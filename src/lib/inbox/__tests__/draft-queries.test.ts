/**
 * Unit tests for `src/lib/inbox/draft-queries.ts`.
 *
 * The functions under test are wrappers around the supabase-js
 * builder chain. We mock the client via a factory that returns
 * canned responses for each `from(table)` call. RLS is implicit —
 * we don't test it here; we just verify our code passes the
 * auth-aware client through correctly and shapes the result.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  PROPOSAL_TAG_MAP,
  getDraftDetail,
  listInboxBuckets,
} from '@/lib/inbox/draft-queries';
import type { Database } from '@/types/database';

type AnySupabase = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Stub builder
// ---------------------------------------------------------------------------

interface Tables {
  action_proposals?: ReadonlyArray<Record<string, unknown>>;
  messages?: ReadonlyArray<Record<string, unknown>>;
  conversations?: ReadonlyArray<Record<string, unknown>>;
  tenants?: ReadonlyArray<Record<string, unknown>>;
  leases?: ReadonlyArray<Record<string, unknown>>;
  units?: ReadonlyArray<Record<string, unknown>>;
  properties?: ReadonlyArray<Record<string, unknown>>;
  users?: ReadonlyArray<Record<string, unknown>>;
}

interface AuthState {
  userId?: string;
}

/**
 * Creates a chainable stub that mimics the subset of supabase-js the
 * draft-queries module uses. Rather than wire up the full builder
 * grammar, we collect predicates per call and apply them when the
 * promise resolves on `await`.
 */
function buildSupabaseStub(
  tables: Tables,
  auth: AuthState = {},
  errors: Partial<Record<keyof Tables, { message: string }>> = {},
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
    from: (tableName: keyof Tables) =>
      buildQuery(tableName, tables, errors),
  };
  return stub as unknown as AnySupabase;
}

interface Predicate {
  kind: 'eq' | 'in' | 'gte';
  column: string;
  value: unknown;
}

function buildQuery(
  tableName: keyof Tables,
  tables: Tables,
  errors: Partial<Record<keyof Tables, { message: string }>>,
): unknown {
  const predicates: Predicate[] = [];
  let limitN: number | null = null;

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
      }
    }
    if (limitN !== null) result = result.slice(0, limitN);
    return result;
  }

  function makeThenable<T>(resolveFn: () => T) {
    return {
      then(
        onFulfilled?: (
          value: { data: T | null; error: { message: string } | null },
        ) => unknown,
      ): Promise<unknown> {
        return Promise.resolve({
          data: errors[tableName] ? null : resolveFn(),
          error: errors[tableName] ?? null,
        }).then(
          onFulfilled,
        );
      },
    };
  }

  function makeChain(): unknown {
    const chain = {
      select(_cols?: string) {
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
      order(_col: string, _opts?: unknown) {
        return chain;
      },
      limit(n: number) {
        limitN = n;
        return chain;
      },
      maybeSingle() {
        return Promise.resolve({
          data: errors[tableName]
            ? null
            : applyPredicates(tables[tableName] ?? [])[0] ?? null,
          error: errors[tableName] ?? null,
        });
      },
      single() {
        return Promise.resolve({
          data: errors[tableName]
            ? null
            : applyPredicates(tables[tableName] ?? [])[0] ?? null,
          error: errors[tableName] ?? null,
        });
      },
      ...makeThenable(() => applyPredicates(tables[tableName] ?? [])),
    };
    return chain;
  }

  return makeChain();
}

// ---------------------------------------------------------------------------
// listInboxBuckets
// ---------------------------------------------------------------------------

