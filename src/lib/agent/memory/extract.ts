/**
 * extractFactsFromOutcome — post-proposal fact extraction.
 *
 * Ported from Boop's `server/memory/extract.ts`. Given an ActionProposal +
 * its committed/rejected/edited outcome, ask Haiku 4.5 for any DURABLE
 * facts worth persisting. Output is appended to `memory_facts` with
 * `source='observed'` and `evidence_proposal_ids=[proposal.id]`.
 *
 * Called from the nightly reflection loop (`src/lib/agent/meta/reflection.ts`)
 * — NOT inline on every proposal commit. Reflection batches per property
 * for cost reasons; the extraction prompt itself is single-proposal so it
 * stays composable.
 *
 * Failure mode: extraction errors are swallowed (logged) — a malformed
 * Haiku reply must NEVER break the proposal-commit path. The reflection
 * loop catches exceptions per-proposal and proceeds.
 */

import type Anthropic from '@anthropic-ai/sdk';

import type { ActionProposal } from '@/lib/agent/worker/types';

import { embedFactContent } from './embed';
import { recordFact, type MemoryFactsClient } from './record';
import {
  FACT_TYPE_DEFAULTS,
  type FactType,
  type MemoryFact,
  type MemoryFactInsert,
} from './types';

/**
 * Subset of the worker's `ActionProposal` we actually feed into the
 * extraction prompt. Required fields:
 *   - id                   for evidence_proposal_ids back-references
 *   - action_type / payload / reasoning / confidence
 *                          the proposal body the model reasons over
 *   - routing              orchestrator-resolved identifiers
 *                          (vendorId / tenantId / etc) — the model never
 *                          sees raw UUIDs in the payload itself
 *                          (Privacy Mode invariant), so the extractor
 *                          gets them from routing instead. Without this
 *                          a `dispatch_vendor` outcome can't produce a
 *                          `vendor_relationship` fact tied to a vendor.
 *
 * Defining this as a `Pick` keeps the import authoritative — when the
 * worker types evolve (e.g. action_type union grows), this signature
 * grows with it for free.
 */
export type ProposalForExtraction = Pick<
  ActionProposal,
  | 'id'
  | 'propertyId'
  | 'action_type'
  | 'payload'
  | 'routing'
  | 'reasoning'
  | 'confidence'
  | 'context_fact_ids'
>;

export type ProposalOutcomeStatus = 'committed' | 'rejected' | 'edited' | 'expired';

export interface ProposalOutcome {
  status: ProposalOutcomeStatus;
  /** JSON delta when status='edited'. */
  editDiff?: unknown;
  /** Optional human-readable note (e.g. owner reason in the rejection UI). */
  note?: string;
}

// ---------------------------------------------------------------------------
// Anthropic client contract — narrow interface so tests can mock without
// importing the full SDK.
// ---------------------------------------------------------------------------

export interface AnthropicMessageContract {
  messages: {
    create: Anthropic['messages']['create'];
  };
}

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

const EXTRACTION_PROMPT = `You are a memory-extraction subagent for a property-management AI.

Given an ActionProposal + its outcome (committed / rejected / edited),
extract any DURABLE property facts worth persisting. Return STRICT JSON:

{"facts":[
  {
    "factType":"vendor_relationship|tenant_pattern|building_quirk|derived_rule",
    "subjectId":"vendor or tenant uuid, or null for building_quirk/derived_rule",
    "content":{...shape per factType...},
    "confidence":0.0-1.0,
    "rationale":"one sentence why this is durable"
  }
]}

Per-factType content shapes:
- vendor_relationship: {acceptance_rate:0..1, last_used_at:iso|null, owner_preferred:bool, performance_notes:string}
- tenant_pattern:      {payment_cadence:string, communication_style:string, complaint_themes:string[], last_observed_at:iso|null}
- building_quirk:      {description:string, season:string|null, recurring:bool, severity:0..1}
- derived_rule:        {rule_text:string, supersedes_rule_id:string|null, evidence_count:int}

Rules:
- Prefer fewer, higher-quality facts over many trivial ones.
- Skip transient observations ("tenant was tired"). Tenant_pattern facts must describe ONGOING behavior, not single events.
- Use derived_rule ONLY when the outcome reveals a rule the owner would write themselves (e.g. owner edited 4/4 SMS drafts to remove apologies → "be direct, no apologies").
- Use building_quirk for physical/system facts ("boiler kicks off below 10F").
- Confidence default 0.5; bump up only when the proposal was committed AND outcome is unambiguous.
- Return empty facts array if nothing durable.

Resolving subjectId:
- vendor_relationship → use proposal.routing.vendorId. The proposal.payload uses candidateIndex, not a UUID; routing is the orchestrator-resolved identifier.
- tenant_pattern      → use proposal.routing.tenantId.
- If routing lacks the needed identifier for a fact you're tempted to emit, omit that fact (do NOT invent a UUID).

Respond with ONLY the JSON object.`;

