/**
 * Call scripts — the typed, landlord-readable source of truth for how the
 * Voice Operator behaves per call type, plus the override schema for the
 * owner's custom notes stored in `voice_settings.script_overrides` (jsonb).
 *
 * WHY pure code, not a table: the default behavior and the safety boundaries
 * are policy, not data. `safetyBoundaries` deliberately mirrors the tier-4
 * hard limits and privacy rules in `policy.ts` so the inspectable script a
 * landlord reads on /calls says exactly what the deterministic gate enforces.
 * Owners may only ADD custom notes on top — they can never edit or relax a
 * boundary here (that surface is muted/read-only in the editor).
 *
 * Two schemas by design:
 *   - `scriptOverridesSchema` — STRICT write path. Validates the customNotes
 *     bounds on whatever keys are present and rejects unknown keys.
 *   - `parseScriptOverrides` — LENIENT read path over jsonb that may have
 *     rotted. Drops anything it does not recognize and NEVER throws.
 *
 * NO React, NO Supabase, NO network. Fully vitest-safe on plain objects.
 */

import { z } from 'zod';

export const CALL_SCRIPT_TYPES = [
  'maintenance_request',
  'rent_payment_dispute',
  'owner_briefing',
  'vendor_context',
  'unknown_caller',
] as const;

export type CallScriptType = (typeof CALL_SCRIPT_TYPES)[number];

export interface CallScript {
  type: CallScriptType;
  title: string;
  summary: string;
  defaultBehavior: string[];
  safetyBoundaries: string[];
  collectedFields: string[];
}

/**
 * Default script behavior per call type. Seeded and split out from the three
 * hardcoded Call-scripts ConfigPanels that used to live in
 * calls-command-center.tsx. `safetyBoundaries` mirrors policy.ts tier-4
 * vocabulary (process payment / waive fee / threaten legal / amend lease /
 * dispatch vendor with cost / promise appointment / promise emergency
 * dispatch / disclose private data) and the disclosure matrix.
 */
