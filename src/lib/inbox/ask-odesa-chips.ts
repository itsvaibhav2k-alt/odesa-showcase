/**
 * Ask Odesa chip framework — Wave 7.
 *
 * Pure, framework-free derivation of the contextual chip set, the
 * input-row placeholder, and the "In context — {label}" subline that
 * pin to the bottom of the case-file pane.
 *
 * The framework is split into three pieces so each is independently
 * testable and the consumer (`<AskOdesaBar />`) is a thin renderer:
 *
 *   - `deriveChipSet(ctx)`        — the 4 chips to show for `ctx.status`.
 *   - `buildPlaceholder(ctx)`     — the input-row placeholder string.
 *   - `buildContextLabel(ctx)`    — the short label after "In context —".
 *
 * Chip actions are tagged unions so the dispatcher in
 * `<AskOdesaBar />` can switch on `action.kind` with exhaustive typing.
 * Templates use `{tenantFirstName}` placeholders interpolated by
 * `interpolateTemplate(template, ctx)`.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ChipAction =
  | { kind: 'approve_draft' }
  | { kind: 'reject_draft' }
  | { kind: 'prefill_override'; template: string }
  | { kind: 'regenerate_draft'; instruction: string }
  | { kind: 'ask_assistant'; prompt: string };

export interface ChipDef {
  label: string;
  action: ChipAction;
}

/**
 * Status taxonomy understood by the chip framework. Mirrors the
 * non-`watching` subset of `QueueStatusKind` — `watching` rows collapse
 * to `handled` for chip-selection purposes.
 */
export type ChipStatus = 'review' | 'draft' | 'escalated' | 'handled';

export interface ChipContext {
  status: ChipStatus;
  /** True when an outbound `pending_review` draft message is in flight. */
  hasPendingDraft: boolean;
  /** True when the conversation has at least one open work order. */
  hasWorkOrder: boolean;
  /** Display first name for placeholder/template interpolation. */
  tenantFirstName: string;
  /**
   * True when the thread is linked to a known tenant (`tenant_id` set).
   * When false the thread is unmatched: tenant-specific chips are
   * suppressed and a "Link tenant" affordance is shown instead, so Odesa
   * never sends a tenant-specific rent/payment action to "Unknown".
   */
  tenantResolved: boolean;
}

/**
 * Chip shown on an unmatched thread (no linked tenant). Routes to the
 * read-only assistant to resolve the match — never a silent no-op and
 * never tenant-specific.
 */
const LINK_TENANT_CHIP: ChipDef = {
  label: 'Link tenant',
  action: {
    kind: 'ask_assistant',
    prompt:
      'This thread is not linked to a tenant yet. Help me find and link the right tenant before sending any tenant-specific rent or payment actions.',
  },
};

/** True when a chip's action embeds a tenant-name template/prompt. */
function isTenantSpecificChip(chip: ChipDef): boolean {
  const a = chip.action;
  const text =
    a.kind === 'prefill_override'
      ? a.template
      : a.kind === 'ask_assistant'
        ? a.prompt
        : '';
  return text.includes('{tenantFirstName}');
}

// ---------------------------------------------------------------------------
// Chip derivation
// ---------------------------------------------------------------------------

const CHIP_SETS: Record<ChipStatus, readonly ChipDef[]> = {
  review: [
    // Send safety (Stage 7): this chip REQUESTS the send-confirm
    // dialog (see `<AskOdesaBar />` dispatch) — it never sends directly.
    { label: 'Review & send', action: { kind: 'approve_draft' } },
    {
      label: 'Soften the reminder',
      action: {
        kind: 'regenerate_draft',
        instruction: 'Soften the tone — warm, neutral, no pressure.',
      },
    },
    {
      label: 'Ask for a photo',
      action: {
        kind: 'prefill_override',
        template:
          'Hi {tenantFirstName}, can you send a quick photo of the issue?',
      },
    },
    {
      label: 'Why this draft?',
      action: {
        kind: 'ask_assistant',
        prompt: 'Why did you draft the pending reply this way?',
      },
    },
  ],
  escalated: [
    {
      label: 'Nudge vendor once more',
      action: {
        kind: 'regenerate_draft',
        instruction:
          'Draft a polite but firm follow-up to the vendor asking for an ETA.',
      },
    },
    {
      label: 'Switch to backup vendor',
      action: {
        kind: 'ask_assistant',
        prompt: 'Should I switch to the backup vendor for this work order?',
      },
    },
    {
      label: 'Draft a tenant update',
      action: {
        kind: 'regenerate_draft',
        instruction:
          'Draft a brief, transparent status update to the tenant about the vendor delay.',
      },
    },
    {
      label: 'Show vendor history',
      action: {
        kind: 'ask_assistant',
        prompt: 'Show the recent history for this vendor.',
      },
    },
  ],
  handled: [
    {
      label: 'Show payment history',
      action: {
        kind: 'ask_assistant',
        prompt: "Show {tenantFirstName}'s payment history for the past year.",
      },
    },
    {
      label: 'Schedule a check-in',
      action: {
        kind: 'prefill_override',
        template:
          'Hi {tenantFirstName}, want to schedule a quick check-in this week?',
      },
    },
    {
      label: 'Mark fully resolved',
      action: {
        kind: 'ask_assistant',
        prompt: 'Mark this conversation fully resolved.',
      },
    },
    {
      label: 'Watch for repeats',
      action: {
        kind: 'ask_assistant',
        prompt: 'Watch this thread for repeat issues over the next 30 days.',
      },
    },
  ],
  draft: [
    {
      label: 'Generate a draft',
      action: {
        kind: 'regenerate_draft',
        instruction:
          'Draft a first reply to the most recent inbound message.',
      },
    },
    {
      label: 'Ask for more details',
      action: {
        kind: 'prefill_override',
        template:
          'Hi {tenantFirstName}, can you share a bit more about what is happening?',
      },
    },
    {
      label: 'Show similar past threads',
      action: {
        kind: 'ask_assistant',
        prompt: 'Show similar past threads from this tenant.',
      },
    },
    {
      label: 'Mark spam',
      action: {
        kind: 'ask_assistant',
        prompt: 'Mark this conversation as spam.',
      },
    },
  ],
};