interface ExtractedFact {
  factType?: string;
  subjectId?: string | null;
  content?: unknown;
  confidence?: number;
  rationale?: string;
}

const VALID_TYPES: ReadonlySet<FactType> = new Set([
  'vendor_relationship',
  'tenant_pattern',
  'building_quirk',
  'derived_rule',
  'owner_rule',
]);

export interface ExtractFactsOptions {
  db: MemoryFactsClient;
  anthropic: AnthropicMessageContract;
  propertyId: string;
  proposal: ProposalForExtraction;
  outcome: ProposalOutcome;
  /** Override the model for tests; defaults to Haiku 4.5. */
  model?: string;
}

export interface ExtractFactsResult {
  recorded: MemoryFact[];
  /** Raw fact objects we couldn't validate or persist. */
  skipped: number;
}

/**
 * Run extraction for a single proposal+outcome pair. Persists each
 * extracted fact via `recordFact`.
 *
 * Errors from individual fact inserts are logged and counted in `skipped`
 * — a single bad fact must not abort the whole batch (the reflection loop
 * processes many proposals per property).
 */
export async function extractFactsFromOutcome(
  opts: ExtractFactsOptions,
): Promise<ExtractFactsResult> {
  // ActionProposal.id is null only on the in-memory pre-persist value.
  // Extraction always runs on persisted proposals (reflection loop
  // queries action_proposals from the DB), so this is a contract bug
  // surfaced as a clear error rather than silently dropping evidence.
  if (!opts.proposal.id) {
    throw new Error('[memory.extract] proposal.id is null — only persisted proposals can be extracted');
  }
  const proposalId = opts.proposal.id;

  const payload = JSON.stringify(
    {
      proposal: {
        id: opts.proposal.id,
        action_type: opts.proposal.action_type,
        payload: opts.proposal.payload,
        // routing carries the resolved vendor/tenant/work-order UUIDs
        // the model didn't see in `payload` (candidateIndex etc).
        routing: opts.proposal.routing,
        reasoning: opts.proposal.reasoning,
        confidence: opts.proposal.confidence,
      },
      outcome: opts.outcome,
    },
    null,
    2,
  );

  let raw: string;
  try {
    const message = await opts.anthropic.messages.create({
      model: opts.model ?? HAIKU_MODEL,
      max_tokens: 1024,
      system: EXTRACTION_PROMPT,
      messages: [{ role: 'user', content: payload }],
    });
    raw = textFromMessage(message);
  } catch (err) {
    console.error('[memory.extract] anthropic call failed', err);
    return { recorded: [], skipped: 0 };
  }

  const facts = parseFacts(raw);
  if (facts.length === 0) return { recorded: [], skipped: 0 };

  const recorded: MemoryFact[] = [];
  let skipped = 0;

  for (const fact of facts) {
    const insert = validateAndShape(fact, proposalId);
    if (!insert) {
      skipped++;
      continue;
    }
    // Embed inline so the new row is searchable on first read. Returns
    // null on any failure (missing key, timeout, network) — we still
    // insert so the proposal-commit path is never blocked. The backfill
    // job picks up null embeddings later.
    const embedding = await embedFactContent(insert.content as object);
    try {
      const persisted = await recordFact({
        db: opts.db,
        propertyId: opts.propertyId,
        fact: insert,
        embedding,
      });
      recorded.push(persisted);
    } catch (err) {
      console.error('[memory.extract] recordFact failed', err);
      skipped++;
    }
  }

  return { recorded, skipped };
}

function textFromMessage(
  message: Awaited<ReturnType<AnthropicMessageContract['messages']['create']>>,
): string {
  // The SDK can return either a streamed message or a non-streaming one.
  // We only use non-streaming here, so message has `content` blocks.
  type ContentBlock = { type: string; text?: string };
  const blocks = (message as { content?: ContentBlock[] }).content ?? [];
  let buf = '';
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') buf += block.text;
  }
  return buf;
}

