/**
 * Unit tests for the scheduling MCP. We mock:
 *   - the supabase admin client (chainable from(...) builder + per-row
 *     scripts so each test can assert insert/update payloads)
 *   - the inngest client's `send` (we never hit Inngest in unit tests)
 *
 * The handler boundary is what's under test — name resolution, condition
 * DSL construction, future-validation, list/cancel substring matching,
 * and the privacy invariant (no UUIDs in tool output).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSchedulingMcp,
  type CreateSchedulingMcpDeps,
} from '../scheduling';
import type { OrganizationContext } from '../../org-context';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PropertyContext } from '@/lib/agent/worker/types';
import type { Inngest } from 'inngest';

// ---------------------------------------------------------------------------
// MCP harness — mirrors the pattern in `mcps/spawn.test.ts` /
// `__tests__/semantic-recall.test.ts`. The SDK exposes either an
// `instance._registeredTools` map or a `tools` array depending on
// version; the helper reaches into both.
// ---------------------------------------------------------------------------

interface ToolDefShape {
  name?: string;
  handler: (
    args: Record<string, unknown>,
    extra: unknown,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}
interface McpServerShape {
  instance?: { _registeredTools?: Record<string, ToolDefShape> };
  tools?: ToolDefShape[];
}

function getHandler(server: unknown, name: string): ToolDefShape['handler'] {
  const s = server as McpServerShape;
  return (
    s.instance?._registeredTools?.[name]?.handler ??
    s.tools?.find((t) => t.name === name)?.handler ??
    (() => {
      throw new Error(`${name} handler not found`);
    })()
  );
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2026-05-06T10:00:00.000Z');

function makeOrgContext(): OrganizationContext {
  return {
    organization: { id: 'org-1', name: 'Galaxy Estates', assistantName: 'Odesa' },
    properties: [
      {
        id: 'prop-1',
        name: '17th Street Row',
        address: '17 17th St',
        timezone: 'America/New_York',
        autonomyLevel: 0.5,
        privacyMode: 'hosted',
      },
      {
        id: 'prop-2',
        name: 'Galaxy Lofts',
        address: '200 Loft Ave',
        timezone: 'America/New_York',
        autonomyLevel: 0.4,
        privacyMode: 'anonymous',
      },
    ],
    loadedAt: '2026-05-06T00:00:00Z',
  };
}

function makePropertyContext(propertyId: string): PropertyContext {
  return {
    property: {
      id: propertyId,
      organizationId: 'org-1',
      name: '17th Street Row',
      addressLine: null,
      timezone: 'America/New_York',
      rulesText: 'Be polite.',
      autonomyLevel: 0.5,
      privacyMode: 'hosted',
    },
    facts: [],
    recentTurns: [],
    vendors: [],
    tenants: [
      {
        id: 'tenant-jessica',
        fullName: 'Jessica Kim',
        unitLabel: 'Apt 2A',
        rentStatus: 'late',
        rentAmount: 1950,
      },
      {
        id: 'tenant-hannah',
        fullName: 'Hannah Ito',
        unitLabel: 'Apt 3B',
        rentStatus: 'paid',
        rentAmount: 2200,
      },
      {
        id: 'tenant-jessica-secondary',
        fullName: 'Jessica Park',
        unitLabel: 'Apt 4C',
        rentStatus: 'paid',
        rentAmount: null,
      },
    ],
    loadedAt: '2026-05-06T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Inngest mock
// ---------------------------------------------------------------------------

interface InngestMock {
  send: ReturnType<typeof vi.fn>;
}

function makeInngest(opts: { ids?: string[]; error?: Error } = {}): InngestMock {
  const send = vi.fn(async () => {
    if (opts.error) throw opts.error;
    return { ids: opts.ids ?? ['ev-1'] };
  });
  return { send };
}

// ---------------------------------------------------------------------------
// Admin mock
//
// Each test passes a "script" describing how the chainable builder should
// resolve for each table+operation. The mock supports the call shapes the
// MCP actually issues:
//
//   from('scheduled_actions').insert(row).select(cols).single()
//   from('scheduled_actions').update(patch).eq('id', x).eq('status', y)?
//   from('scheduled_actions').select(cols).eq(...).eq(...).order(...).limit(N)
//   from('action_proposals').select(...).eq(...).eq(...).eq(...).order(...).limit(...)
//
// The script lets each test pin a specific data/error response per table+op.
// ---------------------------------------------------------------------------

type SpyFn = ReturnType<typeof vi.fn>;
type Caller = (...args: unknown[]) => unknown;

interface AdminScript {
  scheduledInsert?: {
    data: { id: string; trigger_at: string; action_text: string; condition_text: string } | null;
    error: { message: string } | null;
  };
  scheduledUpdate?: {
    data: null;
    error: { message: string } | null;
  };
  scheduledList?: {
    data: Array<{
      id: string;
      property_id: string | null;
      trigger_at: string;
      action_text: string;
      action_type: string;
      condition_text: string;
      status: string;
    }> | null;
    error: { message: string } | null;
  };
  proposalsList?: {
    data: Array<{
      id: string;
      action_type: string;
      payload: unknown;
      reasoning: string | null;
      created_at: string;
      routing: { tenantId?: string } | null;
    }> | null;
    error: { message: string } | null;
  };
  /** Captures every insert payload for assertions. */
  insertSpy?: SpyFn;
  /** Captures every update patch+filter for assertions. */
  updateSpy?: SpyFn;
}

