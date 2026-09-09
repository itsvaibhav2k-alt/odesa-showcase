/**
 * Unit tests for src/lib/mcp/auth.ts.
 *
 * Mocks the Supabase admin client with a chainable recorder so we can
 * assert both the query shape (eq('key_hash', sha256(token)) +
 * is('revoked_at', null)) AND the resolved scope returned to callers.
 *
 * Mirrors the mock-builder pattern from
 * src/lib/agent/operator/__tests__/persist.test.ts.
 */

import * as crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

vi.mock('@/lib/authz/context', () => ({
  resolveActiveAccessContextForUser: vi.fn(),
}));

import { resolveActiveAccessContextForUser } from '@/lib/authz/context';

import {
  extractBearerToken,
  lookupApiKey,
  recordKeyUsage,
  requireMcpAuth,
  type AdminClient,
} from '../auth';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG = '00000000-0000-0000-0000-0000000000aa';
const USER = '00000000-0000-0000-0000-0000000000bb';
const KEY_ID = '00000000-0000-0000-0000-0000000000cc';
const TOKEN = 'test-mcp-bearer-token-fixture';
const resolveAccess = vi.mocked(resolveActiveAccessContextForUser);
const ACTIVE_CONTEXT = {
  userId: USER,
  membershipId: 'membership-1',
  organizationId: ORG,
  role: 'owner' as const,
  capabilities: new Set(['view_properties', 'view_assistant'] as const),
  propertyScope: 'all' as const,
};

beforeEach(() => {
  resolveAccess.mockReset();
  resolveAccess.mockResolvedValue({ ok: true, context: ACTIVE_CONTEXT });
});

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// ---------------------------------------------------------------------------
// Mock builder for the supabase admin client
// ---------------------------------------------------------------------------

interface RecordedCall {
  table: string;
  op: 'select' | 'update';
  selects: string[];
  updates: unknown[];
  eqs: Array<[string, unknown]>;
  iss: Array<[string, unknown]>;
  nots: Array<[string, string, unknown]>;
  terminal: 'maybeSingle' | 'await';
}

type Result<T> = { data: T | null; error: null | { message: string } };

interface MockOptions {
  handler: (call: RecordedCall) => Result<unknown>;
}

function makeMock(opts: MockOptions): {
  db: AdminClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];

  function newCall(table: string, op: RecordedCall['op']): RecordedCall {
    return {
      table,
      op,
      selects: [],
      updates: [],
      eqs: [],
      iss: [],
      nots: [],
      terminal: 'await',
    };
  }

  function makeBuilder(call: RecordedCall): Record<string, unknown> {
    const builder: Record<string, unknown> = {
      select(cols?: string) {
        call.selects.push(cols ?? '*');
        return builder;
      },
      eq(col: string, val: unknown) {
        call.eqs.push([col, val]);
        return builder;
      },
      is(col: string, val: unknown) {
        call.iss.push([col, val]);
        return builder;
      },
      not(col: string, op: string, val: unknown) {
        call.nots.push([col, op, val]);
        return builder;
      },
      maybeSingle: async () => {
        call.terminal = 'maybeSingle';
        return opts.handler(call);
      },
      then: <T1, T2 = never>(
        onfulfilled?: ((v: Result<unknown>) => T1 | PromiseLike<T1>) | null,
        onrejected?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
      ): PromiseLike<T1 | T2> => {
        call.terminal = 'await';
        try {
          const r = opts.handler(call);
          return Promise.resolve(
            onfulfilled ? onfulfilled(r) : (r as never),
          );
        } catch (err) {
          return onrejected
            ? Promise.resolve(onrejected(err))
            : Promise.reject(err);
        }
      },
    };
    return builder;
  }

  const from = vi.fn((table: string) => ({
    select(cols?: string) {
      const call = newCall(table, 'select');
      calls.push(call);
      const b = makeBuilder(call);
      (b.select as (c?: string) => unknown)(cols);
      return b;
    },
    update(row: unknown) {
      const call = newCall(table, 'update');
      call.updates.push(row);
      calls.push(call);
      return makeBuilder(call);
    },
  }));

  const db = { from } as unknown as SupabaseClient<Database>;
  return { db, calls };
}