function parseFacts(raw: string): ExtractedFact[] {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { facts?: ExtractedFact[] };
    return Array.isArray(parsed.facts) ? parsed.facts : [];
  } catch {
    return [];
  }
}

/**
 * Validate the LLM payload against our discriminated union and produce a
 * `MemoryFactInsert`. Returns null when the fact is malformed (logged by
 * caller). The `owner_rule` type is intentionally not extractable here —
 * owner rules come from the rulebook editor path, not from observation.
 */
function validateAndShape(
  fact: ExtractedFact,
  proposalId: string,
): MemoryFactInsert | null {
  if (!fact || typeof fact !== 'object') return null;
  const factType = fact.factType as FactType | undefined;
  if (!factType || !VALID_TYPES.has(factType) || factType === 'owner_rule') {
    return null;
  }
  if (!fact.content || typeof fact.content !== 'object') return null;

  const confidence =
    typeof fact.confidence === 'number' && Number.isFinite(fact.confidence)
      ? Math.max(0, Math.min(1, fact.confidence))
      : FACT_TYPE_DEFAULTS[factType].importance;

  switch (factType) {
    case 'vendor_relationship': {
      if (typeof fact.subjectId !== 'string' || !fact.subjectId) return null;
      const c = fact.content as Partial<{
        acceptance_rate: number;
        last_used_at: string | null;
        owner_preferred: boolean;
        performance_notes: string;
      }>;
      if (typeof c.acceptance_rate !== 'number') return null;
      return {
        factType: 'vendor_relationship',
        subjectId: fact.subjectId,
        content: {
          acceptance_rate: clamp01(c.acceptance_rate),
          last_used_at: typeof c.last_used_at === 'string' ? c.last_used_at : null,
          owner_preferred: !!c.owner_preferred,
          performance_notes: typeof c.performance_notes === 'string'
            ? c.performance_notes
            : '',
        },
        confidence,
        source: 'observed',
        evidenceProposalIds: [proposalId],
      };
    }
    case 'tenant_pattern': {
      if (typeof fact.subjectId !== 'string' || !fact.subjectId) return null;
      const c = fact.content as Partial<{
        payment_cadence: string;
        communication_style: string;
        complaint_themes: unknown[];
        last_observed_at: string | null;
      }>;
      return {
        factType: 'tenant_pattern',
        subjectId: fact.subjectId,
        content: {
          payment_cadence: typeof c.payment_cadence === 'string' ? c.payment_cadence : '',
          communication_style:
            typeof c.communication_style === 'string' ? c.communication_style : '',
          complaint_themes: Array.isArray(c.complaint_themes)
            ? c.complaint_themes.filter((x): x is string => typeof x === 'string')
            : [],
          last_observed_at:
            typeof c.last_observed_at === 'string' ? c.last_observed_at : null,
        },
        confidence,
        source: 'observed',
        evidenceProposalIds: [proposalId],
      };
    }
    case 'building_quirk': {
      const c = fact.content as Partial<{
        description: string;
        season: string | null;
        recurring: boolean;
        severity: number;
      }>;
      if (typeof c.description !== 'string' || !c.description) return null;
      return {
        factType: 'building_quirk',
        subjectId: null,
        content: {
          description: c.description,
          season: typeof c.season === 'string' ? c.season : null,
          recurring: !!c.recurring,
          severity: typeof c.severity === 'number' ? clamp01(c.severity) : 0.5,
        },
        confidence,
        source: 'observed',
        evidenceProposalIds: [proposalId],
      };
    }
    case 'derived_rule': {
      const c = fact.content as Partial<{
        rule_text: string;
        supersedes_rule_id: string | null;
        evidence_count: number;
      }>;
      if (typeof c.rule_text !== 'string' || !c.rule_text) return null;
      return {
        factType: 'derived_rule',
        subjectId: null,
        content: {
          rule_text: c.rule_text,
          supersedes_rule_id:
            typeof c.supersedes_rule_id === 'string' ? c.supersedes_rule_id : null,
          evidence_count:
            typeof c.evidence_count === 'number' && c.evidence_count >= 0
              ? Math.floor(c.evidence_count)
              : 1,
        },
        confidence,
        source: 'observed',
        evidenceProposalIds: [proposalId],
      };
    }
  }
  return null;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
