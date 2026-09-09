/**
 * Test utilities for the memory layer.
 *
 * Provides a minimal in-memory Supabase mock and fact factories. The mock
 * implements just the chainable surface our queries actually use:
 *   .from(table).select().eq().is().single() / .order() / .insert().select().single()
 *   .from(table).update(...).eq().is()
 *
 * It is NOT a general-purpose Postgres simulator — only the operations
 * called from `record.ts`, `query.ts`, `decay.ts` need to work. Anything
 * else returns an explicit error so test drift surfaces immediately.
 */
import { vi } from 'vitest';

import type {
  BuildingQuirkFact,
  DerivedRuleFact,
  FactType,
  MemoryFact,
  OwnerRuleFact,
  TenantPatternFact,
  VendorRelationshipFact,
} from '../types';
import type { MemoryFactsBuilder, MemoryFactsClient } from '../record';
import type { MemoryFactRow } from '../row';

let counter = 0;
export const PROPERTY_ID = '00000000-0000-0000-0000-000000000001';
export const ORG_ID = '00000000-0000-0000-0000-0000000000aa';
export const VENDOR_ID = '00000000-0000-0000-0000-0000000000bb';
export const TENANT_ID = '00000000-0000-0000-0000-0000000000cc';

function uid(): string {
  counter += 1;
  return `00000000-0000-0000-0000-${counter.toString(16).padStart(12, '0')}`;
}

export function resetCounter(): void {
  counter = 0;
}

interface FactRowOverrides {
  id?: string;
  organization_id?: string;
  property_id?: string;
  fact_type?: FactType;
  subject_id?: string | null;
  content?: unknown;
  confidence?: number;
  source?: MemoryFactRow['source'];
  evidence_proposal_ids?: string[] | null;
  created_at?: string;
  superseded_at?: string | null;
  superseded_by?: string | null;
}

export function makeRow(overrides: FactRowOverrides = {}): MemoryFactRow {
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
    created_at: overrides.created_at ?? new Date().toISOString(),
    superseded_at: overrides.superseded_at ?? null,
    superseded_by: overrides.superseded_by ?? null,
  };
}

/**
 * Builds a row for a specific fact type with a sensible content default.
 */
export function makeTypedRow(
  factType: FactType,
  overrides: FactRowOverrides = {},
): MemoryFactRow {
  const defaultContent: Record<FactType, unknown> = {
    vendor_relationship: {
      acceptance_rate: 0.8,
      last_used_at: '2026-04-01T00:00:00Z',
      owner_preferred: true,
      performance_notes: 'fast same-day',
    },
    tenant_pattern: {
      payment_cadence: 'pays on the 5th',
      communication_style: 'terse',
      complaint_themes: ['noise'],
      last_observed_at: '2026-04-01T00:00:00Z',
    },
    building_quirk: {
      description: 'boiler kicks off below 10F',
      season: 'winter',
      recurring: true,
      severity: 0.6,
    },
    derived_rule: {
      rule_text: 'be direct, no apologies',
      supersedes_rule_id: null,
      evidence_count: 4,
    },
    owner_rule: {
      rule_text: 'never waive late fees',
      source_text: 'rulebook v1',
    },
  };
  return makeRow({
    fact_type: factType,
    subject_id:
      factType === 'vendor_relationship'
        ? VENDOR_ID
        : factType === 'tenant_pattern'
          ? TENANT_ID
          : null,
    content: defaultContent[factType],
    ...overrides,
  });
}

/** Construct a fully-typed `MemoryFact` directly (skipping rowToFact). */
export function makeFact<T extends FactType>(
  factType: T,
  overrides: Partial<MemoryFact> = {},
): MemoryFact {
  const row = makeTypedRow(factType);
  const base = {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    subjectId: row.subject_id,
    confidence: typeof row.confidence === 'number' ? row.confidence : 0.5,
    source: row.source,
    evidenceProposalIds: row.evidence_proposal_ids ?? [],
    createdAt: row.created_at,
    supersededAt: null,
    supersededBy: null,
    ...overrides,
  };
  switch (factType) {
    case 'vendor_relationship':
      return {
        ...base,
        factType: 'vendor_relationship',
        content: row.content as VendorRelationshipFact['content'],
      };
    case 'tenant_pattern':
      return {
        ...base,
        factType: 'tenant_pattern',
        content: row.content as TenantPatternFact['content'],
      };
    case 'building_quirk':
      return {
        ...base,
        factType: 'building_quirk',
        content: row.content as BuildingQuirkFact['content'],
      };
    case 'derived_rule':
      return {
        ...base,
        factType: 'derived_rule',
        content: row.content as DerivedRuleFact['content'],
      };
    case 'owner_rule':
      return {
        ...base,
        factType: 'owner_rule',
        content: row.content as OwnerRuleFact['content'],
      };
  }
  throw new Error(`unknown fact type ${factType}`);
}

// ---------------------------------------------------------------------------
// Supabase mock — chainable thenable that returns `{ data, error }`.
// ---------------------------------------------------------------------------

