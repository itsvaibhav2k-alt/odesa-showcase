/**
 * Monthly cross-property meta-learning loop (Opus 4.7).
 *
 * Scans active `memory_facts` and the last 30 days of `action_proposals`
 * across ALL properties in a single organization. Looks for portfolio-
 * level patterns invisible from any single property's data: seasonal
 * complaint spikes, vendor portfolio winners, payment segment drift, etc.
 *
 * Writes results into the `meta_insights` table; the briefing card surfaces
 * them as "Patterns we noticed this month."
 *
 * Privacy boundary (per addendum): meta-learning is PER ORG only — no
 * cross-org pattern sharing in v1. Re-evaluate in v3 with explicit
 * anonymized opt-in. The org_id filter on every query enforces this.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  callMetaLlm,
  parseJsonStrict,
  CROSS_PROPERTY_MODEL,
} from './llm';
import { CROSS_PROPERTY_SYSTEM_PROMPT } from './prompts';

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

interface CrossPropertyInsight {
  pattern_type: string;
  affected_property_ids: ReadonlyArray<string>;
  insight: string;
  recommended_action: unknown;
  evidence_summary?: string;
}

interface CrossPropertyResponse {
  insights: ReadonlyArray<CrossPropertyInsight>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunCrossPropertyOptions {
  db: SupabaseClient;
  organizationId: string;
  /** Default 30d. */
  lookbackDays?: number;
  model?: string;
}

export interface RunCrossPropertyResult {
  factsScanned: number;
  proposalsScanned: number;
  insightsEmitted: number;
  insightIds: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FactDigest {
  id: string;
  property_id: string;
  fact_type: string;
  subject_id: string | null;
  content: unknown;
  source: string;
  confidence: number | string;
  created_at: string;
}

interface ProposalDigest {
  id: string;
  property_id: string;
  action_type: string;
  payload: unknown;
  status: string;
  outcome: unknown | null;
  created_at: string;
}

async function loadOrgFacts(
  db: SupabaseClient,
  organizationId: string,
): Promise<FactDigest[]> {
  const { data, error } = await db
    .from('memory_facts')
    .select(
      'id, property_id, fact_type, subject_id, content, source, confidence, created_at',
    )
    .eq('organization_id', organizationId)
    .is('superseded_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`[cross-property] facts query failed: ${error.message}`);
  }
  return (data ?? []) as FactDigest[];
}

async function loadOrgProposals(
  db: SupabaseClient,
  organizationId: string,
  sinceIso: string,
): Promise<ProposalDigest[]> {
  const { data, error } = await db
    .from('action_proposals')
    .select(
      'id, property_id, action_type, payload, status, outcome, created_at',
    )
    .eq('organization_id', organizationId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(
      `[cross-property] proposals query failed: ${error.message}`,
    );
  }
  return (data ?? []) as ProposalDigest[];
}

/**
 * Compact serialization for the user prompt. Opus context is generous but
 * still bounded; we cap content/payload at fixed lengths to keep token
 * counts predictable as orgs grow.
 */
function buildUserPrompt(
  organizationId: string,
  facts: ReadonlyArray<FactDigest>,
  proposals: ReadonlyArray<ProposalDigest>,
): string {
  const factLines = facts.map(
    (f) =>
      `- [${f.id}] property=${f.property_id} type=${f.fact_type} ` +
      `subject=${f.subject_id ?? '-'} c=${
        typeof f.confidence === 'string' ? f.confidence : f.confidence.toFixed(2)
      } content=${JSON.stringify(f.content).slice(0, 240)}`,
  );

  const proposalLines = proposals.map(
    (p) =>
      `- [${p.id}] property=${p.property_id} action=${p.action_type} ` +
      `status=${p.status} payload=${JSON.stringify(p.payload).slice(0, 240)} ` +
      `outcome=${p.outcome ? JSON.stringify(p.outcome).slice(0, 160) : '-'}`,
  );

  return [
    `Organization: ${organizationId}`,
    `Property count: ${new Set(facts.map((f) => f.property_id)).size}`,
    `Active memory_facts (count=${facts.length}):`,
    factLines.join('\n'),
    '',
    `Recent action_proposals (count=${proposals.length}):`,
    proposalLines.join('\n'),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runCrossProperty(
  opts: RunCrossPropertyOptions,
): Promise<RunCrossPropertyResult> {
  const lookbackDays = opts.lookbackDays ?? 30;
  const since = new Date(
    Date.now() - lookbackDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const model = opts.model ?? CROSS_PROPERTY_MODEL;

  const facts = await loadOrgFacts(opts.db, opts.organizationId);
  const proposals = await loadOrgProposals(opts.db, opts.organizationId, since);

  // Need at least 3 distinct properties for any cross-property pattern to
  // be even theoretically possible. Skip the LLM call entirely otherwise.
  const distinctProperties = new Set([
    ...facts.map((f) => f.property_id),
    ...proposals.map((p) => p.property_id),
  ]);
  if (distinctProperties.size < 3) {
    return {
      factsScanned: facts.length,
      proposalsScanned: proposals.length,
      insightsEmitted: 0,
      insightIds: [],
    };
  }

  const llmResponse = await callMetaLlm({
    phase: 'cross-property',
    model,
    systemPrompt: CROSS_PROPERTY_SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(opts.organizationId, facts, proposals),
    maxTokens: 8192,
    temperature: 0.2,
  });

  const parsed = parseJsonStrict<CrossPropertyResponse>(llmResponse.text);
  const insights = parsed?.insights ?? [];
  if (insights.length === 0) {
    return {
      factsScanned: facts.length,
      proposalsScanned: proposals.length,
      insightsEmitted: 0,
      insightIds: [],
    };
  }

  // Validate + insert. The prompt requires ≥3 affected_property_ids; we
  // re-check here so a slipping model can't poison meta_insights.
  const validInsights = insights.filter((i) => {
    if (!Array.isArray(i.affected_property_ids)) return false;
    const unique = new Set(i.affected_property_ids);
    return unique.size >= 3;
  });

  if (validInsights.length === 0) {
    return {
      factsScanned: facts.length,
      proposalsScanned: proposals.length,
      insightsEmitted: 0,
      insightIds: [],
    };
  }

  const rows = validInsights.map((i) => ({
    organization_id: opts.organizationId,
    pattern_type: i.pattern_type,
    affected_property_ids: [...i.affected_property_ids],
    insight: i.insight,
    recommended_action: i.recommended_action ?? null,
  }));

  const { data, error } = await opts.db
    .from('meta_insights')
    .insert(rows)
    .select('id');

  if (error) {
    throw new Error(`[cross-property] insert failed: ${error.message}`);
  }

  const insightIds = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);

  return {
    factsScanned: facts.length,
    proposalsScanned: proposals.length,
    insightsEmitted: insightIds.length,
    insightIds,
  };
}
