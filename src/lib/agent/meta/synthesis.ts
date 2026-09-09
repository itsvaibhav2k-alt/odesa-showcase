/**
 * Weekly per-property synthesis loop (Sonnet 4.6 / Haiku adversary).
 *
 * Ports Boop's 3-phase Proposer → Adversary → Judge consolidation
 * (`/Users/vaibhav/Downloads/boop-agent-main/server/consolidation.ts`)
 * to property-domain semantics:
 *   - "memories" → typed `memory_facts`
 *   - "segment" → fact_type
 *   - "correction" priority → owner_rule + derived_rule priority
 *
 * Adds one verb beyond Boop's three:
 *   - `derive_rule` — emits a NEW derived_rule candidate as an
 *     `update_rulebook` ActionProposal. The rulebook does NOT auto-update;
 *     the owner approves via the proposals UI (Phase 4.5 UI work, task #7).
 *
 * Sequencing within a run:
 *   1. Load active memory_facts for the property (last 7 days of activity
 *      shapes the proposer payload but all active facts are visible).
 *   2. Load last 7 days of action_proposals + outcomes (lets the proposer
 *      see what evidence backs derive_rule candidates).
 *   3. Phase 1: Sonnet (proposer) → array of {verb, ...}.
 *   4. Phase 2: Haiku (adversary) → array of {proposal_index, severity, objection}.
 *   5. Phase 3: Sonnet (judge) → array of {proposal_index, approve, rationale}.
 *   6. Apply each approved proposal:
 *      - merge   → write new memory_fact + supersede absorbed
 *      - supersede → mark older facts superseded by newer
 *      - prune   → mark fact superseded (with no replacement)
 *      - derive_rule → enqueue an `update_rulebook` ActionProposal,
 *        gate_decision='review'. Never auto-applies.
 *
 * Forbidden / read-only callouts:
 *   - We CALL `recordFact` for any new fact body (e.g., a merge rewrite).
 *   - We mark supersession via direct UPDATE on `memory_facts` because the
 *     memory layer's public API does not expose a `markSuperseded` helper
 *     yet. This is a controlled exception — see comment at `markSuperseded`.
 *   - Proposals: we INSERT to action_proposals only for the queued
 *     `update_rulebook` row (a side effect the proposals layer expects via
 *     this exact path; documented in the addendum).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

import { recordFact, type MemoryFactsClient } from '@/lib/agent/memory/record';
import type { MemoryFact, MemoryFactInsert } from '@/lib/agent/memory/types';
import { rowToFact, type MemoryFactRow } from '@/lib/agent/memory/row';
import { recordProposal } from '@/lib/agent/proposals/record';
import type { UpdateRulebookPayload } from '@/lib/agent/worker/types';

import {
  callMetaLlm,
  parseJsonStrict,
  SYNTHESIS_PROPOSER_MODEL,
  SYNTHESIS_ADVERSARY_MODEL,
  SYNTHESIS_JUDGE_MODEL,
} from './llm';
import {
  SYNTHESIS_PROPOSER_PROMPT,
  SYNTHESIS_ADVERSARY_PROMPT,
  SYNTHESIS_JUDGE_PROMPT,
} from './prompts';

// ---------------------------------------------------------------------------
// Wire types (match the prompts' STRICT JSON contracts)
// ---------------------------------------------------------------------------

type SynthesisProposal =
  | {
      verb: 'merge';
      keep_fact_id: string;
      absorb_fact_ids: ReadonlyArray<string>;
      rewrite_content: unknown;
      rationale: string;
    }
  | {
      verb: 'supersede';
      newer_fact_id: string;
      older_fact_ids: ReadonlyArray<string>;
      rationale: string;
    }
  | {
      verb: 'prune';
      fact_id: string;
      rationale: string;
    }
  | {
      verb: 'derive_rule';
      rule_text: string;
      evidence_proposal_ids: ReadonlyArray<string>;
      rationale: string;
    };

interface SynthesisChallenge {
  proposal_index: number;
  objection: string | null;
  severity: 'low' | 'medium' | 'high';
}

interface SynthesisDecision {
  proposal_index: number;
  approve: boolean;
  rationale: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunSynthesisOptions {
  db: SupabaseClient;
  propertyId: string;
  /** Default 7d. */
  lookbackHours?: number;
  /** Override individual phase models if needed (tests). */
  proposerModel?: string;
  adversaryModel?: string;
  judgeModel?: string;
}