function makeAdmin(script: AdminScript = {}): SupabaseClient<Database> {
  const insertSpy = script.insertSpy ?? vi.fn();
  const updateSpy = script.updateSpy ?? vi.fn();

  function builderFor(table: string) {
    let mode: 'select' | 'insert' | 'update' = 'select';
    let pendingInsert: Record<string, unknown> | null = null;
    let pendingPatch: Record<string, unknown> | null = null;
    const filters: Record<string, unknown> = {};
    let isSingle = false;

    const finalize = async (): Promise<{ data: unknown; error: unknown }> => {
      if (table === 'scheduled_actions') {
        if (mode === 'insert') {
          (insertSpy as Caller)({ table, row: pendingInsert });
          const r = script.scheduledInsert ?? {
            data: {
              id: 'sched-1',
              trigger_at: (pendingInsert?.trigger_at as string) ?? '',
              action_text: (pendingInsert?.action_text as string) ?? '',
              condition_text: (pendingInsert?.condition_text as string) ?? '',
            },
            error: null,
          };
          return r;
        }
        if (mode === 'update') {
          (updateSpy as Caller)({
            table,
            patch: pendingPatch,
            filters: { ...filters },
          });
          return script.scheduledUpdate ?? { data: null, error: null };
        }
        return script.scheduledList ?? { data: [], error: null };
      }
      if (table === 'action_proposals') {
        return script.proposalsList ?? { data: [], error: null };
      }
      return { data: null, error: { message: `unknown table ${table}` } };
    };

    const builder = {
      select() {
        // select chains live in select-mode unless an insert/update preceded.
        return builder;
      },
      insert(row: Record<string, unknown>) {
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
        filters[col] = val;
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      single() {
        isSingle = true;
        return finalize().then((res) => {
          if (!isSingle) return res;
          return res;
        });
      },
      // Make the builder thenable so `await` works without single().
      then<R1, R2>(
        onFulfilled?: (value: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>,
        onRejected?: (reason: unknown) => R2 | PromiseLike<R2>,
      ) {
        return finalize().then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return {
    from: vi.fn((table: string) => builderFor(table)),
  } as unknown as SupabaseClient<Database>;
}

// ---------------------------------------------------------------------------
// Deps factory
// ---------------------------------------------------------------------------

function makeDeps(
  overrides: Partial<CreateSchedulingMcpDeps> = {},
): {
  deps: CreateSchedulingMcpDeps;
  inngest: InngestMock;
  insertSpy: ReturnType<typeof vi.fn>;
  updateSpy: ReturnType<typeof vi.fn>;
} {
  const inngest = makeInngest();
  const insertSpy = vi.fn();
  const updateSpy = vi.fn();
  const propertyContextCache = new Map<string, Promise<PropertyContext>>();
  propertyContextCache.set('prop-1', Promise.resolve(makePropertyContext('prop-1')));
  propertyContextCache.set('prop-2', Promise.resolve(makePropertyContext('prop-2')));

  const deps: CreateSchedulingMcpDeps = {
    admin: makeAdmin({ insertSpy, updateSpy }),
    organizationId: 'org-1',
    userId: 'user-1',
    orgContext: makeOrgContext(),
    propertyContextCache,
    commitActor: { kind: 'user', role: 'owner' },
    inngest: inngest as unknown as Pick<Inngest, 'send'>,
    now: () => FIXED_NOW,
    ...overrides,
  };
  return { deps, inngest, insertSpy, updateSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// schedule_action
// ---------------------------------------------------------------------------

describe('schedule_action', () => {
  const FUTURE_TRIGGER = '2026-05-09T13:00:00.000Z';

  it('keeps a VA in preparation mode instead of creating a schedule', async () => {
    const { deps, inngest, insertSpy } = makeDeps({
      commitActor: { kind: 'user', role: 'va' },
    });
    const handler = getHandler(createSchedulingMcp(deps), 'schedule_action');

    const res = await handler(
      {
        propertyName: '17th Street',
        triggerAt: FUTURE_TRIGGER,
        actionType: 'draft_sms_reply',
        actionPrompt: 'send a rent reminder to Jessica Kim',
        tenantName: 'Jessica Kim',
        conditionType: 'rent_unpaid',
      },
      {},
    );

    expect(res.content[0]!.text).toMatch(/owner approval is required/i);
    expect(res.content[0]!.text).toMatch(/prepare/i);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('should insert + send an inngest event for a rent_unpaid condition', async () => {
    const insertSpy = vi.fn();
    const updateSpy = vi.fn();
    const inngest = makeInngest({ ids: ['ev-42'] });
    const admin = makeAdmin({
      insertSpy,
      updateSpy,
      scheduledInsert: {
        data: {
          id: 'sched-99',
          trigger_at: FUTURE_TRIGGER,
          action_text: 'send eviction notice to Jessica Kim',
          condition_text: 'if Jessica Kim has unpaid rent at trigger_at',
        },
        error: null,
      },
    });
    const { deps } = makeDeps({
      admin,
      inngest: inngest as unknown as Pick<Inngest, 'send'>,
    });

    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'schedule_action');
    const res = await handler(
      {
        propertyName: '17th Street',
        triggerAt: FUTURE_TRIGGER,
        actionType: 'draft_sms_reply',
        actionPrompt: 'send eviction notice to Jessica Kim',
        tenantName: 'Jessica Kim',
        conditionType: 'rent_unpaid',
      },
      {},
    );

    // Inserted row carries the resolved tenantId in condition + payload.
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const insertedRow = insertSpy.mock.calls[0]![0].row as Record<
      string,
      unknown
    >;
    expect(insertedRow.organization_id).toBe('org-1');
    expect(insertedRow.property_id).toBe('prop-1');
    expect(insertedRow.user_id).toBe('user-1');
    expect(insertedRow.action_type).toBe('draft_sms_reply');
    expect(insertedRow.action_text).toContain('eviction');
    expect(insertedRow.status).toBe('scheduled');
    expect(insertedRow.condition).toEqual({
      type: 'rent_unpaid',
      tenantId: 'tenant-jessica',
      asOf: 'trigger_at',
    });
    const payload = insertedRow.action_payload as { tenantId: string };
    expect(payload.tenantId).toBe('tenant-jessica');

    // Inngest send fired with scheduleId and the future timestamp.
    expect(inngest.send).toHaveBeenCalledTimes(1);
    const sendArg = inngest.send.mock.calls[0]![0];
    expect(sendArg.name).toBe('odesa/scheduled-action.fire');
    expect(sendArg.data).toEqual({ scheduleId: 'sched-99' });
    expect(sendArg.ts).toBe(new Date(FUTURE_TRIGGER).getTime());

    // inngest_event_id stamped on the row.
    expect(updateSpy).toHaveBeenCalled();
    const update = updateSpy.mock.calls[0]![0];
    expect(update.patch).toEqual({ inngest_event_id: 'ev-42' });

    // Operator-facing text never leaks the UUID.
    const txt = res.content[0]!.text;
    expect(txt).toContain('eviction');
    expect(txt).toContain('Cancel by saying');
    expect(txt).not.toContain('sched-99');
    expect(txt).not.toContain('tenant-jessica');
  });

  it('should accept conditionType=always with no tenantName (unconditional)', async () => {
    const insertSpy = vi.fn();
    const inngest = makeInngest();
    const admin = makeAdmin({
      insertSpy,
      scheduledInsert: {
        data: {
          id: 'sched-1',
          trigger_at: FUTURE_TRIGGER,
          action_text: 'send a check-in to all tenants',
          condition_text: 'unconditional',
        },
        error: null,
      },
    });
    const { deps } = makeDeps({
      admin,
      inngest: inngest as unknown as Pick<Inngest, 'send'>,
    });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'schedule_action');

    const res = await handler(
      {
        propertyName: '17th',
        triggerAt: FUTURE_TRIGGER,
        actionType: 'polish_briefing',
        actionPrompt: 'send a check-in to all tenants',
        conditionType: 'always',
      },
      {},
    );

    const insertedRow = insertSpy.mock.calls[0]![0].row as Record<string, unknown>;
    expect(insertedRow.condition).toEqual({ type: 'always' });
    expect(insertedRow.condition_text).toBe('unconditional');
    expect(res.content[0]!.text).toContain('Scheduled');
  });

  it('should resolve tenant_no_response against the most recent matching reminder', async () => {
    const insertSpy = vi.fn();
    const inngest = makeInngest();
    const admin = makeAdmin({
      insertSpy,
      scheduledInsert: {
        data: {
          id: 'sched-2',
          trigger_at: FUTURE_TRIGGER,
          action_text: 'follow up if no reply',
          condition_text:
            'if Jessica Kim has not replied since the reminder "rent reminder"',
        },
        error: null,
      },
      proposalsList: {
        data: [
          {
            id: 'prop-msg-newer',
            action_type: 'draft_sms_reply',
            payload: { body: 'rent reminder for Jessica' },
            reasoning: 'two days late',
            created_at: '2026-05-05T10:00:00Z',
            routing: { tenantId: 'tenant-jessica' },
          },
          {
            id: 'prop-msg-other',
            action_type: 'draft_sms_reply',
            payload: { body: 'package pickup' },
            reasoning: 'package note',
            created_at: '2026-05-04T10:00:00Z',
            routing: { tenantId: 'tenant-hannah' },
          },
        ],
        error: null,
      },
    });
    const { deps } = makeDeps({
      admin,
      inngest: inngest as unknown as Pick<Inngest, 'send'>,
    });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'schedule_action');

    const res = await handler(
      {
        propertyName: '17th',
        triggerAt: FUTURE_TRIGGER,
        actionType: 'draft_sms_reply',
        actionPrompt: 'follow up if no reply',
        tenantName: 'Jessica Kim',
        conditionType: 'tenant_no_response',
        sinceReminderDescription: 'rent reminder',
      },
      {},
    );

    const inserted = insertSpy.mock.calls[0]![0].row as Record<string, unknown>;
    expect(inserted.condition).toEqual({
      type: 'tenant_no_response',
      tenantId: 'tenant-jessica',
      sinceProposalId: 'prop-msg-newer',
    });
    expect(res.content[0]!.text).toContain('Scheduled');
    // Privacy: proposalId stays out of model output.
    expect(res.content[0]!.text).not.toContain('prop-msg-newer');
  });

  it('should ask for clarification when sinceReminderDescription matches none', async () => {
    const inngest = makeInngest();
    const admin = makeAdmin({
      proposalsList: {
        data: [
          {
            id: 'prop-msg-1',
            action_type: 'draft_sms_reply',
            payload: { body: 'package pickup notice' },
            reasoning: 'package',
            created_at: '2026-05-05T10:00:00Z',
            routing: { tenantId: 'tenant-jessica' },
          },
        ],
        error: null,
      },
    });
    const { deps } = makeDeps({
      admin,
      inngest: inngest as unknown as Pick<Inngest, 'send'>,
    });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'schedule_action');

    const res = await handler(
      {
        propertyName: '17th',
        triggerAt: FUTURE_TRIGGER,
        actionType: 'draft_sms_reply',
        actionPrompt: 'follow up',
        tenantName: 'Jessica Kim',
        conditionType: 'tenant_no_response',
        sinceReminderDescription: 'rent late warning',
      },
      {},
    );
    expect(res.content[0]!.text).toMatch(/No recent reminder/i);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('should reject ambiguous propertyName', async () => {
    const inngest = makeInngest();
    const { deps } = makeDeps({
      inngest: inngest as unknown as Pick<Inngest, 'send'>,
    });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'schedule_action');

    // Empty needle would match all; use a substring that hits both names.
    // 'a' hits "17th Street Row" and "Galaxy Lofts".
    const res = await handler(
      {
        propertyName: 't',
        triggerAt: FUTURE_TRIGGER,
        actionType: 'draft_sms_reply',
        actionPrompt: 'send a note',
        tenantName: 'Jessica Kim',
        conditionType: 'rent_unpaid',
      },
      {},
    );
    expect(res.content[0]!.text).toMatch(/Multiple properties match/i);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('should reject unknown propertyName', async () => {
    const inngest = makeInngest();
    const { deps } = makeDeps({
      inngest: inngest as unknown as Pick<Inngest, 'send'>,
    });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'schedule_action');

    const res = await handler(
      {
        propertyName: 'nowhere',
        triggerAt: FUTURE_TRIGGER,
        actionType: 'draft_sms_reply',
        actionPrompt: 'x',
        tenantName: 'Jessica Kim',
        conditionType: 'rent_unpaid',
      },
      {},
    );
    expect(res.content[0]!.text).toMatch(/No property matches/i);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('should reject ambiguous tenantName for tenant-scoped conditions', async () => {
    const inngest = makeInngest();
    const { deps } = makeDeps({
      inngest: inngest as unknown as Pick<Inngest, 'send'>,
    });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'schedule_action');

    const res = await handler(
      {
        propertyName: '17th',
        triggerAt: FUTURE_TRIGGER,
        actionType: 'draft_sms_reply',
        actionPrompt: 'reminder',
        // 'Jessica' matches both Jessica Kim and Jessica Park
        tenantName: 'Jessica',
        conditionType: 'rent_unpaid',
      },
      {},
    );
    expect(res.content[0]!.text).toMatch(/Multiple tenants match/i);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('should reject triggerAt in the past', async () => {
    const inngest = makeInngest();
    const { deps } = makeDeps({
      inngest: inngest as unknown as Pick<Inngest, 'send'>,
    });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'schedule_action');

    const res = await handler(
      {
        propertyName: '17th',
        triggerAt: '2026-04-01T10:00:00Z',
        actionType: 'draft_sms_reply',
        actionPrompt: 'late note',
        tenantName: 'Jessica Kim',
        conditionType: 'rent_unpaid',
      },
      {},
    );
    expect(res.content[0]!.text).toMatch(/in the past/i);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('should reject malformed triggerAt', async () => {
    const inngest = makeInngest();
    const { deps } = makeDeps({
      inngest: inngest as unknown as Pick<Inngest, 'send'>,
    });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'schedule_action');

    const res = await handler(
      {
        propertyName: '17th',
        triggerAt: 'next friday plz',
        actionType: 'draft_sms_reply',
        actionPrompt: 'late note',
        tenantName: 'Jessica Kim',
        conditionType: 'rent_unpaid',
      },
      {},
    );
    expect(res.content[0]!.text).toMatch(/not a valid ISO 8601/i);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('should mark the row expired and surface failure when inngest.send throws', async () => {
    const inngest = makeInngest({ error: new Error('inngest down') });
    const insertSpy = vi.fn();
    const updateSpy = vi.fn();
    const admin = makeAdmin({
      insertSpy,
      updateSpy,
      scheduledInsert: {
        data: {
          id: 'sched-fail',
          trigger_at: FUTURE_TRIGGER,
          action_text: 'late note',
          condition_text: 'unconditional',
        },
        error: null,
      },
    });
    const { deps } = makeDeps({
      admin,
      inngest: inngest as unknown as Pick<Inngest, 'send'>,
    });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'schedule_action');

    const res = await handler(
      {
        propertyName: '17th',
        triggerAt: FUTURE_TRIGGER,
        actionType: 'polish_briefing',
        actionPrompt: 'send a check-in',
        conditionType: 'always',
      },
      {},
    );
    expect(res.content[0]!.text).toMatch(/inngest.send/i);
    // The compensating update marks the row expired with the failure reason.
    const expiredUpdate = updateSpy.mock.calls.find(
      (c) => (c[0] as { patch: Record<string, unknown> }).patch.status === 'expired',
    );
    expect(expiredUpdate).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// list_scheduled
// ---------------------------------------------------------------------------

describe('list_scheduled', () => {
  it('should return empty-state text when there are no rows', async () => {
    const admin = makeAdmin({ scheduledList: { data: [], error: null } });
    const { deps } = makeDeps({ admin });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'list_scheduled');

    const res = await handler({}, {});
    expect(res.content[0]!.text).toMatch(/No scheduled actions/i);
  });

  it('should number the rows and include property name + trigger time', async () => {
    const admin = makeAdmin({
      scheduledList: {
        data: [
          {
            id: 'sched-1',
            property_id: 'prop-1',
            trigger_at: '2026-05-09T13:00:00Z',
            action_text: 'eviction notice for Jessica Kim',
            action_type: 'draft_sms_reply',
            condition_text: 'if Jessica Kim has unpaid rent at trigger_at',
            status: 'scheduled',
          },
          {
            id: 'sched-2',
            property_id: 'prop-1',
            trigger_at: '2026-05-07T14:00:00Z',
            action_text: 'payment plan reminder for Hannah Ito',
            action_type: 'draft_sms_reply',
            condition_text: 'unconditional',
            status: 'scheduled',
          },
        ],
        error: null,
      },
    });
    const { deps } = makeDeps({ admin });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'list_scheduled');

    const res = await handler({}, {});
    const txt = res.content[0]!.text;
    expect(txt).toContain('1.');
    expect(txt).toContain('2.');
    expect(txt).toContain('17th Street Row');
    expect(txt).toContain('Jessica Kim');
    expect(txt).toContain('unconditional');
    // Privacy: row UUIDs never appear.
    expect(txt).not.toContain('sched-1');
    expect(txt).not.toContain('sched-2');
  });

  it('should pass status filter through to the DB', async () => {
    const fromSpy = vi.fn();
    const admin = makeAdmin({
      scheduledList: { data: [], error: null },
    });
    // Wrap from() to capture the filter chain. Cast to a permissive
    // shape — `from` is typed against the generated Supabase Tables
    // union, but the unit-test mock doesn't conform to that.
    const adminLike = admin as unknown as {
      from: (table: string) => Record<string, unknown>;
    };
    const originalFrom = adminLike.from;
    adminLike.from = (table: string) => {
      const builder = originalFrom.call(adminLike, table) as Record<
        string,
        unknown
      >;
      const eq = builder.eq as (col: string, val: unknown) => unknown;
      builder.eq = function (col: string, val: unknown) {
        (fromSpy as Caller)(table, col, val);
        return eq.call(this, col, val);
      };
      return builder;
    };

    const { deps } = makeDeps({ admin });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'list_scheduled');

    await handler({ status: 'cancelled' }, {});
    // The handler must have called .eq('status', 'cancelled').
    expect(fromSpy).toHaveBeenCalledWith(
      'scheduled_actions',
      'status',
      'cancelled',
    );
  });

  it('should reject unknown propertyName', async () => {
    const { deps } = makeDeps();
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'list_scheduled');

    const res = await handler({ propertyName: 'unknown' }, {});
    expect(res.content[0]!.text).toMatch(/No property matches/i);
  });
});

// ---------------------------------------------------------------------------
// cancel_scheduled
// ---------------------------------------------------------------------------

describe('cancel_scheduled', () => {
  it('keeps a VA read-only instead of cancelling an owner schedule', async () => {
    const { deps, updateSpy } = makeDeps({
      commitActor: { kind: 'user', role: 'va' },
    });
    const handler = getHandler(createSchedulingMcp(deps), 'cancel_scheduled');

    const res = await handler(
      { scheduleDescription: 'rent reminder' },
      {},
    );

    expect(res.content[0]!.text).toMatch(/owner approval is required/i);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  const ROW_JESSICA = {
    id: 'sched-jessica',
    property_id: 'prop-1',
    trigger_at: '2026-05-09T13:00:00Z',
    action_text: 'eviction notice for Jessica Kim',
    action_type: 'draft_sms_reply',
    condition_text: 'if Jessica Kim has unpaid rent at trigger_at',
    status: 'scheduled',
  };
  const ROW_HANNAH = {
    id: 'sched-hannah',
    property_id: 'prop-1',
    trigger_at: '2026-05-07T14:00:00Z',
    action_text: 'payment plan reminder for Hannah Ito',
    action_type: 'draft_sms_reply',
    condition_text: 'unconditional',
    status: 'scheduled',
  };

  it('should cancel a unique substring match', async () => {
    const updateSpy = vi.fn();
    const admin = makeAdmin({
      scheduledList: {
        data: [ROW_JESSICA, ROW_HANNAH],
        error: null,
      },
      updateSpy,
    });
    const { deps } = makeDeps({ admin });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'cancel_scheduled');

    const res = await handler(
      { scheduleDescription: 'eviction', reason: 'tenant paid' },
      {},
    );
    expect(res.content[0]!.text).toMatch(/Cancelled/i);
    expect(updateSpy).toHaveBeenCalled();
    const upd = updateSpy.mock.calls[0]![0];
    expect(upd.patch.status).toBe('cancelled');
    expect(upd.patch.cancelled_by).toBe('user-1');
    expect(upd.patch.cancellation_reason).toBe('tenant paid');
    expect(upd.filters.id).toBe('sched-jessica');
    // status='scheduled' guards stale-row writes.
    expect(upd.filters.status).toBe('scheduled');
  });

  it('should ask for clarification when multiple rows match', async () => {
    const updateSpy = vi.fn();
    const admin = makeAdmin({
      scheduledList: {
        data: [ROW_JESSICA, ROW_HANNAH],
        error: null,
      },
      updateSpy,
    });
    const { deps } = makeDeps({ admin });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'cancel_scheduled');

    // 'reminder' matches the Hannah row's action_text; 'for' matches both
    // (action_text contains "for Jessica"/"for Hannah").
    const res = await handler({ scheduleDescription: 'for' }, {});
    expect(res.content[0]!.text).toMatch(/which one/i);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('should return no-match text when nothing matches', async () => {
    const admin = makeAdmin({
      scheduledList: { data: [ROW_JESSICA], error: null },
    });
    const { deps } = makeDeps({ admin });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'cancel_scheduled');

    const res = await handler({ scheduleDescription: 'unrelated' }, {});
    expect(res.content[0]!.text).toMatch(/No scheduled action matching/i);
  });

  it('should surface DB errors from the update path', async () => {
    const admin = makeAdmin({
      scheduledList: { data: [ROW_JESSICA], error: null },
      scheduledUpdate: { data: null, error: { message: 'rls denied' } },
    });
    const { deps } = makeDeps({ admin });
    const server = createSchedulingMcp(deps);
    const handler = getHandler(server, 'cancel_scheduled');

    const res = await handler({ scheduleDescription: 'eviction' }, {});
    expect(res.content[0]!.text).toMatch(/cancel_scheduled failed/i);
    expect(res.content[0]!.text).toMatch(/rls denied/i);
  });
});
