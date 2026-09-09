/**
 * Late-fee policy engine.
 *
 * Each lease carries a `late_fee_policy` jsonb with one of three shapes:
 *
 *   { "waived": true }                        ← no fee ever
 *   { "kind": "flat",    "amount": 50,        ← single-tier flat fee
 *     "graceDays": 5 }
 *   { "kind": "tiered",  "graceDays": 3,      ← escalating tiers
 *     "tiers": [
 *       { "afterDays": 3, "amount": 25 },
 *       { "afterDays": 7, "amount": 75 }
 *     ] }
 *
 * Callers pass `daysLate` (≥0) and the policy. Returns 0 when within
 * grace or explicitly waived; otherwise the fee that applies *today*.
 *
 * Policy validation lives here (not in a migration CHECK constraint)
 * because the shape is genuinely polymorphic — validating in SQL would
 * mean a trigger or a domain-specific type, which isn't worth it yet.
 */

export interface WaivedPolicy {
  readonly kind: 'waived';
}

export interface FlatPolicy {
  readonly kind: 'flat';
  readonly amount: number;
  readonly graceDays?: number; // default 0
}

export interface TieredPolicy {
  readonly kind: 'tiered';
  readonly graceDays?: number; // default 0
  readonly tiers: readonly { readonly afterDays: number; readonly amount: number }[];
}

export type LateFeePolicy = WaivedPolicy | FlatPolicy | TieredPolicy;

export interface ComputeArgs {
  policy: unknown; // from DB jsonb; validated here
  daysLate: number;
}

export function computeLateFee({ policy, daysLate }: ComputeArgs): number {
  if (daysLate <= 0) return 0;

  const parsed = normalizePolicy(policy);
  if (!parsed) return 0;
  if (parsed.kind === 'waived') return 0;

  if (parsed.kind === 'flat') {
    const grace = parsed.graceDays ?? 0;
    if (daysLate <= grace) return 0;
    return parsed.amount;
  }

  if (parsed.kind === 'tiered') {
    const grace = parsed.graceDays ?? 0;
    if (daysLate <= grace) return 0;
    const applicable = parsed.tiers
      .filter((t) => daysLate > t.afterDays)
      .sort((a, b) => b.afterDays - a.afterDays);
    return applicable[0]?.amount ?? 0;
  }

  return 0;
}

function normalizePolicy(raw: unknown): LateFeePolicy | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  if (o.waived === true) return { kind: 'waived' };

  if (o.kind === 'flat' && typeof o.amount === 'number') {
    return {
      kind: 'flat',
      amount: o.amount,
      graceDays: typeof o.graceDays === 'number' ? o.graceDays : 0,
    };
  }

  if (o.kind === 'tiered' && Array.isArray(o.tiers)) {
    const tiers = (o.tiers as unknown[]).flatMap((t) => {
      if (!t || typeof t !== 'object') return [];
      const rec = t as Record<string, unknown>;
      if (typeof rec.afterDays === 'number' && typeof rec.amount === 'number') {
        return [{ afterDays: rec.afterDays, amount: rec.amount }];
      }
      return [];
    });
    return {
      kind: 'tiered',
      graceDays: typeof o.graceDays === 'number' ? o.graceDays : 0,
      tiers,
    };
  }

  return null;
}