export interface AppliedProposal {
  index: number;
  verb: SynthesisProposal['verb'];
  summary: string;
}

export interface RunSynthesisResult {
  factsScanned: number;
  proposalsScanned: number;
  proposalsCount: number;
  approvedCount: number;
  rejectedCount: number;
  merged: number;
  superseded: number;
  pruned: number;
  rulesQueued: number;
  applied: ReadonlyArray<AppliedProposal>;
  /** Pass-through wire data for tests / trace UI. */
  trace: {
    proposals: ReadonlyArray<SynthesisProposal>;
    challenges: ReadonlyArray<SynthesisChallenge>;
    decisions: ReadonlyArray<SynthesisDecision>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadActiveFacts(
  db: SupabaseClient,
  propertyId: string,
  organizationId: string,
): Promise<MemoryFact[]> {
  const { data, error } = await db
    .from('memory_facts')
    .select(
      'id, organization_id, property_id, fact_type, subject_id, content, ' +
        'confidence, source, evidence_proposal_ids, created_at, ' +
        'superseded_at, superseded_by',
    )
    .eq('organization_id', organizationId)
    .eq('property_id', propertyId)
    .is('superseded_at', null)
    .order('created_at', { ascending: true })
    .returns<MemoryFactRow[]>();

  if (error) {
    throw new Error(`[synthesis] facts query failed: ${error.message}`);
  }
  return (data ?? []).map(rowToFact);
}

interface RecentProposal {
  id: string;
  organization_id: string;
  action_type: string;
  payload: unknown;
  reasoning: string;
  confidence: number | string;
  gate_decision: string;
  status: string;
  edit_diff: unknown | null;
  outcome: unknown | null;
  created_at: string;
}

async function loadRecentProposals(
  db: SupabaseClient,
  propertyId: string,
  organizationId: string,
  sinceIso: string,
): Promise<RecentProposal[]> {
  const { data, error } = await db
    .from('action_proposals')
    .select(
      'id, organization_id, action_type, payload, reasoning, confidence, ' +
        'gate_decision, status, edit_diff, outcome, created_at',
    )
    .eq('organization_id', organizationId)
    .eq('property_id', propertyId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .returns<RecentProposal[]>();

  if (error) {
    throw new Error(`[synthesis] proposals query failed: ${error.message}`);
  }
  return data ?? [];
}

/**
 * Stamp `superseded_at` and (optionally) `superseded_by` on a row.
 *
 * Direct UPDATE rather than going through the memory layer because the
 * memory layer's public surface intentionally does not expose this
 * primitive (so application code can't mark facts stale by accident).
 * Synthesis is the privileged caller for this primitive — gated by the
 * judge's approval — and the SQL CHECK constraints + RLS still apply.
 */
async function markSuperseded(
  db: SupabaseClient,
  factId: string,
  supersededBy: string | null,
  scope: { organizationId: string; propertyId: string },
): Promise<void> {
  const { error } = await db
    .from('memory_facts')
    .update({
      superseded_at: new Date().toISOString(),
      superseded_by: supersededBy,
    })
    .eq('id', factId)
    .eq('organization_id', scope.organizationId)
    .eq('property_id', scope.propertyId)
    .is('superseded_at', null);

  if (error) {
    throw new Error(
      `[synthesis] supersede update failed for ${factId}: ${error.message}`,
    );
  }
}

function sameFactIdentity(a: MemoryFact, b: MemoryFact): boolean {
  return a.factType === b.factType && a.subjectId === b.subjectId;
}

function maySupersede(newer: MemoryFact, older: MemoryFact): boolean {
  if (!sameFactIdentity(newer, older)) return false;
  if (older.factType !== 'owner_rule') return true;

  const newerTime = new Date(newer.createdAt).getTime();
  const olderTime = new Date(older.createdAt).getTime();
  return (
    newer.factType === 'owner_rule' &&
    newer.source === 'owner_stated' &&
    older.source === 'owner_stated' &&
    Number.isFinite(newerTime) &&
    Number.isFinite(olderTime) &&
    newerTime > olderTime
  );
}

async function loadPropertyOrganizationId(
  db: SupabaseClient,
  propertyId: string,
): Promise<string> {
  const { data, error } = await db
    .from('properties')
    .select('organization_id')
    .eq('id', propertyId)
    .single();
  if (error || !data?.organization_id) {
    throw new Error(`[synthesis] property ${propertyId} not found`);
  }
  return data.organization_id;
}

/**
 * Build a MemoryFactInsert from a kept fact + the proposer's rewrite_content.
 *
 * We preserve the kept fact's discriminator (factType + subjectId rule) and
 * just swap the body. The model is told (per prompt) to preserve the
 * discriminator; if it didn't, the per-fact-type body cast in `rowToFact`
 * later would surface a runtime mismatch — which is fine for a soft-fail.
 */
function buildMergeRewrite(
  keep: MemoryFact,
  rewriteContent: unknown,
  evidenceProposalIds: ReadonlyArray<string>,
): MemoryFactInsert {
  // Type assertions are deliberate: we trust the proposer/judge pipeline
  // to keep the body shape aligned with factType. The synthesis trace
  // captures the rewrite for debugging if it doesn't.
  switch (keep.factType) {
    case 'vendor_relationship':
      return {
        factType: 'vendor_relationship',
        subjectId: keep.subjectId ?? '',
        content: rewriteContent as MemoryFact extends { factType: 'vendor_relationship' }
          ? MemoryFact['content']
          : never,
        source: 'derived',
        confidence: Math.min(1, keep.confidence + 0.05),
        evidenceProposalIds,
      } as MemoryFactInsert;
    case 'tenant_pattern':
      return {
        factType: 'tenant_pattern',
        subjectId: keep.subjectId ?? '',
        content: rewriteContent as MemoryFactInsert extends { factType: 'tenant_pattern' }
          ? MemoryFactInsert['content']
          : never,
        source: 'derived',
        confidence: Math.min(1, keep.confidence + 0.05),
        evidenceProposalIds,
      } as MemoryFactInsert;
    case 'building_quirk':
      return {
        factType: 'building_quirk',
        subjectId: null,
        content: rewriteContent as MemoryFactInsert extends { factType: 'building_quirk' }
          ? MemoryFactInsert['content']
          : never,
        source: 'derived',
        confidence: Math.min(1, keep.confidence + 0.05),
        evidenceProposalIds,
      } as MemoryFactInsert;
    case 'derived_rule':
      return {
        factType: 'derived_rule',
        subjectId: null,
        content: rewriteContent as MemoryFactInsert extends { factType: 'derived_rule' }
          ? MemoryFactInsert['content']
          : never,
        source: 'derived',
        confidence: Math.min(1, keep.confidence + 0.05),
        evidenceProposalIds,
      } as MemoryFactInsert;
    case 'owner_rule':
      return {
        factType: 'owner_rule',
        subjectId: null,
        content: rewriteContent as MemoryFactInsert extends { factType: 'owner_rule' }
          ? MemoryFactInsert['content']
          : never,
        source: 'owner_stated',
        confidence: keep.confidence,
        evidenceProposalIds,
      } as MemoryFactInsert;
  }
}

interface PropertySettings {
  rulesText: string;
  autonomyLevel: number;
  privacyMode: 'hosted' | 'on_prem';
}

/**
 * Load the property's current rulebook + autonomy + privacy mode so we can
 * synthesize a complete UpdateRulebookPayload (the proposals layer expects
 * a full rulebook, not a delta).
 */
async function loadPropertySettings(
  db: SupabaseClient,
  propertyId: string,
): Promise<PropertySettings | null> {
  const { data, error } = await db
    .from('properties')
    .select('rules_text, autonomy_level, privacy_mode')
    .eq('id', propertyId)
    .single();
  if (error || !data) return null;
  const row = data as unknown as {
    rules_text: string | null;
    autonomy_level: number | string;
    privacy_mode: string;
  };
  const autonomy =
    typeof row.autonomy_level === 'string'
      ? Number(row.autonomy_level)
      : row.autonomy_level;
  return {
    rulesText: row.rules_text ?? '',
    autonomyLevel: Number.isFinite(autonomy) ? autonomy : 0,
    privacyMode: row.privacy_mode === 'on_prem' ? 'on_prem' : 'hosted',
  };
}

/**
 * Enqueue an `update_rulebook` ActionProposal via the proposals layer.
 *
 * The proposals layer's gate matrix forces 'review' for `update_rulebook`
 * regardless of autonomy_level, so we never auto-apply rulebook changes.
 * We pass the property's actual autonomy / privacy values so the audit
 * trail is honest about the property's state at proposal time.
 */
async function queueRulebookProposal(
  db: SupabaseClient,
  propertyId: string,
  organizationId: string,
  ruleText: string,
  rationale: string,
  settings: PropertySettings,
): Promise<string | null> {
  const existing = settings.rulesText.trim();
  const newRulebook =
    existing.length > 0 ? `${existing}\n\n${ruleText}` : ruleText;
  // Hard cap mirrors the SQL CHECK on properties.rules_text (4k char limit).
  const clipped = newRulebook.length > 4000 ? newRulebook.slice(0, 4000) : newRulebook;
  const payload: UpdateRulebookPayload = {
    newRulebook: clipped,
    diffSummary: `synthesis adds: ${ruleText.slice(0, 200)}`,
  };
  try {
    const result = await recordProposal(db as SupabaseClient<Database>, {
      organizationId,
      propertyId,
      workerModel: 'meta-synthesis-sonnet',
      actionType: 'update_rulebook',
      payload,
      reasoning: rationale,
      confidence: 0.7,
      contextFactIds: [],
      autonomyLevel: settings.autonomyLevel,
      privacyMode: settings.privacyMode,
      // update_rulebook is review_only — owner approves via the
      // property page Server Action, no commit-side dispatch needs
      // routing context.
      routing: null,
    });
    return result.proposal.id;
  } catch (err) {
    console.warn('[synthesis] queueRulebookProposal failed', err);
    return null;
  }
}

/**
 * Format the proposer payload as the prompt expects: a compact line per
 * fact + a separate compact block of recent proposals.
 */
function buildProposerUserPrompt(
  facts: ReadonlyArray<MemoryFact>,
  proposals: ReadonlyArray<{
    id: string;
    action_type: string;
    payload: unknown;
    status: string;
    edit_diff: unknown | null;
  }>,
): string {
  const factLines = facts.map((f) => {
    const ageDays = Math.round(
      (Date.now() - new Date(f.createdAt).getTime()) / 86400000,
    );
    return `- [${f.id}] (${f.factType}/${f.source} c=${f.confidence.toFixed(
      2,
    )} age=${ageDays}d) ${JSON.stringify(f.content).slice(0, 400)}`;
  });

  const proposalLines = proposals.map((p) => {
    const edit = p.edit_diff ? `edit_diff=${JSON.stringify(p.edit_diff).slice(0, 200)}` : '';
    return `- [${p.id}] ${p.action_type} status=${p.status} payload=${JSON.stringify(
      p.payload,
    ).slice(0, 300)} ${edit}`;
  });

  return [
    'Active memory_facts:',
    factLines.join('\n'),
    '',
    'Last 7 days action_proposals:',
    proposalLines.join('\n'),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runSynthesis(
  opts: RunSynthesisOptions,
): Promise<RunSynthesisResult> {
  const lookbackHours = opts.lookbackHours ?? 24 * 7;
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  const organizationId = await loadPropertyOrganizationId(
    opts.db,
    opts.propertyId,
  );
  const facts = await loadActiveFacts(
    opts.db,
    opts.propertyId,
    organizationId,
  );
  const proposals = await loadRecentProposals(
    opts.db,
    opts.propertyId,
    organizationId,
    since,
  );

  if (facts.length === 0) {
    return {
      factsScanned: facts.length,
      proposalsScanned: proposals.length,
      proposalsCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      merged: 0,
      superseded: 0,
      pruned: 0,
      rulesQueued: 0,
      applied: [],
      trace: { proposals: [], challenges: [], decisions: [] },
    };
  }

  // Phase 1 — Proposer
  const proposerUserPrompt = buildProposerUserPrompt(facts, proposals);
  const proposerCall = await callMetaLlm({
    phase: 'synthesis-proposer',
    model: opts.proposerModel ?? SYNTHESIS_PROPOSER_MODEL,
    systemPrompt: SYNTHESIS_PROPOSER_PROMPT,
    userPrompt: proposerUserPrompt,
    maxTokens: 4096,
    temperature: 0.2,
  });
  const proposerJson = parseJsonStrict<{ proposals: SynthesisProposal[] }>(
    proposerCall.text,
  );
  const synthesisProposals: ReadonlyArray<SynthesisProposal> =
    proposerJson?.proposals ?? [];

  if (synthesisProposals.length === 0) {
    return {
      factsScanned: facts.length,
      proposalsScanned: proposals.length,
      proposalsCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      merged: 0,
      superseded: 0,
      pruned: 0,
      rulesQueued: 0,
      applied: [],
      trace: { proposals: [], challenges: [], decisions: [] },
    };
  }

  // Phase 2 — Adversary
  const proposalsBlock = synthesisProposals
    .map((p, i) => `#${i}: ${JSON.stringify(p)}`)
    .join('\n');
  const adversaryUserPrompt = `Proposals:\n${proposalsBlock}\n\nOriginal facts:\n${facts
    .map((f) => `- [${f.id}] ${f.factType} ${JSON.stringify(f.content).slice(0, 200)}`)
    .join('\n')}`;
  const adversaryCall = await callMetaLlm({
    phase: 'synthesis-adversary',
    model: opts.adversaryModel ?? SYNTHESIS_ADVERSARY_MODEL,
    systemPrompt: SYNTHESIS_ADVERSARY_PROMPT,
    userPrompt: adversaryUserPrompt,
    maxTokens: 4096,
    temperature: 0.2,
  });
  const adversaryJson = parseJsonStrict<{ challenges: SynthesisChallenge[] }>(
    adversaryCall.text,
  );
  const challenges: ReadonlyArray<SynthesisChallenge> = adversaryJson?.challenges ?? [];

  // Phase 3 — Judge
  const challengesByIndex = new Map<number, SynthesisChallenge>(
    challenges.map((c) => [c.proposal_index, c]),
  );
  const challengesBlock = synthesisProposals
    .map((_p, i) => {
      const c = challengesByIndex.get(i);
      if (!c || !c.objection) return `#${i}: adversary raised no objection`;
      return `#${i}: [${c.severity}] ${c.objection}`;
    })
    .join('\n');
  const judgeUserPrompt = `Proposals:\n${proposalsBlock}\n\nAdversary challenges:\n${challengesBlock}`;
  const judgeCall = await callMetaLlm({
    phase: 'synthesis-judge',
    model: opts.judgeModel ?? SYNTHESIS_JUDGE_MODEL,
    systemPrompt: SYNTHESIS_JUDGE_PROMPT,
    userPrompt: judgeUserPrompt,
    maxTokens: 4096,
    temperature: 0.2,
  });
  const judgeJson = parseJsonStrict<{ decisions: SynthesisDecision[] }>(judgeCall.text);
  const decisions: ReadonlyArray<SynthesisDecision> = judgeJson?.decisions ?? [];
  const approved = new Set(
    decisions.filter((d) => d.approve).map((d) => d.proposal_index),
  );

  // Apply approved proposals
  const factsById = new Map(facts.map((f) => [f.id, f]));
  let merged = 0;
  let superseded = 0;
  let pruned = 0;
  let rulesQueued = 0;
  let propertySettings: PropertySettings | null = null;
  const applied: AppliedProposal[] = [];

  for (let i = 0; i < synthesisProposals.length; i++) {
    if (!approved.has(i)) continue;
    const p = synthesisProposals[i];
    try {
      if (p.verb === 'merge') {
        const keep = factsById.get(p.keep_fact_id);
        if (!keep || keep.factType === 'owner_rule') continue;
        const absorbIds = [
          ...new Set(
            p.absorb_fact_ids.filter((id) => id !== p.keep_fact_id),
          ),
        ];
        const absorbFacts = absorbIds.map((id) => factsById.get(id));
        if (
          absorbIds.length === 0 ||
          absorbFacts.some(
            (fact) =>
              !fact ||
              fact.factType === 'owner_rule' ||
              !sameFactIdentity(keep, fact),
          )
        ) {
          continue;
        }
        const insert = buildMergeRewrite(keep, p.rewrite_content, absorbIds);
        const newFact = await recordFact({
          db: opts.db as unknown as MemoryFactsClient,
          propertyId: opts.propertyId,
          fact: insert,
        });
        const scope = { organizationId, propertyId: opts.propertyId };
        await markSuperseded(opts.db, keep.id, newFact.id, scope);
        for (const oldId of absorbIds) {
          await markSuperseded(opts.db, oldId, newFact.id, scope);
        }
        merged++;
        applied.push({
          index: i,
          verb: 'merge',
          summary: `merged ${absorbIds.length + 1} facts into new ${newFact.id}`,
        });
      } else if (p.verb === 'supersede') {
        const newer = factsById.get(p.newer_fact_id);
        if (!newer) continue;
        const olderIds = [
          ...new Set(
            p.older_fact_ids.filter((id) => id !== p.newer_fact_id),
          ),
        ];
        const olderFacts = olderIds.map((id) => factsById.get(id));
        if (
          olderIds.length === 0 ||
          olderFacts.some((fact) => !fact || !maySupersede(newer, fact))
        ) {
          continue;
        }
        for (const oldId of olderIds) {
          await markSuperseded(opts.db, oldId, newer.id, {
            organizationId,
            propertyId: opts.propertyId,
          });
          superseded++;
        }
        applied.push({
          index: i,
          verb: 'supersede',
          summary: `${olderIds.length} older superseded by ${p.newer_fact_id}`,
        });
      } else if (p.verb === 'prune') {
        const fact = factsById.get(p.fact_id);
        if (!fact || fact.factType === 'owner_rule') continue;
        await markSuperseded(opts.db, p.fact_id, null, {
          organizationId,
          propertyId: opts.propertyId,
        });
        pruned++;
        applied.push({
          index: i,
          verb: 'prune',
          summary: `pruned ${p.fact_id}`,
        });
      } else if (p.verb === 'derive_rule') {
        // Lazy-load property settings the first time we need them — most
        // synthesis runs have no derive_rule proposals so we skip the
        // round-trip entirely otherwise.
        const settings =
          propertySettings ??
          (propertySettings = await loadPropertySettings(opts.db, opts.propertyId));
        if (!settings) continue;
        const proposalId = await queueRulebookProposal(
          opts.db,
          opts.propertyId,
          organizationId,
          p.rule_text,
          p.rationale,
          settings,
        );
        if (proposalId) {
          rulesQueued++;
          applied.push({
            index: i,
            verb: 'derive_rule',
            summary: `queued rulebook update ${proposalId}`,
          });
        }
      }
    } catch (err) {
      console.warn('[synthesis] apply failed', err);
    }
  }

  return {
    factsScanned: facts.length,
    proposalsScanned: proposals.length,
    proposalsCount: synthesisProposals.length,
    approvedCount: approved.size,
    rejectedCount: synthesisProposals.length - approved.size,
    merged,
    superseded,
    pruned,
    rulesQueued,
    applied,
    trace: {
      proposals: synthesisProposals,
      challenges,
      decisions,
    },
  };
}
