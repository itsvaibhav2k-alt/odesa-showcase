/**
 * Org-level context for the operator dispatcher.
 *
 * Loads a lightweight list of all properties in the organization so the
 * dispatcher can present the org portfolio in its system prompt and MCPs
 * can resolve propertyName → propertyId per tool call.
 *
 * Deliberately does NOT load tenants, vendors, or any per-property data
 * at this stage — that happens lazily inside each MCP tool call via the
 * existing `loadPropertyContext` (per the Wave 1B design).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Lightweight property summary inlined into the org-level system prompt
 * and used by MCPs for name → UUID resolution.
 *
 * `address` is a human-readable string assembled from the DB columns
 * address_street / address_city / address_state (all nullable in the schema).
 */
export interface PropertySummary {
  id: string;
  name: string;
  address: string;
  timezone: string;
  autonomyLevel: number;
  privacyMode: string;
}

/**
 * Everything the org-level dispatcher needs upfront, loaded once per turn.
 * MCPs receive this via their factory args and use it for name resolution.
 *
 * `assistantName` is the org's per-org assistant identity (Wave 0 migration
 * 20260506000000_org_assistant_name.sql) — interpolated into all three
 * system prompts (worker, dispatcher, messaging) and the iMessage sign-off.
 * Defaults to "Odesa" via the schema-level NOT NULL DEFAULT.
 */
export interface OrganizationContext {
  organization: {
    id: string;
    name: string;
    assistantName: string;
  };
  properties: PropertySummary[];
  /** ISO timestamp of when this context was loaded — useful for logs. */
  loadedAt: string;
}

const DEFAULT_ASSISTANT_NAME = 'Odesa';

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

type AdminClient = SupabaseClient<Database>;

/**
 * Load a fresh `OrganizationContext` for `organizationId`.
 *
 * Fetches the org row (for its name) and the property list in a single
 * parallel pair of queries. Throws on any Supabase error so the caller
 * (dispatcher) can surface a `tool.error` event rather than proceeding
 * with bad state.
 *
 * @param admin  - Service-role Supabase client (bypasses RLS).
 * @param organizationId - The org whose context to load.
 */
export async function loadOrganizationContext(
  admin: AdminClient,
  organizationId: string,
): Promise<OrganizationContext> {
  const [orgResult, propsResult] = await Promise.all([
    admin
      .from('organizations')
      .select('id,name,assistant_name')
      .eq('id', organizationId)
      .single(),
    admin
      .from('properties')
      .select('id,name,address_street,address_city,address_state,timezone,autonomy_level,privacy_mode')
      .eq('organization_id', organizationId)
      .order('created_at'),
  ]);

  if (orgResult.error) {
    throw new Error(`loadOrganizationContext: org query failed — ${orgResult.error.message}`);
  }
  if (propsResult.error) {
    throw new Error(`loadOrganizationContext: properties query failed — ${propsResult.error.message}`);
  }

  const properties: PropertySummary[] = (propsResult.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    address: buildAddress(row.address_street, row.address_city, row.address_state),
    timezone: row.timezone ?? 'UTC',
    autonomyLevel: row.autonomy_level,
    privacyMode: row.privacy_mode,
  }));

  // Defensive null-coalesce: the schema enforces NOT NULL DEFAULT 'Odesa'
  // (Wave 0 migration), but treat a blank string as the default too in
  // case admin tooling lets the operator clear it.
  const orgRow = orgResult.data as {
    id: string;
    name: string;
    assistant_name: string | null;
  };
  const assistantName =
    orgRow.assistant_name && orgRow.assistant_name.trim().length > 0
      ? orgRow.assistant_name
      : DEFAULT_ASSISTANT_NAME;

  return {
    organization: {
      id: orgRow.id,
      name: orgRow.name,
      assistantName,
    },
    properties,
    loadedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAddress(
  street: string | null,
  city: string | null,
  state: string | null,
): string {
  const parts = [street, city, state].filter((p): p is string => p !== null && p.trim() !== '');
  return parts.length > 0 ? parts.join(', ') : 'n/a';
}