// ===========================================================================
// extractBearerToken
// ===========================================================================

describe('extractBearerToken', () => {
  it('should return the token when Authorization is a valid Bearer header', () => {
    const headers = new Headers({ authorization: `Bearer ${TOKEN}` });
    expect(extractBearerToken(headers)).toBe(TOKEN);
  });

  it('should be case-insensitive on the Bearer scheme', () => {
    const headers = new Headers({ authorization: `bearer ${TOKEN}` });
    expect(extractBearerToken(headers)).toBe(TOKEN);
  });

  it('should trim surrounding whitespace from the header', () => {
    const headers = new Headers({ authorization: `   Bearer    ${TOKEN}   ` });
    expect(extractBearerToken(headers)).toBe(TOKEN);
  });

  it('should return null when Authorization is missing', () => {
    const headers = new Headers({});
    expect(extractBearerToken(headers)).toBeNull();
  });

  it('should return null when scheme is not Bearer', () => {
    const headers = new Headers({ authorization: `Basic ${TOKEN}` });
    expect(extractBearerToken(headers)).toBeNull();
  });

  it('should return null when Bearer scheme present but token is empty', () => {
    const headers = new Headers({ authorization: 'Bearer ' });
    expect(extractBearerToken(headers)).toBeNull();
  });
});

// ===========================================================================
// lookupApiKey
// ===========================================================================

