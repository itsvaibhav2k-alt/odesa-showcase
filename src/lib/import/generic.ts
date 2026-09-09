/**
 * Generic CSV mapper — the "I hand-built my spreadsheet" path.
 *
 * Required columns (case-insensitive, header order doesn't matter):
 *   - property_name
 *   - property_address
 *   - unit_label
 *   - tenant_first_name
 *   - tenant_last_name
 *   - tenant_phone
 *   - lease_rent
 *   - lease_start
 *   - lease_due_day
 *
 * Optional columns:
 *   - tenant_email, tenant_dob, lease_end, bedrooms, bathrooms,
 *     lease_status (defaults to 'active')
 *
 * Each CSV row produces (at most) one of each of: property, unit,
 * tenant, lease.  Dedup by natural key happens within the mapper too,
 * so multiple rows with the same property roll up into a single
 * PropertyDraft.
 */

import {
  normalizePhoneE164,
  parseAddress,
  parseCurrencyToCents,
  parseDate,
  parseFloatOrNull,
  parseIntOrNull,
  pickColumn,
  slugify,
} from './common';
import type {
  ImportItem,
  ImportPlan,
  LeaseDraft,
  MapperResult,
  PropertyDraft,
  TenantDraft,
  UnitDraft,
} from './types';
import { normalizeLeaseStatus } from './lease-status';

const REQUIRED_COLUMNS = [
  'property_name',
  'property_address',
  'unit_label',
  'tenant_first_name',
  'tenant_last_name',
  'tenant_phone',
  'lease_rent',
  'lease_start',
  'lease_due_day',
] as const;

function detectMissingColumns(rows: ReadonlyArray<Record<string, string>>): string[] {
  if (rows.length === 0) return [...REQUIRED_COLUMNS];

  const headers = new Set(
    Object.keys(rows[0]).map((k) => k.trim().toLowerCase()),
  );
  return REQUIRED_COLUMNS.filter((c) => !headers.has(c));
}

export function mapGenericCsv(
  rows: ReadonlyArray<Record<string, string>>,
): MapperResult {
  const missing = detectMissingColumns(rows);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required columns: ${missing.join(', ')}`,
    };
  }

  const properties = new Map<string, ImportItem<PropertyDraft>>();
  const units = new Map<string, ImportItem<UnitDraft>>();
  const tenants = new Map<string, ImportItem<TenantDraft>>();
  const leases = new Map<string, ImportItem<LeaseDraft>>();
  const warnings: string[] = [];

  rows.forEach((row, idx) => {
    const propertyName = pickColumn(row, ['property_name']);
    const propertyAddress = pickColumn(row, ['property_address']);
    const unitLabel = pickColumn(row, ['unit_label']);
    const tenantFirst = pickColumn(row, ['tenant_first_name']);
    const tenantLast = pickColumn(row, ['tenant_last_name']);
    const tenantPhoneRaw = pickColumn(row, ['tenant_phone']);
    const leaseRent = pickColumn(row, ['lease_rent']);
    const leaseStart = pickColumn(row, ['lease_start']);
    const leaseDueDay = pickColumn(row, ['lease_due_day']);

    if (!propertyName || !unitLabel) {
      warnings.push(`Row ${idx + 2}: missing property_name or unit_label, skipped`);
      return;
    }

    const phone = normalizePhoneE164(tenantPhoneRaw);
    if (tenantPhoneRaw && !phone) {
      warnings.push(`Row ${idx + 2}: phone "${tenantPhoneRaw}" couldn't be normalized to E.164, row skipped`);
      return;
    }
    if (!phone) {
      warnings.push(`Row ${idx + 2}: missing tenant_phone, row skipped`);
      return;
    }

    const addr = parseAddress(propertyAddress);
    const propertyKey = `${slugify(propertyName)}::${slugify(addr?.street ?? '')}`;
    if (!properties.has(propertyKey)) {
      properties.set(propertyKey, {
        naturalKey: propertyKey,
        action: 'will_insert',
        data: {
          name: propertyName,
          addressStreet: addr?.street ?? null,
          addressCity: addr?.city ?? null,
          addressState: addr?.state ?? null,
          addressZip: addr?.zip ?? null,
        },
      });
    }

    const unitKey = `${propertyKey}::${slugify(unitLabel)}`;
    if (!units.has(unitKey)) {
      units.set(unitKey, {
        naturalKey: unitKey,
        action: 'will_insert',
        data: {
          propertyName,
          label: unitLabel,
          bedrooms: parseIntOrNull(pickColumn(row, ['bedrooms'])),
          bathrooms: parseFloatOrNull(pickColumn(row, ['bathrooms'])),
        },
      });
    }

    const tenantEmail = pickColumn(row, ['tenant_email']) || null;
    const tenantKey = `phone::${phone}`;
    if (!tenants.has(tenantKey)) {
      tenants.set(tenantKey, {
        naturalKey: tenantKey,
        action: 'will_insert',
        data: {
          fullName: `${tenantFirst} ${tenantLast}`.trim(),
          phoneE164: phone,
          email: tenantEmail,
          dateOfBirth: parseDate(pickColumn(row, ['tenant_dob'])),
        },
      });
    }

    const rentCents = parseCurrencyToCents(leaseRent);
    if (rentCents === null) {
      warnings.push(`Row ${idx + 2}: couldn't parse lease_rent "${leaseRent}", row skipped`);
      return;
    }
    const dueDayParsed = parseIntOrNull(leaseDueDay);
    if (dueDayParsed === null || dueDayParsed < 1 || dueDayParsed > 31) {
      warnings.push(`Row ${idx + 2}: lease_due_day "${leaseDueDay}" not 1-31, row skipped`);
      return;
    }
    const startDate = parseDate(leaseStart);
    const endDate = parseDate(pickColumn(row, ['lease_end']));
    const status = (pickColumn(row, ['lease_status']) || 'active').toLowerCase();
    const normalizedStatus: LeaseDraft['status'] = normalizeLeaseStatus(status);

    const leaseKey = `${unitKey}::${tenantKey}::${startDate ?? 'unknown'}`;
    if (!leases.has(leaseKey)) {
      leases.set(leaseKey, {
        naturalKey: leaseKey,
        action: 'will_insert',
        data: {
          propertyName,
          unitLabel,
          tenantPhoneE164: phone,
          tenantEmail,
          rentAmount: rentCents / 100,
          rentDueDay: dueDayParsed,
          startDate,
          endDate,
          status: normalizedStatus,
        },
      });
    }
  });

  const plan: ImportPlan = {
    properties: [...properties.values()],
    units: [...units.values()],
    tenants: [...tenants.values()],
    leases: [...leases.values()],
  };

  return { ok: true, plan, warnings };
}
