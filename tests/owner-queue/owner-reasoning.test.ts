/**
 * Unit tests for the Owner Queue owner-facing reasoning derivation.
 *
 * These lock the release-readiness guarantee (Task 7C): the Decisions Desk
 * dossier must render structured HUMAN copy, never raw classifier/source enum
 * tokens (e.g. `payment_cleared_claim`, `source: retell_voice`) that voice- and
 * policy-originated proposals write into `action_proposals.reasoning`.
 *
 * The derivation is PURE (no IO, no React) so the honest-copy contract is
 * locked without a live DB — mirroring the other pure owner-queue suites.
 */
import { describe, expect, it } from 'vitest';

import {
  cleanReasoning,
  deriveOwnerReasoning,
  humanizeClassifier,
  humanizeSource,
  type OwnerReasoningLabel,
} from '@/lib/owner-queue/owner-reasoning';
import { WORKER_ACTION_TYPES } from '@/lib/agent/worker/types';

// A snake_case enum token rendered bare (what must NEVER reach owner copy).
const BARE_TOKEN = /^[a-z0-9_]+$/;

// The exact leak-string a voice draft parks in `reasoning` (send_sms_followup
// builds `${category}: ${reason}`, create-draft appends `(source: …, call …)`).
const VOICE_LEAK_REASONING =
  'payment_cleared_claim: ledger honesty: never claim a payment was received, cleared, or processed (source: retell_voice, call call_abc123)';

const ALL_LABELS: OwnerReasoningLabel[] = [
  'Trigger',
  'Evidence',
  'Safety boundary',
  'Recommended next action',
  'Source',
  'If ignored',
];

// ---------------------------------------------------------------------------
// humanizeClassifier
// ---------------------------------------------------------------------------

