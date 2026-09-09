/**
 * Unit tests for `uploadDocument` in lib/documents/upload.ts.
 *
 * Invariants under test (asserted with a recording mock, like the
 * notify.ts tests):
 *   - validation gate: bad MIME / oversize / bad kind / bad property id
 *     never reach storage
 *   - upload-then-insert ordering: the storage object is written BEFORE the
 *     documents registry row
 *   - cleanup-on-failure: a row-insert failure removes the just-uploaded
 *     object (and logs loudly when even the cleanup fails)
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import {
  uploadDocument,
  MAX_DOCUMENT_BYTES,
  DOCUMENTS_BUCKET,
} from '../upload';

const ORG = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-000000000002';
const PROPERTY = '33333333-3333-3333-3333-333333333333'; // seed-style, non-RFC variant
const UNIT = '44444444-4444-4444-4444-444444444444';
const TENANT = '55555555-5555-5555-5555-555555555555';
const LEASE = '66666666-6666-6666-6666-666666666666';
const DOC_ID = 'doc-1';

interface RecordedDb {
  db: SupabaseClient<Database>;
  /** Ordered operation log, e.g. 'storage:upload', 'insert:documents'. */
  calls: string[];
  uploads: Array<{ bucket: string; path: string; contentType?: string }>;
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
  removed: string[];
}

function buildDb(
  opts: {
    failUpload?: boolean;
    failInsert?: boolean;
    failRemove?: boolean;
    /** Property ids the RLS-scoped client can see (default: any asked for). */
    visibleProperties?: string[];
    leaseStatus?: 'active' | 'pending' | 'expired';
  } = {},
): RecordedDb {
  const calls: string[] = [];
  const uploads: RecordedDb['uploads'] = [];
  const inserts: RecordedDb['inserts'] = [];
  const removed: string[] = [];

  const storage = {
    from: vi.fn((bucket: string) => ({
      upload: vi.fn(
        async (path: string, _file: File, options?: { contentType?: string }) => {
          calls.push('storage:upload');
          uploads.push({ bucket, path, contentType: options?.contentType });
          return opts.failUpload
            ? { data: null, error: { message: 'bucket exploded' } }
            : { data: { path }, error: null };
        },
      ),
      remove: vi.fn(async (paths: string[]) => {
        calls.push('storage:remove');
        removed.push(...paths);
        return opts.failRemove
          ? { data: null, error: { message: 'remove exploded' } }
          : { data: [], error: null };
      }),
    })),
  };

  const from = vi.fn((table: string) => {
    if (table === 'properties') {
      let askedId: unknown = null;
      const propChain = {
        select: vi.fn(() => propChain),
        eq: vi.fn((_col: string, value: unknown) => {
          askedId = value;
          return propChain;
        }),
        maybeSingle: vi.fn(async () => {
          calls.push('select:properties');
          const visible =
            opts.visibleProperties === undefined ||
            opts.visibleProperties.includes(String(askedId));
          return { data: visible ? { id: askedId } : null, error: null };
        }),
      };
      return propChain;
    }
    if (table === 'leases') {
      const leaseChain = {
        select: vi.fn(() => leaseChain),
        eq: vi.fn(() => leaseChain),
        maybeSingle: vi.fn(async () => ({
          data: {
            id: LEASE,
            unit_id: UNIT,
            tenant_id: TENANT,
            status: opts.leaseStatus ?? 'active',
          },
          error: null,
        })),
      };
      return leaseChain;
    }
    if (table === 'units') {
      const unitChain = {
        select: vi.fn(() => unitChain),
        eq: vi.fn(() => unitChain),
        maybeSingle: vi.fn(async () => ({
          data: { property_id: PROPERTY },
          error: null,
        })),
      };
      return unitChain;
    }
    if (table !== 'documents') throw new Error(`unexpected from(${table})`);
    return {
      insert: vi.fn((values: Record<string, unknown>) => {
        calls.push('insert:documents');
        inserts.push({ table, values });
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: opts.failInsert ? null : { id: DOC_ID },
              error: opts.failInsert ? { message: 'insert exploded' } : null,
            })),
          })),
        };
      }),
    };
  });

  return {
    db: { from, storage } as unknown as SupabaseClient<Database>,
    calls,
    uploads,
    inserts,
    removed,
  };
}

function makeFile(
  name = 'lease.pdf',
  type = 'application/pdf',
  size = 1024,
): File {
  return new File([new Uint8Array(size)], name, { type });
}

