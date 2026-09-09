/**
 * Typed memory layer — discriminated union per `fact_type`.
 *
 * This is the "moat" surface from the v1.5 addendum: per-property typed
 * knowledge competitors can't replicate by adding features. CrewAI /
 * AutoGen have no concept of `vendor_relationship` or `tenant_pattern` —
 * they'd have to build the property domain from scratch.
 *
 * Persistence shape lives in `supabase/migrations/20260428000000_property_workers.sql`
 * (`memory_facts` table). The TypeScript types here mirror that schema with
 * a discriminated union on `factType` so callers get exhaustive narrowing
 * over `content`.
 *
 * Lifted from Boop's `server/memory/types.ts` (segment + decay design),
 * but the shape is property-domain-specific instead of conversational.
 */

/**
 * Source of a fact. Mirrors the SQL CHECK constraint on `memory_facts.source`.
 *
 *   - `observed`     — Haiku reflection saw this in proposal outcomes.
 *   - `owner_stated` — Owner typed it into the rulebook (or an edit).
 *   - `derived`      — Sonnet weekly synthesis inferred it from observations.
 *   - `meta_learned` — Opus monthly cross-property loop produced it.
 */
export type FactSource = 'observed' | 'owner_stated' | 'derived' | 'meta_learned';

/**
 * Discriminator. Mirrors the SQL CHECK constraint on `memory_facts.fact_type`.
 *
 * `owner_rule` is included beyond the original spec list because the
 * rulebook is itself a derived collection of owner-stated rules; making
 * them first-class facts lets the worker reason over them through the same
 * query path as observed/derived facts (see migration comment).
 */
export type FactType =
  | 'vendor_relationship'
  | 'tenant_pattern'
  | 'building_quirk'
  | 'derived_rule'
  | 'owner_rule';

// ---------------------------------------------------------------------------
// Per-fact-type content shapes (the typed body of `memory_facts.content`).
// ---------------------------------------------------------------------------

export interface VendorRelationshipContent {
  /** 0..1; share of dispatches the owner accepted/kept assigned to vendor. */
  acceptance_rate: number;
  /** ISO timestamp of last successful job (committed proposal). */
  last_used_at: string | null;
  /** Owner explicitly preferred this vendor (stated in rulebook or edits). */
  owner_preferred: boolean;
  /** Free-form notes the reflection loop attaches (e.g. "fast same-day"). */
  performance_notes: string;
}

export interface TenantPatternContent {
  /** Free-form: "pays on the 5th", "splits over two weeks", etc. */
  payment_cadence: string;
  /** Free-form: "terse", "wants explanations", "responds via voicemail". */
  communication_style: string;
  /** Recurring complaint themes ("AC", "neighbor noise"). */
  complaint_themes: readonly string[];
  /** ISO timestamp of last activity that updated this pattern. */
  last_observed_at: string | null;
}

export interface BuildingQuirkContent {
  /** "Boiler kicks off below 10F", "second-floor toilet runs on cold days". */
  description: string;
  /** Optional season tag: 'winter' | 'summer' | etc. Free-form. */
  season: string | null;
  /** True if observed multiple seasons; bumps the gate's confidence. */
  recurring: boolean;
  /** 0..1; how disruptive — affects review/auto gate decisions. */
  severity: number;
}

export interface DerivedRuleContent {
  /** The rule the owner would write themselves ("don't waive late fees"). */
  rule_text: string;
  /** Older rule this replaces, if any. Mirrors superseded_by lineage. */
  supersedes_rule_id?: string | null;
  /** How many distinct proposal outcomes back this rule. */
  evidence_count: number;
}

export interface OwnerRuleContent {
  /** The rule as the owner stated it (post-extraction). */
  rule_text: string;
  /** Original raw text the rule was extracted from, when available. */
  source_text?: string | null;
}

// ---------------------------------------------------------------------------
// Discriminated union — narrow on `factType` to pick the right `content`.
// ---------------------------------------------------------------------------

interface MemoryFactBase<TType extends FactType, TContent> {
  id: string;
  organizationId: string;
  propertyId: string;
  factType: TType;
  /**
   * Vendor / tenant / unit ID depending on `factType`. Null for
   * `building_quirk`, `derived_rule`, `owner_rule`.
   */
  subjectId: string | null;
  content: TContent;
  /** 0..1; updated by reflection/synthesis loops as evidence accrues. */
  confidence: number;
  source: FactSource;
  /** Back-references for the audit log + reflection traceability. */
  evidenceProposalIds: readonly string[];
  createdAt: string;
  /** ISO timestamp when a newer fact replaced this one. Null = active. */
  supersededAt: string | null;
  /** ID of the fact that replaced this one. Null = active or pruned. */
  supersededBy: string | null;
}