describe('humanizeClassifier', () => {
  it('maps a known classifier token to a calm owner sentence', () => {
    expect(humanizeClassifier('payment_cleared_claim')).toBe(
      'Tenant claims a payment already cleared',
    );
  });

  it('never emits a bare snake_case token for a known category', () => {
    for (const token of [
      'payment_cleared_claim',
      'fee_waiver',
      'dispatch_promise',
      'legal_or_eviction',
    ]) {
      expect(humanizeClassifier(token)).not.toMatch(BARE_TOKEN);
    }
  });

  it('falls back to a readable "Automated classifier" label for unknown tokens (never bare)', () => {
    const out = humanizeClassifier('some_new_category');
    expect(out).toBe('Automated classifier: some_new_category');
    // The whole string is not a bare token (it has caps + spaces + colon).
    expect(out).not.toMatch(BARE_TOKEN);
  });

  it('returns empty string for an empty token', () => {
    expect(humanizeClassifier('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// humanizeSource
// ---------------------------------------------------------------------------

describe('humanizeSource', () => {
  it('maps the retell_voice source to a human origin', () => {
    expect(humanizeSource('retell_voice')).toBe('Voice call (Retell)');
  });

  it('gives an unknown source a readable, non-bare fallback', () => {
    const out = humanizeSource('some_channel');
    expect(out).not.toMatch(BARE_TOKEN);
    expect(out).toContain('some_channel');
  });
});

// ---------------------------------------------------------------------------
// cleanReasoning — the primary "Odesa recommends" one-liner
// ---------------------------------------------------------------------------

describe('cleanReasoning', () => {
  it('humanizes the classifier prefix and strips the source suffix', () => {
    const out = cleanReasoning(VOICE_LEAK_REASONING);
    expect(out).toContain('Tenant claims a payment already cleared');
    // No raw token, no "source:" tag, no call id in the primary line.
    expect(out).not.toMatch(/payment_cleared_claim/);
    expect(out).not.toMatch(/source:/i);
    expect(out).not.toMatch(/retell_voice/);
    expect(out).not.toMatch(/call_abc123/);
  });

  it('strips a source suffix even when there is no classifier prefix', () => {
    const out = cleanReasoning(
      'Tenant asked to pay by card next week (source: retell_voice)',
    );
    expect(out).toBe('Tenant asked to pay by card next week');
  });

  it('is a no-op for already-clean human reasoning', () => {
    const clean = 'Rent is reliably paid on the 3rd. Tenant asked for a reminder.';
    expect(cleanReasoning(clean)).toBe(clean);
  });

  it('returns empty string for empty/missing reasoning', () => {
    expect(cleanReasoning('')).toBe('');
    expect(cleanReasoning(null)).toBe('');
    expect(cleanReasoning(undefined)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// deriveOwnerReasoning — the structured 6-section dossier copy
// ---------------------------------------------------------------------------

describe('deriveOwnerReasoning', () => {
  it('never emits a bare enum token or a "source:" prefix in any section', () => {
    const sections = deriveOwnerReasoning({
      reasoning: VOICE_LEAK_REASONING,
      actionType: 'draft_sms_reply',
      gate: 'review',
      recommendation: 'hold',
      sourceLabels: ['Tenant messages'],
    });
    for (const section of sections) {
      expect(section.detail).not.toMatch(BARE_TOKEN);
      expect(section.detail).not.toMatch(/^source:/i);
      expect(section.detail).not.toContain('source: retell_voice');
      expect(section.detail).not.toContain('payment_cleared_claim');
    }
  });

  it('humanizes the classifier trigger and voice source', () => {
    const sections = deriveOwnerReasoning({
      reasoning: VOICE_LEAK_REASONING,
      actionType: 'draft_sms_reply',
      gate: 'review',
      recommendation: 'hold',
    });
    const byLabel = Object.fromEntries(
      sections.map((s) => [s.label, s.detail]),
    );
    expect(byLabel.Trigger).toBe('Tenant claims a payment already cleared');
    expect(byLabel.Source).toBe('Voice call (Retell)');
  });

  it('emits all six labeled sections, in order, for a representative proposal of each action_type', () => {
    const representative = [
      'draft_sms_reply',
      'send_tenant_message',
      'dispatch_vendor',
      'request_rent_payment',
      'update_rent',
      'set_lease_terms',
      'health_flag',
      'voice_call_review',
    ].filter((t) => (WORKER_ACTION_TYPES as readonly string[]).includes(t) ||
      t === 'health_flag' || t === 'voice_call_review');

    for (const actionType of representative) {
      const sections = deriveOwnerReasoning({
        reasoning:
          'Active issue reported by the tenant. Prior context supports acting now.',
        actionType,
        gate: 'review',
        recommendation: 'hold',
        sourceLabels: ['Tenant messages'],
      });
      const labels = sections.map((s) => s.label);
      expect(labels, `sections for ${actionType}`).toEqual(ALL_LABELS);
      for (const s of sections) {
        expect(s.detail.trim().length, `${actionType} ${s.label}`).toBeGreaterThan(0);
      }
    }
  });

  it('reuses the shared decision-actions copy maps for boundary / next-action / if-ignored', () => {
    const sections = deriveOwnerReasoning({
      reasoning: 'Vendor estimate received. Active leak in unit.',
      actionType: 'dispatch_vendor',
      gate: 'review',
      recommendation: 'hold',
    });
    const byLabel = Object.fromEntries(sections.map((s) => [s.label, s.detail]));
    expect(byLabel['Safety boundary']).toBe(
      'Vendor is not contacted from this action — Odesa records your approval for the dispatch workflow.',
    );
    expect(byLabel['Recommended next action']).toBe('Record dispatch approval');
  });

  it('does not mutate its input and leaves the raw reasoning recoverable', () => {
    const input = {
      reasoning: VOICE_LEAK_REASONING,
      actionType: 'draft_sms_reply',
      gate: 'review',
      recommendation: 'hold' as const,
    };
    deriveOwnerReasoning(input);
    // Raw audit string is untouched by the pure derivation.
    expect(input.reasoning).toBe(VOICE_LEAK_REASONING);
  });

  it('omits Trigger/Evidence but keeps the action-derived sections when reasoning is absent', () => {
    const sections = deriveOwnerReasoning({
      reasoning: null,
      actionType: 'dispatch_vendor',
      gate: 'review',
      recommendation: 'hold',
    });
    const labels = sections.map((s) => s.label);
    expect(labels).not.toContain('Trigger');
    expect(labels).toContain('Safety boundary');
    expect(labels).toContain('Recommended next action');
    expect(labels).toContain('Source');
    expect(labels).toContain('If ignored');
  });
});
