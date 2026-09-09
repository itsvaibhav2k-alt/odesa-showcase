'use server';

/**
 * Server actions for the property vendors tab.
 *
 *   - assignVendorAction  — owner-side UPSERT through the worker handler
 *                            (source='owner', confidence=1.0)
 *   - confirmVendorAction — promotes an agent-collected assignment to
 *                            owner-confirmed (source='owner', confidence=1.0)
 */

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import { handleSetPropertyVendor } from '@/lib/agent/worker/handlers/set-property-vendor';
import type { ApiResponse } from '@/types';
import type { UserRole } from '@/types/database';

import { VENDOR_CATEGORIES, type VendorCategory } from './shared-types';

interface AuthContext {
  userId: string;
  organizationId: string;
  role: UserRole | null;
}

async function requireAuthContext(): Promise<ApiResponse<AuthContext>> {
  const supabase = await createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: 'Not authenticated' };
  }
  const { data: userRow, error } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();
  if (error || !userRow) {
    return { success: false, error: 'User profile not found' };
  }
  return {
    success: true,
    data: {
      userId: user.id,
      organizationId: userRow.organization_id,
      role: userRow.role ?? null,
    },
  };
}

function isCategory(v: unknown): v is VendorCategory {
  return (
    typeof v === 'string' &&
    VENDOR_CATEGORIES.includes(v as VendorCategory)
  );
}

function nonEmpty(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? undefined : trimmed;
}

export interface AssignVendorContext {
  propertyId: string;
  category: VendorCategory;
}

export async function assignVendorAction(
  context: AssignVendorContext,
  formData: FormData,
): Promise<ApiResponse<{ propertyId: string; category: VendorCategory }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role === 'va') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  if (!isCategory(context.category)) {
    return { success: false, error: 'Invalid category' };
  }

  const vendorId = nonEmpty(formData.get('vendorId'));
  if (!vendorId) {
    return { success: false, error: 'vendorId is required' };
  }
  const notes = nonEmpty(formData.get('notes'));

  const admin = createAdminClient();
  const result = await handleSetPropertyVendor({
    admin,
    organizationId: auth.data.organizationId,
    payload: {
      propertyRef: { propertyId: context.propertyId },
      category: context.category,
      vendorRef: { vendorId },
      notes,
      confidence: 1.0,
      source: 'owner',
    },
  });

  if (!result.ok) {
    return { success: false, error: result.error };
  }

  revalidatePath(`/properties/${context.propertyId}`);
  return {
    success: true,
    data: { propertyId: context.propertyId, category: context.category },
  };
}

export interface ConfirmVendorContext {
  propertyId: string;
  category: VendorCategory;
}

export async function confirmVendorAction(
  context: ConfirmVendorContext,
  _formData?: FormData,
): Promise<void> {
  await confirmVendorCore(context);
}

async function confirmVendorCore(
  context: ConfirmVendorContext,
): Promise<ApiResponse<{ propertyId: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role === 'va') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  if (!isCategory(context.category)) {
    return { success: false, error: 'Invalid category' };
  }

  // Promote an existing assignment to owner-confirmed without changing
  // the vendor itself. Look up the current vendor_id then re-UPSERT
  // with source='owner' and confidence=1.0.
  const supabase = await createServerClient();
  const { data: row } = await supabase
    .from('property_vendors')
    .select('vendor_id')
    .eq('property_id', context.propertyId)
    .eq('category', context.category)
    .maybeSingle();

  if (!row?.vendor_id) {
    return { success: false, error: 'no_assignment_to_confirm' };
  }

  const admin = createAdminClient();
  const result = await handleSetPropertyVendor({
    admin,
    organizationId: auth.data.organizationId,
    payload: {
      propertyRef: { propertyId: context.propertyId },
      category: context.category,
      vendorRef: { vendorId: row.vendor_id },
      confidence: 1.0,
      source: 'owner',
    },
  });

  if (!result.ok) {
    return { success: false, error: result.error };
  }

  revalidatePath(`/properties/${context.propertyId}`);
  return { success: true, data: { propertyId: context.propertyId } };
}
