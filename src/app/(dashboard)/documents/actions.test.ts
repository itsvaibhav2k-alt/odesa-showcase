import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/documents/upload', () => ({ uploadDocument: vi.fn() }));

import { uploadDocument } from '@/lib/documents/upload';
import { createServerClient } from '@/lib/supabase/server';
import { uploadDocumentAction } from './actions';

const LEASE_ID = '66666666-6666-6666-6666-666666666666';

function form(leaseId = ''): FormData {
  const data = new FormData();
  data.set('file', new File(['lease'], 'lease.pdf', { type: 'application/pdf' }));
  data.set('kind', 'lease');
  data.set('name', 'Exact lease');
  data.set('leaseId', leaseId);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    },
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { organization_id: 'org-1' }, error: null }),
        }),
      }),
    })),
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);
  vi.mocked(uploadDocument).mockResolvedValue({
    success: true,
    data: { id: 'doc-1', storagePath: 'org/lease.pdf' },
  });
});

describe('uploadDocumentAction lease association', () => {
  it('rejects a normal lease upload without an exact lease id', async () => {
    const result = await uploadDocumentAction(form());

    expect(result).toEqual({
      success: false,
      error: 'Select the exact current lease this document belongs to.',
    });
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it('forwards the selected lease id to the upload boundary', async () => {
    const result = await uploadDocumentAction(form(LEASE_ID));

    expect(result.success).toBe(true);
    expect(uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({ leaseId: LEASE_ID, kind: 'lease' }),
    );
  });
});
