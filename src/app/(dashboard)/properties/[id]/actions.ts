'use server';

/**
 * Server actions for the property detail page (v1.5).
 *
 *   - updateRulebook       → properties.rules_text (4k char ceiling)
 *   - updatePrivacyMode    → properties.privacy_mode + .ollama_host
 *   - testOllamaConnection → invokes selectProvider(...).healthCheck()
 *                            without persisting; pure connectivity probe.
 *
 * All writes go through the SSR Supabase client so RLS auto-scopes to
 * the caller's organization. Each write revalidates the property page.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { can, FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import { createServerClient } from '@/lib/supabase/server';
import { normalizePhoneE164 } from '@/lib/validation/onboarding';
import {
  selectProvider,
  PrivacyModeMisconfiguredError,
} from '@/lib/agent/worker/providers/select';
import type { ProviderHealth } from '@/lib/agent/worker/types';
import type { ApiResponse } from '@/types';
import type { UserRole } from '@/types/database';

interface AuthContext {
  userId: string;
  organizationId: string;
  /** users.role of the caller; owner-managed writes fail closed on null. */
  role: UserRole | null;
}

async function requireAuthContext(): Promise<ApiResponse<AuthContext>> {
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

  return {
    success: true,
    data: {
      userId: user.id,
      organizationId: userRow.organization_id,
      role: userRow.role ?? null,
    },
  };
}

function firstZodError(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string {
  const first = issues[0];
  if (!first) return 'Validation failed';
  const path = first.path.map(String).join('.');
  return path ? `${path}: ${first.message}` : first.message;
}

const RULEBOOK_MAX = 4000;

// Lenient UUID shape (mirrors `isUuidLike` in agent/worker/types.ts). zod 4's
// `.uuid()` strictly enforces the RFC-4122 variant nibble, which the seeded
// deterministic fixtures (e.g. 3333…3333) do not satisfy; the RLS-scoped
// write is the real authority on whether the property is reachable.
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidLike = z.string().regex(UUID_LIKE, 'Invalid UUID');

// ---------------------------------------------------------------------------
// Rulebook auto-save
// ---------------------------------------------------------------------------

const updateRulebookSchema = z.object({
  propertyId: uuidLike,
  rulesText: z
    .string()
    .max(RULEBOOK_MAX, `must be ${RULEBOOK_MAX} characters or fewer`),
});

export interface UpdateRulebookPayload {
  propertyId: string;
  rulesText: string;
}

export async function updateRulebook(
  payload: UpdateRulebookPayload,
): Promise<ApiResponse<{ propertyId: string; rulesText: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role !== 'owner') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const parsed = updateRulebookSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('properties')
    .update({ rules_text: parsed.data.rulesText })
    .eq('id', parsed.data.propertyId)
    .select('id, rules_text')
    .single();

  if (error || !data) {
    return {
      success: false,
      error: error?.message ?? 'Failed to update rulebook',
    };
  }

  revalidatePath(`/properties/${parsed.data.propertyId}`);

  return {
    success: true,
    data: { propertyId: data.id, rulesText: data.rules_text },
  };
}

// ---------------------------------------------------------------------------
// Edit property — name + address
// ---------------------------------------------------------------------------

const updatePropertySchema = z.object({
  propertyId: uuidLike,
  name: z.string().trim().min(1, 'Property name is required').max(200),
  addressStreet: z.string().trim().max(200).optional(),
  addressCity: z.string().trim().max(120).optional(),
  addressState: z.string().trim().max(60).optional(),
  addressZip: z.string().trim().max(20).optional(),
});

export interface UpdatePropertyInput {
  propertyId: string;
}

/** Convert an optional trimmed string to a nullable column value. */
function orNull(v: string | undefined): string | null {
  return v && v.length > 0 ? v : null;
}

/**
 * Owner-side edit of a property's name + mailing address. RLS-scoped via
 * the SSR client, so a caller can only update a property in their own org.
 */
