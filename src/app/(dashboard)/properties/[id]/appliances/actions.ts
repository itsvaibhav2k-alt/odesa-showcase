'use server';

/**
 * Server actions for the property appliances tab.
 *
 *   - addApplianceAction       — owner-side INSERT through the worker handler
 *                                 (source='owner', confidence=1.0)
 *   - confirmApplianceAction   — flips an existing row's source to 'owner'
 *                                 and confidence to 1.0 (the click-to-confirm
 *                                 affordance behind the badge)
 *
 * Why route through the worker handler instead of the Supabase client
 * directly: the handler enforces the natural-key idempotency
 * (organization_id, property, unit, type, make, model). Owner-side
 * insertion that races with an agent-collected row would otherwise
 * create duplicates; the handler returns `idempotent: true` and
 * upgrades source/confidence on the existing row.
 *
 * RLS strategy: we read auth via the SSR client (so the user's session
 * is the source of truth for `organization_id`), then pass that org id
 * into the handler with the admin client. The admin client bypasses
 * RLS but every handler we call is org-scoped explicitly.
 */

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import { handleAddAppliance } from '@/lib/agent/worker/handlers/add-appliance';
import { handleUpdateAppliance } from '@/lib/agent/worker/handlers/update-appliance';
import type { ApiResponse } from '@/types';
import type { UserRole } from '@/types/database';
import type { ApplianceType } from './shared-types';

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

const APPLIANCE_TYPES: ReadonlyArray<ApplianceType> = [
  'fridge',
  'hvac',
  'washer',
  'dryer',
  'water_heater',
  'dishwasher',
  'oven',
  'microwave',
  'other',
];

function isApplianceType(v: unknown): v is ApplianceType {
  return typeof v === 'string' && APPLIANCE_TYPES.includes(v as ApplianceType);
}

function nonEmptyString(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? undefined : trimmed;
}

// ---------------------------------------------------------------------------
// addApplianceAction — owner-side INSERT
// ---------------------------------------------------------------------------

export interface AddApplianceInput {
  propertyId: string;
}

export async function addApplianceAction(
  context: AddApplianceInput,
  formData: FormData,
): Promise<ApiResponse<{ id: string | null }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role === 'va') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const type = formData.get('type');
  if (!isApplianceType(type)) {
    return { success: false, error: 'Invalid appliance type' };
  }

  const unitIdRaw = nonEmptyString(formData.get('unitId'));
  const make = nonEmptyString(formData.get('make'));
  const model = nonEmptyString(formData.get('model'));
  const installDate = nonEmptyString(formData.get('installDate'));
  const warrantyExpiresAt = nonEmptyString(formData.get('warrantyExpiresAt'));
  const notes = nonEmptyString(formData.get('notes'));

  const admin = createAdminClient();

  // Owner-side write: confidence 1.0 + source 'owner' per wave-7 contract.
  const result = await handleAddAppliance({
    admin,
    organizationId: auth.data.organizationId,
    payload: {
      propertyRef: { propertyId: context.propertyId },
      ...(unitIdRaw ? { unitRef: { unitId: unitIdRaw } } : {}),
      type,
      make,
      model,
      installDate,
      warrantyExpiresAt,
      notes,
      confidence: 1.0,
      source: 'owner',
    },
  });

  if (!result.ok) {
    return { success: false, error: result.error };
  }

  revalidatePath(`/properties/${context.propertyId}`);

  const id = (result.data as { id?: string }).id ?? null;
  return { success: true, data: { id } };
}

// ---------------------------------------------------------------------------
// confirmApplianceAction — promote agent-collected row to owner-confirmed
// ---------------------------------------------------------------------------

export interface ConfirmApplianceInput {
  propertyId: string;
  applianceId: string;
}

export async function confirmApplianceAction(
  context: ConfirmApplianceInput,
  // form-action shape — present so the button form can submit without
  // a payload. We don't read from the FormData; the context.bind() the
  // page does is the only required input.
  _formData?: FormData,
): Promise<void> {
  await confirmApplianceCore(context);
}

async function confirmApplianceCore(
  context: ConfirmApplianceInput,
): Promise<ApiResponse<{ id: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role === 'va') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const admin = createAdminClient();

  // The handler bumps confidence → 1.0 when source === 'owner'. We only
  // pass the applianceRef + source to avoid clobbering data fields.
  const result = await handleUpdateAppliance({
    admin,
    organizationId: auth.data.organizationId,
    payload: {
      applianceRef: { applianceId: context.applianceId },
      source: 'owner',
    },
  });

  if (!result.ok) {
    return { success: false, error: result.error };
  }

  revalidatePath(`/properties/${context.propertyId}`);
  return { success: true, data: { id: context.applianceId } };
}
