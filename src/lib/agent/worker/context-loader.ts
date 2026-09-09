/**
 * Context loader — pulls the per-property worker prompt context out
 * of Supabase and shapes it into a `PropertyContext`.
 *
 * Caller-side dependency injection: every function takes a
 * Supabase-shaped client (admin or server) so unit tests can swap
 * in a hand-rolled mock with the same `.from(...).select(...)`
 * surface. The runtime caller in production code uses
 * `createAdminClient()` from `@/lib/supabase/admin`.
 *
 * Sourcing strategy:
 *   - properties: single row by id; throws PropertyContextNotFoundError
 *     if the row is missing (or RLS-hidden).
 *   - facts: memory_facts where superseded_at IS NULL, ordered by
 *     confidence desc → created_at desc. Capped to 200/property to
 *     match the addendum's hard ceiling.
 *   - recentTurns: last 20 messages in conversations attached to the
 *     property, ordered newest-first then reversed.
 *   - vendors: org-wide vendor table (vendors are not yet
 *     property-scoped in v1; addendum allows broadening).
 *   - tenants: leases (active|pending) joined to units in this
 *     property, joined to tenants. rent_status is layered in via the
 *     latest rent_event per lease.
 *
 * NOTE: nothing here calls a model. This module is pure I/O + shape
 * transformation. The system-prompt builder consumes the result.
 */

import {
  PropertyContextNotFoundError,
  type ContextConversationTurn,
  type ContextFact,
  type ContextPropertySummary,
  type ContextTenantSummary,
  type ContextVendorSummary,
  type PropertyContext,
} from './types';

// ---------------------------------------------------------------------------
// Minimal client surface
// ---------------------------------------------------------------------------
//
// SupabaseLike is intentionally permissive: anything that exposes a
// `from(table)` method that returns a chainable builder satisfies it.
// Using `any` for the builder return type lets the production
// AdminClient (PostgrestQueryBuilder) flow through without forcing
// callers to widen their types, while still letting the unit-test
// mock implement only the methods we actually use. The `as` casts on
// each await re-narrow the returned shape so the consumer code stays
// typed.

export interface QueryBuilderResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface SupabaseLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

export const RECENT_TURNS_LIMIT = 20;
export const FACTS_LIMIT = 200;
export const VENDORS_LIMIT = 30;
export const TENANTS_LIMIT = 50;

// ---------------------------------------------------------------------------
// Row shapes — minimal subset of database.ts we actually read
// ---------------------------------------------------------------------------

interface PropertyRow {
  id: string;
  organization_id: string;
  name: string;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  timezone: string | null;
  rules_text: string;
  autonomy_level: number;
  privacy_mode: 'hosted' | 'on_prem';
}

interface MemoryFactRow {
  id: string;
  fact_type: ContextFact['factType'];
  subject_id: string | null;
  content: unknown;
  confidence: number;
  source: ContextFact['source'];
  created_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  body: string | null;
  created_at: string;
  conversations: {
    channel: 'voice' | 'sms' | 'imessage';
    property_id: string | null;
  } | null;
}

interface VendorRow {
  id: string;
  name: string;
  category: string | null;
  acceptance_rate: number | null;
}

interface LeaseJoinRow {
  id: string;
  status: string;
  tenant_id: string | null;
  /** Postgres numeric — may arrive as a string through PostgREST. */
  rent_amount: number | string | null;
  units: { property_id: string; label: string | null } | null;
  tenants: { id: string; full_name: string } | null;
}

