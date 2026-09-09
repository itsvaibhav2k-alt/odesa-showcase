/**
 * Weekly briefing metrics calculator.
 *
 * Pulls occupancy, rent collection, work order flow, late tenants,
 * expiring leases, and below-market flags for a single organization.
 * Each field feeds the template generator (`generate.ts`).
 *
 * Scoping: callers pass the organization_id explicitly because this runs
 * from the Inngest cron (no user JWT, service-role client bypasses RLS).
 * The per-org loop lives in the cron handler, not here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type {
  BelowMarketFlag,
  BriefingMetrics,
  ExpiringLease,
} from './types';
import { findBelowMarketFlags } from './below-market';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXPIRING_WINDOW_DAYS = 60;

export interface ComputeMetricsArgs {
  db: SupabaseClient<Database>;
  organizationId: string;
  weekStartDate: string; // ISO YYYY-MM-DD (Monday)
  now?: Date;
}

export async function computeBriefingMetrics({
  db,
  organizationId,
  weekStartDate,
  now = new Date(),
}: ComputeMetricsArgs): Promise<BriefingMetrics> {
  const weekEnd = addDays(weekStartDate, 7);

  const [unitsRes, leasesRes, rentEventsRes, woOpenedRes, woClosedRes, woStillOpenRes] =
    await Promise.all([
      db
        .from('units')
        .select('id, lease_status:leases(status)')
        .eq('organization_id', organizationId),
      db
        .from('leases')
        .select('id, rent_amount, end_date, tenant_id, unit_id, status')
        .eq('organization_id', organizationId)
        .eq('status', 'active'),
      db
        .from('rent_events')
        .select('status, amount_due, amount_paid, due_date, lease_id')
        .eq('organization_id', organizationId)
        .gte('due_date', weekStartDate)
        .lt('due_date', weekEnd),
      db
        .from('work_orders')
        .select('id')
        .eq('organization_id', organizationId)
        .gte('created_at', weekStartDate)
        .lt('created_at', weekEnd),
      db
        .from('work_orders')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('status', 'completed')
        .gte('updated_at', weekStartDate)
        .lt('updated_at', weekEnd),
      db
        .from('work_orders')
        .select('id')
        .eq('organization_id', organizationId)
        .in('status', ['open', 'assigned', 'in_progress']),
    ]);

  const unitsTotal = unitsRes.data?.length ?? 0;
  const activeLeases = leasesRes.data ?? [];
  const unitsOccupied = new Set(activeLeases.map((l) => l.unit_id)).size;
  const occupancyPct = unitsTotal > 0 ? Math.round((unitsOccupied / unitsTotal) * 100) : 0;

  const rentDueDollars =
    rentEventsRes.data?.reduce((sum, e) => sum + Number(e.amount_due ?? 0), 0) ?? 0;
  const rentCollectedDollars =
    rentEventsRes.data?.reduce((sum, e) => sum + Number(e.amount_paid ?? 0), 0) ?? 0;
  const rentCollectedPct =
    rentDueDollars > 0 ? Math.round((rentCollectedDollars / rentDueDollars) * 100) : 0;

  const lateTenantsCount =
    rentEventsRes.data?.filter((e) =>
      ['late_1', 'late_3', 'late_7', 'escalated'].includes(e.status),
    ).length ?? 0;

  const expiringLeases = await collectExpiringLeases({
    db,
    activeLeases,
    now,
  });

  const belowMarketUnits = await findBelowMarketFlags({
    db,
    organizationId,
    activeLeases,
  });

  return {
    weekStartDate,
    occupancyPct,
    unitsOccupied,
    unitsTotal,
    rentCollectedDollars: round2(rentCollectedDollars),
    rentDueDollars: round2(rentDueDollars),
    rentCollectedPct,
    workOrdersOpenedCount: woOpenedRes.data?.length ?? 0,
    workOrdersClosedCount: woClosedRes.data?.length ?? 0,
    workOrdersOpenCount: woStillOpenRes.data?.length ?? 0,
    lateTenantsCount,
    expiringLeasesCount: expiringLeases.length,
    expiringLeases,
    belowMarketUnits,
  };
}

interface ActiveLease {
  id: string;
  rent_amount: number;
  end_date: string | null;
  tenant_id: string;
  unit_id: string;
}

async function collectExpiringLeases({
  db,
  activeLeases,
  now,
}: {
  db: SupabaseClient<Database>;
  activeLeases: ActiveLease[];
  now: Date;
}): Promise<ExpiringLease[]> {
  const windowEnd = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * MS_PER_DAY);
  const expiring = activeLeases.filter(
    (l) => l.end_date && new Date(l.end_date) <= windowEnd && new Date(l.end_date) >= now,
  );
  if (expiring.length === 0) return [];

  const tenantIds = Array.from(new Set(expiring.map((l) => l.tenant_id)));
  const unitIds = Array.from(new Set(expiring.map((l) => l.unit_id)));
  const [{ data: tenants }, { data: units }] = await Promise.all([
    db.from('tenants').select('id, full_name').in('id', tenantIds),
    db.from('units').select('id, label').in('id', unitIds),
  ]);
  const tenantById = new Map((tenants ?? []).map((t) => [t.id, t.full_name]));
  const unitLabelById = new Map((units ?? []).map((u) => [u.id, u.label]));

  return expiring
    .map((l) => ({
      leaseId: l.id,
      tenantName: tenantById.get(l.tenant_id) ?? 'Unknown tenant',
      unitLabel: unitLabelById.get(l.unit_id) ?? null,
      endDate: l.end_date!,
      rentAmount: Number(l.rent_amount),
    }))
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Re-export for tests.
export type { BelowMarketFlag };
