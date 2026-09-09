/**
 * Nightly per-property reflection loop (Haiku 4.5).
 *
 * For each property with at least one ActionProposal in the last 24 hours:
 *   1. Load proposals + outcomes from `action_proposals`.
 *   2. Ask Haiku to produce a structured journal of:
 *      - patterns_observed (vendor/tenant/building observations)
 *      - edit_classifications (disagreed_with_intent vs added_context)
 *      - vendor_signals (accept/reject patterns)
 *      - edits_worth_learning (rules the owner is implicitly stating)
 *   3. Convert observations into `memory_facts` rows via `recordFact`,
 *      tagged `source='observed'` with the proposal IDs as evidence.
 *
 * What this loop deliberately does NOT do:
 *   - It does not write rules to the rulebook directly. "edits_worth_learning"
 *     entries are just observations; the weekly synthesis loop (Sonnet)
 *     decides whether they are strong enough to queue an `update_rulebook`
 *     ActionProposal for owner approval.
 *   - It does not supersede facts. Synthesis owns the merge/supersede logic.
 *   - It does not compute confidence rollups across days. Each run records
 *     the journal; cumulative reasoning is synthesis's job.
 *
 * Forbidden / read-only callouts (per task ownership):
 *   - We CALL `recordFact` from `@/lib/agent/memory/record` — never reach
 *     into the table directly.
 *   - We READ from `action_proposals` directly via Supabase, but never
 *     write to it. Proposals layer (`src/lib/agent/proposals/`) owns writes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { recordFact, type MemoryFactsClient } from '@/lib/agent/memory/record';
import type {
  MemoryFactInsert,
  VendorRelationshipContent,
  TenantPatternContent,
  BuildingQuirkContent,
} from '@/lib/agent/memory/types';

import {
  callMetaLlm,
  parseJsonStrict,
  REFLECTION_MODEL,
} from './llm';
import { REFLECTION_SYSTEM_PROMPT } from './prompts';

// ---------------------------------------------------------------------------
// Input shapes — what we read from action_proposals
// ---------------------------------------------------------------------------

interface ProposalRow {
  id: string;
  property_id: string;
  organization_id: string;
  worker_model: string;
  action_type: string;
  payload: unknown;
  reasoning: string;
  confidence: number | string;
  context_fact_ids: string[] | null;
  gate_decision: string;
  status: string;
  edit_diff: unknown | null;
  outcome: unknown | null;
  created_at: string;
  committed_at: string | null;
  rejected_at: string | null;
}

// ---------------------------------------------------------------------------
// LLM output shape (matches REFLECTION_SYSTEM_PROMPT contract)
// ---------------------------------------------------------------------------

interface ReflectionJournal {
  patterns_observed: ReadonlyArray<{
    subject_type: 'vendor' | 'tenant' | 'building' | 'general';
    subject_id: string | null;
    pattern: string;
    evidence_proposal_ids: ReadonlyArray<string>;
    confidence: number;
  }>;
  edit_classifications: ReadonlyArray<{
    proposal_id: string;
    edit_type: 'disagreed_with_intent' | 'added_context' | 'tone_change' | 'no_edit';
    rationale: string;
  }>;
  vendor_signals: ReadonlyArray<{
    vendor_id: string;
    signal: 'accepted' | 'rejected' | 'owner_preferred';
    evidence_proposal_ids: ReadonlyArray<string>;
    notes: string;
  }>;
  edits_worth_learning: ReadonlyArray<{
    rule_text: string;
    evidence_proposal_ids: ReadonlyArray<string>;
    confidence: number;
  }>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunReflectionOptions {
  db: SupabaseClient;
  propertyId: string;
  /**
   * Lookback window in hours. Default 24h (cron runs nightly). Tests use
   * a wider window when seeding old proposals.
   */
  lookbackHours?: number;
  /** Override for tests; defaults to env-configured Haiku 4.5. */
  model?: string;
}

export interface RunReflectionResult {
  proposalsScanned: number;
  factsCreated: number;
  /** Reflection itself does not supersede; left at 0 for symmetry with synthesis. */
  factsSuperseded: number;
  /**
   * Pass-through of the journal for upstream tracing; useful in tests and
   * for the eventual reflection-trace UI panel.
   */
  journal: ReflectionJournal | null;
}

/**
 * Build the user prompt body. Trimmed by including only fields the model
 * needs — keeps token count predictable on busy properties.
 */
