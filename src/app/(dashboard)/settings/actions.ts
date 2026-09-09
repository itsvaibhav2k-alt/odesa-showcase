'use server';

/**
 * Server actions for the Settings screen.
 *
 * Covers vendor CRUD (create / update / delete) used by the Preferred
 * Vendors section. Each action:
 *   1. Resolves the authenticated user + their organization_id.
 *   2. Parses the input payload through the matching Zod schema.
 *   3. Writes to Supabase via the SSR client (RLS enforced via
 *      `organization_id = current_user_org_id()`).
 *   4. Revalidates `/settings` so the Server Component refetches and
 *      re-renders the fresh row alongside the optimistic UI update.
 *
 * Preference toggles, billing, and team invites are UI-only in Phase 2
 * per the scoping note in the plan — those get their own server actions
 * once the underlying DB columns land (Phase 4/6/8). Placeholder
 * actions aren't included so future agents can add them as they land.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServerClient } from '@/lib/supabase/server';
import { requireAccessContext } from '@/lib/authz/context';
import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import {
  normalizeVendorPhone,
  vendorCreateSchema,
  vendorDeleteSchema,
  vendorUpdateSchema,
} from '@/lib/validation/vendor';
import type { ApiResponse, WorkOrderCategory } from '@/types';
import type { Json, UserRole } from '@/types/database';

// ---------------------------------------------------------------------------
// Shared auth helper
// ---------------------------------------------------------------------------

interface AuthContext {
  userId: string;
  organizationId: string;
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
  if (userRow.role === 'va' || userRow.role === 'accountant') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  return {
    success: true,
    data: { userId: user.id, organizationId: userRow.organization_id },
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

// ---------------------------------------------------------------------------
// Public action payloads (typed for client-side callers)
// ---------------------------------------------------------------------------

export interface VendorCreatePayload {
  name: string;
  category: WorkOrderCategory;
  phoneE164?: string | null;
}

export interface VendorUpdatePayload {
  id: string;
  name: string;
  category: WorkOrderCategory;
  phoneE164?: string | null;
}

export interface VendorDeletePayload {
  id: string;
}

export interface VendorRow {
  id: string;
  name: string;
  category: WorkOrderCategory;
  phoneE164: string | null;
  acceptanceRate: number;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Inserts a vendor for the caller's org. Phone is optional — landlords
 * sometimes add a vendor for reporting only (no dispatchable number yet).
 */
