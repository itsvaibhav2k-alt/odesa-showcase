/**
 * Galaxy Estates data pull — Aero legacy backend → Odesa Supabase.
 *
 * Two modes, selected via `AERO_SOURCE`:
 *   - `mock` (default): reads a fixture JSON from disk.
 *   - `real`: reads directly from the Aero Postgres DB (raw SQL, no
 *             Prisma). Left as a TODO until credentials land.
 *
 * The mapper is intentionally permissive: Aero fields that don't exist
 * in Odesa's 12-table schema are dropped silently with a debug log, and
 * orphan leases (no matching tenant or unit) are skipped rather than
 * failing the run. Running twice is idempotent — everything upserts on
 * `source_aero_id` unique constraints added in migration
 * 20260422000001_aero_source_ids.sql.
 *
 * Phase-3 scaffold only. Not wired into Inngest or any UI yet.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '../src/lib/supabase/admin';
import type {
  Database,
  LeaseStatus,
  WorkOrderCategory,
  WorkOrderStatus,
  WorkOrderUrgency,
} from '../src/types/database';

// ---------------------------------------------------------------------------
// Aero shapes (hand-written; do NOT import from Prisma)
// ---------------------------------------------------------------------------

export interface AeroOrganization {
  id: string;
  name: string;
  createdAt?: string;
}

export interface AeroProperty {
  id: string;
  orgId: string;
  name?: string | null;
  address: string;
  status?: string;
  type?: string | null;
  rent?: number | null;
  rentDay?: number;
  startMonth?: number;
  unitCount?: number | null;
  image?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AeroUnit {
  id: string;
  propertyId: string;
  label: string;
}

export interface AeroTenant {
  id: string;
  propertyId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AeroLease {
  id: string;
  propertyId: string;
  tenantId: string;
  unitLabel: string;
  startDate: string;
  endDate: string;
  rentAmount: number;
  status: string;
}

export interface AeroWorkOrder {
  id: string;
  orgId: string;
  propertyId: string;
  unitLabel: string;
  tenantId?: string | null;
  title: string;
  status: string;
  priority: string;
  category: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AeroDump {
  organizations: AeroOrganization[];
  properties: AeroProperty[];
  units: AeroUnit[];
  tenants: AeroTenant[];
  leases: AeroLease[];
  workOrders: AeroWorkOrder[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type AeroSourceMode = 'mock' | 'real';

export interface MigrateOptions {
  /** Mode selector. Defaults to env `AERO_SOURCE` or `'mock'`. */
  source?: AeroSourceMode;
  /**
   * Absolute path to the mock fixture JSON. Required when `source = 'mock'`.
   * Defaults to the Playwright fixture at `e2e/fixtures/aero-mock-dump.json`.
   */
  mockFixturePath?: string;
  /**
   * Supabase admin client override. Callers (e.g. Playwright specs) that
   * need to point at a disposable org/client pass their own. Defaults to
   * `createAdminClient()`, which reads env.
   */
  client?: SupabaseClient<Database>;
  /**
   * Odesa organization_id to migrate into. Required. The migrator does
   * NOT create orgs — the caller must create/seed the target org
   * beforehand (see e2e/migration/galaxy-pull.spec.ts for the pattern).
   */
  organizationId: string;
  /** Optional logger override; defaults to console-backed logger. */
  logger?: Logger;
}

export interface MigrationCounts {
  properties: number;
  units: number;
  tenants: number;
  leases: number;
  workOrders: number;
  skipped: {
    orphanLeases: number;
    orphanWorkOrders: number;
    duplicateTenants: number;
  };
}

export interface Logger {
  info: (msg: string, meta?: unknown) => void;
  warn: (msg: string, meta?: unknown) => void;
  debug: (msg: string, meta?: unknown) => void;
}

const defaultLogger: Logger = {
  info: (msg, meta) => console.log(`[migrate-galaxy] ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[migrate-galaxy] ${msg}`, meta ?? ''),
  debug: (msg, meta) => {
    if (process.env.DEBUG_MIGRATE === '1') {
      console.debug(`[migrate-galaxy] ${msg}`, meta ?? '');
    }
  },
};

// ---------------------------------------------------------------------------
// Field mappers
// ---------------------------------------------------------------------------

/**
 * Splits Aero's single-line address into Odesa's four-column shape.
 * Best-effort parser: falls back to storing the whole string in street
 * when it can't find a comma-separated city/state-zip.
 */
