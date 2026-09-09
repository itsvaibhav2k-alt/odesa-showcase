/**
 * Unit tests for the Wave 7 Ask Odesa chip framework.
 *
 * Covers four pure surfaces:
 *   - `deriveChipSet`     — one branch per status, plus action-kind shape.
 *   - `buildPlaceholder`  — name interpolation + empty-name fallback.
 *   - `buildContextLabel` — status × hasWorkOrder matrix.
 *   - `interpolateTemplate` — happy path, multiple placeholders, empty name.
 */
import { describe, expect, it } from 'vitest';

import {
  buildContextLabel,
  buildPlaceholder,
  deriveChipSet,
  interpolateTemplate,
  type ChipContext,
} from '@/lib/inbox/ask-odesa-chips';

function makeCtx(overrides: Partial<ChipContext> = {}): ChipContext {
  return {
    status: 'handled',
    hasPendingDraft: false,
    hasWorkOrder: false,
    tenantFirstName: 'Priya',
    tenantResolved: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// deriveChipSet
// ---------------------------------------------------------------------------

describe('deriveChipSet', () => {
  it('returns exactly 4 chips for the review status', () => {
    const chips = deriveChipSet(makeCtx({ status: 'review' }));
    expect(chips).toHaveLength(4);
  });

  it('returns exactly 4 chips for the escalated status', () => {
    const chips = deriveChipSet(makeCtx({ status: 'escalated' }));
    expect(chips).toHaveLength(4);
  });

  it('suppresses tenant-specific chips and leads with "Link tenant" when unmatched', () => {
    const chips = deriveChipSet(makeCtx({ status: 'handled', tenantResolved: false }));
    expect(chips[0]?.label).toBe('Link tenant');
    // No chip may carry an unresolved tenant-name template.
    for (const chip of chips) {
      const text =
        chip.action.kind === 'prefill_override'
          ? chip.action.template
          : chip.action.kind === 'ask_assistant'
            ? chip.action.prompt
            : '';
      expect(text).not.toContain('{tenantFirstName}');
    }
  });

  it('returns exactly 4 chips for the handled status', () => {
    const chips = deriveChipSet(makeCtx({ status: 'handled' }));
    expect(chips).toHaveLength(4);
  });

  it('returns exactly 4 chips for the draft status', () => {
    const chips = deriveChipSet(makeCtx({ status: 'draft' }));
    expect(chips).toHaveLength(4);
  });

  it('returns review chips that include Review & send → approve_draft', () => {
    const chips = deriveChipSet(makeCtx({ status: 'review' }));
    const first = chips[0];
    expect(first.label).toBe('Review & send');
    expect(first.action).toEqual({ kind: 'approve_draft' });
  });

  it('maps the approve chip to the confirm-request action kind, never a direct send', () => {
    // Send safety (Stage 7): `approve_draft` is dispatched by
    // <AskOdesaBar /> to `requestSendConfirm()` (opens the confirm
    // dialog). The chip definition must not carry any payload that
    // could short-circuit into a send.
    const chips = deriveChipSet(makeCtx({ status: 'review' }));
    const approve = chips.find((c) => c.action.kind === 'approve_draft');
    expect(approve).toBeDefined();
    expect(approve?.label).toBe('Review & send');
    // Tagged union carries ONLY the kind — no send payload.
    expect(approve?.action).toEqual({ kind: 'approve_draft' });
    // And no chip set contains more than one approve-flavoured action.
    const approveChips = chips.filter(
      (c) => c.action.kind === 'approve_draft',
    );
    expect(approveChips).toHaveLength(1);
  });

  it('returns review chips that include a regenerate_draft instruction', () => {
    const chips = deriveChipSet(makeCtx({ status: 'review' }));
    const regen = chips.find((c) => c.action.kind === 'regenerate_draft');
    expect(regen?.label).toBe('Soften the reminder');
    expect(regen?.action.kind).toBe('regenerate_draft');
  });

  it('returns review chips that include a prefill_override template', () => {
    const chips = deriveChipSet(makeCtx({ status: 'review' }));
    const prefill = chips.find((c) => c.action.kind === 'prefill_override');
    expect(prefill?.label).toBe('Ask for a photo');
    if (prefill?.action.kind === 'prefill_override') {
      expect(prefill.action.template).toContain('{tenantFirstName}');
    } else {
      throw new Error('expected prefill_override action');
    }
  });

  it('returns review chips that include an ask_assistant fallback', () => {
    const chips = deriveChipSet(makeCtx({ status: 'review' }));
    const ask = chips.find((c) => c.action.kind === 'ask_assistant');
    expect(ask?.label).toBe('Why this draft?');
  });

  it('returns escalated chips that include the backup-vendor ask_assistant', () => {
    const chips = deriveChipSet(makeCtx({ status: 'escalated' }));
    expect(chips.map((c) => c.label)).toContain('Switch to backup vendor');
  });

  it('returns escalated chips that include two regenerate_draft chips', () => {
    const chips = deriveChipSet(makeCtx({ status: 'escalated' }));
    const regens = chips.filter((c) => c.action.kind === 'regenerate_draft');
    expect(regens).toHaveLength(2);
  });

  it('returns handled chips that include a payment-history ask_assistant', () => {
    const chips = deriveChipSet(makeCtx({ status: 'handled' }));
    expect(chips.map((c) => c.label)).toContain('Show payment history');
  });

  it('returns handled chips that include a check-in prefill_override', () => {
    const chips = deriveChipSet(makeCtx({ status: 'handled' }));
    const prefill = chips.find((c) => c.action.kind === 'prefill_override');
    expect(prefill?.label).toBe('Schedule a check-in');
  });

  it('returns draft chips that include Generate a draft → regenerate_draft', () => {
    const chips = deriveChipSet(makeCtx({ status: 'draft' }));
    const gen = chips[0];
    expect(gen.label).toBe('Generate a draft');
    expect(gen.action.kind).toBe('regenerate_draft');
  });

  it('returns draft chips that include Mark spam → ask_assistant', () => {
    const chips = deriveChipSet(makeCtx({ status: 'draft' }));
    const spam = chips.find((c) => c.label === 'Mark spam');
    expect(spam?.action.kind).toBe('ask_assistant');
  });

  it('returns a fresh array per call (callers can mutate safely)', () => {
    const a = deriveChipSet(makeCtx({ status: 'review' }));
    const b = deriveChipSet(makeCtx({ status: 'review' }));
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });
});

// ---------------------------------------------------------------------------
// buildPlaceholder
// ---------------------------------------------------------------------------

describe('buildPlaceholder', () => {
  it('interpolates the first name into the review placeholder', () => {
    const out = buildPlaceholder(
      makeCtx({ status: 'review', tenantFirstName: 'Priya' }),
    );
    expect(out).toBe("Ask Odesa about Priya's draft…");
  });

  it('falls back to a generic phrasing when the first name is empty for review', () => {
    const out = buildPlaceholder(
      makeCtx({ status: 'review', tenantFirstName: '' }),
    );
    expect(out).toBe('Ask Odesa about the pending draft…');
  });

  it('interpolates the first name into the escalated placeholder', () => {
    const out = buildPlaceholder(
      makeCtx({ status: 'escalated', tenantFirstName: 'Jamie' }),
    );
    expect(out).toBe("Ask Odesa about Jamie's vendor delay…");
  });

  it('uses "draft a reply" phrasing for the draft status', () => {
    const out = buildPlaceholder(
      makeCtx({ status: 'draft', tenantFirstName: 'Sam' }),
    );
    expect(out).toBe('Ask Odesa to draft a reply to Sam…');
  });

  it('uses bare "this thread" fallback for handled status without a name', () => {
    const out = buildPlaceholder(
      makeCtx({ status: 'handled', tenantFirstName: '   ' }),
    );
    expect(out).toBe('Ask Odesa about this thread…');
  });

  it('trims surrounding whitespace from the tenant first name', () => {
    const out = buildPlaceholder(
      makeCtx({ status: 'handled', tenantFirstName: '  Lee  ' }),
    );
    expect(out).toBe('Ask Odesa about Lee…');
  });
});

// ---------------------------------------------------------------------------
// buildContextLabel
// ---------------------------------------------------------------------------

describe('buildContextLabel', () => {
  it('returns "pending draft" for review without a work order', () => {
    expect(buildContextLabel(makeCtx({ status: 'review' }))).toBe(
      'pending draft',
    );
  });

  it('returns "work order draft" for review with a work order', () => {
    expect(
      buildContextLabel(makeCtx({ status: 'review', hasWorkOrder: true })),
    ).toBe('work order draft');
  });

  it('returns "vendor delay" for escalated', () => {
    expect(buildContextLabel(makeCtx({ status: 'escalated' }))).toBe(
      'vendor delay',
    );
  });

  it('returns "new inbound" for draft without a work order', () => {
    expect(buildContextLabel(makeCtx({ status: 'draft' }))).toBe('new inbound');
  });

  it('returns "work order intake" for draft with a work order', () => {
    expect(
      buildContextLabel(makeCtx({ status: 'draft', hasWorkOrder: true })),
    ).toBe('work order intake');
  });

  it('returns "quiet thread" for handled without a work order', () => {
    expect(buildContextLabel(makeCtx({ status: 'handled' }))).toBe(
      'quiet thread',
    );
  });

  it('returns "work order resolved" for handled with a work order', () => {
    expect(
      buildContextLabel(makeCtx({ status: 'handled', hasWorkOrder: true })),
    ).toBe('work order resolved');
  });
});

// ---------------------------------------------------------------------------
// interpolateTemplate
// ---------------------------------------------------------------------------

describe('interpolateTemplate', () => {
  it('replaces a single {tenantFirstName} placeholder', () => {
    const out = interpolateTemplate('Hi {tenantFirstName}, hello.', {
      tenantFirstName: 'Priya',
    });
    expect(out).toBe('Hi Priya, hello.');
  });

  it('replaces multiple {tenantFirstName} placeholders', () => {
    const out = interpolateTemplate(
      '{tenantFirstName} — yes {tenantFirstName}!',
      { tenantFirstName: 'Sam' },
    );
    expect(out).toBe('Sam — yes Sam!');
  });

  it('falls back to "there" when the first name is empty', () => {
    const out = interpolateTemplate('Hi {tenantFirstName}!', {
      tenantFirstName: '',
    });
    expect(out).toBe('Hi there!');
  });

  it('falls back to "there" when the first name is whitespace-only', () => {
    const out = interpolateTemplate('Hi {tenantFirstName}!', {
      tenantFirstName: '   ',
    });
    expect(out).toBe('Hi there!');
  });

  it('is a no-op for strings without placeholders', () => {
    const out = interpolateTemplate('Hi friend.', { tenantFirstName: 'Priya' });
    expect(out).toBe('Hi friend.');
  });
});
