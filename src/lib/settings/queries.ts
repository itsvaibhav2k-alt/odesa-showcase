/**
 * Settings screen queries.
 *
 * Server-side reads for the five Settings sections:
 *  - Organization (phone number, plan)
 *  - Vendors (preferred-vendor table)
 *  - Team (users in the org)
 *
 * Every function uses the SSR Supabase client so RLS enforces org
 * scoping — no manual `organization_id` filter needed.
 *
 * Kept narrow on purpose: each caller reads exactly the columns the UI
 * renders so we never leak extra data across the server/client boundary.
 */

import { createServerClient } from '@/lib/supabase/server';
import { isClientVisibleTeamMember } from '@/lib/demo-safe/normalize';
import type {
  Organization,
  OrganizationPlan,
  UserRole,
  Vendor,
  WorkOrderCategory,
} from '@/types/database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Subset of the `organizations` row the Settings screen renders. */
export interface SettingsOrganization {
  id: string;
  name: string;
  odesaPhoneNumber: string | null;
  plan: OrganizationPlan;
  timezone: string;
  /**
   * Voice/Retell opt-in flag. Null when the column doesn't exist yet
   * (pending T2b migration). UI treats null the same as false.
   */
  voiceEnabled: boolean | null;
}

/** A vendor row with the fields the table + inline-edit form expose. */
export interface SettingsVendor {
  id: string;
  name: string;
  category: WorkOrderCategory;
  phoneE164: string | null;
  acceptanceRate: number;
  /**
   * ISO-8601 timestamp for the vendor's most-recent `work_orders`
   * assignment, or `null` if the vendor has never been dispatched.
   */
  lastDispatchedAt: string | null;
}

/** A team member row for the Settings → Team section. */
export interface SettingsTeamMember {
  id: string;
  fullName: string | null;
  email: string | null;
  role: UserRole;
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

/**
 * Reads the caller's organization row for the Settings screen.
 *
 * Returns `null` when the caller is unauthenticated or has no org yet —
 * callers render the appropriate empty/loading state in that case.
 */
export async function getSettingsOrganization(): Promise<SettingsOrganization | null> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, odesa_phone_number, plan, timezone, voice_enabled')
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    name: data.name,
    odesaPhoneNumber: data.odesa_phone_number,
    plan: data.plan,
    timezone: data.timezone,
    voiceEnabled: data.voice_enabled ?? null,
  };
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

/**
 * Returns all vendors for the caller's org, alphabetised by name, plus
 * each vendor's most-recent dispatch timestamp (derived from
 * `work_orders.vendor_id`).
 *
 * Two round-trips: vendors first, then the `work_orders` latest-per-
 * vendor join. Keeping these split is cheaper than a single RPC when
 * the vendor list is small (typical landlord has < 20 vendors).
 */
export async function getSettingsVendors(): Promise<SettingsVendor[]> {
  const supabase = await createServerClient();

  const { data: vendors, error } = await supabase
    .from('vendors')
    .select('id, name, category, phone_e164, acceptance_rate')
    .order('name', { ascending: true });

  if (error || !vendors) return [];

  if (vendors.length === 0) return [];

  const ids = vendors.map((v) => v.id);
  const { data: workOrders } = await supabase
    .from('work_orders')
    .select('vendor_id, created_at')
    .in('vendor_id', ids)
    .order('created_at', { ascending: false });

  const latestByVendor = new Map<string, string>();
  for (const wo of workOrders ?? []) {
    if (!wo.vendor_id) continue;
    if (!latestByVendor.has(wo.vendor_id)) {
      latestByVendor.set(wo.vendor_id, wo.created_at);
    }
  }

  return vendors.map((v) => ({
    id: v.id,
    name: v.name,
    category: v.category,
    phoneE164: v.phone_e164,
    acceptanceRate: Number(v.acceptance_rate ?? 0),
    lastDispatchedAt: latestByVendor.get(v.id) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

/**
 * Returns all users in the caller's org for the Team section. Order:
 * owners first, then managers, accountants, then VAs — each group alphabetised by
 * name.
 */
export async function getSettingsTeam(): Promise<SettingsTeamMember[]> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role')
    .order('role', { ascending: true })
    .order('full_name', { ascending: true, nullsFirst: false });

  if (error || !data) return [];

  // RLS already scopes to the caller's org; this filter only removes obvious
  // e2e/test/provisioned users from the client-facing list (the genuine
  // seeded owner@galaxy-estates.test owner is preserved).
  const roleOrder: Record<UserRole, number> = {
    owner: 0,
    manager: 1,
    accountant: 2,
    va: 3,
  };
  return data
    .map((u) => ({
      id: u.id,
      fullName: u.full_name,
      email: u.email,
      role: u.role,
    }))
    .filter((member) => isClientVisibleTeamMember(member))
    .sort(
      (a, b) =>
        roleOrder[a.role] - roleOrder[b.role] ||
        (a.fullName ?? '').localeCompare(b.fullName ?? ''),
    );
}

// ---------------------------------------------------------------------------
// Narrow type re-exports for callers that want the raw DB shapes
// ---------------------------------------------------------------------------

export type { Organization, Vendor };
