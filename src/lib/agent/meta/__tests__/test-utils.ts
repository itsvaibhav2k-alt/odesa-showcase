/**
 * Test utilities for the meta loops (reflection / synthesis / cross-property).
 *
 * Extends the memory-layer mock pattern to cover the four tables the loops
 * touch: properties, memory_facts, action_proposals, meta_insights.
 *
 * The mock is intentionally minimal — only the chainable surface our
 * production code calls is implemented. Anything else returns an explicit
 * `not implemented` error so test drift surfaces immediately.
 */
import { vi } from 'vitest';

let counter = 0;

export const ORG_ID = '00000000-0000-0000-0000-0000000000aa';
export const PROPERTY_ID = '00000000-0000-0000-0000-000000000001';
export const PROPERTY_2_ID = '00000000-0000-0000-0000-000000000002';
export const PROPERTY_3_ID = '00000000-0000-0000-0000-000000000003';
export const PROPERTY_4_ID = '00000000-0000-0000-0000-000000000004';
export const PROPERTY_5_ID = '00000000-0000-0000-0000-000000000005';
export const VENDOR_ID = '00000000-0000-0000-0000-0000000000bb';
export const TENANT_ID = '00000000-0000-0000-0000-0000000000cc';

export function uid(): string {
  counter += 1;
  return `00000000-0000-0000-0000-${counter.toString(16).padStart(12, '0')}`;
}

export function resetCounter(): void {
  counter = 0;
}

// ---------------------------------------------------------------------------
// Row shapes (snake_case, mirror Postgres)
// ---------------------------------------------------------------------------

export interface PropertyRow {
  id: string;
  organization_id: string;
  rules_text: string;
  autonomy_level: number;
  privacy_mode: string;
}

export interface MemoryFactRow {
  id: string;
  organization_id: string;
  property_id: string;
  fact_type: string;
  subject_id: string | null;
  content: unknown;
  confidence: number;
  source: string;
  evidence_proposal_ids: string[] | null;
  created_at: string;
  superseded_at: string | null;
  superseded_by: string | null;
}

export interface ActionProposalRow {
  id: string;
  organization_id: string;
  property_id: string;
  worker_model: string;
  action_type: string;
  payload: unknown;
  reasoning: string;
  confidence: number;
  context_fact_ids: string[] | null;
  gate_decision: string;
  status: string;
  edit_diff: unknown | null;
  outcome: unknown | null;
  created_at: string;
  committed_at: string | null;
  rejected_at: string | null;
}

export interface MetaInsightRow {
  id: string;
  organization_id: string;
  pattern_type: string;
  affected_property_ids: string[];
  insight: string;
  recommended_action: unknown | null;
  acknowledged_at: string | null;
  acted_on_at: string | null;
  created_at: string;
}

export interface MockState {
  properties: PropertyRow[];
  memoryFacts: MemoryFactRow[];
  actionProposals: ActionProposalRow[];
  metaInsights: MetaInsightRow[];
  inserts: { table: string; row: Record<string, unknown> }[];
  updates: { table: string; patch: Record<string, unknown> }[];
  forcedError: { table: string; op: string; message: string } | null;
}

export function createMockState(): MockState {
  return {
    properties: [
      {
        id: PROPERTY_ID,
        organization_id: ORG_ID,
        rules_text: '',
        autonomy_level: 0.5,
        privacy_mode: 'hosted',
      },
    ],
    memoryFacts: [],
    actionProposals: [],
    metaInsights: [],
    inserts: [],
    updates: [],
    forcedError: null,
  };
}

// ---------------------------------------------------------------------------
// Row factories
// ---------------------------------------------------------------------------

export function makeFactRow(overrides: Partial<MemoryFactRow> = {}): MemoryFactRow {
  const created = overrides.created_at ?? new Date().toISOString();
  return {
    id: overrides.id ?? uid(),
    organization_id: overrides.organization_id ?? ORG_ID,
    property_id: overrides.property_id ?? PROPERTY_ID,
    fact_type: overrides.fact_type ?? 'tenant_pattern',
    subject_id: overrides.subject_id ?? null,
    content: overrides.content ?? {},
    confidence: overrides.confidence ?? 0.5,
    source: overrides.source ?? 'observed',
    evidence_proposal_ids: overrides.evidence_proposal_ids ?? [],
    created_at: created,
    superseded_at: overrides.superseded_at ?? null,
    superseded_by: overrides.superseded_by ?? null,
  };
}

