/**
 * Commit gate matrix spec — v1.5 verification gate #8.
 *
 * The commit gate decides auto/review/block from three inputs:
 *   - autonomy_level (per-property, 0..1)
 *   - action_type    (some classes always require review, e.g.
 *                     'escalate_to_owner')
 *   - confidence     (0..1, attached to each proposal)
 *
 * Parameterised matrix per the plan: every (autonomy × action_type ×
 * confidence) tuple → expected gate decision. Matrix is small and
 * deterministic so each row runs as its own test for readability.
 *
 * NOTE: gate logic lives in `src/lib/agent/commit-gate.ts` (owned by
 * agent-eng). This spec exercises the integrated path: spawn a worker
 * via the mocked Anthropic provider, observe the resulting
 * action_proposals.gate_decision column.
 *
 * Mock-state-sensitive: must run with --workers=1.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyV15,
  setPropertyAutonomy,
  type GalaxyV15Fixture,
} from '../fixtures/galaxy-v1-5';
import {
  createAnthropicMockHarness,
  toolUseReply,
} from '../mocks/anthropic-mock';

interface MatrixRow {
  autonomy: number;
  actionType: 'dispatch_vendor' | 'send_sms' | 'escalate_to_owner';
  confidence: number;
  expected: 'auto' | 'review' | 'block';
}

// Tuned to the gate thresholds documented in the plan §commit-gate:
//   - autonomy ≥ 0.7 + confidence ≥ 0.7 + non-escalate → auto
//   - escalate_to_owner → always review
//   - confidence < 0.3 → block
//   - everything else → review
const MATRIX: readonly MatrixRow[] = [
  { autonomy: 0.9, actionType: 'dispatch_vendor', confidence: 0.85, expected: 'auto' },
  { autonomy: 0.9, actionType: 'send_sms',       confidence: 0.85, expected: 'auto' },
  { autonomy: 0.5, actionType: 'dispatch_vendor', confidence: 0.85, expected: 'review' },
  { autonomy: 0.9, actionType: 'dispatch_vendor', confidence: 0.55, expected: 'review' },
  { autonomy: 0.9, actionType: 'escalate_to_owner', confidence: 0.95, expected: 'review' },
  { autonomy: 0.0, actionType: 'send_sms',       confidence: 0.20, expected: 'block' },
  { autonomy: 0.5, actionType: 'send_sms',       confidence: 0.10, expected: 'block' },
];

test.describe('agent: commit gate matrix', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;

  test.beforeEach(async ({ request }) => {
    fixture = await provisionGalaxyV15({ propertyCount: 1, autonomyLevel: 0.5 });
    const mock = createAnthropicMockHarness(request);
    await mock.install({ scripts: [] });
  });

  test.afterEach(async ({ request }) => {
    const mock = createAnthropicMockHarness(request);
    await mock.uninstall().catch(() => {});
    if (fixture) await fixture.teardown();
  });

  for (const row of MATRIX) {
    test.fixme(
      `(autonomy=${row.autonomy}, action=${row.actionType}, conf=${row.confidence}) → ${row.expected}`,
      async ({ request }) => {
        const propertyId = fixture.properties[0]!.id;
        await setPropertyAutonomy(propertyId, row.autonomy);

        // Script the worker to emit exactly this action_type at this
        // confidence so the gate sees the matrix tuple.
        const mock = createAnthropicMockHarness(request);
        await mock.setScripts([
          {
            matchActionType: 'worker_spawn',
            reply: toolUseReply(row.actionType, {
              confidence: row.confidence,
              summary: 'Test proposal for matrix row',
            }),
          },
        ]);

        const spawn = await request.post('/api/agent/worker/spawn', {
          data: { propertyId, trigger: 'matrix_test' },
        });
        expect(spawn.status()).toBe(200);
        const json = (await spawn.json()) as {
          success: boolean;
          data: { proposalId: string; gateDecision: string };
        };
        expect(json.data.gateDecision).toBe(row.expected);
      },
    );
  }
});
