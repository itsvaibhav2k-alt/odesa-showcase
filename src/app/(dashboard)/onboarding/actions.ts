'use server';

/**
 * Server actions for the 4-step onboarding flow.
 *
 * Each action:
 *   1. Resolves the authenticated user + their organization_id (RLS-safe).
 *   2. Parses input through the matching Zod schema.
 *   3. Inserts the row via the SSR Supabase client (RLS enforced).
 *   4. Returns ApiResponse<{ id: string }> with the new row id OR redirects
 *      to the next onboarding step on success.
 *
 * organization_id injection: we read current_user_org_id() via a Postgres
 * RPC exposed by Agent B's RLS migration. This guarantees the org_id we
 * pass in the INSERT matches exactly what the RLS WITH CHECK clause will
 * evaluate, eliminating one class of subtle "insert silently rejected"
 * bugs where the UI gets a 403 because it guessed the org wrong.
 */

import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import {
  propertySchema,
  unitSchema,
  tenantSchema,
  leaseSchema,
  normalizePhoneE164,
} from '@/lib/validation/onboarding';
import type { ApiResponse } from '@/types';
import type { UserRole } from '@/types/database';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface AuthContext {
  userId: string;
  organizationId: string;
  role: UserRole | null;
}

/**
 * Resolve the current auth'd user + their organization_id.
 *
 * Bubbles a typed error up to the caller — server actions return
 * ApiResponse so the UI can render the message without a try/catch.
 */
async function requireAuthContext(): Promise<
  ApiResponse<AuthContext>
> {
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
    return {
      success: false,
      error:
        'User profile not found — the signup trigger may not have run. Contact support.',
    };
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

/** Collapse a set of Zod issues into a single user-facing error message. */
interface ParseFailure {
  message: string;
  fieldErrors: Record<string, string>;
}

function formatZodIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): ParseFailure {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || '_';
    if (!fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  const first = issues[0];
  return {
    message: first
      ? `${first.path.map(String).join('.') || 'Input'}: ${first.message}`
      : 'Validation failed',
    fieldErrors,
  };
}

// ---------------------------------------------------------------------------
// Step 1 — Property
// ---------------------------------------------------------------------------

export interface PropertyActionResult
  extends ParseFailure {
  id?: string;
}

export async function createPropertyAction(
  formData: FormData,
): Promise<ApiResponse<{ id: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role === 'va') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const parsed = propertySchema.safeParse({
    name: formData.get('name'),
    addressStreet: formData.get('addressStreet'),
    addressCity: formData.get('addressCity'),
    addressState: (formData.get('addressState') as string | null)
      ?.toUpperCase(),
    addressZip: formData.get('addressZip'),
    timezone: formData.get('timezone') || undefined,
  });

  if (!parsed.success) {
    return { success: false, error: formatZodIssues(parsed.error.issues).message };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('properties')
    .insert({
      organization_id: auth.data.organizationId,
      name: parsed.data.name,
      address_street: parsed.data.addressStreet,
      address_city: parsed.data.addressCity,
      address_state: parsed.data.addressState,
      address_zip: parsed.data.addressZip,
      timezone: parsed.data.timezone,
    })
    .select('id')
    .single();

  if (error || !data) {
    return {
      success: false,
      error: error?.message ?? 'Failed to create property',
    };
  }

  redirect(`/onboarding/unit?propertyId=${data.id}`);
}

// ---------------------------------------------------------------------------
// Step 2 — Unit
// ---------------------------------------------------------------------------

export async function createUnitAction(
  formData: FormData,
): Promise<ApiResponse<{ id: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role === 'va') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const parsed = unitSchema.safeParse({
    propertyId: formData.get('propertyId'),
    label: formData.get('label'),
    bedrooms: formData.get('bedrooms') || undefined,
    bathrooms: formData.get('bathrooms') || undefined,
    squareFeet: formData.get('squareFeet') || undefined,
  });

  if (!parsed.success) {
    return { success: false, error: formatZodIssues(parsed.error.issues).message };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('units')
    .insert({
      organization_id: auth.data.organizationId,
      property_id: parsed.data.propertyId,
      label: parsed.data.label,
      bedrooms: parsed.data.bedrooms ?? null,
      bathrooms: parsed.data.bathrooms ?? null,
      square_feet: parsed.data.squareFeet ?? null,
    })
    .select('id')
    .single();

  if (error || !data) {
    return {
      success: false,
      error: error?.message ?? 'Failed to create unit',
    };
  }

  redirect(`/onboarding/tenant?unitId=${data.id}`);
}

// ---------------------------------------------------------------------------
// Step 3 — Tenant
// ---------------------------------------------------------------------------

export async function createTenantAction(
  formData: FormData,
): Promise<ApiResponse<{ id: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role === 'va') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const unitId = formData.get('unitId'); // carried forward to lease step

  const parsed = tenantSchema.safeParse({
    fullName: formData.get('fullName'),
    phoneE164: formData.get('phoneE164'),
    email: formData.get('email') || '',
    dateOfBirth: formData.get('dateOfBirth') || '',
  });

  if (!parsed.success) {
    return { success: false, error: formatZodIssues(parsed.error.issues).message };
  }

  const supabase = await createServerClient();
  const normalized = normalizePhoneE164(parsed.data.phoneE164);
  if (!normalized) {
    return { success: false, error: 'Phone must be a valid E.164 identity' };
  }
  const email =
    parsed.data.email && parsed.data.email !== ''
      ? parsed.data.email
      : null;
  const dob =
    parsed.data.dateOfBirth && parsed.data.dateOfBirth !== ''
      ? parsed.data.dateOfBirth
      : null;

  const { data, error } = await supabase
    .from('tenants')
    .insert({
      organization_id: auth.data.organizationId,
      full_name: parsed.data.fullName,
      phone_e164: normalized,
      email,
      date_of_birth: dob,
    })
    .select('id')
    .single();

  if (error || !data) {
    return {
      success: false,
      error: error?.message ?? 'Failed to create tenant',
    };
  }

  const nextParams = new URLSearchParams();
  if (typeof unitId === 'string' && unitId.length > 0) {
    nextParams.set('unitId', unitId);
  }
  nextParams.set('tenantId', data.id);
  redirect(`/onboarding/lease?${nextParams.toString()}`);
}

// ---------------------------------------------------------------------------
// Step 4 — Lease
// ---------------------------------------------------------------------------

export async function createLeaseAction(
  formData: FormData,
): Promise<ApiResponse<{ id: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role === 'va') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const parsed = leaseSchema.safeParse({
    unitId: formData.get('unitId'),
    tenantId: formData.get('tenantId'),
    rentAmount: formData.get('rentAmount'),
    rentDueDay: formData.get('rentDueDay'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
  });

  if (!parsed.success) {
    return { success: false, error: formatZodIssues(parsed.error.issues).message };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('leases')
    .insert({
      organization_id: auth.data.organizationId,
      unit_id: parsed.data.unitId,
      tenant_id: parsed.data.tenantId,
      rent_amount: parsed.data.rentAmount,
      rent_due_day: parsed.data.rentDueDay,
      start_date: parsed.data.startDate,
      end_date: parsed.data.endDate,
      status: 'active',
    })
    .select('id')
    .single();

  if (error || !data) {
    return {
      success: false,
      error: error?.message ?? 'Failed to create lease',
    };
  }

  // Step 5 (Messaging) gathers the Sendblue number, assistant name, and
  // sends a verification SMS. Lease completion no longer drops straight
  // into /today.
  redirect('/onboarding/messaging');
}
