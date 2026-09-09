/**
 * Fuzzy reference resolver — wave 6.
 *
 * The agentic dispatcher receives intent like "add a unit to vaba house"
 * where the operator referred to a property by a human-friendly name
 * rather than a UUID. Handlers in `src/lib/agent/worker/handlers/*` call
 * into this module to convert names → ids before mutating, and to detect
 * ambiguity (multiple matches) so the dispatcher can ask the operator
 * to disambiguate.
 *
 * Design notes:
 *   - All queries scope to `organization_id`. Never trust caller input
 *     here — the dispatcher passes the org id from auth context.
 *   - Case-insensitive substring match (`ilike '%needle%'`). Two-row
 *     limit lets us decide unique vs ambiguous without fetching the
 *     whole table.
 *   - For leases we resolve via tenant name → active lease. Returning
 *     `ambiguous` when multiple active leases match (rare but possible
 *     if a tenant has two units).
 *   - Pure async; no side effects. Errors from Supabase bubble as
 *     `not_found` (we never want a 500 to crash the dispatcher).
 *
 * Why not reuse src/lib/agent/operator/property-resolver.ts: that
 * resolver works in-memory against an already-loaded
 * OrganizationContext. The handler layer doesn't always have that
 * context (e.g. when committing a queued proposal). Going to the DB
 * keeps the handler self-contained.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ResolveOk = { ok: true; id: string };
export type ResolveErr = { ok: false; reason: 'not_found' | 'ambiguous' };
export type ResolveResult = ResolveOk | ResolveErr;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the `ilike` pattern for a free-form name. We strip surrounding
 * whitespace and wrap with `%` on both sides so a substring like
 * "vaba" matches "Vaba House". Empty inputs return `null` to short-
 * circuit the query at the call site.
 */
