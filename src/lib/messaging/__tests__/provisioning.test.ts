/**
 * Unit tests for src/lib/messaging/provisioning.ts.
 *
 * Covers:
 *   - countAvailableNumbers: happy path + DB error
 *   - addNumbersToPool: happy path, empty input, DB error
 *   - maybeCapturePoolLowAlert: fires when count ≤ threshold, no-op above it,
 *     handles count failure gracefully
 *
 * All Supabase calls are mocked at the module boundary. Sentry is mocked so
 * we can assert captureMessage calls without a real DSN.
 *
 * T2b (2026-05-17).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
}));

import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import {
  addNumbersToPool,
  countAvailableNumbers,
  DEFAULT_POOL_LOW_THRESHOLD,
  maybeCapturePoolLowAlert,
} from '../provisioning';

const mockCaptureMessage = vi.mocked(Sentry.captureMessage);

// ---------------------------------------------------------------------------
// Supabase admin stub builder
// ---------------------------------------------------------------------------

type AdminClient = SupabaseClient<Database>;

interface PoolSelectStubOpts {
  count?: number | null;
  countError?: string;
  insertedIds?: string[];
  insertError?: string;
}

function buildAdminStub(opts: PoolSelectStubOpts = {}): AdminClient {
  const { count = 5, countError, insertedIds = ['id-1'], insertError } = opts;

  // COUNT query stub (head:true)
  const headSingle = vi.fn(async () => {
    // `head: true` queries don't call .single(); they return from the select chain
    if (countError) {
      return { count: null, error: { message: countError } };
    }
    return { count, error: null };
  });

  // Normal SELECT stub (for count)
  const selectEq = vi.fn(() => ({ single: headSingle }));
  const selectOpts = vi.fn((_cols: string, _opts?: unknown) => {
    // head:true variant — just return result directly
    return {
      eq: vi.fn(() => ({
        // This is what supabase returns for { count: 'exact', head: true }
        then: vi.fn((_resolve: (v: unknown) => void) => {
          // Promise-like; we'll handle via async function overload
        }),
      })),
    };
  });

  // We need to intercept both the count path and the insert path.
  // Build two flavors:

  // Count path: .select('id', { count: 'exact', head: true }).eq('status', 'available')
  const countResult = countError
    ? { count: null, error: { message: countError } }
    : { count, error: null };

  const countEq = vi.fn(async () => countResult);
  const countSelect = vi.fn(() => ({ eq: countEq }));

  // Insert path: .insert(rows).select('id')
  const insertSelect = vi.fn(async () => {
    if (insertError) {
      return { data: null, error: { message: insertError } };
    }
    return {
      data: insertedIds.map((id) => ({ id })),
      error: null,
    };
  });
  const insert = vi.fn(() => ({ select: insertSelect }));

  const from = vi.fn((_table: string) => ({
    select: countSelect,
    insert,
  }));

  return { from } as unknown as AdminClient;
}

// ---------------------------------------------------------------------------
// Tests: countAvailableNumbers
// ---------------------------------------------------------------------------

describe('countAvailableNumbers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should return count when query succeeds', async () => {
    const admin = buildAdminStub({ count: 7 });
    const result = await countAvailableNumbers(admin);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(7);
    }
  });

  it('should return count 0 when no rows', async () => {
    const admin = buildAdminStub({ count: 0 });
    const result = await countAvailableNumbers(admin);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.count).toBe(0);
    }
  });

  it('should return error when DB query fails', async () => {
    const admin = buildAdminStub({ countError: 'connection refused' });
    const result = await countAvailableNumbers(admin);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('connection refused');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: addNumbersToPool
// ---------------------------------------------------------------------------

describe('addNumbersToPool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should return inserted 0 when given an empty array without touching DB', async () => {
    const admin = buildAdminStub();
    const result = await addNumbersToPool(admin, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.inserted).toBe(0);
    }
    // from() should not have been called.
    expect((admin.from as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('should insert numbers and return the count', async () => {
    const admin = buildAdminStub({ insertedIds: ['id-1', 'id-2'] });
    const result = await addNumbersToPool(admin, [
      { e164: '+16505551234' },
      { e164: '+16505555678' },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.inserted).toBe(2);
    }
  });

  it('should return error when DB insert fails (e.g. duplicate)', async () => {
    const admin = buildAdminStub({ insertError: 'duplicate key value violates unique constraint' });
    const result = await addNumbersToPool(admin, [{ e164: '+16505551234' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/duplicate/);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: maybeCapturePoolLowAlert
// ---------------------------------------------------------------------------

describe('maybeCapturePoolLowAlert', () => {
  const ORG_ID = 'org-abc';

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PHONE_POOL_LOW_THRESHOLD;
  });

  afterEach(() => {
    vi.resetAllMocks();
    delete process.env.PHONE_POOL_LOW_THRESHOLD;
  });

  it('should fire Sentry.captureMessage when count equals threshold', async () => {
    const admin = buildAdminStub({ count: DEFAULT_POOL_LOW_THRESHOLD });
    await maybeCapturePoolLowAlert(admin, ORG_ID);
    expect(mockCaptureMessage).toHaveBeenCalledOnce();
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'Phone pool low',
      expect.objectContaining({
        level: 'warning',
        extra: expect.objectContaining({
          availableCount: DEFAULT_POOL_LOW_THRESHOLD,
          triggeredByOrgId: ORG_ID,
        }),
      }),
    );
  });

  it('should fire Sentry.captureMessage when count is below threshold', async () => {
    const admin = buildAdminStub({ count: 1 });
    await maybeCapturePoolLowAlert(admin, ORG_ID);
    expect(mockCaptureMessage).toHaveBeenCalledOnce();
  });

  it('should NOT fire Sentry.captureMessage when count is above threshold', async () => {
    const admin = buildAdminStub({ count: DEFAULT_POOL_LOW_THRESHOLD + 1 });
    await maybeCapturePoolLowAlert(admin, ORG_ID);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('should respect a custom threshold argument', async () => {
    const admin = buildAdminStub({ count: 5 });
    // count (5) equals custom threshold (5) → should fire
    await maybeCapturePoolLowAlert(admin, ORG_ID, 5);
    expect(mockCaptureMessage).toHaveBeenCalledOnce();
  });

  it('should respect PHONE_POOL_LOW_THRESHOLD env override', async () => {
    process.env.PHONE_POOL_LOW_THRESHOLD = '10';
    const admin = buildAdminStub({ count: 8 });
    await maybeCapturePoolLowAlert(admin, ORG_ID);
    expect(mockCaptureMessage).toHaveBeenCalledOnce();
  });

  it('should NOT fire when count is above env-override threshold', async () => {
    process.env.PHONE_POOL_LOW_THRESHOLD = '5';
    const admin = buildAdminStub({ count: 6 });
    await maybeCapturePoolLowAlert(admin, ORG_ID);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('should log a warning and NOT throw when DB count fails', async () => {
    const admin = buildAdminStub({ countError: 'db timeout' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Should not throw.
    await expect(maybeCapturePoolLowAlert(admin, ORG_ID)).resolves.toBeUndefined();
    expect(mockCaptureMessage).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
