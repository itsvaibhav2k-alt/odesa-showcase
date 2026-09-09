/**
 * Decay + compaction. Ported from Boop's `server/memory/clean.ts`,
 * adapted to the property-domain `MemoryFact` schema.
 *
 * Formula (per the addendum risk note in the v1.5 plan):
 *
 *   effectiveScore = importance × (1 − decayRate × daysSinceAccess)
 *
 *   archive when score < ARCHIVE_THRESHOLD (0.15)
 *   prune   when score < PRUNE_THRESHOLD   (0.05)
 *
 * The per-fact-type defaults in `FACT_TYPE_DEFAULTS` provide the importance
 * and decayRate. `daysSinceAccess` collapses to `daysSinceCreated` here
 * because the schema has no `last_accessed_at` column — the Phase 4.5 v1
 * intentionally keeps the schema minimal; access-count tracking can be
 * added later if the cap-enforcement heuristic isn't tight enough.
 *
 * Hard cap: 200 active facts per property. When over the cap, oldest
 * non-`owner_rule` facts are archived first (owner-stated rules are the
 * contract — they only leave via explicit supersession).
 */

import {
  ARCHIVE_THRESHOLD,
  FACT_TYPE_DEFAULTS,
  MAX_ACTIVE_FACTS_PER_PROPERTY,
  PRUNE_THRESHOLD,
  type FactType,
  type MemoryFact,
} from './types';
import { getActiveFacts } from './query';
import type { MemoryFactsClient } from './record';

export type { MemoryFactsClient } from './record';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Score a fact in [0, 1]. owner_rule decays so slowly its score stays near
 * importance for years; tenant_pattern decays fast.
 */
export function effectiveScore(
  fact: Pick<MemoryFact, 'factType' | 'createdAt' | 'confidence'>,
  now: number = Date.now(),
): number {
  const defaults = FACT_TYPE_DEFAULTS[fact.factType];
  const created = Date.parse(fact.createdAt);
  if (!Number.isFinite(created)) return clamp(defaults.importance, 0, 1);

  const daysSince = Math.max(0, (now - created) / DAY_MS);
  // Confidence is the live score the loops update over time; if the
  // reflection loop hasn't touched it, we fall back to the per-type
  // default importance.
  const importance =
    Number.isFinite(fact.confidence) && fact.confidence > 0
      ? fact.confidence
      : defaults.importance;
  const score = importance * (1 - defaults.decayRate * daysSince);
  return clamp(score, 0, 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface DecayFactsOptions {
  db: MemoryFactsClient;
  propertyId: string;
  /** Override clock for tests. */
  now?: number;
}

export interface DecayFactsResult {
  scanned: number;
  archived: number;
  pruned: number;
  /** Extra archives forced by the per-property cap (after threshold pass). */
  capArchived: number;
}

/**
 * Run a decay pass on a single property.
 *
 *   1. Score every active fact.
 *   2. Mark `superseded_at = NOW()` on facts under PRUNE_THRESHOLD or
 *      ARCHIVE_THRESHOLD. (Both flow through the same column: the
 *      schema doesn't distinguish "archived" vs "pruned" — the threshold
 *      buckets are operational telemetry only.)
 *   3. If still over MAX_ACTIVE_FACTS_PER_PROPERTY, archive the oldest
 *      non-owner-rule facts until under the cap.
 *
 * The two-phase design (threshold-first, then cap) means soft-decay
 * eviction respects fact-type importance, while the cap protects against
 * memory explosion when a property has unusually heavy proposal volume.
 */
export async function decayFacts(
  opts: DecayFactsOptions,
): Promise<DecayFactsResult> {
  const now = opts.now ?? Date.now();
  const facts = await getActiveFacts({ db: opts.db, propertyId: opts.propertyId });

  let archived = 0;
  let pruned = 0;
  const survivors: MemoryFact[] = [];

  for (const fact of facts) {
    // owner_rule never decays via threshold — only explicit supersession.
    if (fact.factType === 'owner_rule') {
      survivors.push(fact);
      continue;
    }
    const score = effectiveScore(fact, now);
    if (score < PRUNE_THRESHOLD) {
      await archiveOne(opts.db, fact.id, now);
      pruned++;
    } else if (score < ARCHIVE_THRESHOLD) {
      await archiveOne(opts.db, fact.id, now);
      archived++;
    } else {
      survivors.push(fact);
    }
  }

  // Cap enforcement. Archive oldest non-owner-rule survivors until under
  // the cap. Owner-rule facts are excluded from cap eviction — they're
  // the contract, not observed state.
  let capArchived = 0;
  if (survivors.length > MAX_ACTIVE_FACTS_PER_PROPERTY) {
    const evictable = survivors
      .filter((f) => f.factType !== 'owner_rule')
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const overflow = survivors.length - MAX_ACTIVE_FACTS_PER_PROPERTY;
    const toArchive = evictable.slice(0, overflow);
    for (const fact of toArchive) {
      await archiveOne(opts.db, fact.id, now);
      capArchived++;
    }
  }

  return {
    scanned: facts.length,
    archived,
    pruned,
    capArchived,
  };
}

async function archiveOne(
  db: MemoryFactsClient,
  factId: string,
  now: number,
): Promise<void> {
  const isoNow = new Date(now).toISOString();
  const { error } = await db
    .from('memory_facts')
    .update({ superseded_at: isoNow, superseded_by: null })
    .eq('id', factId)
    .is('superseded_at', null);
  if (error) {
    throw new Error(`[memory.decay] archive failed for ${factId}: ${error.message}`);
  }
}

/**
 * Group facts by type — useful for the synthesis loop and for tests that
 * want to assert decay behavior per discriminator.
 */
export function groupByFactType(
  facts: readonly MemoryFact[],
): Record<FactType, MemoryFact[]> {
  const groups: Record<FactType, MemoryFact[]> = {
    vendor_relationship: [],
    tenant_pattern: [],
    building_quirk: [],
    derived_rule: [],
    owner_rule: [],
  };
  for (const f of facts) groups[f.factType].push(f);
  return groups;
}
