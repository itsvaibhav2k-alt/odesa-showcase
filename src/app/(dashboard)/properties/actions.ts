'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v4';

import { createServerClient } from '@/lib/supabase/server';
import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import type { ApiResponse } from '@/types';
import type { UserRole } from '@/types/database';

interface AuthContext {
  userId: string;
  organizationId: string;
  role: UserRole | null;
}

const propertyTypeSchema = z.enum([
  'single-family',
  'townhouse',
  'apartment',
  'condo',
]);

const createPortfolioPropertySchema = z.object({
  name: z.string().trim().min(1, 'Property name is required').max(200),
  propertyType: propertyTypeSchema,
  addressStreet: z.string().trim().min(1, 'Street address is required').max(200),
  addressCity: z.string().trim().min(1, 'City is required').max(100),
  addressState: z
    .string()
    .trim()
    .toUpperCase()
    .length(2, 'State must be a 2-letter abbreviation')
    .regex(/^[A-Z]{2}$/, 'State must be a 2-letter abbreviation'),
  addressZip: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, 'ZIP must be 5 digits or ZIP+4'),
  unitCount: z.coerce
    .number()
    .int('Unit count must be a whole number')
    .min(1, 'Unit count must be at least 1')
    .max(200, 'Unit count must be 200 or fewer'),
});

export interface CreatePortfolioPropertyInput {
  name: string;
  propertyType: z.infer<typeof propertyTypeSchema>;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  unitCount: number;
}

export interface CreatePortfolioPropertyResult {
  id: string;
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

function unitLabel(index: number, total: number): string {
  if (total === 1) return '1';
  return `Unit ${index + 1}`;
}

export async function createPortfolioProperty(
  input: CreatePortfolioPropertyInput,
): Promise<ApiResponse<CreatePortfolioPropertyResult>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role === 'va') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const parsed = createPortfolioPropertySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const supabase = await createServerClient();

  const { data: property, error: propertyError } = await supabase
    .from('properties')
    .insert({
      organization_id: auth.data.organizationId,
      name: parsed.data.name,
      address_street: parsed.data.addressStreet,
      address_city: parsed.data.addressCity,
      address_state: parsed.data.addressState,
      address_zip: parsed.data.addressZip,
      timezone: 'America/New_York',
    })
    .select('id')
    .single();

  if (propertyError || !property) {
    return {
      success: false,
      error: propertyError?.message ?? 'Failed to create property',
    };
  }

  const unitRows = Array.from({ length: parsed.data.unitCount }, (_, index) => ({
    organization_id: auth.data.organizationId,
    property_id: property.id,
    label: unitLabel(index, parsed.data.unitCount),
  }));

  const { error: unitsError } = await supabase.from('units').insert(unitRows);

  if (unitsError) {
    return {
      success: false,
      error: `Property was created, but units failed: ${unitsError.message}`,
    };
  }

  revalidatePath('/properties');

  return { success: true, data: { id: property.id } };
}

// Lenient UUID shape (mirrors `isUuidLike` in agent/worker/types.ts). zod 4's
// `.uuid()` strictly enforces the RFC-4122 variant nibble, which the seeded
// deterministic fixtures (e.g. 3333…3333) do not satisfy; the RLS-scoped
// delete is the real authority on whether the property is reachable.
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const deletePortfolioPropertySchema = z.object({
  propertyId: z.string().regex(UUID_LIKE, 'Invalid property id'),
});

export interface DeletePortfolioPropertyInput {
  propertyId: string;
}

export async function deletePortfolioProperty(
  input: DeletePortfolioPropertyInput,
): Promise<ApiResponse<{ id: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role === 'va') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const parsed = deletePortfolioPropertySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const supabase = await createServerClient();

  // RLS scopes the delete to the caller's organization; the FK graph
  // cascades units, leases, work orders, and conversations with it.
  // `.select('id')` distinguishes a real delete from a 0-row no-op
  // (cross-org or already-deleted id).
  const { data: deleted, error } = await supabase
    .from('properties')
    .delete()
    .eq('id', parsed.data.propertyId)
    .select('id')
    .maybeSingle();

  if (error) {
    return { success: false, error: error.message };
  }

  if (!deleted) {
    return { success: false, error: 'Property not found' };
  }

  revalidatePath('/properties');
  revalidatePath(`/properties/${parsed.data.propertyId}`);

  return { success: true, data: { id: deleted.id } };
}