function buildUserPrompt(propertyId: string, proposals: ProposalRow[]): string {
  const lines = proposals.map((p) => {
    const confidence = typeof p.confidence === 'string' ? Number(p.confidence) : p.confidence;
    const edited = p.edit_diff ? JSON.stringify(p.edit_diff).slice(0, 600) : null;
    const outcome = p.outcome ? JSON.stringify(p.outcome).slice(0, 400) : null;
    return [
      `id=${p.id}`,
      `action_type=${p.action_type}`,
      `confidence=${Number.isFinite(confidence) ? confidence.toFixed(2) : 'NaN'}`,
      `gate=${p.gate_decision}`,
      `status=${p.status}`,
      `payload=${JSON.stringify(p.payload).slice(0, 800)}`,
      `reasoning=${p.reasoning.slice(0, 400)}`,
      edited ? `edit_diff=${edited}` : null,
      outcome ? `outcome=${outcome}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  });

  return [
    `Property ID: ${propertyId}`,
    `Proposals (count=${proposals.length}):`,
    '',
    lines.join('\n---\n'),
  ].join('\n');
}

/**
 * Convert a single observation into a MemoryFactInsert. Returns null if the
 * observation is structurally invalid (e.g., vendor signal with no
 * vendor_id) — we drop quietly rather than poisoning the fact table.
 */
function toFactInsert(
  observation: ReflectionJournal['patterns_observed'][number] | null,
  signal: ReflectionJournal['vendor_signals'][number] | null,
): MemoryFactInsert | null {
  if (signal) {
    if (!signal.vendor_id) return null;
    const content: VendorRelationshipContent = {
      acceptance_rate: signal.signal === 'accepted' ? 1 : signal.signal === 'rejected' ? 0 : 0.5,
      last_used_at: new Date().toISOString(),
      owner_preferred: signal.signal === 'owner_preferred',
      performance_notes: signal.notes,
    };
    return {
      factType: 'vendor_relationship',
      subjectId: signal.vendor_id,
      content,
      source: 'observed',
      confidence: 0.6,
      evidenceProposalIds: signal.evidence_proposal_ids,
    };
  }

  if (!observation) return null;

  if (observation.subject_type === 'tenant') {
    if (!observation.subject_id) return null;
    const content: TenantPatternContent = {
      payment_cadence: '',
      communication_style: '',
      complaint_themes: [],
      last_observed_at: new Date().toISOString(),
    };
    // Pack the observation prose into communication_style as a default;
    // synthesis will refine into the structured fields once it has
    // multiple observations to triangulate.
    content.communication_style = observation.pattern.slice(0, 500);
    return {
      factType: 'tenant_pattern',
      subjectId: observation.subject_id,
      content,
      source: 'observed',
      confidence: Math.max(0.5, Math.min(1, observation.confidence)),
      evidenceProposalIds: observation.evidence_proposal_ids,
    };
  }

  if (observation.subject_type === 'building') {
    const content: BuildingQuirkContent = {
      description: observation.pattern.slice(0, 500),
      season: null,
      recurring: false,
      severity: 0.5,
    };
    return {
      factType: 'building_quirk',
      subjectId: null,
      content,
      source: 'observed',
      confidence: Math.max(0.5, Math.min(1, observation.confidence)),
      evidenceProposalIds: observation.evidence_proposal_ids,
    };
  }

  // 'general' and 'vendor' (when not paired with a vendor_signal) we drop
  // for now — synthesis is the correct layer to crystallize generic patterns
  // into rules. A 'vendor' observation without a vendor_id has no subject
  // to pin to.
  return null;
}

export async function runReflection(
  opts: RunReflectionOptions,
): Promise<RunReflectionResult> {
  const lookbackHours = opts.lookbackHours ?? 24;
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const model = opts.model ?? REFLECTION_MODEL;

  const { data, error } = await opts.db
    .from('action_proposals')
    .select(
      'id, property_id, organization_id, worker_model, action_type, payload, ' +
        'reasoning, confidence, context_fact_ids, gate_decision, status, ' +
        'edit_diff, outcome, created_at, committed_at, rejected_at',
    )
    .eq('property_id', opts.propertyId)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .returns<ProposalRow[]>();

  if (error) {
    throw new Error(`[reflection] proposals query failed: ${error.message}`);
  }

  const proposals = data ?? [];
  if (proposals.length === 0) {
    return {
      proposalsScanned: 0,
      factsCreated: 0,
      factsSuperseded: 0,
      journal: null,
    };
  }

  const userPrompt = buildUserPrompt(opts.propertyId, proposals);
  const llmResponse = await callMetaLlm({
    phase: 'reflection',
    model,
    systemPrompt: REFLECTION_SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 4096,
    temperature: 0.2,
  });

  const journal = parseJsonStrict<ReflectionJournal>(llmResponse.text);
  if (!journal) {
    return {
      proposalsScanned: proposals.length,
      factsCreated: 0,
      factsSuperseded: 0,
      journal: null,
    };
  }

  let factsCreated = 0;

  for (const signal of journal.vendor_signals ?? []) {
    const insert = toFactInsert(null, signal);
    if (!insert) continue;
    try {
      await recordFact({
        db: opts.db as unknown as MemoryFactsClient,
        propertyId: opts.propertyId,
        fact: insert,
      });
      factsCreated++;
    } catch (err) {
      console.warn('[reflection] vendor_signal recordFact failed', err);
    }
  }

  for (const observation of journal.patterns_observed ?? []) {
    if (observation.confidence < 0.6) continue;
    const insert = toFactInsert(observation, null);
    if (!insert) continue;
    try {
      await recordFact({
        db: opts.db as unknown as MemoryFactsClient,
        propertyId: opts.propertyId,
        fact: insert,
      });
      factsCreated++;
    } catch (err) {
      console.warn('[reflection] pattern recordFact failed', err);
    }
  }

  // edits_worth_learning are *not* recorded as memory_facts here. Synthesis
  // is the layer that crystallizes them (and only via the queued
  // update_rulebook ActionProposal — owner approval gated). Reflection
  // emits them so synthesis sees them as part of its proposer payload.

  return {
    proposalsScanned: proposals.length,
    factsCreated,
    factsSuperseded: 0,
    journal,
  };
}