interface RentEventLatestRow {
  lease_id: string;
  status: string;
  cycle_month: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LoadPropertyContextOptions {
  recentTurnsLimit?: number;
  factsLimit?: number;
  vendorsLimit?: number;
  tenantsLimit?: number;
  /** Override "now" for deterministic snapshots in tests. */
  now?: () => Date;
}

/**
 * Load the per-property context bundle. Throws
 * `PropertyContextNotFoundError` if the property does not exist or is
 * not visible under RLS.
 */
export async function loadPropertyContext(
  client: SupabaseLike,
  propertyId: string,
  opts: LoadPropertyContextOptions = {},
): Promise<PropertyContext> {
  const recentLimit = opts.recentTurnsLimit ?? RECENT_TURNS_LIMIT;
  const factLimit = opts.factsLimit ?? FACTS_LIMIT;
  const vendorLimit = opts.vendorsLimit ?? VENDORS_LIMIT;
  const tenantLimit = opts.tenantsLimit ?? TENANTS_LIMIT;
  const now = opts.now ?? (() => new Date());

  const property = await loadProperty(client, propertyId);
  const facts = await loadActiveFacts(client, propertyId, factLimit);
  const recentTurns = await loadRecentTurns(client, propertyId, recentLimit);
  const vendors = await loadVendors(
    client,
    property.organizationId,
    vendorLimit,
  );
  const tenants = await loadTenants(client, propertyId, tenantLimit);

  return {
    property,
    facts,
    recentTurns,
    vendors,
    tenants,
    loadedAt: now().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

async function loadProperty(
  client: SupabaseLike,
  propertyId: string,
): Promise<ContextPropertySummary> {
  const { data, error } = (await client
    .from('properties')
    .select(
      'id, organization_id, name, address_street, address_city, address_state, address_zip, timezone, rules_text, autonomy_level, privacy_mode',
    )
    .eq('id', propertyId)
    .maybeSingle()) as QueryBuilderResult<PropertyRow>;

  if (error) {
    throw new Error(`property load failed: ${error.message}`);
  }

  if (!data) {
    throw new PropertyContextNotFoundError(propertyId);
  }

  return {
    id: data.id,
    organizationId: data.organization_id,
    name: data.name,
    addressLine: formatAddress(data),
    timezone: data.timezone,
    rulesText: data.rules_text ?? '',
    autonomyLevel: Number(data.autonomy_level ?? 0),
    privacyMode: data.privacy_mode ?? 'hosted',
  };
}

function formatAddress(p: PropertyRow): string | null {
  const parts = [
    p.address_street,
    p.address_city,
    p.address_state,
    p.address_zip,
  ].filter((s): s is string => Boolean(s && s.trim()));
  if (parts.length === 0) return null;
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Active memory_facts
// ---------------------------------------------------------------------------

async function loadActiveFacts(
  client: SupabaseLike,
  propertyId: string,
  limit: number,
): Promise<ReadonlyArray<ContextFact>> {
  const { data, error } = (await client
    .from('memory_facts')
    .select(
      'id, fact_type, subject_id, content, confidence, source, created_at',
    )
    .eq('property_id', propertyId)
    .is('superseded_at', null)
    .order('confidence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)) as QueryBuilderResult<MemoryFactRow[]>;

  if (error) {
    throw new Error(`memory_facts load failed: ${error.message}`);
  }

  if (!data) return [];

  return data.map((row) => ({
    id: row.id,
    factType: row.fact_type,
    subjectId: row.subject_id,
    content: row.content,
    confidence: Number(row.confidence ?? 0),
    source: row.source,
    createdAt: row.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Recent conversation turns
// ---------------------------------------------------------------------------

async function loadRecentTurns(
  client: SupabaseLike,
  propertyId: string,
  limit: number,
): Promise<ReadonlyArray<ContextConversationTurn>> {
  // Read messages joined to their conversation; filter conversation
  // by property_id. We pull DESC then reverse for chronological order
  // because Postgres LIMIT after ORDER BY DESC is the cheapest way to
  // get the tail.
  const { data, error } = (await client
    .from('messages')
    .select(
      'id, conversation_id, direction, body, created_at, conversations!inner(channel, property_id)',
    )
    .eq('conversations.property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(limit)) as QueryBuilderResult<MessageRow[]>;

  if (error) {
    throw new Error(`messages load failed: ${error.message}`);
  }

  if (!data) return [];

  const turns = data.map(
    (row): ContextConversationTurn => ({
      conversationId: row.conversation_id,
      channel: row.conversations?.channel ?? 'sms',
      direction: row.direction,
      body: row.body,
      occurredAt: row.created_at,
    }),
  );

  // Reverse so the prompt sees oldest → newest.
  return turns.slice().reverse();
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

async function loadVendors(
  client: SupabaseLike,
  organizationId: string,
  limit: number,
): Promise<ReadonlyArray<ContextVendorSummary>> {
  const { data, error } = (await client
    .from('vendors')
    .select('id, name, category, acceptance_rate')
    .eq('organization_id', organizationId)
    .order('acceptance_rate', { ascending: false })
    .limit(limit)) as QueryBuilderResult<VendorRow[]>;

  if (error) {
    throw new Error(`vendors load failed: ${error.message}`);
  }

  if (!data) return [];

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    acceptanceRate: row.acceptance_rate,
  }));
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

const ACTIVE_LEASE_STATES = ['active', 'pending'] as const;

async function loadTenants(
  client: SupabaseLike,
  propertyId: string,
  limit: number,
): Promise<ReadonlyArray<ContextTenantSummary>> {
  // Direct join — leases ⨝ units (filtered to property) ⨝ tenants —
  // pulls the active/pending tenants for this property in one round
  // trip. We then layer rent_status by looking up the most recent
  // rent_event per lease in a second query (cheap; one IN clause).
  // This replaces an earlier reliance on a `v_property_tenants` view
  // that doesn't exist in the migrations; the direct-join path keeps
  // the loader self-contained and avoids a coordination dance with
  // migrations-eng.
  const { data: leases, error: leaseError } = (await client
    .from('leases')
    .select(
      'id, status, tenant_id, rent_amount, units!inner(property_id, label), tenants(id, full_name)',
    )
    .eq('units.property_id', propertyId)
    .in('status', ACTIVE_LEASE_STATES)
    .limit(limit)) as QueryBuilderResult<LeaseJoinRow[]>;

  if (leaseError) {
    throw new Error(`tenants load failed: ${leaseError.message}`);
  }

  if (!leases || leases.length === 0) return [];

  const leaseIds = leases.map((l) => l.id);
  const rentStatusByLease = await loadLatestRentStatusByLease(
    client,
    leaseIds,
  );

  return leases.flatMap((lease): ContextTenantSummary[] => {
    if (!lease.tenants) return [];
    return [
      {
        id: lease.tenants.id,
        fullName: lease.tenants.full_name,
        unitLabel: lease.units?.label ?? null,
        rentStatus: rentStatusByLease.get(lease.id) ?? null,
        rentAmount: parseRentAmount(lease.rent_amount),
      },
    ];
  });
}

/** Coerce leases.rent_amount (numeric → number | string via PostgREST)
 *  to a finite number, or null when missing/unparseable. */
function parseRentAmount(raw: number | string | null | undefined): number | null {
  if (raw == null) return null;
  const value = typeof raw === 'string' ? Number(raw) : raw;
  return Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Organization branding (assistant_name)
// ---------------------------------------------------------------------------

export interface OrganizationBranding {
  /** Display name of the organization (e.g. "Galaxy Estates"). */
  name: string;
  /** Per-org assistant name; defaults to "Odesa" when not customised. */
  assistantName: string;
}

interface OrganizationBrandingRow {
  id: string;
  name: string;
  assistant_name: string | null;
}

const DEFAULT_ASSISTANT_NAME = 'Odesa';

/**
 * Load org-level branding (org name + assistant_name) once per
 * dispatcher run. Used by:
 *   - the dispatcher to brand the operator-facing system prompt
 *   - the worker spawn pipeline to brand the per-property system prompt
 *   - the messaging tenant-facing system prompt
 *   - the iMessage outbound sign-off
 *
 * Falls back to "Odesa" when `assistant_name` is null (older rows that
 * predate the Wave 0 migration; the migration sets a NOT NULL DEFAULT
 * 'Odesa' but defensive null-coalesce keeps the worker from blowing up
 * if a future schema migration weakens that constraint).
 *
 * Throws when the row is missing — the dispatcher reads org elsewhere
 * and would already have surfaced a tool.error before this loader runs,
 * so a missing row here is a programmer bug, not a runtime expectation.
 */
export async function loadOrganizationBranding(
  client: SupabaseLike,
  organizationId: string,
): Promise<OrganizationBranding> {
  const { data, error } = (await client
    .from('organizations')
    .select('id, name, assistant_name')
    .eq('id', organizationId)
    .maybeSingle()) as QueryBuilderResult<OrganizationBrandingRow>;

  if (error) {
    throw new Error(`organization branding load failed: ${error.message}`);
  }
  if (!data) {
    throw new Error(`organization not found: ${organizationId}`);
  }

  return {
    name: data.name,
    assistantName:
      data.assistant_name && data.assistant_name.trim().length > 0
        ? data.assistant_name
        : DEFAULT_ASSISTANT_NAME,
  };
}

async function loadLatestRentStatusByLease(
  client: SupabaseLike,
  leaseIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  if (leaseIds.length === 0) return new Map();

  // Pull recent rent_events for these leases ordered newest-first.
  // We fetch up to 4× lease count so we cover a few months of history
  // and can pick the latest per lease in TS without a window function.
  // rent_status is informational (not safety-load-bearing for the
  // prompt), so a query error here returns an empty map and the
  // tenant rows surface with rentStatus=null rather than aborting
  // the whole context load.
  const cap = leaseIds.length * 4;
  const { data, error } = (await client
    .from('rent_events')
    .select('lease_id, status, cycle_month')
    .in('lease_id', leaseIds)
    .order('cycle_month', { ascending: false })
    .limit(cap)) as QueryBuilderResult<RentEventLatestRow[]>;

  if (error || !data) return new Map();

  // If we filled the cap exactly, a lease's actual latest rent_event
  // could be sitting just past the window. Galaxy is ~130 properties
  // × 1-3 leases each so this is extremely unlikely; warn so we can
  // raise the multiplier if it ever fires in production.
  if (data.length >= cap) {
    console.warn(
      `[context-loader] rent_events cap reached: leaseIds=${leaseIds.length} rows=${data.length} cap=${cap}`,
    );
  }

  const out = new Map<string, string>();
  for (const ev of data) {
    if (!out.has(ev.lease_id)) {
      out.set(ev.lease_id, ev.status);
    }
  }
  return out;
}
