/**
 * The single server-side access seam.
 *
 * Before this module, "which org am I in, and what is my role" was
 * inlined ~44 times as an ad-hoc `users` read, so there was nowhere to
 * add property scope or capability resolution without touching every
 * caller. `requireAccessContext()` is that missing indirection point.
 *
 * Wave 1b cashed that seam in: org + role moved off `users` onto
 * `organization_memberships` and only this file changed. The exported
 * signature, result shape, and fail-closed semantics are untouched.
 *
 * Design notes:
 *
 * - It RETURNS a result rather than throwing or redirecting, because the
 *   existing call sites map failure very differently (null, empty string,
 *   `{ ok: false }`, `{ success: false }`, 401/403 responses). A shared
 *   throw would have changed behavior at every one of them.
 * - Auth and data clients are separate options: several callers resolve
 *   the signed-in user from the cookie-bound server client but read the
 *   row through the service-role admin client. Both default to one lazily
 *   created server client, so the common case passes nothing.
 * - Fail closed: no session, no row, missing org, or an unknown role all
 *   deny. An unknown role yields an empty capability set via
 *   `capabilitiesFor` rather than a partial one. Zero active memberships
 *   AND more than one both deny, mirroring `current_user_org_id()` — if
 *   the app picked a winner the database would not, every RLS-scoped
 *   read underneath would silently come back empty.
 * - Never cache across requests. A per-request React `cache()` is fine;
 *   anything wider breaks "revocation takes effect on the next request".
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { createServerClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

import {
  capabilitiesFor,
  isPortalRole,
  type AccessOverride,
  type Capability,
} from './access-policy';
import { FORBIDDEN_MESSAGE } from './policy';

export type AccessRole = Database['public']['Enums']['user_role'];

/** Properties the caller may act on. */
export type PropertyScope = 'all' | readonly string[];

export interface AccessContext {
  userId: string;
  /** Active organization-membership identity used by membership-owned records. */
  membershipId: string;
  organizationId: string;
  role: AccessRole;
  capabilities: ReadonlySet<Capability>;
  /** Owner/all-properties sentinel, or the caller's explicit grant ids. */
  propertyScope: PropertyScope;
}

export type AccessContextResult =
  | { ok: true; context: AccessContext }
  | { ok: false; status: 401 | 403; error: string };

export interface AccessContextOptions {
  /** Client used to READ the membership row. Defaults to the server client. */
  db?: SupabaseClient<Database>;
  /** Client used to RESOLVE the signed-in user. Defaults to the server client. */
  auth?: SupabaseClient<Database>;
}

/**
 * Resolve the one current active staff membership for a concrete user.
 * Webhook/API-key callers use this after authenticating their own credential,
 * so membership suspension, role changes, overrides, and property-grant
 * revocation take effect on the very next request.
 */
export async function resolveActiveAccessContextForUser(
  db: SupabaseClient<Database>,
  userId: string,
  expectedOrganizationId?: string,
): Promise<AccessContextResult> {
  const query = db
    .from('organization_memberships')
    .select(
      'id, organization_id, role, all_properties, membership_capability_overrides(capability, effect), membership_property_grants!membership_property_grants_membership_id_fkey(property_id)',
    )
    .eq('user_id', userId)
    .eq('status', 'active');
  // Never narrow by the expected organization before `.single()`: doing so
  // could hide a second active membership and turn an ambiguous identity into
  // an apparently valid caller. Resolve uniqueness globally, then compare.
  const { data: row, error } = await query.single();

  const membership = row as unknown as MembershipAccessRow | null;
  if (
    error
    || !membership?.id
    || !membership.organization_id
    || (expectedOrganizationId !== undefined
      && membership.organization_id !== expectedOrganizationId)
    || !isPortalRole(membership.role)
  ) {
    return { ok: false, status: 403, error: FORBIDDEN_MESSAGE };
  }

  const overrides = persistedOverrides(membership.membership_capability_overrides);
  return {
    ok: true,
    context: {
      userId,
      membershipId: membership.id,
      organizationId: membership.organization_id,
      role: membership.role,
      capabilities: capabilitiesFor(membership.role, overrides),
      propertyScope: persistedPropertyScope(
        membership.role,
        membership.all_properties,
        membership.membership_property_grants,
      ),
    },
  };
}

interface MembershipAccessRow {
  id: string;
  organization_id: string | null;
  role: string | null;
  all_properties: boolean;
  membership_capability_overrides: Array<{
    capability: string;
    effect: string;
  }> | null;
  membership_property_grants: Array<{ property_id: string | null }> | null;
}

function persistedOverrides(
  rows: MembershipAccessRow['membership_capability_overrides'],
): AccessOverride[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (
      !row
      || typeof row.capability !== 'string'
      || (row.effect !== 'allow' && row.effect !== 'deny')
    ) {
      return [];
    }
    return [{ capability: row.capability, effect: row.effect }];
  });
}

function persistedPropertyScope(
  role: MembershipAccessRow['role'],
  allProperties: boolean,
  rows: MembershipAccessRow['membership_property_grants'],
): PropertyScope {
  // Owner scope is immutable even if a malformed row says otherwise.
  if (role === 'owner' || allProperties === true) return 'all';
  if (!Array.isArray(rows)) return [];

  return [...new Set(
    rows.flatMap((row) => (
      row && typeof row.property_id === 'string' && row.property_id.length > 0
        ? [row.property_id]
        : []
    )),
  )].sort();
}

/**
 * Resolve the caller's organization, role, capabilities, and property
 * scope, failing closed at every step.
 *
 * @param options - optional auth/data client overrides
 * @returns the context, or a 401/403 result the caller maps to its own shape
 *
 * @example
 * const access = await requireAccessContext();
 * if (!access.ok) return { success: false, error: access.error };
 * const { organizationId } = access.context;
 */
export async function requireAccessContext(
  options: AccessContextOptions = {},
): Promise<AccessContextResult> {
  let serverClient: SupabaseClient<Database> | null = null;
  const server = async (): Promise<SupabaseClient<Database>> => {
    serverClient ??= await createServerClient();
    return serverClient;
  };

  const authClient = options.auth ?? (await server());
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return { ok: false, status: 401, error: 'Not authenticated' };

  const db = options.db ?? (await server());
  // `.single()` inside the shared resolver fails on zero rows AND on a second
  // active membership, so an ambiguous caller never receives a context.
  return resolveActiveAccessContextForUser(db, user.id);
}