function baseParams(db: SupabaseClient<Database>, file: File) {
  return {
    db,
    organizationId: ORG,
    uploadedBy: USER,
    file,
    name: 'Maya lease 2026',
    kind: 'lease',
    propertyId: null,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('uploadDocument', () => {
  describe('validation', () => {
    it('should reject an unsupported file type without touching storage', async () => {
      const { db, calls } = buildDb();

      const result = await uploadDocument(
        baseParams(db, makeFile('notes.txt', 'text/plain')),
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('Unsupported file type');
      expect(calls).toEqual([]);
    });

    it('should reject a file larger than 10MB without touching storage', async () => {
      const { db, calls } = buildDb();
      const oversize = makeFile('big.pdf', 'application/pdf', MAX_DOCUMENT_BYTES + 1);

      const result = await uploadDocument(baseParams(db, oversize));

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('10MB');
      expect(calls).toEqual([]);
    });

    it('should reject an empty file', async () => {
      const { db, calls } = buildDb();

      const result = await uploadDocument(
        baseParams(db, makeFile('empty.pdf', 'application/pdf', 0)),
      );

      expect(result.success).toBe(false);
      expect(calls).toEqual([]);
    });

    it('should reject an invalid kind', async () => {
      const { db, calls } = buildDb();

      const result = await uploadDocument({
        ...baseParams(db, makeFile()),
        kind: 'memes',
      });

      expect(result.success).toBe(false);
      expect(calls).toEqual([]);
    });

    it('should reject an invalid property id', async () => {
      const { db, calls } = buildDb();

      const result = await uploadDocument({
        ...baseParams(db, makeFile()),
        propertyId: 'not-a-uuid',
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('Invalid property id');
      expect(calls).toEqual([]);
    });

    it('should accept a seed-style uuid that zod4 .uuid() would reject', async () => {
      const { db, inserts } = buildDb();

      const result = await uploadDocument({
        ...baseParams(db, makeFile()),
        propertyId: PROPERTY,
      });

      expect(result.success).toBe(true);
      expect(inserts[0].values).toMatchObject({ property_id: PROPERTY });
    });

    it('should reject a property id outside the caller org before any writes', async () => {
      // RLS hides cross-org properties — the pre-resolve must fail closed.
      const { db, calls } = buildDb({ visibleProperties: [] });

      const result = await uploadDocument({
        ...baseParams(db, makeFile()),
        propertyId: PROPERTY,
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('Property not found');
      expect(calls).toEqual(['select:properties']);
    });

    it('should reject an expired lease association before storage', async () => {
      const { db, calls } = buildDb({ leaseStatus: 'expired' });

      const result = await uploadDocument({
        ...baseParams(db, makeFile()),
        leaseId: LEASE,
      });

      expect(result).toEqual({
        success: false,
        error: 'Lease is not active or pending',
      });
      expect(calls).toEqual([]);
    });

    it('should accept a HEIC file whose browser-reported MIME type is empty', async () => {
      const { db, uploads } = buildDb();

      const result = await uploadDocument(
        baseParams(db, makeFile('kitchen.heic', '')),
      );

      expect(result.success).toBe(true);
      expect(uploads[0].contentType).toBe('image/heic');
    });
  });

  describe('upload-then-insert ordering', () => {
    it('should persist the exact lease relationship and its scoped associations', async () => {
      const { db, inserts } = buildDb();

      const result = await uploadDocument({
        ...baseParams(db, makeFile()),
        propertyId: PROPERTY,
        leaseId: LEASE,
      });

      expect(result.success).toBe(true);
      expect(inserts[0].values).toMatchObject({
        lease_id: LEASE,
        property_id: PROPERTY,
        unit_id: UNIT,
        tenant_id: TENANT,
      });
    });

    it('should upload the object BEFORE inserting the documents row', async () => {
      const { db, calls, uploads, inserts } = buildDb();

      const result = await uploadDocument(baseParams(db, makeFile()));

      expect(calls).toEqual(['storage:upload', 'insert:documents']);
      expect(uploads[0].bucket).toBe(DOCUMENTS_BUCKET);
      expect(uploads[0].path).toMatch(
        new RegExp(`^${ORG}/[0-9a-f-]{36}-lease\\.pdf$`),
      );
      expect(inserts[0].values).toMatchObject({
        organization_id: ORG,
        property_id: null,
        type: 'lease',
        title: 'Maya lease 2026',
        file_key: uploads[0].path,
        uploaded_by: USER,
      });
      expect(result).toEqual({
        success: true,
        data: { id: DOC_ID, storagePath: uploads[0].path },
      });
    });

    it('should never insert a row when the storage upload fails', async () => {
      const { db, calls } = buildDb({ failUpload: true });

      const result = await uploadDocument(baseParams(db, makeFile()));

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('bucket exploded');
      expect(calls).toEqual(['storage:upload']);
    });
  });

  describe('cleanup on row-insert failure', () => {
    it('should remove the uploaded object when the row insert fails', async () => {
      const { db, calls, uploads, removed } = buildDb({ failInsert: true });

      const result = await uploadDocument(baseParams(db, makeFile()));

      expect(calls).toEqual([
        'storage:upload',
        'insert:documents',
        'storage:remove',
      ]);
      expect(removed).toEqual([uploads[0].path]);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('insert exploded');
    });

    it('should log loudly and still report failure when the cleanup itself fails', async () => {
      const { db, calls, uploads } = buildDb({
        failInsert: true,
        failRemove: true,
      });
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      const result = await uploadDocument(baseParams(db, makeFile()));

      expect(calls).toEqual([
        'storage:upload',
        'insert:documents',
        'storage:remove',
      ]);
      expect(result.success).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(uploads[0].path),
      );
      errorSpy.mockRestore();
    });
  });
});
