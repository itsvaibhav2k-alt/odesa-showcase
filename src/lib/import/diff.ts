/**
 * Plan diff — annotate an `ImportPlan` against current DB state.
 *
 * For each draft in the plan, query the matching natural key on the
 * org and tag the item:
 *   - existingId set + `will_skip` if a row matches.
 *   - `will_insert` otherwise.
 *
 * The importer's policy is "CSV is the source of truth on insert only."
 * Existing rows are never overwritten by a re-import — they're tagged
 * `will_skip` so re-running commit on the same CSV is a no-op.
 *
 * Natural keys (per Stream C spec):
 *   properties: (org, lower(name), lower(address_street))
 *   units:      (org, property_id, lower(label))
 *   tenants:    (org, phone_e164) → fallback (org, lower(email))
 *   leases:     (org, unit_id, tenant_id, start_date)
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import type { ImportItem, ImportPlan } from './types';

type Admin = SupabaseClient<Database>;

interface DiffContext {
  admin: Admin;
  organizationId: string;
}

/**
 * Look up an existing property by (org, lower(name), lower(street)).
 * Returns the row id if found, null otherwise.
 */
async function findPropertyId(
  ctx: DiffContext,
  name: string,
  street: string | null,
): Promise<string | null> {
  let query = ctx.admin
    .from('properties')
    .select('id')
    .eq('organization_id', ctx.organizationId)
    .ilike('name', name);
  if (street) query = query.ilike('address_street', street);

  const { data } = await query.limit(1).maybeSingle();
  return data?.id ?? null;
}

async function findUnitId(
  ctx: DiffContext,
  propertyId: string,
  label: string,
): Promise<string | null> {
  const { data } = await ctx.admin
    .from('units')
    .select('id')
    .eq('organization_id', ctx.organizationId)
    .eq('property_id', propertyId)
    .ilike('label', label)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function findTenantId(
  ctx: DiffContext,
  phoneE164: string,
  email: string | null,
): Promise<string | null> {
  const { data: byPhone } = await ctx.admin
    .from('tenants')
    .select('id')
    .eq('organization_id', ctx.organizationId)
    .eq('phone_e164', phoneE164)
    .limit(1)
    .maybeSingle();
  if (byPhone?.id) return byPhone.id;

  if (email) {
    const { data: byEmail } = await ctx.admin
      .from('tenants')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .ilike('email', email)
      .limit(1)
      .maybeSingle();
    if (byEmail?.id) return byEmail.id;
  }
  return null;
}

async function findLeaseId(
  ctx: DiffContext,
  unitId: string,
  tenantId: string,
  startDate: string | null,
): Promise<string | null> {
  let query = ctx.admin
    .from('leases')
    .select('id')
    .eq('organization_id', ctx.organizationId)
    .eq('unit_id', unitId)
    .eq('tenant_id', tenantId);
  if (startDate) query = query.eq('start_date', startDate);
  else query = query.is('start_date', null);

  const { data } = await query.limit(1).maybeSingle();
  return data?.id ?? null;
}

export interface AnnotatedPlan extends ImportPlan {
  /** Lookup table: PropertyDraft naturalKey → existing DB id (if any). */
  propertyIdByKey: Map<string, string>;
  unitIdByKey: Map<string, string>;
  tenantIdByKey: Map<string, string>;
}

/**
 * Annotate a plan against the DB.  Returns a new plan with each item
 * tagged + a lookup map keyed by mapper-natural-key → db-id (used by
 * downstream layers like the unit dedup, which needs the property id
 * even when the property already exists).
 */
export async function annotatePlan(
  admin: Admin,
  organizationId: string,
  plan: ImportPlan,
): Promise<AnnotatedPlan> {
  const ctx: DiffContext = { admin, organizationId };

  const propertyIdByKey = new Map<string, string>();
  const properties: ImportItem<ImportPlan['properties'][number]['data']>[] = [];
  for (const item of plan.properties) {
    const existingId = await findPropertyId(
      ctx,
      item.data.name,
      item.data.addressStreet,
    );
    const annotated: ImportItem<typeof item.data> = existingId
      ? { ...item, existingId, action: 'will_skip' }
      : { ...item, action: 'will_insert' };
    properties.push(annotated);
    if (existingId) propertyIdByKey.set(item.naturalKey, existingId);
  }

  // For unit dedup we need the property id — pass through the lookup
  // map for already-existing properties; new properties get their id
  // assigned at commit time (so units of new properties always resolve
  // to will_insert during preview).
  const unitIdByKey = new Map<string, string>();
  const units: ImportItem<ImportPlan['units'][number]['data']>[] = [];
  for (const item of plan.units) {
    const propKey = item.naturalKey.split('::').slice(0, 2).join('::');
    const propertyId = propertyIdByKey.get(propKey);
    if (!propertyId) {
      units.push({ ...item, action: 'will_insert' });
      continue;
    }
    const existingId = await findUnitId(ctx, propertyId, item.data.label);
    const annotated: ImportItem<typeof item.data> = existingId
      ? { ...item, existingId, action: 'will_skip' }
      : { ...item, action: 'will_insert' };
    units.push(annotated);
    if (existingId) unitIdByKey.set(item.naturalKey, existingId);
  }

  const tenantIdByKey = new Map<string, string>();
  const tenants: ImportItem<ImportPlan['tenants'][number]['data']>[] = [];
  for (const item of plan.tenants) {
    const existingId = await findTenantId(
      ctx,
      item.data.phoneE164,
      item.data.email,
    );
    const annotated: ImportItem<typeof item.data> = existingId
      ? { ...item, existingId, action: 'will_skip' }
      : { ...item, action: 'will_insert' };
    tenants.push(annotated);
    if (existingId) tenantIdByKey.set(item.naturalKey, existingId);
  }

  const leases: ImportItem<ImportPlan['leases'][number]['data']>[] = [];
  for (const item of plan.leases) {
    // Lease natural-key shape: "<propKey>::<unitSlug>::<tenantKey>::<date>"
    // (see generic.ts/appfolio.ts).  We split it back out to find the
    // unit + tenant lookup keys.
    const segments = item.naturalKey.split('::');
    const unitKey = segments.slice(0, 3).join('::');
    const tenantKey = segments.slice(3, segments.length - 1).join('::');
    const unitId = unitIdByKey.get(unitKey);
    const tenantId = tenantIdByKey.get(tenantKey);

    if (!unitId || !tenantId) {
      leases.push({ ...item, action: 'will_insert' });
      continue;
    }
    const existingId = await findLeaseId(
      ctx,
      unitId,
      tenantId,
      item.data.startDate,
    );
    const annotated: ImportItem<typeof item.data> = existingId
      ? { ...item, existingId, action: 'will_skip' }
      : { ...item, action: 'will_insert' };
    leases.push(annotated);
  }

  return {
    properties,
    units,
    tenants,
    leases,
    propertyIdByKey,
    unitIdByKey,
    tenantIdByKey,
  };
}

/**
 * Compute a count summary for the preview view.
 */
export interface PlanSummary {
  willInsert: number;
  willSkip: number;
  willUpdate: number;
}

export function summarize(items: ImportItem<unknown>[]): PlanSummary {
  let willInsert = 0;
  let willSkip = 0;
  let willUpdate = 0;
  for (const item of items) {
    if (item.action === 'will_insert') willInsert += 1;
    else if (item.action === 'will_skip') willSkip += 1;
    else willUpdate += 1;
  }
  return { willInsert, willSkip, willUpdate };
}