export interface MockState {
  /** memory_facts rows the mock will serve to selects. */
  rows: MemoryFactRow[];
  /** properties rows the mock can resolve org_id against. */
  properties: { id: string; organization_id: string }[];
  /** Records every insert so tests can assert. */
  inserts: { table: string; row: Record<string, unknown> }[];
  /** Records every update call (post-filter). */
  updates: {
    table: string;
    patch: Record<string, unknown>;
    filters: Record<string, unknown>;
  }[];
  /** Force a specific error to be returned on next op (for error tests). */
  forcedError: { table: string; op: string; message: string } | null;
}

export function createMockState(): MockState {
  return {
    rows: [],
    properties: [{ id: PROPERTY_ID, organization_id: ORG_ID }],
    inserts: [],
    updates: [],
    forcedError: null,
  };
}

interface BuilderOpts {
  table: string;
  state: MockState;
}

/**
 * Build a chainable query against `state.rows` for memory_facts or
 * `state.properties` for properties. The builder intentionally implements
 * `.then` so it's awaitable — Supabase queries are PromiseLike.
 */
function makeBuilder(opts: BuilderOpts): MemoryFactsBuilder {
  const filters: Array<(row: Record<string, unknown>) => boolean> = [];
  let mode: 'select' | 'insert' | 'update' = 'select';
  let single = false;
  let isCount = false;
  let pendingPatch: Record<string, unknown> | null = null;
  let pendingInsert: Record<string, unknown> | null = null;
  let orderBy: { col: string; asc: boolean } | null = null;
  // For `select('*', { count: 'exact', head: true })` we want a count without rows.
  let headOnly = false;

  const collectRows = (): Record<string, unknown>[] => {
    const source =
      opts.table === 'memory_facts'
        ? (opts.state.rows as unknown as Record<string, unknown>[])
        : opts.table === 'properties'
          ? (opts.state.properties as unknown as Record<string, unknown>[])
          : [];
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

  const resolve = (): { data: unknown; error: unknown; count?: number | null } => {
    const forced = opts.state.forcedError;
    if (forced && forced.table === opts.table && forced.op === mode) {
      opts.state.forcedError = null;
      return { data: null, error: { message: forced.message } };
    }
    if (mode === 'insert' && pendingInsert) {
      const inserted: Record<string, unknown> = {
        ...pendingInsert,
        id: pendingInsert.id ?? uid(),
      };
      // For tests we don't push to rows automatically — keep insert side-
      // effects observable via `state.inserts`. Tests that need follow-on
      // queries push manually (or call `appendInsertedRows: true`).
      opts.state.inserts.push({ table: opts.table, row: inserted });
      if (opts.table === 'memory_facts') {
        // Auto-append a synthesized row so subsequent selects can see it.
        // Stamp created_at + defaults that the SQL DEFAULT would supply.
        const row = makeRow({
          id: String(inserted.id),
          organization_id: String(inserted.organization_id),
          property_id: String(inserted.property_id),
          fact_type: inserted.fact_type as FactType,
          subject_id: (inserted.subject_id as string | null) ?? null,
          content: inserted.content,
          confidence: Number(inserted.confidence ?? 0.5),
          source: inserted.source as MemoryFactRow['source'],
          evidence_proposal_ids:
            (inserted.evidence_proposal_ids as string[] | null) ?? [],
        });
        opts.state.rows.push(row);
        return single
          ? { data: row, error: null }
          : { data: [row], error: null };
      }
      return single ? { data: inserted, error: null } : { data: [inserted], error: null };
    }
    if (mode === 'update' && pendingPatch) {
      const matched = collectRows();
      const filtersSummary: Record<string, unknown> = {};
      for (const fn of filters) {
        // We can't introspect closures; tests assert via state.updates.length
        // and via verifying rows were patched.
        void fn;
      }
      for (const row of matched) {
        Object.assign(row, pendingPatch);
      }
      opts.state.updates.push({
        table: opts.table,
        patch: pendingPatch,
        filters: filtersSummary,
      });
      return { data: null, error: null, count: matched.length };
    }
    // select
    const rows = collectRows();
    if (isCount) {
      return { data: null, error: null, count: rows.length };
    }
    if (headOnly) {
      return { data: null, error: null, count: rows.length };
    }
    if (single) {
      if (rows.length === 0) {
        return { data: null, error: { message: 'no rows' } };
      }
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  };

  const builder: MemoryFactsBuilder = {
    select(_cols?: string, options?: { count?: string; head?: boolean }) {
      // Don't downgrade mode: `.insert(...).select().single()` must still
      // resolve through the insert path. Only set mode if no other op is
      // pending.
      if (mode !== 'insert' && mode !== 'update') {
        mode = 'select';
      }
      if (options?.count === 'exact') {
        if (options.head) headOnly = true;
        else isCount = true;
      }
      return builder;
    },
    insert(row: Record<string, unknown>) {
      mode = 'insert';
      pendingInsert = row;
      return builder;
    },
    update(patch: Record<string, unknown>, options?: { count?: string }) {
      mode = 'update';
      pendingPatch = patch;
      if (options?.count === 'exact') isCount = true;
      return builder;
    },
    eq(col: string, val: unknown) {
      filters.push((row) => row[col] === val);
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

export function createSupabaseMock(state: MockState): MemoryFactsClient {
  return {
    from: vi.fn((table: string) => makeBuilder({ table, state })),
  };
}

export function setForcedError(
  state: MockState,
  table: string,
  op: 'select' | 'insert' | 'update',
  message: string,
): void {
  state.forcedError = { table, op, message };
}
