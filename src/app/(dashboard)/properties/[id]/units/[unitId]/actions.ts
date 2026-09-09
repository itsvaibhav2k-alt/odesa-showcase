'use server';

/**
 * Server actions for the unit detail page (Wave 7 Stream P).
 *
 *   - updateTenantPreferencesAction — owner-side write through the
 *     update_tenant_preference handler (source='owner', confidence=1.0).
 *   - createWorkOrderAction — owner-side "file a maintenance request" write
 *     through the audited, owner-only database boundary.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import { handleUpdateTenantPreference } from '@/lib/agent/worker/handlers/update-tenant-preference';
import type { ApiResponse } from '@/types';
import type {
  UserRole,
  WorkOrderCategory,
  WorkOrderUrgency,
} from '@/types/database';

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

function firstZodError(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string {
  const first = issues[0];
  if (!first) return 'Validation failed';
  const path = first.path.map(String).join('.');
  return path ? `${path}: ${first.message}` : first.message;
}

const petsSchema = z.array(
  z.object({
    type: z.string().min(1).max(40),
    name: z.string().min(1).max(80).optional(),
    depositPaid: z.boolean().optional(),
  }),
);

function parsePets(raw: FormDataEntryValue | null): Array<{
  type: string;
  name?: string;
  depositPaid?: boolean;
}> | null {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw);
    const result = petsSchema.safeParse(parsed);
    if (!result.success) return null;
    return [...result.data];
  } catch {
    return null;
  }
}

function nonEmpty(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? undefined : trimmed;
}

export interface UpdateTenantPreferencesContext {
  propertyId: string;
  unitId: string;
  tenantId: string;
}

export async function updateTenantPreferencesAction(
  context: UpdateTenantPreferencesContext,
  formData: FormData,
): Promise<ApiResponse<{ tenantId: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role === 'va') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const channelRaw = nonEmpty(formData.get('preferredChannel'));
  let preferredChannel: 'sms' | 'email' | 'voice' | 'none' | undefined;
  if (
    channelRaw === 'sms' ||
    channelRaw === 'email' ||
    channelRaw === 'voice' ||
    channelRaw === 'none'
  ) {
    preferredChannel = channelRaw;
  }

  const pets = parsePets(formData.get('pets'));
  if (pets === null) {
    return { success: false, error: 'Invalid pets payload' };
  }

  const admin = createAdminClient();
  const result = await handleUpdateTenantPreference({
    admin,
    organizationId: auth.data.organizationId,
    payload: {
      tenantRef: { tenantId: context.tenantId },
      ...(preferredChannel ? { preferredChannel } : {}),
      language: nonEmpty(formData.get('language')),
      emergencyContactName: nonEmpty(formData.get('emergencyContactName')),
      emergencyContactPhone: nonEmpty(formData.get('emergencyContactPhone')),
      parkingSpace: nonEmpty(formData.get('parkingSpace')),
      pets,
      confidence: 1.0,
      source: 'owner',
    },
  });

  if (!result.ok) {
    return { success: false, error: result.error };
  }

  revalidatePath(
    `/properties/${context.propertyId}/units/${context.unitId}`,
  );
  return { success: true, data: { tenantId: context.tenantId } };
}

// ---------------------------------------------------------------------------
// File a maintenance request → work_orders insert
// ---------------------------------------------------------------------------

const WORK_ORDER_CATEGORIES = [
  'plumbing',
  'electrical',
  'hvac',
  'appliances',
  'flooring',
  'painting',
  'landscaping',
  'security',
  'cleaning',
  'general',
  'other',
] as const;

const WORK_ORDER_URGENCIES = ['emergency', 'urgent', 'routine'] as const;

// Lenient UUID shape (mirrors `isUuidLike` in agent/worker/types.ts). zod 4's
// `.uuid()` strictly enforces the RFC-4122 variant nibble, which the seeded
// deterministic fixtures (e.g. 4444…4444) do not satisfy; the RLS-scoped DB
// lookup below is the real authority on whether the unit/tenant exists.
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidLike = z.string().regex(UUID_LIKE, 'Invalid UUID');

const createWorkOrderSchema = z.object({
  unitId: uuidLike,
  tenantId: uuidLike.nullable().optional(),
  category: z.enum(WORK_ORDER_CATEGORIES),
  urgency: z.enum(WORK_ORDER_URGENCIES),
  description: z.string().trim().min(1).max(2000),
  applianceLabel: z.string().max(200).optional(),
  entryConsent: z.boolean(),
});

export interface CreateWorkOrderPayload {
  unitId: string;
  tenantId?: string | null;
  category: WorkOrderCategory;
  urgency: WorkOrderUrgency;
  description: string;
  applianceLabel?: string;
  entryConsent: boolean;
}

/**
 * Composes the stored work-order description from the owner's free-text plus
 * an optional appliance prefix and a trailing entry-consent note.
 */
function composeWorkOrderDescription(
  description: string,
  applianceLabel: string | undefined,
  entryConsent: boolean,
): string {
  const prefix =
    applianceLabel && applianceLabel.trim() !== ''
      ? `Related appliance: ${applianceLabel.trim()}. `
      : '';
  const consentNote = entryConsent
    ? ' Tenant grants entry if no one is home (per lease §9).'
    : ' Tenant does not grant entry without prior notice.';
  return `${prefix}${description}${consentNote}`;
}

/**
 * Owner-side "file a maintenance request" write. The unit's `property_id` is
 * derived server-side from an RLS-scoped lookup (never a client input), and a
 * non-null `tenantId` is verified to actually lease the unit before insert.
 *
 * All reads/writes go through the SSR Supabase client so RLS auto-scopes to
 * the caller's organization.
 *
 * @param payload - the request-modal field values
 * @returns the new work_orders.id on success
 */
export async function createWorkOrderAction(
  payload: CreateWorkOrderPayload,
): Promise<ApiResponse<{ id: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;

  const parsed = createWorkOrderSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const {
    unitId,
    tenantId,
    category,
    urgency,
    description,
    applianceLabel,
    entryConsent,
  } = parsed.data;

  const supabase = await createServerClient();

  // Derive property_id from the unit (RLS-scoped). A cross-org / unknown id
  // resolves to null and is rejected — propertyId is never a client input.
  const { data: unitRow, error: unitError } = await supabase
    .from('units')
    .select('id, property_id')
    .eq('id', unitId)
    .maybeSingle();

  if (unitError || !unitRow) {
    return { success: false, error: 'Unit not found' };
  }

  const propertyId = unitRow.property_id as string;

  // Security: a UUID-shaped tenantId must actually lease this unit. Verify
  // through an RLS-scoped lease lookup before trusting it on the write.
  if (tenantId) {
    const { data: leaseRow, error: leaseError } = await supabase
      .from('leases')
      .select('id')
      .eq('unit_id', unitId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (leaseError || !leaseRow) {
      return { success: false, error: 'Tenant not found for unit' };
    }
  }

  const { data, error: insertError } = await supabase.rpc(
    'create_work_order_audited',
    {
      p_unit_id: unitId,
      p_tenant_id: tenantId ?? null,
      p_category: category,
      p_urgency: urgency,
      p_description: composeWorkOrderDescription(
        description,
        applianceLabel,
        entryConsent,
      ),
    },
  );
  const inserted = data as { id?: string } | null;

  if (insertError || !inserted?.id) {
    return {
      success: false,
      error: insertError?.message ?? 'Failed to create work order',
    };
  }

  revalidatePath(`/properties/${propertyId}/units/${unitId}`);
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath(`/properties/${propertyId}/maintenance`);

  return { success: true, data: { id: inserted.id } };
}