export async function updateProperty(
  context: UpdatePropertyInput,
  formData: FormData,
): Promise<ApiResponse<{ propertyId: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role !== 'owner') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const parsed = updatePropertySchema.safeParse({
    propertyId: context.propertyId,
    name: formData.get('name'),
    addressStreet: formData.get('addressStreet') ?? undefined,
    addressCity: formData.get('addressCity') ?? undefined,
    addressState: formData.get('addressState') ?? undefined,
    addressZip: formData.get('addressZip') ?? undefined,
  });
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('properties')
    .update({
      name: parsed.data.name,
      address_street: orNull(parsed.data.addressStreet),
      address_city: orNull(parsed.data.addressCity),
      address_state: orNull(parsed.data.addressState),
      address_zip: orNull(parsed.data.addressZip),
    })
    .eq('id', parsed.data.propertyId)
    .select('id')
    .single();

  if (error || !data) {
    return {
      success: false,
      error: error?.message ?? 'Failed to update property',
    };
  }

  revalidatePath(`/properties/${parsed.data.propertyId}`);
  revalidatePath('/properties');

  return { success: true, data: { propertyId: data.id } };
}

// ---------------------------------------------------------------------------
// Privacy mode persistence
// ---------------------------------------------------------------------------

const updatePrivacyModeSchema = z.object({
  propertyId: uuidLike,
  privacyMode: z.enum(['hosted', 'on_prem']),
  ollamaHost: z.string().trim().max(2048).nullable().optional(),
});

export interface UpdatePrivacyModePayload {
  propertyId: string;
  privacyMode: 'hosted' | 'on_prem';
  ollamaHost?: string | null;
}

export async function updatePrivacyMode(
  payload: UpdatePrivacyModePayload,
): Promise<
  ApiResponse<{
    propertyId: string;
    privacyMode: 'hosted' | 'on_prem';
    ollamaHost: string | null;
  }>
> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role !== 'owner') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const parsed = updatePrivacyModeSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  // Hosted has no host; on_prem with empty input persists NULL until the
  // landlord types one (matches Settings — never reject a partial save).
  const nextHost =
    parsed.data.privacyMode === 'hosted'
      ? null
      : (parsed.data.ollamaHost ?? '').trim() === ''
        ? null
        : parsed.data.ollamaHost!.trim();

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('properties')
    .update({
      privacy_mode: parsed.data.privacyMode,
      ollama_host: nextHost,
    })
    .eq('id', parsed.data.propertyId)
    .select('id, privacy_mode, ollama_host')
    .single();

  if (error || !data) {
    return {
      success: false,
      error: error?.message ?? 'Failed to update privacy mode',
    };
  }

  revalidatePath(`/properties/${parsed.data.propertyId}`);

  return {
    success: true,
    data: {
      propertyId: data.id,
      privacyMode: data.privacy_mode as 'hosted' | 'on_prem',
      ollamaHost: data.ollama_host,
    },
  };
}

// ---------------------------------------------------------------------------
// Ollama health probe
// ---------------------------------------------------------------------------

const testOllamaConnectionSchema = z.object({
  ollamaHost: z.string().trim().min(1, 'Host is required'),
});

export interface TestOllamaConnectionPayload {
  ollamaHost: string;
}