function buildPattern(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return null;
  // Escape postgres `_` and `%` wildcards so user input doesn't
  // accidentally widen the match. Single backslashes are fine here —
  // postgrest passes the pattern through as a parameter.
  const escaped = trimmed.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

function decideMatches(rows: ReadonlyArray<{ id: string }> | null): ResolveResult {
  if (!rows || rows.length === 0) return { ok: false, reason: 'not_found' };
  if (rows.length > 1) return { ok: false, reason: 'ambiguous' };
  return { ok: true, id: rows[0].id };
}

// ---------------------------------------------------------------------------
// resolveProperty
// ---------------------------------------------------------------------------

/**
 * Resolve a property by name within an organization. Returns ambiguous
 * when 2+ properties match the substring; not_found when zero match.
 */
export async function resolveProperty(
  admin: SupabaseClient<Database>,
  organizationId: string,
  name: string,
): Promise<ResolveResult> {
  const pattern = buildPattern(name);
  if (pattern === null) return { ok: false, reason: 'not_found' };

  const { data, error } = await admin
    .from('properties')
    .select('id')
    .eq('organization_id', organizationId)
    .ilike('name', pattern)
    .limit(2);

  if (error) return { ok: false, reason: 'not_found' };
  return decideMatches(data);
}

// ---------------------------------------------------------------------------
// resolveTenant
// ---------------------------------------------------------------------------

/**
 * Resolve a tenant by full_name within an organization. Substring-
 * matched so "jessica" matches "Jessica Ramirez". Two-row limit gates
 * ambiguity detection.
 */
export async function resolveTenant(
  admin: SupabaseClient<Database>,
  organizationId: string,
  name: string,
): Promise<ResolveResult> {
  const pattern = buildPattern(name);
  if (pattern === null) return { ok: false, reason: 'not_found' };

  const { data, error } = await admin
    .from('tenants')
    .select('id')
    .eq('organization_id', organizationId)
    .ilike('full_name', pattern)
    .limit(2);

  if (error) return { ok: false, reason: 'not_found' };
  return decideMatches(data);
}

// ---------------------------------------------------------------------------
// resolveUnit
// ---------------------------------------------------------------------------

/**
 * Resolve a unit by label, optionally narrowed to a property by name.
 * When `propertyName` is omitted, label uniqueness is checked across
 * the whole org; when supplied, we resolve the property first and
 * filter units to that property.
 *
 * If the property lookup is itself ambiguous, the unit lookup
 * inherits the ambiguous reason — the operator must disambiguate
 * the property before the unit can be resolved.
 */
export async function resolveUnit(
  admin: SupabaseClient<Database>,
  organizationId: string,
  label: string,
  propertyName?: string,
): Promise<ResolveResult> {
  const labelPattern = buildPattern(label);
  if (labelPattern === null) return { ok: false, reason: 'not_found' };

  let query = admin
    .from('units')
    .select('id')
    .eq('organization_id', organizationId)
    .ilike('label', labelPattern);

  if (propertyName !== undefined) {
    const property = await resolveProperty(admin, organizationId, propertyName);
    if (!property.ok) return property;
    query = query.eq('property_id', property.id);
  }

  const { data, error } = await query.limit(2);
  if (error) return { ok: false, reason: 'not_found' };
  return decideMatches(data);
}

// ---------------------------------------------------------------------------
// resolveLease
// ---------------------------------------------------------------------------

/**
 * Resolve an ACTIVE lease via tenant name. Multi-step:
 *   1. resolveTenant(name) → tenantId
 *   2. SELECT id FROM leases WHERE tenant_id = ? AND status = 'active'
 *
 * Returns ambiguous when the tenant has multiple active leases (a
 * tenant on two units simultaneously); not_found when the tenant has
 * no active lease at all.
 */
export async function resolveLease(
  admin: SupabaseClient<Database>,
  organizationId: string,
  tenantName: string,
): Promise<ResolveResult> {
  const tenant = await resolveTenant(admin, organizationId, tenantName);
  if (!tenant.ok) return tenant;

  const { data, error } = await admin
    .from('leases')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('tenant_id', tenant.id)
    .eq('status', 'active')
    .limit(2);

  if (error) return { ok: false, reason: 'not_found' };
  return decideMatches(data);
}

// ---------------------------------------------------------------------------
// resolveAppliance (wave 7)
// ---------------------------------------------------------------------------

/** Reference into a single appliance row. Either the row's UUID, or
 *  a fuzzy `(propertyName, unitLabel?, type)` triple the handler
 *  resolves via property → unit → appliance. */
export type ApplianceRef =
  | { applianceId: string }
  | { propertyName: string; unitLabel?: string; type: string };

/**
 * Resolve an appliance row. Path A: id short-circuit (verifies the
 * UUID belongs to the org). Path B: resolve property → optional unit
 * → SELECT appliances WHERE property_id = ? AND type = ? (and
 * optionally unit_id).
 *
 * Returns ambiguous when the (property, unit?, type) tuple matches
 * multiple appliances — e.g. two fridges on the same unit. The
 * dispatcher should prompt the operator to specify make/model.
 */
export async function resolveAppliance(
  admin: SupabaseClient<Database>,
  organizationId: string,
  ref: ApplianceRef,
): Promise<ResolveResult> {
  if ('applianceId' in ref) {
    const { data, error } = await admin
      .from('appliances')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('id', ref.applianceId)
      .limit(1);
    if (error) return { ok: false, reason: 'not_found' };
    if (!data || data.length === 0) return { ok: false, reason: 'not_found' };
    return { ok: true, id: data[0].id };
  }

  const property = await resolveProperty(admin, organizationId, ref.propertyName);
  if (!property.ok) return property;

  let query = admin
    .from('appliances')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('property_id', property.id)
    .eq('type', ref.type);

  if (ref.unitLabel !== undefined) {
    const unit = await resolveUnit(admin, organizationId, ref.unitLabel, ref.propertyName);
    if (!unit.ok) return unit;
    query = query.eq('unit_id', unit.id);
  }

  const { data, error } = await query.limit(2);
  if (error) return { ok: false, reason: 'not_found' };
  return decideMatches(data);
}

// ---------------------------------------------------------------------------
// resolveVendor (wave 7)
// ---------------------------------------------------------------------------

/** Reference into a single vendor row. Either UUID or vendor name. */
export type VendorRef =
  | { vendorId: string }
  | { vendorName: string };

/**
 * Resolve a vendor row. UUID short-circuit (org-scoped); else
 * substring match on vendors.name. Same ambiguity semantics as the
 * other resolvers — two-row limit gates the decision.
 */
export async function resolveVendor(
  admin: SupabaseClient<Database>,
  organizationId: string,
  ref: VendorRef,
): Promise<ResolveResult> {
  if ('vendorId' in ref) {
    const { data, error } = await admin
      .from('vendors')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('id', ref.vendorId)
      .limit(1);
    if (error) return { ok: false, reason: 'not_found' };
    if (!data || data.length === 0) return { ok: false, reason: 'not_found' };
    return { ok: true, id: data[0].id };
  }

  const pattern = buildPattern(ref.vendorName);
  if (pattern === null) return { ok: false, reason: 'not_found' };

  const { data, error } = await admin
    .from('vendors')
    .select('id')
    .eq('organization_id', organizationId)
    .ilike('name', pattern)
    .limit(2);

  if (error) return { ok: false, reason: 'not_found' };
  return decideMatches(data);
}