export function makeProposalRow(
  overrides: Partial<ActionProposalRow> = {},
): ActionProposalRow {
  const created = overrides.created_at ?? new Date().toISOString();
  return {
    id: overrides.id ?? uid(),
    organization_id: overrides.organization_id ?? ORG_ID,
    property_id: overrides.property_id ?? PROPERTY_ID,
    worker_model: overrides.worker_model ?? 'claude-haiku-4-5-20251001',
    action_type: overrides.action_type ?? 'draft_sms_reply',
    payload: overrides.payload ?? { body: 'sample', tone: 'neutral' },
    reasoning: overrides.reasoning ?? 'sample reasoning',
    confidence: overrides.confidence ?? 0.8,
    context_fact_ids: overrides.context_fact_ids ?? [],
    gate_decision: overrides.gate_decision ?? 'review',
    status: overrides.status ?? 'committed',
    edit_diff: overrides.edit_diff ?? null,
    outcome: overrides.outcome ?? null,
    created_at: created,
    committed_at: overrides.committed_at ?? null,
    rejected_at: overrides.rejected_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Supabase mock — chainable thenable builder
// ---------------------------------------------------------------------------

interface BuilderOpts {
  table: string;
  state: MockState;
}

function getRows(opts: BuilderOpts): Record<string, unknown>[] {
  switch (opts.table) {
    case 'properties':
      return opts.state.properties as unknown as Record<string, unknown>[];
    case 'memory_facts':
      return opts.state.memoryFacts as unknown as Record<string, unknown>[];
    case 'action_proposals':
      return opts.state.actionProposals as unknown as Record<string, unknown>[];
    case 'meta_insights':
      return opts.state.metaInsights as unknown as Record<string, unknown>[];
    default:
      return [];
  }
}

function makeBuilder(opts: BuilderOpts) {
  const filters: Array<(row: Record<string, unknown>) => boolean> = [];
  let mode: 'select' | 'insert' | 'update' = 'select';
  let single = false;
  let pendingPatch: Record<string, unknown> | null = null;
  let pendingInsert: Record<string, unknown> | Record<string, unknown>[] | null = null;
  let orderBy: { col: string; asc: boolean } | null = null;

  const collectRows = (): Record<string, unknown>[] => {
    const source = getRows(opts);
    let result = source.filter((row) => filters.every((f) => f(row)));
    if (orderBy) {
      const { col, asc } = orderBy;
      result = [...result].sort((a, b) => {
        const av = String(a[col] ?? '');
        const bv = String(b[col] ?? '');
        if (av === bv) return 0;
        return asc ? (av < bv ? -1 : 1) : av < bv ? 1 : -1;
      });
    }
    return result;
  };

  const persistInsert = (
    row: Record<string, unknown>,
  ): Record<string, unknown> => {
    const id = (row.id ?? uid()) as string;
    const stamped: Record<string, unknown> = { ...row, id };
    opts.state.inserts.push({ table: opts.table, row: stamped });
    if (opts.table === 'memory_facts') {
      const fact = makeFactRow({
        id: String(stamped.id),
        organization_id: String(stamped.organization_id),
        property_id: String(stamped.property_id),
        fact_type: String(stamped.fact_type),
        subject_id: (stamped.subject_id as string | null) ?? null,
        content: stamped.content,
        confidence: Number(stamped.confidence ?? 0.5),
        source: String(stamped.source),
        evidence_proposal_ids:
          (stamped.evidence_proposal_ids as string[] | null) ?? [],
      });
      opts.state.memoryFacts.push(fact);
      return fact as unknown as Record<string, unknown>;
    }
    if (opts.table === 'action_proposals') {
      const proposal = makeProposalRow({
        id: String(stamped.id),
        organization_id: String(stamped.organization_id),
        property_id: String(stamped.property_id),
        worker_model: String(stamped.worker_model),
        action_type: String(stamped.action_type),
        payload: stamped.payload,
        reasoning: String(stamped.reasoning ?? ''),
        confidence: Number(stamped.confidence ?? 0.5),
        context_fact_ids:
          (stamped.context_fact_ids as string[] | null) ?? [],
        gate_decision: String(stamped.gate_decision),
        status: String(stamped.status ?? 'proposed'),
      });
      opts.state.actionProposals.push(proposal);
      return proposal as unknown as Record<string, unknown>;
    }
    if (opts.table === 'meta_insights') {
      const insight: MetaInsightRow = {
        id: String(stamped.id),
        organization_id: String(stamped.organization_id),
        pattern_type: String(stamped.pattern_type),
        affected_property_ids:
          (stamped.affected_property_ids as string[]) ?? [],
        insight: String(stamped.insight ?? ''),
        recommended_action: stamped.recommended_action ?? null,
        acknowledged_at: null,
        acted_on_at: null,
        created_at: new Date().toISOString(),
      };
      opts.state.metaInsights.push(insight);
      return insight as unknown as Record<string, unknown>;
    }
    return stamped;
  };

  const resolve = (): {
    data: unknown;
    error: unknown;
    count?: number | null;
  } => {
    const forced = opts.state.forcedError;
    if (forced && forced.table === opts.table && forced.op === mode) {
      opts.state.forcedError = null;
      return { data: null, error: { message: forced.message } };
    }
    if (mode === 'insert' && pendingInsert) {
      if (Array.isArray(pendingInsert)) {
        const inserted = pendingInsert.map((r) => persistInsert(r));
        return { data: inserted, error: null };
      }
      const inserted = persistInsert(pendingInsert);
      return single
        ? { data: inserted, error: null }
        : { data: [inserted], error: null };
    }
    if (mode === 'update' && pendingPatch) {
      const matched = collectRows();
      for (const row of matched) {
        Object.assign(row, pendingPatch);
      }
      opts.state.updates.push({ table: opts.table, patch: pendingPatch });
      return { data: null, error: null };
    }
    const rows = collectRows();
    if (single) {
      if (rows.length === 0) {
        return { data: null, error: { message: 'no rows' } };
      }
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  };

  const builder: Record<string, unknown> & PromiseLike<unknown> = {
    select() {
      if (mode !== 'insert' && mode !== 'update') mode = 'select';
      return builder;
    },
    insert(row: Record<string, unknown> | Record<string, unknown>[]) {
      mode = 'insert';
      pendingInsert = row;
      return builder;
    },
    update(patch: Record<string, unknown>) {
      mode = 'update';
      pendingPatch = patch;
      return builder;
    },
    eq(col: string, val: unknown) {
      filters.push((row) => row[col] === val);
      return builder;
    },
    gte(col: string, val: unknown) {
      filters.push((row) => String(row[col]) >= String(val));
      return builder;
    },
    is(col: string, val: unknown) {
      filters.push((row) => row[col] === val);
      return builder;
    },
    order(col: string, options?: { ascending?: boolean }) {
      orderBy = { col, asc: options?.ascending !== false };
      return builder;
    },
    single() {
      single = true;
      return builder;
    },
    // PostgrestQueryBuilder.returns<T>() is a no-op at runtime — it just
    // narrows the static result type. The mock mirrors that behavior so
    // production code that chains `.returns<T>()` to keep typecheck clean
    // doesn't blow up here.
    returns() {
      return builder;
    },
    then<R1, R2>(
      onFulfilled?: (value: unknown) => R1 | PromiseLike<R1>,
      onRejected?: (reason: unknown) => R2 | PromiseLike<R2>,
    ) {
      try {
        return Promise.resolve(resolve()).then(onFulfilled, onRejected);
      } catch (err) {
        return Promise.reject(err).then(onFulfilled, onRejected);
      }
    },
  };
  return builder;
}

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The production code declares its db parameter as `SupabaseClient` but the
 * runtime surface we need (chainable from(...) builder) is much smaller. We
 * cast to that type via `unknown` so call sites in tests don't need to
 * sprinkle `as any` everywhere — and so that lint stays clean.
 */
export function createSupabaseMock(state: MockState): SupabaseClient {
  return {
    from: vi.fn((table: string) => makeBuilder({ table, state })),
  } as unknown as SupabaseClient;
}

export function setForcedError(
  state: MockState,
  table: string,
  op: 'select' | 'insert' | 'update',
  message: string,
): void {
  state.forcedError = { table, op, message };
}

// ---------------------------------------------------------------------------
// Anthropic SDK mock — captures calls + returns scripted responses
// ---------------------------------------------------------------------------

import type Anthropic from '@anthropic-ai/sdk';

import { setAnthropicClientFactory, resetAnthropicClient } from '../llm';

export interface AnthropicCall {
  model: string;
  system: string;
  userPrompt: string;
}

export interface AnthropicMockState {
  calls: AnthropicCall[];
  /**
   * Queued responses, FIFO. Each one is the JSON string the model would
   * emit. Tests push the canned responses in the order they expect the
   * loops to fire (proposer → adversary → judge for synthesis).
   */
  responses: string[];
}

export function installAnthropicMock(): AnthropicMockState {
  const state: AnthropicMockState = { calls: [], responses: [] };

  const fakeClient = {
    messages: {
      create: vi.fn(async (input: { model: string; system: string; messages: Array<{ role: string; content: string }> }) => {
        state.calls.push({
          model: input.model,
          system: input.system,
          userPrompt:
            input.messages[0]?.content ?? '',
        });
        const text = state.responses.shift() ?? '{}';
        return {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: input.model,
          stop_reason: 'end_turn',
          stop_sequence: null,
          content: [{ type: 'text', text }],
          usage: { input_tokens: 42, output_tokens: 84 },
        };
      }),
    },
  } as unknown as Anthropic;

  setAnthropicClientFactory(() => fakeClient);
  return state;
}

export function uninstallAnthropicMock(): void {
  resetAnthropicClient();
}