export const CALL_SCRIPTS: Record<CallScriptType, CallScript> = {
  maintenance_request: {
    type: 'maintenance_request',
    title: 'Maintenance request',
    summary: 'A tenant reporting a repair or maintenance issue.',
    defaultBehavior: [
      'Confirm caller identity, property, and unit before acting.',
      'Capture the issue, symptoms, when it started, and severity.',
      'Screen for emergencies (flooding, gas, no heat, no power, security) and escalate those immediately.',
      'Ask about access permission and scheduling constraints.',
      'Create a work order only when evidence and policy allow it; otherwise log a note and escalate.',
      'Send a safe confirmation SMS or draft an owner follow-up when appropriate.',
    ],
    safetyBoundaries: [
      'Never promise that a plumber, technician, or any responder is on the way — escalate instead.',
      'Never promise or confirm an appointment time; say the owner will follow up.',
      'Never dispatch a vendor or commit to a repair cost.',
      'Never disclose tenant, owner, or vendor data to an unresolved caller.',
    ],
    collectedFields: [
      'Caller identity and callback number',
      'Property and unit',
      'Issue and symptoms',
      'When it started and severity',
      'Emergency screen (flooding, gas, heat, power, security)',
      'Access permission and scheduling constraints',
    ],
  },
  rent_payment_dispute: {
    type: 'rent_payment_dispute',
    title: 'Rent or payment dispute',
    summary: 'A caller asking about rent status or disputing a payment.',
    defaultBehavior: [
      'Answer factual rent status for verified tenants or owners only, using ledger-honest wording.',
      'For a disputed payment, request proof (screenshot or confirmation) rather than adjusting the ledger.',
      'Never pressure the caller, waive fees, or agree to payment terms.',
      'Flag disputes and sensitive claims for owner review.',
    ],
    safetyBoundaries: [
      'Never claim a payment was received, cleared, or processed — report only what the ledger shows.',
      'Never process a payment or move money.',
      'Never waive, reduce, or forgive a fee — that is an owner decision.',
      'Never agree to a payment plan or new payment terms.',
      'Never threaten legal action or eviction.',
      'Never disclose ledger or tenant data to an unresolved or unverified caller.',
    ],
    collectedFields: [
      'Caller identity and verification',
      'Property and unit',
      'Disputed amount or period',
      'Payment method and date claimed',
      'Proof offered (screenshot, confirmation number)',
    ],
  },
  owner_briefing: {
    type: 'owner_briefing',
    title: 'Owner briefing',
    summary: 'A verified property owner asking for a portfolio briefing.',
    defaultBehavior: [
      'Confirm the caller is a verified owner before sharing any portfolio data.',
      'Provide the requested briefing: open issues, rent status, and recent activity.',
      'Record owner instructions as notes or queue items; never execute restricted actions on request.',
      "Escalate anything requiring judgment back to the owner's own review queue.",
    ],
    safetyBoundaries: [
      'Only a verified owner may hear portfolio, tenant, or ledger data.',
      'Never disclose owner or tenant data to a caller who is not a verified owner.',
      'An owner request cannot authorize a fee waiver, payment, lease change, or vendor dispatch on the call — those stay owner-reviewed actions.',
      "Never promise appointments, dispatch, or scheduling on the owner's behalf.",
    ],
    collectedFields: [
      'Owner identity and verification',
      'Properties or units in scope',
      'Briefing topics requested (issues, rent, activity)',
      'Any instructions to record for review',
    ],
  },
  vendor_context: {
    type: 'vendor_context',
    title: 'Vendor coordination',
    summary: 'A known vendor coordinating on their assigned jobs.',
    defaultBehavior: [
      'Confirm the vendor is known before sharing any job context.',
      'Share only the vendor\'s own job context — never tenant, owner, or ledger data.',
      'Collect status updates, ETAs, and completion notes.',
      'Record updates and escalate cost changes or new work to the owner.',
    ],
    safetyBoundaries: [
      'A vendor hears only their own job context — no tenant identity, ledger, or owner portfolio data.',
      'Never dispatch a vendor with a cost commitment or approve new spend.',
      "Never promise an appointment or confirm scheduling on the owner's behalf.",
      'Never disclose private data to an unresolved caller.',
    ],
    collectedFields: [
      'Vendor identity and company',
      'Job or work order reference',
      'Status, ETA, or completion update',
      'Any cost change or additional work to escalate',
    ],
  },
  unknown_caller: {
    type: 'unknown_caller',
    title: 'Unknown or unverified caller',
    summary: 'A caller Odesa cannot identify or verify.',
    defaultBehavior: [
      'Stay polite and helpful without revealing any private data.',
      'Offer to take a message or a callback request.',
      'Attempt light verification only through the safe path; never guess identity.',
      'Route every unresolved or risky outcome to the call dossier for review.',
    ],
    safetyBoundaries: [
      'An unresolved caller receives no tenant names, balances, unit, lease, or owner data through any channel.',
      'Never confirm whether a person, tenancy, or property exists.',
      'Never create tenant-linked records for an unverified caller.',
      'Never process payments, waive fees, threaten legal action, amend a lease, or promise dispatch or appointments.',
    ],
    collectedFields: [
      "Caller's stated name and callback number",
      'Reason for the call',
      'Message to pass along',
      'Any details offered for later verification',
    ],
  },
};

/**
 * A single script override: the only thing an owner may customize. Trimmed,
 * non-empty, capped so a runaway paste cannot bloat the prompt or jsonb.
 */
export const scriptOverrideSchema = z.object({
  customNotes: z.string().trim().min(1).max(2000),
});

export type ScriptOverride = z.infer<typeof scriptOverrideSchema>;

/**
 * Strict WRITE schema. Partial by intent — an owner customizes only some call
 * types, so the map is a subset of CALL_SCRIPT_TYPES. `z.partialRecord`
 * (zod 4) accepts a subset of enum keys while still rejecting unknown keys and
 * bad customNotes; plain `z.record(z.enum(...))` in zod 4 is exhaustive and
 * would reject every real single-override save.
 */
export const scriptOverridesSchema = z.partialRecord(
  z.enum(CALL_SCRIPT_TYPES),
  scriptOverrideSchema,
);

export type ScriptOverrides = z.infer<typeof scriptOverridesSchema>;

/** Narrow an arbitrary string to a known CallScriptType. */
function isCallScriptType(value: string): value is CallScriptType {
  return (CALL_SCRIPT_TYPES as readonly string[]).includes(value);
}

/**
 * Lenient READ parse for `voice_settings.script_overrides` jsonb. The column
 * can hold anything a prior version or a bad write left behind, so this is
 * fail-open on shape but strict per entry:
 *   - non-object (null, string, number, array, etc.) → {}
 *   - keep only keys in CALL_SCRIPT_TYPES whose value safe-parses an override
 *   - drop everything else
 *   - NEVER throws
 *
 * @param value - Raw jsonb value, untrusted.
 * @returns A clean, partial overrides map.
 */
export function parseScriptOverrides(value: unknown): ScriptOverrides {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const out: ScriptOverrides = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isCallScriptType(key)) continue;
    const parsed = scriptOverrideSchema.safeParse(raw);
    if (parsed.success) {
      out[key] = parsed.data;
    }
  }
  return out;
}