/**
 * Returns the chip set for the given context. Chips are returned as a
 * fresh array per call so consumers can safely mutate (e.g. for
 * animation keys) without mutating the canonical definitions.
 *
 * @param ctx - The chip context (status + flags + tenant first name).
 * @returns A 4-chip array, label + tagged action.
 *
 * @example
 *   const chips = deriveChipSet({ status: 'review', ... });
 *   chips[0].label // 'Review & send'
 */
export function deriveChipSet(ctx: ChipContext): ChipDef[] {
  const base = CHIP_SETS[ctx.status].map((c) => ({ ...c }));
  if (ctx.tenantResolved) return base;
  // Unmatched thread: drop tenant-specific chips and lead with "Link tenant"
  // so no tenant-named action can fire against "Unknown".
  return [LINK_TENANT_CHIP, ...base.filter((c) => !isTenantSpecificChip(c))];
}

// ---------------------------------------------------------------------------
// Placeholder + context label
// ---------------------------------------------------------------------------

/**
 * Builds the input-row placeholder text. Adapts to the status so the
 * operator immediately sees what Odesa expects: "Ask Odesa about
 * Priya's leak…" vs. "Ask Odesa to draft a reply…".
 *
 * @param ctx - The chip context.
 * @returns A short placeholder string ending with an ellipsis.
 */
export function buildPlaceholder(ctx: ChipContext): string {
  const firstName = ctx.tenantFirstName.trim();
  switch (ctx.status) {
    case 'review':
      return firstName
        ? `Ask Odesa about ${firstName}'s draft…`
        : 'Ask Odesa about the pending draft…';
    case 'escalated':
      return firstName
        ? `Ask Odesa about ${firstName}'s vendor delay…`
        : 'Ask Odesa about the vendor delay…';
    case 'draft':
      return firstName
        ? `Ask Odesa to draft a reply to ${firstName}…`
        : 'Ask Odesa to draft a reply…';
    case 'handled':
    default:
      return firstName
        ? `Ask Odesa about ${firstName}…`
        : 'Ask Odesa about this thread…';
  }
}

/**
 * Builds the short subline rendered after "In context — ". Conveys
 * what Odesa thinks the operator is asking about so the chips feel
 * grounded ("leak escalation" vs. "rent reminder" vs. "vendor delay").
 *
 * @param ctx - The chip context.
 * @returns A 1-3 word label (no leading/trailing punctuation).
 */
export function buildContextLabel(ctx: ChipContext): string {
  if (!ctx.tenantResolved) return 'unlinked thread';
  switch (ctx.status) {
    case 'review':
      return ctx.hasWorkOrder ? 'work order draft' : 'pending draft';
    case 'escalated':
      return 'vendor delay';
    case 'draft':
      return ctx.hasWorkOrder ? 'work order intake' : 'new inbound';
    case 'handled':
    default:
      return ctx.hasWorkOrder ? 'work order resolved' : 'quiet thread';
  }
}

// ---------------------------------------------------------------------------
// Template interpolation
// ---------------------------------------------------------------------------

/**
 * Interpolates `{tenantFirstName}` placeholders in a chip template.
 * Falls back to a tasteful generic (`there`) when the first name is
 * empty so the resulting message reads naturally.
 *
 * @param template - Source template with `{tenantFirstName}` markers.
 * @param ctx      - Chip context providing the first name.
 * @returns The interpolated string.
 *
 * @example
 *   interpolateTemplate('Hi {tenantFirstName}', { tenantFirstName: 'Priya', ... })
 *   // → 'Hi Priya'
 */
export function interpolateTemplate(
  template: string,
  ctx: Pick<ChipContext, 'tenantFirstName'>,
): string {
  const name = ctx.tenantFirstName.trim() || 'there';
  return template.replaceAll('{tenantFirstName}', name);
}
