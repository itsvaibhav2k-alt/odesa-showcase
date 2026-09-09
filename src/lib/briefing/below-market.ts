/**
 * Below-market rent flagger.
 *
 * v1 uses a static address_zip → median rent bootstrap (hard-coded below).
 * Phase 8 upgrades to Apartment List / HUD FMR data. A unit is flagged
 * when current rent is ≥ 5% below the median for its address_zip.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { BelowMarketFlag } from './types';

const BELOW_MARKET_THRESHOLD_PCT = 5;

const ZIPCODE_MEDIAN_RENT: Record<string, number> = {
  // DMV bootstrap set — Galaxy Estates' footprint. Extend as we go.
  '20001': 2400,
  '20002': 2250,
  '20003': 2500,
  '20004': 2650,
  '20005': 2800,
  '22101': 2700,
  '22102': 2800,
  '22201': 2600,
  '22202': 2500,
  '22203': 2400,
  '22204': 2300,
  '22205': 2450,
  '22206': 2350,
  '22207': 2550,
  '22209': 2750,
  // Fallback buckets — used only when a specific zip is missing.
  '__default__': 2500,
};

export function medianRentForZip(address_zip: string | null | undefined): number {
  if (!address_zip) return ZIPCODE_MEDIAN_RENT['__default__'];
  return ZIPCODE_MEDIAN_RENT[address_zip] ?? ZIPCODE_MEDIAN_RENT['__default__'];
}

interface ActiveLease {
  id: string;
  rent_amount: number;
  tenant_id: string;
  unit_id: string;
}

export async function findBelowMarketFlags({
  db,
  organizationId,
  activeLeases,
}: {
  db: SupabaseClient<Database>;
  organizationId: string;
  activeLeases: ActiveLease[];
}): Promise<BelowMarketFlag[]> {
  if (activeLeases.length === 0) return [];

  const unitIds = Array.from(new Set(activeLeases.map((l) => l.unit_id)));
  const tenantIds = Array.from(new Set(activeLeases.map((l) => l.tenant_id)));

  const [{ data: units }, { data: tenants }, { data: properties }] = await Promise.all([
    db.from('units').select('id, label, property_id').in('id', unitIds),
    db.from('tenants').select('id, full_name').in('id', tenantIds),
    db
      .from('properties')
      .select('id, address_zip')
      .eq('organization_id', organizationId),
  ]);

  const propertyZipById = new Map(
    (properties ?? []).map((p) => [p.id, p.address_zip ?? null]),
  );
  const unitById = new Map((units ?? []).map((u) => [u.id, u]));
  const tenantById = new Map((tenants ?? []).map((t) => [t.id, t.full_name]));

  const flags: BelowMarketFlag[] = [];
  for (const lease of activeLeases) {
    const unit = unitById.get(lease.unit_id);
    if (!unit) continue;
    const zip = propertyZipById.get(unit.property_id) ?? null;
    const median = medianRentForZip(zip);
    const current = Number(lease.rent_amount);
    const delta = median - current;
    if (delta > 0 && delta / median >= BELOW_MARKET_THRESHOLD_PCT / 100) {
      flags.push({
        leaseId: lease.id,
        tenantName: tenantById.get(lease.tenant_id) ?? 'Unknown tenant',
        unitLabel: unit.label ?? null,
        currentRent: current,
        medianRent: median,
        deltaDollars: Math.round(delta),
      });
    }
  }

  flags.sort((a, b) => b.deltaDollars - a.deltaDollars);
  return flags;
}