export function splitAddress(addr: string | null | undefined): {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
} {
  if (!addr) return { street: null, city: null, state: null, zip: null };
  const parts = addr.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { street: addr, city: null, state: null, zip: null };
  }
  const street = parts[0] ?? null;
  const city = parts[1] ?? null;
  const rest = parts.slice(2).join(' ').trim();
  const match = rest.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (match) {
    return { street, city, state: match[1] ?? null, zip: match[2] ?? null };
  }
  return { street, city, state: rest || null, zip: null };
}

const WORK_ORDER_CATEGORIES: ReadonlySet<WorkOrderCategory> = new Set([
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
]);

/** Normalises free-text Aero category to the Odesa enum; unknown -> `other`. */
export function mapWorkOrderCategory(raw: string): WorkOrderCategory {
  const lower = raw.toLowerCase().trim();
  if ((WORK_ORDER_CATEGORIES as Set<string>).has(lower)) {
    return lower as WorkOrderCategory;
  }
  return 'other';
}

/**
 * Aero's free-text priority maps loosely to Odesa's urgency enum.
 *   emergency, urgent, high, normal, routine, low
 */
export function mapWorkOrderUrgency(raw: string): WorkOrderUrgency {
  const lower = raw.toLowerCase().trim();
  if (lower === 'emergency') return 'emergency';
  if (lower === 'urgent' || lower === 'high') return 'urgent';
  return 'routine';
}

/**
 * Aero status strings (Open, Assigned, InProgress, Completed, Cancelled)
 * -> Odesa enum.
 */
export function mapWorkOrderStatus(raw: string): WorkOrderStatus {
  const norm = raw.toLowerCase().trim().replace(/[_\s-]+/g, '');
  if (norm === 'assigned') return 'assigned';
  if (norm === 'inprogress') return 'in_progress';
  if (norm === 'completed' || norm === 'done') return 'completed';
  if (norm === 'cancelled' || norm === 'canceled') return 'cancelled';
  return 'open';
}

/** Aero status strings (active, pending, expired, terminated) -> Odesa enum. */
export function mapLeaseStatus(raw: string): LeaseStatus {
  const lower = raw.toLowerCase().trim();
  if (lower === 'pending') return 'pending';
  if (lower === 'expired') return 'expired';
  if (lower === 'terminated' || lower === 'cancelled') return 'terminated';
  return 'active';
}

// ---------------------------------------------------------------------------
// Dedup helpers
// ---------------------------------------------------------------------------

/**
 * Dedupes tenants within an organization by phone_e164. When multiple
 * tenants share a phone, keeps the one with the latest `updatedAt`
 * (falling back to `createdAt`). Returns the kept tenants plus the ids
 * of the tenants that were dropped, so downstream leases/work orders
 * can rewrite their tenant_id references onto the surviving row.
 */
export function dedupeTenantsByPhone(
  tenants: readonly AeroTenant[],
): {
  kept: AeroTenant[];
  redirects: Map<string, string>;
  duplicateCount: number;
} {
  const byPhone = new Map<string, AeroTenant[]>();
  const noPhone: AeroTenant[] = [];
  for (const t of tenants) {
    if (!t.phone) {
      noPhone.push(t);
      continue;
    }
    const bucket = byPhone.get(t.phone) ?? [];
    bucket.push(t);
    byPhone.set(t.phone, bucket);
  }

  const kept: AeroTenant[] = [...noPhone];
  const redirects = new Map<string, string>();
  let duplicateCount = 0;

  for (const [, group] of byPhone) {
    if (group.length === 1) {
      const winner = group[0];
      if (winner) kept.push(winner);
      continue;
    }
    const sorted = [...group].sort((a, b) => {
      const aStamp = a.updatedAt ?? a.createdAt ?? '';
      const bStamp = b.updatedAt ?? b.createdAt ?? '';
      return bStamp.localeCompare(aStamp);
    });
    const winner = sorted[0];
    if (!winner) continue;
    kept.push(winner);
    for (const loser of sorted.slice(1)) {
      redirects.set(loser.id, winner.id);
      duplicateCount += 1;
    }
  }

  return { kept, redirects, duplicateCount };
}

// ---------------------------------------------------------------------------
// Source loaders
// ---------------------------------------------------------------------------

export function loadMockDump(fixturePath: string): AeroDump {
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<AeroDump>;
  return {
    organizations: parsed.organizations ?? [],
    properties: parsed.properties ?? [],
    units: parsed.units ?? [],
    tenants: parsed.tenants ?? [],
    leases: parsed.leases ?? [],
    workOrders: parsed.workOrders ?? [],
  };
}

// ---------------------------------------------------------------------------
// Main migrator
// ---------------------------------------------------------------------------

/**
 * Runs the Galaxy migration against the configured Supabase client.
 * Returns counts for smoke-testing in Playwright specs.
 */
