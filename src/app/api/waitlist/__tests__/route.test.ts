import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import { createClient } from '@supabase/supabase-js';
import { POST } from '../route';

const mockCreateClient = vi.mocked(createClient);

function buildDb(result: {
  data: { id: string } | null;
  error: { code?: string; message: string } | null;
}) {
  const maybeSingle = vi.fn(async () => result);
  const select = vi.fn(() => ({ maybeSingle }));
  const upsert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ upsert }));
  mockCreateClient.mockReturnValue({ from } as never);
  return { from, upsert };
}

function request(body: unknown): Parameters<typeof POST>[0] {
  return new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.7',
      referer: 'http://localhost/pilot',
    },
    body: JSON.stringify(body),
  }) as Parameters<typeof POST>[0];
}

describe('POST /api/waitlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates and writes the guided-pilot contract with normalized email', async () => {
    const { upsert } = buildDb({ data: { id: 'waitlist-1' }, error: null });

    const response = await POST(
      request({
        email: 'Owner@Example.com',
        fullName: 'Sample Owner',
        unitCount: 24,
        currentStack: 'Spreadsheet',
        source: 'night-garden-pilot',
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      id: 'waitlist-1',
      duplicate: false,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'owner@example.com',
        full_name: 'Sample Owner',
        unit_count: 24,
        current_stack: 'Spreadsheet',
        source: 'night-garden-pilot',
      }),
      { onConflict: 'email', ignoreDuplicates: true },
    );
  });

  it('treats an existing email as an honest idempotent success', async () => {
    buildDb({ data: null, error: null });

    const response = await POST(request({ email: 'owner@example.com' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      id: null,
      duplicate: true,
    });
  });

  it('returns validation failure without opening a database client', async () => {
    const response = await POST(request({ email: 'not-an-email' }));

    expect(response.status).toBe(400);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('does not expose provider details on a database failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    buildDb({
      data: null,
      error: { code: 'XX000', message: 'internal provider detail' },
    });

    const response = await POST(request({ email: 'owner@example.com' }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      error: 'Unable to save your request right now.',
    });
    expect(JSON.stringify(body)).not.toContain('internal provider detail');
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