describe('lookupApiKey', () => {
  it('should resolve scope when the hashed token matches a live row', async () => {
    const { db, calls } = makeMock({
      handler: () => ({
        data: {
          id: KEY_ID,
          organization_id: ORG,
          user_id: USER,
        },
        error: null,
      }),
    });

    const out = await lookupApiKey(db, TOKEN);

    expect(out).toEqual({
      organizationId: ORG,
      userId: USER,
      keyId: KEY_ID,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe('mcp_api_keys');
    expect(calls[0]!.eqs).toContainEqual(['key_hash', sha256Hex(TOKEN)]);
    expect(calls[0]!.iss).toContainEqual(['revoked_at', null]);
    expect(calls[0]!.terminal).toBe('maybeSingle');
  });

  it('should return null when no row matches', async () => {
    const { db } = makeMock({
      handler: () => ({ data: null, error: null }),
    });

    const out = await lookupApiKey(db, TOKEN);
    expect(out).toBeNull();
  });

  it('should return null when the lookup errors', async () => {
    const { db } = makeMock({
      handler: () => ({ data: null, error: { message: 'boom' } }),
    });

    const out = await lookupApiKey(db, TOKEN);
    expect(out).toBeNull();
  });
});

// ===========================================================================
// recordKeyUsage
// ===========================================================================

describe('recordKeyUsage', () => {
  it('should issue an UPDATE on mcp_api_keys with last_used_at set', async () => {
    const { db, calls } = makeMock({
      handler: () => ({ data: null, error: null }),
    });

    await recordKeyUsage(db, KEY_ID);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.op).toBe('update');
    expect(calls[0]!.table).toBe('mcp_api_keys');
    expect(calls[0]!.eqs).toContainEqual(['id', KEY_ID]);

    const update = calls[0]!.updates[0] as { last_used_at?: string };
    expect(typeof update.last_used_at).toBe('string');
    // ISO-8601 sanity check.
    expect(Number.isNaN(Date.parse(update.last_used_at!))).toBe(false);
  });

  it('should swallow update errors silently', async () => {
    const { db } = makeMock({
      handler: () => {
        throw new Error('db down');
      },
    });

    await expect(recordKeyUsage(db, KEY_ID)).resolves.toBeUndefined();
  });
});

// ===========================================================================
// requireMcpAuth
// ===========================================================================

describe('requireMcpAuth', () => {
  it('should return scope and bump last_used_at when the token is valid', async () => {
    let bumped = false;
    const { db } = makeMock({
      handler: (call) => {
        if (call.op === 'select' && call.iss.length > 0) {
          // Live-key lookup.
          return {
            data: {
              id: KEY_ID,
              organization_id: ORG,
              user_id: USER,
            },
            error: null,
          };
        }
        if (call.op === 'update') {
          bumped = true;
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
    });

    const headers = new Headers({ authorization: `Bearer ${TOKEN}` });
    const out = await requireMcpAuth(db, headers);

    expect(out).toEqual({
      ...ACTIVE_CONTEXT,
      keyId: KEY_ID,
    });
    expect(resolveAccess).toHaveBeenCalledWith(db, USER, ORG);

    // Wait a tick for the fire-and-forget bump to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(bumped).toBe(true);
  });

  it('should return missing when Authorization header is absent', async () => {
    const { db } = makeMock({ handler: () => ({ data: null, error: null }) });
    const out = await requireMcpAuth(db, new Headers({}));
    expect(out).toEqual({ error: 'missing' });
  });

  it('should return invalid when the token does not match any row', async () => {
    const { db } = makeMock({
      handler: () => ({ data: null, error: null }),
    });
    const headers = new Headers({ authorization: `Bearer ${TOKEN}` });
    const out = await requireMcpAuth(db, headers);
    expect(out).toEqual({ error: 'invalid' });
  });

  it('should return revoked when a matching row exists with revoked_at set', async () => {
    const { db } = makeMock({
      handler: (call) => {
        // First call: live-key lookup with is('revoked_at', null) → no rows.
        if (call.iss.length > 0) {
          return { data: null, error: null };
        }
        // Second call: revoked-key lookup with not('revoked_at', 'is', null) → 1 row.
        if (call.nots.length > 0) {
          return { data: { id: KEY_ID }, error: null };
        }
        return { data: null, error: null };
      },
    });

    const headers = new Headers({ authorization: `Bearer ${TOKEN}` });
    const out = await requireMcpAuth(db, headers);
    expect(out).toEqual({ error: 'revoked' });
    expect(resolveAccess).not.toHaveBeenCalled();
  });

  it('should fail closed and not bump usage when current membership is inactive', async () => {
    let bumped = false;
    resolveAccess.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    });
    const { db } = makeMock({
      handler: (call) => {
        if (call.op === 'select') {
          return {
            data: { id: KEY_ID, organization_id: ORG, user_id: USER },
            error: null,
          };
        }
        bumped = true;
        return { data: null, error: null };
      },
    });

    const out = await requireMcpAuth(
      db,
      new Headers({ authorization: `Bearer ${TOKEN}` }),
    );

    expect(out).toEqual({ error: 'forbidden' });
    expect(resolveAccess).toHaveBeenCalledWith(db, USER, ORG);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bumped).toBe(false);
  });

  it('should resolve current role, capabilities, and grants on every request', async () => {
    const scoped = {
      ...ACTIVE_CONTEXT,
      role: 'manager' as const,
      capabilities: new Set(['view_properties'] as const),
      propertyScope: ['property-a'] as const,
    };
    resolveAccess
      .mockResolvedValueOnce({ ok: true, context: ACTIVE_CONTEXT })
      .mockResolvedValueOnce({ ok: true, context: scoped });
    const { db } = makeMock({
      handler: (call) =>
        call.op === 'select'
          ? {
              data: { id: KEY_ID, organization_id: ORG, user_id: USER },
              error: null,
            }
          : { data: null, error: null },
    });
    const headers = new Headers({ authorization: `Bearer ${TOKEN}` });

    expect(await requireMcpAuth(db, headers)).toMatchObject({ role: 'owner' });
    expect(await requireMcpAuth(db, headers)).toMatchObject({
      role: 'manager',
      propertyScope: ['property-a'],
    });
    expect(resolveAccess).toHaveBeenCalledTimes(2);
  });
});