export type VendorRelationshipFact = MemoryFactBase<
  'vendor_relationship',
  VendorRelationshipContent
>;
export type TenantPatternFact = MemoryFactBase<'tenant_pattern', TenantPatternContent>;
export type BuildingQuirkFact = MemoryFactBase<'building_quirk', BuildingQuirkContent>;
export type DerivedRuleFact = MemoryFactBase<'derived_rule', DerivedRuleContent>;
export type OwnerRuleFact = MemoryFactBase<'owner_rule', OwnerRuleContent>;

export type MemoryFact =
  | VendorRelationshipFact
  | TenantPatternFact
  | BuildingQuirkFact
  | DerivedRuleFact
  | OwnerRuleFact;

// ---------------------------------------------------------------------------
// Insert-shape: callers don't supply IDs / timestamps / supersession.
// `recordFact` derives `organizationId` from the property and stamps the
// rest at insert time. `evidenceProposalIds` is optional because some
// fact sources (owner_stated) have no backing proposal.
// ---------------------------------------------------------------------------

export type MemoryFactInsertContent =
  | { factType: 'vendor_relationship'; subjectId: string; content: VendorRelationshipContent }
  | { factType: 'tenant_pattern'; subjectId: string; content: TenantPatternContent }
  | { factType: 'building_quirk'; subjectId: null; content: BuildingQuirkContent }
  | { factType: 'derived_rule'; subjectId: null; content: DerivedRuleContent }
  | { factType: 'owner_rule'; subjectId: null; content: OwnerRuleContent };

export type MemoryFactInsert = MemoryFactInsertContent & {
  source: FactSource;
  /** Defaults to 0.5 if not supplied (matches SQL DEFAULT). */
  confidence?: number;
  /** Optional back-references for traceability. */
  evidenceProposalIds?: readonly string[];
};

// ---------------------------------------------------------------------------
// Per-fact-type decay defaults — ported from Boop's SEGMENT_DEFAULTS but
// remapped to property-memory semantics. Decay rates were chosen so
// owner-stated rules essentially never decay (they're the contract);
// observed vendor / tenant patterns decay slowly; building quirks decay
// slower than tenant patterns because buildings change less than people.
//
// Values are per-day decay rate `r` in the formula:
//   effectiveScore = importance × (1 − r × daysSinceAccess)
// (clamp to [0,1]). See `decay.ts` for the exact compaction.
// ---------------------------------------------------------------------------

export interface FactTypeDefaults {
  /** Initial importance assigned at record time when caller doesn't override. */
  importance: number;
  /** Per-day decay rate (linear). */
  decayRate: number;
}

export const FACT_TYPE_DEFAULTS: Record<FactType, FactTypeDefaults> = {
  // owner_rule: the owner's stated contract; near-zero decay so rules
  // persist until explicitly superseded.
  owner_rule: { importance: 0.95, decayRate: 0.001 },
  // derived_rule: synthesized rule from Sonnet weekly loop; decays only
  // mildly so it survives until reinforced or superseded.
  derived_rule: { importance: 0.85, decayRate: 0.005 },
  // building_quirk: physical reality changes slowly; decay slow.
  building_quirk: { importance: 0.75, decayRate: 0.01 },
  // vendor_relationship: business relationships drift; medium decay.
  vendor_relationship: { importance: 0.7, decayRate: 0.015 },
  // tenant_pattern: people change behavior the most; fastest decay.
  tenant_pattern: { importance: 0.65, decayRate: 0.02 },
};

// Hard cap from the addendum: max 200 active facts per property. Oldest
// non-owner-stated facts get archived first when over the cap.
export const MAX_ACTIVE_FACTS_PER_PROPERTY = 200;

// Decay thresholds from Boop's clean.ts (linear-decay equivalents).
//   archive at score < 0.15 → moves out of active queries
//   prune   at score < 0.05 → marks the row as fully superseded
export const ARCHIVE_THRESHOLD = 0.15;
export const PRUNE_THRESHOLD = 0.05;
