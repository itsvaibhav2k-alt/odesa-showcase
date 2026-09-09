/**
 * Autonomy graduation spec — v1.5 verification gate #9.
 *
 * Trust graduates upward over consecutive successful drafts and falls
 * after rejections. The endpoint applies ONE graduation step per call
 * via `graduateAutonomy(currentLevel, outcome)`.
 *
 * Acceptance:
 *   - Provision a property at autonomy 0.5.
 *   - Replay 50 'committed' outcomes via /api/agent/trust/recompute.
 *     Assert autonomy_level > 0.5 afterward.
 *   - Reset to 0.7. Replay 5 'rejected' outcomes. Assert autonomy_level
 *     < 0.7 afterward.
 *   - Stress test: 200 'committed' calls leave the level inside [0, 1].
 *
 * Endpoint contract (from src/app/api/agent/trust/recompute/route.ts):
 *   - Body: { propertyId, actionType, outcome }
 *   - actionType is accepted but unused in v1 (single autonomy_level
 *     per property; per-action graduation deferred to v1.6). Spec
 *     passes 'draft_sms_reply' for legibility.
 *   - outcome ∈ { 'committed' | 'committed_after_review' | 'edited' |
 *                 'rejected' | 'expired' }
 *   - Response: { success, data: { autonomy_level, delta, clamped } }
 *
 * Not mock-state-sensitive (no Anthropic calls during recompute) — can
 * run with default workers.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  provisionGalaxyV15,
  setPropertyAutonomy,
  type GalaxyV15Fixture,
} from '../fixtures/galaxy-v1-5';

interface RecomputeResponse {
  success: boolean;
  data?: {
    autonomy_level: number;
    delta: number;
    clamped: boolean;
  };
  error?: string;
}

test.describe('agent: autonomy graduation', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;

  test.beforeEach(async () => {
    fixture = await provisionGalaxyV15({ propertyCount: 1, autonomyLevel: 0.5 });
  });

  test.afterEach(async () => {
    if (fixture) await fixture.teardown();
  });

  test('50 successful drafts moves autonomy upward', async ({ request }) => {
    const propertyId = fixture.properties[0]!.id;

    for (let i = 0; i < 50; i++) {
      const resp = await request.post('/api/agent/trust/recompute', {
        data: {
          propertyId,
          actionType: 'draft_sms_reply',
          outcome: 'committed',
        },
      });
      expect(resp.status()).toBe(200);
    }

    const admin = createAdmin();
    const { data: prop } = await admin
      .from('properties')
      .select('autonomy_level')
      .eq('id', propertyId)
      .single();
    expect(Number(prop?.autonomy_level ?? 0)).toBeGreaterThan(0.5);
  });

  test('5 rejections moves autonomy downward', async ({ request }) => {
    const propertyId = fixture.properties[0]!.id;
    // Reset to a known-high baseline so the decrement is observable.
    await setPropertyAutonomy(propertyId, 0.7);

    for (let i = 0; i < 5; i++) {
      const resp = await request.post('/api/agent/trust/recompute', {
        data: {
          propertyId,
          actionType: 'draft_sms_reply',
          outcome: 'rejected',
        },
      });
      expect(resp.status()).toBe(200);
    }

    const admin = createAdmin();
    const { data: prop } = await admin
      .from('properties')
      .select('autonomy_level')
      .eq('id', propertyId)
      .single();
    expect(Number(prop?.autonomy_level ?? 1)).toBeLessThan(0.7);
  });

  test('autonomy stays within [0, 1] under extreme inputs', async ({
    request,
  }) => {
    const propertyId = fixture.properties[0]!.id;

    // 200 'committed' calls would push past 1.0 without clamping.
    let lastClamped = false;
    for (let i = 0; i < 200; i++) {
      const resp = await request.post('/api/agent/trust/recompute', {
        data: {
          propertyId,
          actionType: 'draft_sms_reply',
          outcome: 'committed',
        },
      });
      const json = (await resp.json()) as RecomputeResponse;
      lastClamped = json.data?.clamped ?? false;
    }
    // Stress run should report clamping fired at least on the tail end.
    expect(lastClamped).toBe(true);

    const admin = createAdmin();
    const { data } = await admin
      .from('properties')
      .select('autonomy_level')
      .eq('id', propertyId)
      .single();
    const level = Number(data?.autonomy_level ?? 0);
    expect(level).toBeGreaterThanOrEqual(0);
    expect(level).toBeLessThanOrEqual(1);
  });

  test("'expired' outcome is a no-op", async ({ request }) => {
    const propertyId = fixture.properties[0]!.id;
    const baseline = 0.5;

    const resp = await request.post('/api/agent/trust/recompute', {
      data: {
        propertyId,
        actionType: 'draft_sms_reply',
        outcome: 'expired',
      },
    });
    expect(resp.status()).toBe(200);
    const json = (await resp.json()) as RecomputeResponse;
    expect(json.data?.delta).toBe(0);

    const admin = createAdmin();
    const { data: prop } = await admin
      .from('properties')
      .select('autonomy_level')
      .eq('id', propertyId)
      .single();
    expect(Number(prop?.autonomy_level ?? 0)).toBeCloseTo(baseline, 4);
  });
});