export async function runGalaxyMigration(
  opts: MigrateOptions,
): Promise<MigrationCounts> {
  const source = opts.source ?? ((process.env.AERO_SOURCE as AeroSourceMode | undefined) ?? 'mock');
  const logger = opts.logger ?? defaultLogger;
  const client = opts.client ?? createAdminClient();
  const organizationId = opts.organizationId;

  if (!organizationId) {
    throw new Error('runGalaxyMigration: organizationId is required');
  }

  logger.info(`Starting Galaxy migration (source=${source}, org=${organizationId})`);

  const dump = await loadDump(source, opts, logger);

  const counts: MigrationCounts = {
    properties: 0,
    units: 0,
    tenants: 0,
    leases: 0,
    workOrders: 0,
    skipped: {
      orphanLeases: 0,
      orphanWorkOrders: 0,
      duplicateTenants: 0,
    },
  };

  // Properties
  const propRows = dump.properties.map((p) => {
    const addr = splitAddress(p.address);
    return {
      organization_id: organizationId,
      name: p.name ?? p.address ?? 'Untitled property',
      address_street: addr.street,
      address_city: addr.city,
      address_state: addr.state,
      address_zip: addr.zip,
      source_aero_id: p.id,
    };
  });
  if (propRows.length > 0) {
    const { error } = await client
      .from('properties')
      .upsert(propRows, { onConflict: 'organization_id,source_aero_id' });
    if (error) throw new Error(`property upsert failed: ${error.message}`);
    counts.properties = propRows.length;
  }

  // Look up property ids we just wrote so we can join unit/lease/WO rows.
  const { data: dbProps, error: propFetchErr } = await client
    .from('properties')
    .select('id, source_aero_id')
    .eq('organization_id', organizationId)
    .in(
      'source_aero_id',
      dump.properties.map((p) => p.id),
    );
  if (propFetchErr) throw new Error(`property fetch failed: ${propFetchErr.message}`);

  const propIdByAero = new Map<string, string>();
  for (const row of dbProps ?? []) {
    if (row.source_aero_id) propIdByAero.set(row.source_aero_id, row.id);
  }

  // Units
  const unitRows = dump.units
    .map((u) => {
      const odesaPropId = propIdByAero.get(u.propertyId);
      if (!odesaPropId) {
        logger.debug(`Unit ${u.id} references unknown property ${u.propertyId}; skipping`);
        return null;
      }
      return {
        organization_id: organizationId,
        property_id: odesaPropId,
        label: u.label,
        source_aero_id: u.id,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (unitRows.length > 0) {
    const { error } = await client
      .from('units')
      .upsert(unitRows, { onConflict: 'organization_id,source_aero_id' });
    if (error) throw new Error(`unit upsert failed: ${error.message}`);
    counts.units = unitRows.length;
  }

  const { data: dbUnits, error: unitFetchErr } = await client
    .from('units')
    .select('id, source_aero_id, property_id, label')
    .eq('organization_id', organizationId)
    .in(
      'source_aero_id',
      dump.units.map((u) => u.id),
    );
  if (unitFetchErr) throw new Error(`unit fetch failed: ${unitFetchErr.message}`);

  const unitIdByAero = new Map<string, string>();
  const unitIdByPropAndLabel = new Map<string, string>();
  for (const row of dbUnits ?? []) {
    if (row.source_aero_id) unitIdByAero.set(row.source_aero_id, row.id);
    unitIdByPropAndLabel.set(`${row.property_id}|${row.label}`, row.id);
  }

  // Tenants — dedupe by phone first, then upsert.
  const { kept: keptTenants, redirects, duplicateCount } = dedupeTenantsByPhone(
    dump.tenants,
  );
  counts.skipped.duplicateTenants = duplicateCount;
  if (duplicateCount > 0) {
    logger.info(
      `Deduped ${duplicateCount} tenant duplicate(s) by (org, phone_e164)`,
    );
  }

  const tenantRows = keptTenants
    .filter((t) => {
      if (!t.phone) {
        logger.debug(`Tenant ${t.id} has no phone; skipping (phone_e164 is NOT NULL)`);
        return false;
      }
      return true;
    })
    .map((t) => ({
      organization_id: organizationId,
      full_name: t.name,
      phone_e164: t.phone as string,
      email: t.email ?? null,
      source_aero_id: t.id,
    }));

  if (tenantRows.length > 0) {
    const { error } = await client
      .from('tenants')
      .upsert(tenantRows, { onConflict: 'organization_id,source_aero_id' });
    if (error) throw new Error(`tenant upsert failed: ${error.message}`);
    counts.tenants = tenantRows.length;
  }

  const { data: dbTenants, error: tenantFetchErr } = await client
    .from('tenants')
    .select('id, source_aero_id')
    .eq('organization_id', organizationId)
    .in(
      'source_aero_id',
      tenantRows.map((t) => t.source_aero_id as string),
    );
  if (tenantFetchErr) throw new Error(`tenant fetch failed: ${tenantFetchErr.message}`);

  const tenantIdByAero = new Map<string, string>();
  for (const row of dbTenants ?? []) {
    if (row.source_aero_id) tenantIdByAero.set(row.source_aero_id, row.id);
  }

  // Leases
  const leaseRows = dump.leases
    .map((l) => {
      const odesaPropId = propIdByAero.get(l.propertyId);
      if (!odesaPropId) {
        logger.warn(`Orphan lease ${l.id}: unknown propertyId ${l.propertyId}; skipping`);
        counts.skipped.orphanLeases += 1;
        return null;
      }
      const unitId = unitIdByPropAndLabel.get(`${odesaPropId}|${l.unitLabel}`);
      if (!unitId) {
        logger.warn(
          `Orphan lease ${l.id}: no unit label ${l.unitLabel} under property ${l.propertyId}; skipping`,
        );
        counts.skipped.orphanLeases += 1;
        return null;
      }
      const canonicalTenantId = redirects.get(l.tenantId) ?? l.tenantId;
      const tenantId = tenantIdByAero.get(canonicalTenantId);
      if (!tenantId) {
        logger.warn(
          `Orphan lease ${l.id}: tenant ${l.tenantId} not in Odesa; skipping`,
        );
        counts.skipped.orphanLeases += 1;
        return null;
      }
      return {
        organization_id: organizationId,
        unit_id: unitId,
        tenant_id: tenantId,
        rent_amount: l.rentAmount,
        rent_due_day: 1,
        start_date: l.startDate ? l.startDate.slice(0, 10) : null,
        end_date: l.endDate ? l.endDate.slice(0, 10) : null,
        status: mapLeaseStatus(l.status),
        source_aero_id: l.id,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (leaseRows.length > 0) {
    const { error } = await client
      .from('leases')
      .upsert(leaseRows, { onConflict: 'organization_id,source_aero_id' });
    if (error) throw new Error(`lease upsert failed: ${error.message}`);
    counts.leases = leaseRows.length;
  }

  // Work orders
  const woRows = dump.workOrders
    .map((w) => {
      const odesaPropId = propIdByAero.get(w.propertyId);
      if (!odesaPropId) {
        logger.warn(`Orphan WO ${w.id}: unknown propertyId ${w.propertyId}; skipping`);
        counts.skipped.orphanWorkOrders += 1;
        return null;
      }
      const unitId = unitIdByPropAndLabel.get(`${odesaPropId}|${w.unitLabel}`);
      if (!unitId) {
        logger.warn(
          `Orphan WO ${w.id}: no unit label ${w.unitLabel} under property ${w.propertyId}; skipping`,
        );
        counts.skipped.orphanWorkOrders += 1;
        return null;
      }
      const canonicalTenantId = w.tenantId
        ? redirects.get(w.tenantId) ?? w.tenantId
        : null;
      const tenantId = canonicalTenantId
        ? tenantIdByAero.get(canonicalTenantId) ?? null
        : null;
      return {
        organization_id: organizationId,
        unit_id: unitId,
        tenant_id: tenantId,
        category: mapWorkOrderCategory(w.category),
        urgency: mapWorkOrderUrgency(w.priority),
        status: mapWorkOrderStatus(w.status),
        description: w.title,
        source_aero_id: w.id,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (woRows.length > 0) {
    const { error } = await client
      .from('work_orders')
      .upsert(woRows, { onConflict: 'organization_id,source_aero_id' });
    if (error) throw new Error(`work order upsert failed: ${error.message}`);
    counts.workOrders = woRows.length;
  }

  logger.info('Galaxy migration complete', counts);
  return counts;
}

async function loadDump(
  source: AeroSourceMode,
  opts: MigrateOptions,
  logger: Logger,
): Promise<AeroDump> {
  if (source === 'mock') {
    const fixturePath = opts.mockFixturePath
      ?? path.resolve(process.cwd(), 'e2e/fixtures/aero-mock-dump.json');
    logger.info(`Loading mock dump from ${fixturePath}`);
    return loadMockDump(fixturePath);
  }

  // Real-mode stub. Wire this up once Aero creds land.
  throw new Error(
    'AERO_SOURCE=real is not implemented yet. Provide AERO_DATABASE_URL and replace this stub with raw SQL reads.',
  );
}