export async function testOllamaConnection(
  payload: TestOllamaConnectionPayload,
): Promise<ApiResponse<ProviderHealth>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;

  const parsed = testOllamaConnectionSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  try {
    const provider = selectProvider({
      privacyMode: 'on_prem',
      ollamaHost: parsed.data.ollamaHost,
    });
    const health = await provider.healthCheck();
    return { success: true, data: health };
  } catch (err) {
    if (err instanceof PrivacyModeMisconfiguredError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Add tenant — owner-side tenant + lease creation, scoped to a unit
// ---------------------------------------------------------------------------

/**
 * Form schema for the property "Add tenant" flow.
 *
 * A unit is required: a tenant is linked to a property only through a
 * lease on one of its units, so without a unit we'd create an orphan
 * tenant with no property association. Rent + start date are optional —
 * the owner can fill terms later from the rent room — but rent_amount is
 * NOT NULL on the lease, so a blank field stores 0.
 */
const addTenantSchema = z.object({
  requestId: z.uuid('Invalid tenant request id'),
  unitId: uuidLike,
  fullName: z.string().trim().min(1, 'Tenant name is required').max(200),
  phone: z.string().trim().min(1, 'Phone number is required'),
  email: z.union([z.email('Enter a valid email'), z.literal('')]).optional(),
  monthlyRent: z
    .union([
      z.coerce.number().nonnegative('Rent must be 0 or more'),
      z.literal(''),
    ])
    .optional(),
  startDate: z.union([z.iso.date(), z.literal('')]).optional(),
});

export interface AddTenantInput {
  propertyId: string;
}

/**
 * Map the atomic RPC's machine error codes to operator-facing copy.
 */
function tenantErrorMessage(code: string): string {
  if (code.includes('unit_not_vacant') || code.includes('uq_leases_one_occupancy_per_unit')) {
    return 'That unit is no longer vacant. Refresh and choose another unit.';
  }
  if (code.includes('unit_not_found')) {
    return 'That unit could not be found on this property.';
  }
  if (code.includes('idempotency_key_reused')) {
    return 'This tenant request changed while it was saving. Close the form and try again.';
  }
  switch (code) {
    default:
      return 'Could not save the tenant. No tenant or lease was created. Please try again.';
  }
}

/**
 * Create or reuse a tenant by the organization phone key and link them to a
 * unit through one request-idempotent active-lease transaction.
 *
 * The authenticated database RPC owns authorization, vacancy recheck, tenant
 * creation, active-lease creation, rollback, concurrency serialization, and
 * idempotent replay in one transaction. No service-role multi-step write is
 * used here.
 */
export async function addTenantAction(
  context: AddTenantInput,
  formData: FormData,
): Promise<ApiResponse<{ tenantId: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;

  // Adding a tenant creates an active lease with owner-supplied terms. The
  // action checks owner permission before calling the independently guarded RPC.
  if (!can(auth.data.role, 'change_lease_terms')) {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const parsed = addTenantSchema.safeParse({
    requestId: formData.get('requestId'),
    unitId: formData.get('unitId'),
    fullName: formData.get('fullName'),
    phone: formData.get('phone'),
    email: formData.get('email') ?? '',
    monthlyRent: formData.get('monthlyRent') ?? '',
    startDate: formData.get('startDate') ?? '',
  });
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const { requestId, unitId, fullName } = parsed.data;
  const phoneE164 = normalizePhoneE164(parsed.data.phone);
  if (!phoneE164) {
    return {
      success: false,
      error: 'Enter a valid phone number with a country code or 10 US digits.',
    };
  }
  const email = parsed.data.email ? parsed.data.email : null;
  const startDate = parsed.data.startDate ? parsed.data.startDate : null;
  const rentAmount =
    typeof parsed.data.monthlyRent === 'number' ? parsed.data.monthlyRent : 0;

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc(
    'create_tenant_with_active_lease',
    {
      p_property_id: context.propertyId,
      p_unit_id: unitId,
      p_full_name: fullName,
      p_phone_e164: phoneE164,
      p_email: email,
      p_rent_amount: rentAmount,
      p_start_date: startDate,
      p_idempotency_key: requestId,
    },
  );

  const created = data?.[0];
  if (error || !created) {
    return {
      success: false,
      error: tenantErrorMessage(error?.message ?? 'empty_rpc_result'),
    };
  }

  revalidatePath(`/properties/${context.propertyId}`);

  return { success: true, data: { tenantId: created.tenant_id } };
}
