/**
 * AppFolio CSV mapper (Wave 7 Stream C).
 *
 * AppFolio's owner-facing exports vary by report template. The two we
 * see most often in migrations are:
 *
 *   - "Rent Roll" — one row per active lease, joining property / unit /
 *     tenant / lease columns.
 *   - "Tenants" — one row per tenant, lease columns embedded.
 *
 * Both share enough columns that a single mapper handles them.  Column
 * names below are AppFolio's owner-portal export defaults (best-guess
 * canonicalization — multiple aliases accepted via `pickColumn`).
 *
 * COLUMN MAPPINGS (canonical alias first, fallbacks in order):
 *
 *   PROPERTY:
 *     - "Property Name" → property.name
 *     - "Property Address" → parsed → property.address_*
 *
 *   UNIT:
 *     - "Unit Number" / "Unit" → unit.label
 *
 *   TENANT:
 *     - "Tenant First Name" + "Tenant Last Name" → tenant.full_name
 *       (or "Tenant Name" if a single column)
 *     - "Tenant Phone" / "Phone" → tenant.phone_e164 (E.164 normalized)
 *     - "Tenant Email" / "Email" → tenant.email
 *
 *   LEASE:
 *     - "Lease Rent" / "Rent" → lease.rent_amount (currency-parsed)
 *     - "Lease Start Date" / "Move In" → lease.start_date
 *     - "Lease End Date" / "Move Out" → lease.end_date
 *     - "Lease Status" → lease.status
 *
 * If you discover the real AppFolio export uses different headers,
 * extend the candidate arrays in `pickColumn` calls below — the rest of
 * the mapper is column-agnostic.
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

export function mapAppfolioCsv(
  rows: ReadonlyArray<Record<string, string>>,
): MapperResult {
  if (rows.length === 0) {
    return { ok: true, plan: emptyPlan(), warnings: ['CSV had no data rows'] };
  }

  const properties = new Map<string, ImportItem<PropertyDraft>>();
  const units = new Map<string, ImportItem<UnitDraft>>();
  const tenants = new Map<string, ImportItem<TenantDraft>>();
  const leases = new Map<string, ImportItem<LeaseDraft>>();
  const warnings: string[] = [];

  rows.forEach((row, idx) => {
    const propertyName = pickColumn(row, ['Property Name', 'Property']);
    const propertyAddress = pickColumn(row, ['Property Address', 'Address']);
    const unitLabel = pickColumn(row, ['Unit Number', 'Unit', 'Unit Label']);

    const tenantFirst = pickColumn(row, ['Tenant First Name', 'First Name']);
    const tenantLast = pickColumn(row, ['Tenant Last Name', 'Last Name']);
    const tenantNameSingle = pickColumn(row, ['Tenant Name', 'Resident', 'Resident Name']);
    const tenantFullName = (`${tenantFirst} ${tenantLast}`.trim()) || tenantNameSingle;
    const tenantPhoneRaw = pickColumn(row, ['Tenant Phone', 'Phone', 'Mobile Phone', 'Phone Number']);
    const tenantEmail = pickColumn(row, ['Tenant Email', 'Email']) || null;
    const tenantDob = pickColumn(row, ['Date of Birth', 'DOB']);

    const leaseRent = pickColumn(row, ['Lease Rent', 'Rent', 'Monthly Rent']);
    const leaseStart = pickColumn(row, ['Lease Start Date', 'Lease From', 'Move In', 'Move In Date']);
    const leaseEnd = pickColumn(row, ['Lease End Date', 'Lease To', 'Move Out', 'Move Out Date']);
    const leaseStatus = pickColumn(row, ['Lease Status', 'Status']) || 'active';
    const dueDay = pickColumn(row, ['Rent Due Day', 'Due Day']) || '1';

    if (!propertyName || !unitLabel) {
      warnings.push(`Row ${idx + 2}: missing Property Name or Unit Number, skipped`);
      return;
    }

    const phone = normalizePhoneE164(tenantPhoneRaw);
    if (tenantPhoneRaw && !phone) {
      warnings.push(
        `Row ${idx + 2}: phone "${tenantPhoneRaw}" couldn't be normalized to E.164, row skipped`,
      );
      return;
    }
    if (!phone) {
      warnings.push(`Row ${idx + 2}: missing Tenant Phone, row skipped`);
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
          bedrooms: parseIntOrNull(pickColumn(row, ['Bedrooms', 'Beds', 'BR'])),
          bathrooms: parseFloatOrNull(pickColumn(row, ['Bathrooms', 'Baths', 'BA'])),
        },
      });
    }

    const tenantKey = `phone::${phone}`;
    if (!tenants.has(tenantKey)) {
      tenants.set(tenantKey, {
        naturalKey: tenantKey,
        action: 'will_insert',
        data: {
          fullName: tenantFullName || phone,
          phoneE164: phone,
          email: tenantEmail,
          dateOfBirth: parseDate(tenantDob),
        },
      });
    }

    const rentCents = parseCurrencyToCents(leaseRent);
    if (rentCents === null) {
      warnings.push(`Row ${idx + 2}: couldn't parse rent "${leaseRent}", row skipped`);
      return;
    }
    const startDate = parseDate(leaseStart);
    const endDate = parseDate(leaseEnd);
    const dueDayParsed = parseIntOrNull(dueDay);
    const normalizedStatus: LeaseDraft['status'] = normalizeLeaseStatus(leaseStatus);

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
          rentDueDay: dueDayParsed && dueDayParsed >= 1 && dueDayParsed <= 31 ? dueDayParsed : 1,
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

function emptyPlan(): ImportPlan {
  return { properties: [], units: [], tenants: [], leases: [] };
}