export async function createVendor(
  payload: VendorCreatePayload,
): Promise<ApiResponse<VendorRow>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;

  const parsed = vendorCreateSchema.safeParse({
    name: payload.name,
    category: payload.category,
    phoneE164: payload.phoneE164 ?? '',
  });

  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const supabase = await createServerClient();
  const phone = normalizeVendorPhone(parsed.data.phoneE164 ?? null);

  const { data, error } = await supabase
    .from('vendors')
    .insert({
      organization_id: auth.data.organizationId,
      name: parsed.data.name,
      category: parsed.data.category,
      phone_e164: phone,
    })
    .select('id, name, category, phone_e164, acceptance_rate')
    .single();

  if (error || !data) {
    return {
      success: false,
      error: error?.message ?? 'Failed to create vendor',
    };
  }

  revalidatePath('/settings');

  return {
    success: true,
    data: {
      id: data.id,
      name: data.name,
      category: data.category,
      phoneE164: data.phone_e164,
      acceptanceRate: Number(data.acceptance_rate ?? 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Edits a vendor's name / category / phone. Inline — each field's
 * `onChange` or form `submit` calls this immediately; there's no save
 * button. Acceptance-rate is read-only here (it's derived from
 * work-order outcomes and updated by the dispatch pipeline).
 */
export async function updateVendor(
  payload: VendorUpdatePayload,
): Promise<ApiResponse<VendorRow>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;

  const parsed = vendorUpdateSchema.safeParse({
    id: payload.id,
    name: payload.name,
    category: payload.category,
    phoneE164: payload.phoneE164 ?? '',
  });

  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const supabase = await createServerClient();
  const phone = normalizeVendorPhone(parsed.data.phoneE164 ?? null);

  const { data, error } = await supabase
    .from('vendors')
    .update({
      name: parsed.data.name,
      category: parsed.data.category,
      phone_e164: phone,
    })
    .eq('id', parsed.data.id)
    .select('id, name, category, phone_e164, acceptance_rate')
    .single();

  if (error || !data) {
    return {
      success: false,
      error: error?.message ?? 'Failed to update vendor',
    };
  }

  revalidatePath('/settings');

  return {
    success: true,
    data: {
      id: data.id,
      name: data.name,
      category: data.category,
      phoneE164: data.phone_e164,
      acceptanceRate: Number(data.acceptance_rate ?? 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Deletes a vendor. The UI uses a two-click confirm pattern — the
 * server simply executes the deletion when called. FK on `work_orders`
 * is ON DELETE SET NULL so past work orders keep their history.
 */
export async function deleteVendor(
  payload: VendorDeletePayload,
): Promise<ApiResponse<{ id: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;

  const parsed = vendorDeleteSchema.safeParse({ id: payload.id });

  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const supabase = await createServerClient();

  const { error } = await supabase
    .from('vendors')
    .delete()
    .eq('id', parsed.data.id);

  if (error) {
    return { success: false, error: error.message ?? 'Failed to delete vendor' };
  }

  revalidatePath('/settings');

  return { success: true, data: { id: parsed.data.id } };
}

// ---------------------------------------------------------------------------
// Team & Access — local link invitations (no email is sent)
// ---------------------------------------------------------------------------

const INVITE_ROLES = ['owner', 'manager', 'accountant', 'va'] as const;
// Postgres accepts deterministic fixture UUIDs whose variant nibble is not
// RFC-4122. Keep shape validation here; the invitation RPC remains the
// authority for organization ownership and property reachability.
const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invitationCreateSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  role: z.enum(INVITE_ROLES),
  allProperties: z.boolean().default(false),
  propertyIds: z
    .array(z.string().regex(UUID_LIKE, 'Invalid property id'))
    .max(500)
    .default([]),
});
const invitationRevokeSchema = z.object({
  id: z.string().uuid('Invalid invitation id'),
});

export interface PendingInvitation {
  id: string;
  email: string;
  role: UserRole;
  allProperties: boolean;
  propertyIds: string[];
  expiresAt: string;
}

export interface TeamInviteState {
  canInvite: boolean;
  invitations: PendingInvitation[];
  properties: Array<{ id: string; name: string }>;
}

export interface CreatedInvitation {
  invitation: PendingInvitation;
  /** Raw claim token appears only in this relative path, once. */
  path: string;
}

function object(value: Json | null): Record<string, Json | undefined> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

function pendingInvitation(row: {
  id: string;
  email: string;
  role: UserRole;
  expires_at: string;
  all_properties: boolean;
  organization_invitation_property_grants?: Array<{
    property_id: string;
  }> | null;
}): PendingInvitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    allProperties: row.all_properties,
    propertyIds: (row.organization_invitation_property_grants ?? [])
      .map((grant) => grant.property_id)
      .sort(),
    expiresAt: row.expires_at,
  };
}

async function requireTeamAdminContext(): Promise<ApiResponse<AuthContext>> {
  const access = await requireAccessContext();
  if (!access.ok) {
    return {
      success: false,
      error: access.status === 401 ? 'Not authenticated' : FORBIDDEN_MESSAGE,
    };
  }
  if (!access.context.capabilities.has('manage_team_access')) {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }
  return {
    success: true,
    data: {
      userId: access.context.userId,
      organizationId: access.context.organizationId,
    },
  };
}

export async function getTeamInviteStateAction(): Promise<
  ApiResponse<TeamInviteState>
> {
  const access = await requireAccessContext();
  if (!access.ok) return { success: false, error: 'Not authenticated' };
  if (!access.context.capabilities.has('manage_team_access')) {
    return {
      success: true,
      data: { canInvite: false, invitations: [], properties: [] },
    };
  }

  const supabase = await createServerClient();
  const [{ data: invitations, error }, { data: properties, error: propertyError }] =
    await Promise.all([
      supabase
        .from('organization_invitations')
        .select(
          'id, email, role, expires_at, all_properties, organization_invitation_property_grants(property_id)',
        )
        .eq('organization_id', access.context.organizationId)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('properties')
        .select('id, name')
        .eq('organization_id', access.context.organizationId)
        .is('archived_at', null)
        .order('name', { ascending: true }),
    ]);

  if (error || propertyError) {
    return { success: false, error: 'Could not load team access' };
  }
  return {
    success: true,
    data: {
      canInvite: true,
      invitations: (invitations ?? []).map((row) =>
        pendingInvitation(row as Parameters<typeof pendingInvitation>[0]),
      ),
      properties: properties ?? [],
    },
  };
}

export async function createInvitationAction(payload: {
  email: string;
  role: UserRole;
  allProperties?: boolean;
  propertyIds?: string[];
}): Promise<ApiResponse<CreatedInvitation>> {
  const auth = await requireTeamAdminContext();
  if (!auth.success) return auth;
  const parsed = invitationCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const allProperties =
    parsed.data.role === 'owner' || parsed.data.allProperties;
  const propertyIds = allProperties ? [] : parsed.data.propertyIds;
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc('create_organization_invitation', {
    p_organization_id: auth.data.organizationId,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
    p_all_properties: allProperties,
    p_property_ids: propertyIds,
  });
  const payloadObject = object(data);
  const token = payloadObject?.token;
  if (error || typeof token !== 'string' || token.length === 0) {
    return {
      success: false,
      error: 'Could not create the invitation. Revoke any open invite for this email and try again.',
    };
  }

  const { data: row } = await supabase
    .from('organization_invitations')
    .select(
      'id, email, role, expires_at, all_properties, organization_invitation_property_grants(property_id)',
    )
    .eq('organization_id', auth.data.organizationId)
    .ilike('email', parsed.data.email)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .maybeSingle();
  if (!row) {
    return { success: false, error: 'Invitation was created but could not be reloaded.' };
  }

  revalidatePath('/settings');
  return {
    success: true,
    data: {
      invitation: pendingInvitation(
        row as Parameters<typeof pendingInvitation>[0],
      ),
      path: `/invite/${encodeURIComponent(token)}`,
    },
  };
}

export async function revokeInvitationAction(payload: {
  id: string;
}): Promise<ApiResponse<{ id: string }>> {
  const auth = await requireTeamAdminContext();
  if (!auth.success) return auth;
  const parsed = invitationRevokeSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const { data, error } = await (await createServerClient())
    .from('organization_invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    .eq('organization_id', auth.data.organizationId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .select('id');
  if (error || !data || data.length === 0) {
    return { success: false, error: 'That invitation is no longer open.' };
  }
  revalidatePath('/settings');
  return { success: true, data: { id: parsed.data.id } };
}
