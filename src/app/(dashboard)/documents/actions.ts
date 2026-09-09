'use server';

/**
 * Server actions for /documents — currently just the upload action.
 *
 * Auth + org resolution follow the properties actions precedent: resolve the
 * caller through the org-scoped SSR client, then hand the same client to the
 * upload core (storage RLS + table RLS both enforce the org boundary).
 */

import { revalidatePath } from 'next/cache';

import { createServerClient } from '@/lib/supabase/server';
import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import {
  uploadDocument,
  type UploadDocumentResult,
} from '@/lib/documents/upload';
import type { ApiResponse } from '@/types';

export async function uploadDocumentAction(
  formData: FormData,
): Promise<ApiResponse<UploadDocumentResult>> {
  const supabase = await createServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Not authenticated' };
  }

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (userErr || !userRow) {
    return { success: false, error: 'User profile not found' };
  }
  if (userRow.role === 'va') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: 'Choose a file to upload.' };
  }

  const kind = String(formData.get('kind') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const propertyId = String(formData.get('propertyId') ?? '').trim();
  const leaseId = String(formData.get('leaseId') ?? '').trim();

  if (kind === 'lease' && !leaseId) {
    return {
      success: false,
      error: 'Select the exact current lease this document belongs to.',
    };
  }

  const result = await uploadDocument({
    db: supabase,
    organizationId: userRow.organization_id,
    uploadedBy: user.id,
    file,
    name: name || file.name,
    kind,
    propertyId: propertyId || null,
    leaseId: leaseId || null,
  });

  if (result.success) {
    revalidatePath('/documents');
  }

  return result;
}
