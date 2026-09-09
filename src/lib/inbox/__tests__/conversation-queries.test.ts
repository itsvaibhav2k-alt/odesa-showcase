/**
 * Unit tests for `src/lib/inbox/conversation-queries.ts`.
 *
 * The new wave-4 inbox surface reads conversations + messages directly
 * via the auth-aware supabase client. We mock the client with a small
 * chainable stub that mirrors the subset of supabase-js the queries
 * use. RLS is implicit — we don't simulate it, we just trust the
 * caller passes the cookie-bound client.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getActivitySummary,
  getConversation,
  listConversations,
} from '@/lib/inbox/conversation-queries';
import type { Database } from '@/types/database';

type AnySupabase = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Stub builder
// ---------------------------------------------------------------------------

interface Tables {
  conversations?: ReadonlyArray<Record<string, unknown>>;
  messages?: ReadonlyArray<Record<string, unknown>>;
  tenants?: ReadonlyArray<Record<string, unknown>>;
  leases?: ReadonlyArray<Record<string, unknown>>;
  units?: ReadonlyArray<Record<string, unknown>>;
  properties?: ReadonlyArray<Record<string, unknown>>;
  users?: ReadonlyArray<Record<string, unknown>>;
}

interface AuthState {
  userId?: string;
}

interface Predicate {
  kind: 'eq' | 'in' | 'gte' | 'or';
  column: string;
  value: unknown;
}

interface OrderSpec {
  column: string;
  ascending: boolean;
}

function buildSupabaseStub(
  tables: Tables,
  auth: AuthState = {},
): AnySupabase {
  const stub = {
    auth: {
      getUser: async () => ({
        data: {
          user: auth.userId
            ? { id: auth.userId, email: 'op@example.test' }
            : null,
        },
        error: null,
      }),
    },
    from: (tableName: keyof Tables) => buildQuery(tableName, tables),
  };
  return stub as unknown as AnySupabase;
}

function buildQuery(tableName: keyof Tables, tables: Tables): unknown {
  const predicates: Predicate[] = [];
  let limitN: number | null = null;
  let countMode: 'exact' | null = null;
  let headOnly = false;
  let orderSpec: OrderSpec | null = null;

  function applyPredicates(
    rows: ReadonlyArray<Record<string, unknown>>,
  ): Record<string, unknown>[] {
    let result = [...rows];
    for (const p of predicates) {
      if (p.kind === 'eq') {
        result = result.filter((r) => r[p.column] === p.value);
      } else if (p.kind === 'in') {
        const arr = p.value as unknown[];
        result = result.filter((r) => arr.includes(r[p.column]));
      } else if (p.kind === 'gte') {
        result = result.filter((r) => {
          const v = r[p.column];
          if (typeof v !== 'string' || typeof p.value !== 'string') return false;
          return v >= p.value;
        });
      } else if (p.kind === 'or') {
        // PostgREST or-filter: 'col.op.value,col.op.value' (eq/gt supported)
        const clauses = String(p.value)
          .split(',')
          .map((clause) => {
            const [column, op, ...rest] = clause.split('.');
            return { column, op, value: rest.join('.') };
          });
        result = result.filter((r) =>
          clauses.some(({ column, op, value }) => {
            const v = r[column];
            if (op === 'eq') return String(v) === value;
            if (op === 'gt') {
              return typeof v === 'string' && v > value;
            }
            return false;
          }),
        );
      }
    }
    if (orderSpec) {
      const { column, ascending } = orderSpec;
      result = [...result].sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av < bv) return ascending ? -1 : 1;
        if (av > bv) return ascending ? 1 : -1;
        return 0;
      });
    }
    if (limitN !== null) result = result.slice(0, limitN);
    return result;
  }

  function settle(): { data: unknown; count?: number; error: null } {
    const rows = applyPredicates(tables[tableName] ?? []);
    if (countMode === 'exact') {
      return {
        data: headOnly ? null : rows,
        count: rows.length,
        error: null,
      };
    }
    return { data: rows, error: null };
  }

  const chain = {
    select(_cols?: string, opts?: { count?: 'exact'; head?: boolean }) {
      if (opts?.count) countMode = opts.count;
      if (opts?.head) headOnly = true;
      return chain;
    },
    eq(col: string, value: unknown) {
      predicates.push({ kind: 'eq', column: col, value });
      return chain;
    },
    in(col: string, value: unknown[]) {
      predicates.push({ kind: 'in', column: col, value });
      return chain;
    },
    gte(col: string, value: unknown) {
      predicates.push({ kind: 'gte', column: col, value });
      return chain;
    },
    or(filter: string) {
      predicates.push({ kind: 'or', column: '', value: filter });
      return chain;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderSpec = {
        column: col,
        ascending: opts?.ascending !== false,
      };
      return chain;
    },
    limit(n: number) {
      limitN = n;
      return chain;
    },
    maybeSingle() {
      const row = applyPredicates(tables[tableName] ?? [])[0] ?? null;
      return Promise.resolve({ data: row, error: null });
    },
    single() {
      const row = applyPredicates(tables[tableName] ?? [])[0] ?? null;
      return Promise.resolve({ data: row, error: null });
    },
    then(
      onFulfilled?: (value: unknown) => unknown,
    ): Promise<unknown> {
      return Promise.resolve(settle()).then(onFulfilled);
    },
  };
  return chain;
}

// ---------------------------------------------------------------------------
// listConversations
// ---------------------------------------------------------------------------

describe('conversation-queries', () => {
  describe('listConversations', () => {
    it('returns an empty array when no conversations exist', async () => {
      const supabase = buildSupabaseStub(
        { conversations: [], messages: [], tenants: [], leases: [] },
        { userId: 'u1' },
      );
      const result = await listConversations(supabase);
      expect(result).toEqual([]);
    });

    it('populates one row per conversation with last-message preview', async () => {
      const olderIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const newerIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const supabase = buildSupabaseStub(
        {
          conversations: [
            { id: 'conv-1', tenant_id: 'tenant-1', last_message_at: newerIso },
            { id: 'conv-2', tenant_id: 'tenant-2', last_message_at: olderIso },
          ],
          messages: [
            {
              id: 'msg-old',
              conversation_id: 'conv-1',
              direction: 'inbound',
              body: 'Earlier inbound that should be ignored.',
              draft_status: 'auto_sent',
              created_at: olderIso,
            },
            {
              id: 'msg-newest',
              conversation_id: 'conv-1',
              direction: 'outbound',
              body: 'Most recent reply that should anchor the preview.',
              draft_status: 'auto_sent',
              created_at: newerIso,
            },
            {
              id: 'msg-2',
              conversation_id: 'conv-2',
              direction: 'inbound',
              body: 'Hey there, conv 2 inbound.',
              draft_status: 'auto_sent',
              created_at: olderIso,
            },
          ],
          tenants: [
            { id: 'tenant-1', full_name: 'Marcus Lee', phone_e164: '+1' },
            { id: 'tenant-2', full_name: 'Elena Park', phone_e164: '+2' },
          ],
          leases: [
            { tenant_id: 'tenant-1', unit_id: 'unit-1', status: 'active' },
          ],
          units: [{ id: 'unit-1', label: 'Apt 312' }],
        },
        { userId: 'u1' },
      );
      const result = await listConversations(supabase);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'conv-1',
        tenantName: 'Marcus Lee',
        unitLabel: 'Apt 312',
        lastMessageDirection: 'outbound',
      });
      expect(result[0].lastMessagePreview).toBe(
        'Most recent reply that should anchor the preview.',
      );
      expect(result[1].id).toBe('conv-2');
      expect(result[1].unitLabel).toBeNull();
    });

    it('sets pendingDraftId when a pending_review outbound exists', async () => {
      const nowIso = new Date().toISOString();
      const supabase = buildSupabaseStub(
        {
          conversations: [
            { id: 'conv-1', tenant_id: 'tenant-1', last_message_at: nowIso },
          ],
          messages: [
            {
              id: 'inbound-1',
              conversation_id: 'conv-1',
              direction: 'inbound',
              body: 'Hi, when can the plumber come?',
              draft_status: 'auto_sent',
              created_at: nowIso,
            },
            {
              id: 'draft-1',
              conversation_id: 'conv-1',
              direction: 'outbound',
              body: 'Pending suggested reply.',
              draft_status: 'pending_review',
              created_at: nowIso,
            },
          ],
          tenants: [
            { id: 'tenant-1', full_name: 'Marcus Lee', phone_e164: '+1' },
          ],
          leases: [],
        },
        { userId: 'u1' },
      );
      const result = await listConversations(supabase);
      expect(result[0].pendingDraftId).toBe('draft-1');
    });

    it('truncates long previews to 80 chars + ellipsis', async () => {
      const nowIso = new Date().toISOString();
      const longBody =
        'This is a very long preview body that exceeds eighty characters in total length so the helper truncates.';
      const supabase = buildSupabaseStub(
        {
          conversations: [
            { id: 'conv-1', tenant_id: 'tenant-1', last_message_at: nowIso },
          ],
          messages: [
            {
              id: 'msg-long',
              conversation_id: 'conv-1',
              direction: 'inbound',
              body: longBody,
              draft_status: 'auto_sent',
              created_at: nowIso,
            },
          ],
          tenants: [
            { id: 'tenant-1', full_name: 'Marcus Lee', phone_e164: '+1' },
          ],
          leases: [],
        },
        { userId: 'u1' },
      );
      const result = await listConversations(supabase);
      expect(result[0].lastMessagePreview.length).toBeLessThanOrEqual(81);
      expect(result[0].lastMessagePreview.endsWith('…')).toBe(true);
    });

    it('uses fallback name when tenant row is missing', async () => {
      const nowIso = new Date().toISOString();
      const supabase = buildSupabaseStub(
        {
          conversations: [
            { id: 'conv-1', tenant_id: 'tenant-orphan', last_message_at: nowIso },
          ],
          messages: [
            {
              id: 'msg-1',
              conversation_id: 'conv-1',
              direction: 'inbound',
              body: 'Hello',
              draft_status: 'auto_sent',
              created_at: nowIso,
            },
          ],
          tenants: [],
          leases: [],
        },
        { userId: 'u1' },
      );
      const result = await listConversations(supabase);
      expect(result[0].tenantName).toBe('Unknown tenant');
    });

    it('skips conversations that have zero non-rejected messages', async () => {
      const nowIso = new Date().toISOString();
      const supabase = buildSupabaseStub(
        {
          conversations: [
            { id: 'conv-1', tenant_id: 'tenant-1', last_message_at: nowIso },
          ],
          messages: [
            {
              id: 'msg-rejected',
              conversation_id: 'conv-1',
              direction: 'outbound',
              body: 'Rejected draft',
              draft_status: 'rejected',
              created_at: nowIso,
            },
          ],
          tenants: [
            { id: 'tenant-1', full_name: 'Marcus Lee', phone_e164: '+1' },
          ],
          leases: [],
        },
        { userId: 'u1' },
      );
      const result = await listConversations(supabase);
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getConversation
  // -------------------------------------------------------------------------

  describe('getConversation', () => {
    it('returns null when the conversation is not visible', async () => {
      const supabase = buildSupabaseStub(
        { conversations: [], messages: [], tenants: [], leases: [] },
        { userId: 'u1' },
      );
      const result = await getConversation(supabase, 'missing-conv');
      expect(result).toBeNull();
    });

    it('populates tenant context and chronological messages', async () => {
      const nowIso = new Date().toISOString();
      const supabase = buildSupabaseStub(
        {
          conversations: [{ id: 'conv-1', tenant_id: 'tenant-1' }],
          messages: [
            {
              id: 'inbound-1',
              conversation_id: 'conv-1',
              direction: 'inbound',
              body: 'Hi',
              draft_status: 'auto_sent',
              created_at: '2026-05-01T09:00:00.000Z',
              sent_at: '2026-05-01T09:00:00.000Z',
            },
            {
              id: 'outbound-1',
              conversation_id: 'conv-1',
              direction: 'outbound',
              body: 'Reply',
              draft_status: 'auto_sent',
              created_at: '2026-05-01T09:01:00.000Z',
              sent_at: '2026-05-01T09:01:00.000Z',
            },
          ],
          tenants: [
            {
              id: 'tenant-1',
              full_name: 'Marcus Lee',
              phone_e164: '+15715559001',
              created_at: '2024-01-01T00:00:00.000Z',
            },
          ],
          leases: [
            {
              id: 'lease-1',
              tenant_id: 'tenant-1',
              unit_id: 'unit-1',
              rent_amount: 2400,
              start_date: '2025-08-01',
              status: 'active',
            },
          ],
          units: [
            {
              id: 'unit-1',
              label: 'Apt 312',
              bedrooms: 2,
              bathrooms: 1,
              property_id: 'prop-1',
            },
          ],
          properties: [{ id: 'prop-1', name: 'The Maplewoods' }],
        },
        { userId: 'u1' },
      );
      // The "now" param is used implicitly by helpers; not relevant here.
      void nowIso;
      const detail = await getConversation(supabase, 'conv-1');
      expect(detail).not.toBeNull();
      expect(detail!.tenant.name).toBe('Marcus Lee');
      expect(detail!.tenant.propertyName).toBe('The Maplewoods');
      expect(detail!.tenant.unitLabel).toBe('Apt 312');
      expect(detail!.tenant.bedBath).toBe('2 Bed, 1 Bath');
      expect(detail!.tenant.currentRent).toBe('$2,400/mo');
      expect(detail!.tenant.badge).toBe('TENANT SINCE 2025');
      expect(detail!.messages).toHaveLength(2);
      expect(detail!.messages[0].id).toBe('inbound-1');
      expect(detail!.messages[1].id).toBe('outbound-1');
      expect(detail!.pendingDraft).toBeNull();
    });

    it('exposes pendingDraft when an outbound pending_review exists', async () => {
      const supabase = buildSupabaseStub(
        {
          conversations: [{ id: 'conv-1', tenant_id: 'tenant-1' }],
          messages: [
            {
              id: 'pending-1',
              conversation_id: 'conv-1',
              direction: 'outbound',
              body: 'Suggested reply body',
              draft_status: 'pending_review',
              created_at: '2026-05-01T10:00:00.000Z',
              sent_at: null,
            },
          ],
          tenants: [
            {
              id: 'tenant-1',
              full_name: 'Marcus Lee',
              phone_e164: '+1',
              created_at: '2024-01-01T00:00:00.000Z',
            },
          ],
          leases: [],
        },
        { userId: 'u1' },
      );
      const detail = await getConversation(supabase, 'conv-1');
      expect(detail!.pendingDraft).not.toBeNull();
      expect(detail!.pendingDraft!.id).toBe('pending-1');
      expect(detail!.pendingDraft!.body).toBe('Suggested reply body');
    });

    it('omits rejected drafts from the message list', async () => {
      const supabase = buildSupabaseStub(
        {
          conversations: [{ id: 'conv-1', tenant_id: 'tenant-1' }],
          messages: [
            {
              id: 'good',
              conversation_id: 'conv-1',
              direction: 'outbound',
              body: 'Visible',
              draft_status: 'sent_by_human',
              created_at: '2026-05-01T10:00:00.000Z',
              sent_at: '2026-05-01T10:00:00.000Z',
            },
            {
              id: 'bad',
              conversation_id: 'conv-1',
              direction: 'outbound',
              body: 'Hidden',
              draft_status: 'rejected',
              created_at: '2026-05-01T10:01:00.000Z',
              sent_at: null,
            },
          ],
          tenants: [
            {
              id: 'tenant-1',
              full_name: 'Marcus Lee',
              phone_e164: '+1',
              created_at: '2024-01-01T00:00:00.000Z',
            },
          ],
          leases: [],
        },
        { userId: 'u1' },
      );
      const detail = await getConversation(supabase, 'conv-1');
      expect(detail!.messages.map((m) => m.id)).toEqual(['good']);
    });
  });

  // -------------------------------------------------------------------------
  // getActivitySummary
  // -------------------------------------------------------------------------

  describe('getActivitySummary', () => {
    it('counts ai-sent today and pending review distinctly', async () => {
      const todayIso = new Date().toISOString();
      const yesterdayIso = new Date(
        Date.now() - 25 * 60 * 60 * 1000,
      ).toISOString();
      const supabase = buildSupabaseStub(
        {
          users: [{ id: 'u1', organization_id: 'org-1' }],
          messages: [
            {
              id: 'a',
              direction: 'outbound',
              draft_status: 'auto_sent',
              sent_at: todayIso,
            },
            {
              id: 'b',
              direction: 'outbound',
              draft_status: 'auto_sent',
              sent_at: todayIso,
            },
            {
              id: 'old',
              direction: 'outbound',
              draft_status: 'auto_sent',
              sent_at: yesterdayIso,
            },
            {
              id: 'pend',
              direction: 'outbound',
              draft_status: 'pending_review',
              sent_at: null,
              conversation_id: 'conv-1',
            },
          ],
        },
        { userId: 'u1' },
      );
      const result = await getActivitySummary(supabase);
      expect(result.aiSentToday).toBe(2);
      expect(result.pendingReviewCount).toBe(1);
      expect(result.organizationId).toBe('org-1');
    });

    it('returns zero counts when nothing matches', async () => {
      const supabase = buildSupabaseStub(
        {
          users: [{ id: 'u1', organization_id: 'org-1' }],
          messages: [],
        },
        { userId: 'u1' },
      );
      const result = await getActivitySummary(supabase);
      expect(result.aiSentToday).toBe(0);
      expect(result.pendingReviewCount).toBe(0);
    });
  });
});
