/**
 * Document upload core — validate, upload to storage, THEN insert the row.
 *
 * Ordering invariant (mirrors the messaging insert-before-send discipline,
 * inverted for files): the storage object must durably exist BEFORE the
 * `documents` registry row is written, so the list page never shows a row
 * whose file is missing. If the row insert fails after a successful upload,
 * the orphaned object is removed best-effort (and logged loudly when even
 * that fails).
 *
 * Takes the Supabase client as a parameter (like `notifyTenant` in
 * messaging/notify.ts) so callers pass the org-scoped SSR client and tests
 * pass a recording mock. Storage RLS + table RLS are the real authority;
 * validation here is the friendly boundary.
 */

import { z } from 'zod/v4';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { ApiResponse } from '@/types';

export const DOCUMENTS_BUCKET = 'documents';
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10MB

export const DOCUMENT_KINDS = [
  'lease',
  'inspection',
  'insurance',
  'notice',
  'tax',
  'hoa',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Accepted upload MIME types (pdf / png / jpg / heic). */
export const ALLOWED_DOCUMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/heic',
]);

/**
 * Browsers often report an empty MIME type for HEIC (and occasionally other)
 * files — fall back to the filename extension for the allowed set only.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  heic: 'image/heic',
};

// Lenient UUID shape (mirrors `isUuidLike` in agent/worker/types.ts). zod 4's
// `.uuid()` strictly enforces the RFC-4122 variant nibble, which the seeded
// deterministic fixtures (e.g. 3333…3333) do not satisfy; RLS is the real
// authority on whether the property is reachable.
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uploadDocumentSchema = z.object({
  name: z.string().trim().min(1, 'Document name is required').max(200),
  kind: z.enum(DOCUMENT_KINDS),
  propertyId: z
    .string()
    .regex(UUID_LIKE, 'Invalid property id')
    .nullable(),
  leaseId: z.string().regex(UUID_LIKE, 'Invalid lease id').nullable(),
});

export interface UploadDocumentParams {
  db: SupabaseClient<Database>;
  organizationId: string;
  uploadedBy: string;
  file: File;
  /** Display title for the registry row (defaults to the file name upstream). */
  name: string;
  /** Document kind — must be one of DOCUMENT_KINDS (the table CHECK values). */
  kind: string;
  propertyId?: string | null;
  /** Exact lease evidenced by a lease document; omitted rows remain unlinked. */
  leaseId?: string | null;
}

export interface UploadDocumentResult {
  id: string;
  storagePath: string;
}

/** Resolve the effective MIME type, or null when the file is not allowed. */
export function resolveDocumentMime(file: File): string | null {
  if (ALLOWED_DOCUMENT_MIME_TYPES.has(file.type)) return file.type;
  if (file.type === '') {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    return MIME_BY_EXTENSION[ext] ?? null;
  }
  return null;
}

/** Storage-key-safe file name: conservative charset, bounded length. */
function sanitizeFilename(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (safe || 'file').slice(0, 100);
}

function firstZodError(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string {
  const first = issues[0];
  if (!first) return 'Validation failed';
  const path = first.path.map(String).join('.');
  return path ? `${path}: ${first.message}` : first.message;
}

export async function uploadDocument(
  params: UploadDocumentParams,
): Promise<ApiResponse<UploadDocumentResult>> {
  const { db, organizationId, uploadedBy, file } = params;

  const parsed = uploadDocumentSchema.safeParse({
    name: params.name,
    kind: params.kind,
    propertyId: params.propertyId ?? null,
    leaseId: params.leaseId ?? null,
  });
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const contentType = resolveDocumentMime(file);
  if (!contentType) {
    return {
      success: false,
      error: 'Unsupported file type — upload a PDF, PNG, JPG, or HEIC.',
    };
  }
  if (file.size === 0) {
    return { success: false, error: 'File is empty.' };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { success: false, error: 'File is larger than the 10MB limit.' };
  }

  // Resolve propertyId through the RLS-scoped client before any writes —
  // the documents FK references properties globally, so without this a
  // crafted form post could attach the row to another org's property.
  if (parsed.data.propertyId !== null) {
    const { data: propertyRow, error: propertyError } = await db
      .from('properties')
      .select('id')
      .eq('id', parsed.data.propertyId)
      .maybeSingle();
    if (propertyError || !propertyRow) {
      return { success: false, error: 'Property not found' };
    }
  }

  let linkedUnitId: string | null = null;
  let linkedTenantId: string | null = null;
  let linkedPropertyId = parsed.data.propertyId;
  if (parsed.data.leaseId !== null) {
    if (parsed.data.kind !== 'lease') {
      return { success: false, error: 'Only lease documents can link to a lease.' };
    }
    const { data: leaseRow, error: leaseError } = await db
      .from('leases')
      .select('id, unit_id, tenant_id, status')
      .eq('id', parsed.data.leaseId)
      .maybeSingle();
    if (leaseError || !leaseRow) {
      return { success: false, error: 'Lease not found' };
    }
    if (leaseRow.status !== 'active' && leaseRow.status !== 'pending') {
      return { success: false, error: 'Lease is not active or pending' };
    }
    const { data: unitRow, error: unitError } = await db
      .from('units')
      .select('property_id')
      .eq('id', leaseRow.unit_id)
      .maybeSingle();
    if (unitError || !unitRow) {
      return { success: false, error: 'Lease unit not found' };
    }
    if (linkedPropertyId && linkedPropertyId !== unitRow.property_id) {
      return { success: false, error: 'Lease does not belong to that property' };
    }
    linkedUnitId = leaseRow.unit_id;
    linkedTenantId = leaseRow.tenant_id;
    linkedPropertyId = unitRow.property_id;
  }

  // Path convention: <organization_id>/<uuid>-<filename> — the org folder is
  // what the storage RLS policies scope on.
  const storagePath = `${organizationId}/${globalThis.crypto.randomUUID()}-${sanitizeFilename(file.name)}`;

  // Upload FIRST. The registry row is only written once the object exists.
  const { error: uploadError } = await db.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, file, { contentType, upsert: false });

  if (uploadError) {
    return { success: false, error: `Upload failed: ${uploadError.message}` };
  }

  const insertRes = await db
    .from('documents')
    .insert({
      organization_id: organizationId,
      property_id: linkedPropertyId,
      unit_id: linkedUnitId,
      tenant_id: linkedTenantId,
      lease_id: parsed.data.leaseId,
      type: parsed.data.kind,
      title: parsed.data.name,
      file_key: storagePath,
      uploaded_by: uploadedBy,
    })
    .select('id')
    .single();

  const inserted = insertRes.data as { id: string } | null;

  if (insertRes.error || !inserted) {
    // Row insert failed after a successful upload — remove the orphaned
    // object so storage never drifts ahead of the registry.
    const { error: removeError } = await db.storage
      .from(DOCUMENTS_BUCKET)
      .remove([storagePath]);
    if (removeError) {
      console.error(
        `[documents] orphan cleanup failed for ${storagePath}: ${removeError.message}`,
      );
    }
    return {
      success: false,
      error: insertRes.error?.message ?? 'Failed to save document',
    };
  }

  return { success: true, data: { id: inserted.id, storagePath } };
}
