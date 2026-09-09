/**
 * RentRedi CSV mapper (Wave 7 Stream C).
 *
 * RentRedi exports tenant + lease data in a flatter shape than AppFolio
 * or Buildium — typically one row per tenant with the property/unit
 * embedded.  Common columns observed in RentRedi exports:
 *
 *   - "Property" — building/property label
 *   - "Unit" — unit number/label
 *   - "Tenant Name" — single full-name column
 *   - "Tenant Phone" — phone (any format)
 *   - "Tenant Email" — email
 *   - "Rent Amount" — monthly rent
 *   - "Lease Start" / "Lease End" — dates
 *
 * If your real RentRedi export uses different headers, extend the
 * candidate arrays in `pickColumn` calls — the rest of the mapper is
 * column-agnostic.
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

function splitName(full: string): { first: string; last: string } {
  const trimmed = full.trim();
  if (!trimmed) return { first: '', last: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export function mapRentrediCsv(
  rows: ReadonlyArray<Record<string, string>>,
): MapperResult {
  if (rows.length === 0) {
    return {
      ok: true,
      plan: { properties: [], units: [], tenants: [], leases: [] },
      warnings: ['CSV had no data rows'],
    };
  }

  const properties = new Map<string, ImportItem<PropertyDraft>>();
  const units = new Map<string, ImportItem<UnitDraft>>();
  const tenants = new Map<string, ImportItem<TenantDraft>>();
  const leases = new Map<string, ImportItem<LeaseDraft>>();
  const warnings: string[] = [];

  rows.forEach((row, idx) => {
    const propertyName = pickColumn(row, ['Property', 'Property Name', 'Building']);
    const propertyAddress = pickColumn(row, ['Property Address', 'Address']);
    const unitLabel = pickColumn(row, ['Unit', 'Unit Number', 'Unit Name']);

    const tenantSingle = pickColumn(row, ['Tenant Name', 'Tenant', 'Resident Name', 'Resident']);
    const tenantFirstCol = pickColumn(row, ['First Name', 'Tenant First Name']);
    const tenantLastCol = pickColumn(row, ['Last Name', 'Tenant Last Name']);
    let tenantFirst = tenantFirstCol;
    let tenantLast = tenantLastCol;
    if (!tenantFirst && !tenantLast && tenantSingle) {
      const split = splitName(tenantSingle);
      tenantFirst = split.first;
      tenantLast = split.last;
    }
    const tenantFullName = `${tenantFirst} ${tenantLast}`.trim() || tenantSingle;

    const tenantPhoneRaw = pickColumn(row, ['Tenant Phone', 'Phone', 'Mobile']);
    const tenantEmail = pickColumn(row, ['Tenant Email', 'Email']) || null;

    const leaseRent = pickColumn(row, ['Rent Amount', 'Rent', 'Monthly Rent']);
    const leaseStart = pickColumn(row, ['Lease Start', 'Lease Start Date', 'Move In']);
    const leaseEnd = pickColumn(row, ['Lease End', 'Lease End Date', 'Move Out']);
    const dueDay = pickColumn(row, ['Rent Due Day', 'Due Day']) || '1';
    const leaseStatus = pickColumn(row, ['Lease Status', 'Status']) || 'active';

    if (!propertyName || !unitLabel) {
      warnings.push(`Row ${idx + 2}: missing Property or Unit, skipped`);
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
          bedrooms: parseIntOrNull(pickColumn(row, ['Bedrooms', 'Beds'])),
          bathrooms: parseFloatOrNull(pickColumn(row, ['Bathrooms', 'Baths'])),
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
          dateOfBirth: null,
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