describe('draft-queries', () => {
  describe('listInboxBuckets', () => {
    it('should return empty buckets when no rows exist', async () => {
      const supabase = buildSupabaseStub(
        {
          users: [{ id: 'u1', organization_id: 'org-1' }],
          action_proposals: [],
          messages: [],
          conversations: [],
        },
        { userId: 'u1' },
      );
      const result = await listInboxBuckets(supabase);
      expect(result.needsJudgment).toEqual([]);
      expect(result.readyToSend).toEqual([]);
      expect(result.sentToday.count).toBe(0);
      expect(result.summary.organizationId).toBe('org-1');
      expect(result.summary.needsCount).toBe(0);
      expect(result.summary.readyCount).toBe(0);
      expect(result.summary.sentTodayCount).toBe(0);
    });

    it('should populate needs-judgment from proposed action_proposals', async () => {
      const supabase = buildSupabaseStub(
        {
          users: [{ id: 'u1', organization_id: 'org-1' }],
          action_proposals: [
            {
              id: 'prop-1',
              action_type: 'draft_sms_reply',
              payload: { body: 'Hello tenant' },
              reasoning: 'Tenant asked about rent timing',
              created_at: new Date(Date.now() - 60_000).toISOString(),
              routing: { tenantId: 'tenant-1' },
              property_id: 'prop-prop-1',
              status: 'proposed',
              gate_decision: 'review',
            },
          ],
          tenants: [
            { id: 'tenant-1', full_name: 'Marcus Lee', phone_e164: '+1' },
          ],
          leases: [],
          messages: [],
          conversations: [],
        },
        { userId: 'u1' },
      );
      const result = await listInboxBuckets(supabase);
      expect(result.needsJudgment).toHaveLength(1);
      expect(result.needsJudgment[0].id).toBe('prop-1');
      expect(result.needsJudgment[0].tag).toBe(
        PROPOSAL_TAG_MAP.draft_sms_reply,
      );
      expect(result.needsJudgment[0].title).toContain('Marcus Lee');
      expect(result.needsJudgment[0].preview).toBe('Hello tenant');
    });

    it('should populate ready-to-send from pending_review messages', async () => {
      const supabase = buildSupabaseStub(
        {
          users: [{ id: 'u1', organization_id: 'org-1' }],
          messages: [
            {
              id: 'msg-1',
              conversation_id: 'conv-1',
              body: 'Confirming your inspection',
              created_at: new Date(Date.now() - 120_000).toISOString(),
              draft_status: 'pending_review',
              direction: 'outbound',
            },
          ],
          conversations: [{ id: 'conv-1', tenant_id: 'tenant-1' }],
          tenants: [
            { id: 'tenant-1', full_name: 'Elena Rodriguez', phone_e164: '+1' },
          ],
          leases: [
            {
              tenant_id: 'tenant-1',
              unit_id: 'unit-1',
              status: 'active',
            },
          ],
          units: [{ id: 'unit-1', label: 'Apt 218' }],
          action_proposals: [],
        },
        { userId: 'u1' },
      );
      const result = await listInboxBuckets(supabase);
      expect(result.readyToSend).toHaveLength(1);
      expect(result.readyToSend[0]).toMatchObject({
        id: 'msg-1',
        tenant: 'Elena Rodriguez',
        unitLine: 'Apt 218',
        tag: 'AMBIGUOUS',
      });
      expect(result.readyToSend[0].preview).toContain('inspection');
    });

    it('hides voice evidence when a canonical Owner Queue proposal exists', async () => {
      const supabase = buildSupabaseStub(
        {
          users: [{ id: 'u1', organization_id: 'org-1' }],
          messages: [
            {
              id: 'voice-message',
              conversation_id: 'conv-1',
              body: 'Call follow-up evidence',
              created_at: new Date().toISOString(),
              draft_status: 'pending_review',
              direction: 'outbound',
              retell_artifact_key: 'retell:call-1:message',
            },
          ],
          action_proposals: [
            {
              id: 'voice-proposal',
              status: 'committed',
              gate_decision: 'review',
              retell_artifact_key: 'retell:call-1:proposal',
            },
          ],
          conversations: [{ id: 'conv-1', tenant_id: 'tenant-1' }],
          tenants: [{ id: 'tenant-1', full_name: 'Dana Reed' }],
        },
        { userId: 'u1' },
      );

      const result = await listInboxBuckets(supabase);

      expect(result.readyToSend).toEqual([]);
    });

    it('fails closed for keyed voice evidence when proposal linkage is unavailable', async () => {
      const supabase = buildSupabaseStub(
        {
          users: [{ id: 'u1', organization_id: 'org-1' }],
          messages: [
            {
              id: 'voice-message',
              conversation_id: 'conv-1',
              body: 'Call follow-up evidence',
              created_at: new Date().toISOString(),
              draft_status: 'pending_review',
              direction: 'outbound',
              retell_artifact_key: 'retell:call-1:message',
            },
          ],
          action_proposals: [],
          conversations: [{ id: 'conv-1', tenant_id: 'tenant-1' }],
          tenants: [{ id: 'tenant-1', full_name: 'Dana Reed' }],
        },
        { userId: 'u1' },
        { action_proposals: { message: 'lookup unavailable' } },
      );

      const result = await listInboxBuckets(supabase);

      expect(result.readyToSend).toEqual([]);
    });

    it('should count sent message records once even when a proposal also committed today', async () => {
      const todayIso = new Date().toISOString();
      const yesterdayIso = new Date(
        Date.now() - 25 * 60 * 60 * 1000,
      ).toISOString();
      const supabase = buildSupabaseStub(
        {
          users: [{ id: 'u1', organization_id: 'org-1' }],
          messages: [
            {
              id: 'msg-today',
              conversation_id: 'conv-1',
              sent_at: todayIso,
              draft_status: 'sent_by_human',
            },
            {
              id: 'msg-yest',
              conversation_id: 'conv-2',
              sent_at: yesterdayIso,
              draft_status: 'sent_by_human',
            },
          ],
          action_proposals: [
            {
              id: 'prop-today',
              committed_at: todayIso,
              status: 'committed',
              routing: { tenantId: 'tenant-2' },
            },
          ],
          conversations: [
            { id: 'conv-1', tenant_id: 'tenant-1' },
            { id: 'conv-2', tenant_id: 'tenant-3' },
          ],
          tenants: [
            { id: 'tenant-1', full_name: 'Marcus Lee', phone_e164: '+1' },
            { id: 'tenant-2', full_name: 'James Park', phone_e164: '+2' },
          ],
          leases: [],
        },
        { userId: 'u1' },
      );
      const result = await listInboxBuckets(supabase);
      // Only today's items; yesterday is filtered by the gte() predicate.
      expect(result.sentToday.count).toBe(1);
      expect(result.sentToday.preview).toEqual(['Marcus Lee']);
      expect(result.sentToday.remainder).toBe(0);
    });

    it('should resolve organizationId from users table via auth uid', async () => {
      const supabase = buildSupabaseStub(
        {
          users: [
            { id: 'u1', organization_id: 'org-A' },
            { id: 'u2', organization_id: 'org-B' },
          ],
          messages: [],
          action_proposals: [],
          conversations: [],
        },
        { userId: 'u2' },
      );
      const result = await listInboxBuckets(supabase);
      expect(result.summary.organizationId).toBe('org-B');
    });

    it('should return blank organizationId when unauthenticated', async () => {
      const supabase = buildSupabaseStub(
        {
          users: [],
          messages: [],
          action_proposals: [],
          conversations: [],
        },
        { userId: undefined },
      );
      const result = await listInboxBuckets(supabase);
      expect(result.summary.organizationId).toBe('');
    });
  });

  describe('getDraftDetail', () => {
    it('should return null when message id is missing', async () => {
      const supabase = buildSupabaseStub(
        {
          messages: [],
        },
        { userId: 'u1' },
      );
      const result = await getDraftDetail(supabase, 'message', 'missing');
      expect(result).toBeNull();
    });

    it('should populate detail for a message draft', async () => {
      const supabase = buildSupabaseStub(
        {
          messages: [
            {
              id: 'msg-1',
              conversation_id: 'conv-1',
              body: 'Renewal offer',
              created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
              organization_id: 'org-1',
            },
          ],
          conversations: [{ id: 'conv-1', tenant_id: 'tenant-1' }],
          tenants: [
            {
              id: 'tenant-1',
              full_name: 'Marcus Lee',
              phone_e164: '+15550192834',
              created_at: '2022-01-01T00:00:00.000Z',
            },
          ],
          leases: [
            {
              id: 'lease-1',
              tenant_id: 'tenant-1',
              unit_id: 'unit-1',
              rent_amount: 3000,
              status: 'active',
            },
          ],
          units: [
            {
              id: 'unit-1',
              label: 'Apt 312',
              bedrooms: 1,
              bathrooms: 1,
              property_id: 'prop-1',
            },
          ],
          properties: [{ id: 'prop-1', name: 'The Maplewoods' }],
        },
        { userId: 'u1' },
      );
      const detail = await getDraftDetail(supabase, 'message', 'msg-1');
      expect(detail).not.toBeNull();
      expect(detail!.smsBody).toBe('Renewal offer');
      expect(detail!.tenant.name).toBe('Marcus Lee');
      expect(detail!.tenant.property).toBe('The Maplewoods');
      expect(detail!.tenant.unit).toBe('Apt 312');
      expect(detail!.tenant.bedBath).toBe('1 Bed, 1 Bath');
      expect(detail!.tenant.currentRent).toBe('$3,000/mo');
      expect(detail!.tenant.badge).toBe('TENANT SINCE 2022');
      expect(detail!.smsPhone).toBe('+15550192834');
      expect(detail!.touchpoints.days).toBe(14);
    });

    it('should populate detail for a proposal draft', async () => {
      const supabase = buildSupabaseStub(
        {
          action_proposals: [
            {
              id: 'prop-1',
              action_type: 'draft_sms_reply',
              payload: {
                body: 'Hi, about your rent',
                recipient_phone: '+15550009999',
              },
              reasoning: 'Routine rent reminder',
              created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
              routing: { tenantId: 'tenant-2', conversationId: 'conv-2' },
              edit_diff: null,
            },
          ],
          tenants: [
            {
              id: 'tenant-2',
              full_name: 'James Park',
              phone_e164: '+15550009999',
              created_at: '2023-06-01T00:00:00.000Z',
            },
          ],
          leases: [],
          messages: [],
        },
        { userId: 'u1' },
      );
      const detail = await getDraftDetail(supabase, 'proposal', 'prop-1');
      expect(detail).not.toBeNull();
      expect(detail!.draftType).toBe('Draft Sms Reply');
      expect(detail!.smsBody).toBe('Hi, about your rent');
      expect(detail!.smsPhone).toBe('+15550009999');
      expect(detail!.reasoning).toBe('Routine rent reminder');
      expect(detail!.tenant.name).toBe('James Park');
      expect(detail!.tenant.badge).toBe('TENANT SINCE 2023');
    });

    it('should prefer edit_diff body_after over payload body for proposals', async () => {
      const supabase = buildSupabaseStub(
        {
          action_proposals: [
            {
              id: 'prop-edited',
              action_type: 'draft_sms_reply',
              payload: { body: 'Original', recipient_phone: '+1' },
              reasoning: '',
              created_at: new Date().toISOString(),
              routing: { tenantId: 'tenant-2', conversationId: 'conv-2' },
              edit_diff: {
                body_before: 'Original',
                body_after: 'Edited body',
                edited_at: new Date().toISOString(),
              },
            },
          ],
          tenants: [
            {
              id: 'tenant-2',
              full_name: 'James Park',
              phone_e164: '+1',
              created_at: '2023-06-01T00:00:00.000Z',
            },
          ],
          leases: [],
          messages: [],
        },
        { userId: 'u1' },
      );
      const detail = await getDraftDetail(supabase, 'proposal', 'prop-edited');
      expect(detail!.smsBody).toBe('Edited body');
    });
  });
});
