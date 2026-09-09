/**
 * Single source of truth for canonical seed identities — mirror of
 * supabase/seed.sql. Update both together.
 *
 * Plain constants only: no `@supabase/supabase-js` import, no `Database`
 * type. Specs and helper modules re-export from here so the seeded UUIDs,
 * names, and phone numbers live in exactly one place. When seed.sql changes
 * a UUID, name, address, status, or phone number, change it here in the same
 * commit.
 *
 * Grouped: ORG, PROPERTIES, UNITS, TENANTS, VENDORS, WORK_ORDERS, DOCUMENTS,
 * LEASES, PHONES (+ the seeded demo voice-call id). The flat `*_ID` constants
 * are the names existing specs already import (via ../properties/helpers and
 * ../today/helpers) and must keep their exact spelling.
 */

// ---------------------------------------------------------------------------
// Environment resolution (shared by every Supabase-touching spec/helper)
// ---------------------------------------------------------------------------

export const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  '';

export const HAVE_SUPABASE = Boolean(
  SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY,
);

/** Shared test-hook secret; config supplies it for managed runs. No fallback. */
export const TEST_HOOKS_SECRET = process.env.TEST_HOOKS_SECRET ?? '';
/** Spread into requests only when a secret was explicitly configured. */
export const TEST_HOOKS_HEADERS: Readonly<Record<string, string>> =
  TEST_HOOKS_SECRET ? { 'x-test-hooks-secret': TEST_HOOKS_SECRET } : {};

// ---------------------------------------------------------------------------
// ORG
// ---------------------------------------------------------------------------

export const GALAXY_ORG_ID = '11111111-1111-1111-1111-111111111101';

export const ORG = {
  id: GALAXY_ORG_ID,
  name: 'Galaxy Estates',
  slug: 'galaxy-estates',
  odesaPhoneNumber: '+15715550101',
  messagingPrimary: 'linq',
  plan: 'managed',
  timezone: 'America/New_York',
} as const;

// ---------------------------------------------------------------------------
// PROPERTIES (2)
// ---------------------------------------------------------------------------

/** Oakwood Commons — 7 units. */
export const OAKWOOD_PROPERTY_ID = '33333333-3333-3333-3333-333333333301';

/** 17th Street Row — 3 units. */
export const SEVENTEENTH_PROPERTY_ID = '33333333-3333-3333-3333-333333333302';

export const PROPERTIES = [
  {
    id: OAKWOOD_PROPERTY_ID,
    name: 'Oakwood Commons',
    addressStreet: '1400 Oakwood Dr',
    addressCity: 'Arlington',
    addressState: 'VA',
    addressZip: '22201',
    unitCount: 7,
  },
  {
    id: SEVENTEENTH_PROPERTY_ID,
    name: '17th Street Row',
    addressStreet: '1701 17th St NW',
    addressCity: 'Washington',
    addressState: 'DC',
    addressZip: '20009',
    unitCount: 3,
  },
] as const;

// ---------------------------------------------------------------------------
// UNITS (10 = 7 Oakwood + 3 17th Street)
// ---------------------------------------------------------------------------

/** Unit 101 (Oakwood) — leased to Marcus Alvarez; open emergency WO. */
export const UNIT_101_ID = '44444444-4444-4444-4444-444444444401';

/** Unit 204 (Oakwood) — leased to Gavin Huang. */
export const UNIT_204_ID = '44444444-4444-4444-4444-444444444407';

/** Unit C (17th Street) — leased to Jessica Kim; rent escalated. */
export const UNIT_C_ID = '44444444-4444-4444-4444-444444444410';

export const UNITS = [
  {
    id: UNIT_101_ID,
    propertyId: OAKWOOD_PROPERTY_ID,
    label: '101',
    bedrooms: 1,
    bathrooms: 1.0,
    squareFeet: 650,
  },
  {
    id: '44444444-4444-4444-4444-444444444402',
    propertyId: OAKWOOD_PROPERTY_ID,
    label: '102',
    bedrooms: 2,
    bathrooms: 1.5,
    squareFeet: 900,
  },
  {
    id: '44444444-4444-4444-4444-444444444403',
    propertyId: OAKWOOD_PROPERTY_ID,
    label: '103',
    bedrooms: 1,
    bathrooms: 1.0,
    squareFeet: 680,
  },
  {
    id: '44444444-4444-4444-4444-444444444404',
    propertyId: OAKWOOD_PROPERTY_ID,
    label: '201',
    bedrooms: 2,
    bathrooms: 2.0,
    squareFeet: 950,
  },
  {
    id: '44444444-4444-4444-4444-444444444405',
    propertyId: OAKWOOD_PROPERTY_ID,
    label: '202',
    bedrooms: 3,
    bathrooms: 2.0,
    squareFeet: 1180,
  },
  {
    id: '44444444-4444-4444-4444-444444444406',
    propertyId: OAKWOOD_PROPERTY_ID,
    label: '203',
    bedrooms: 2,
    bathrooms: 1.5,
    squareFeet: 910,
  },
  {
    id: UNIT_204_ID,
    propertyId: OAKWOOD_PROPERTY_ID,
    label: '204',
    bedrooms: 1,
    bathrooms: 1.0,
    squareFeet: 700,
  },
  {
    id: '44444444-4444-4444-4444-444444444408',
    propertyId: SEVENTEENTH_PROPERTY_ID,
    label: 'A',
    bedrooms: 2,
    bathrooms: 1.5,
    squareFeet: 880,
  },
  {
    id: '44444444-4444-4444-4444-444444444409',
    propertyId: SEVENTEENTH_PROPERTY_ID,
    label: 'B',
    bedrooms: 2,
    bathrooms: 1.5,
    squareFeet: 890,
  },
  {
    id: UNIT_C_ID,
    propertyId: SEVENTEENTH_PROPERTY_ID,
    label: 'C',
    bedrooms: 3,
    bathrooms: 2.0,
    squareFeet: 1220,
  },
] as const;

// ---------------------------------------------------------------------------
// TENANTS (10)
// ---------------------------------------------------------------------------

/** Marcus Alvarez — current + paid tenant (Unit 101). */
export const MARCUS_TENANT_ID = '55555555-5555-5555-5555-555555555501';

/** Jessica Kim — escalated / unresponsive tenant (Unit C). */
export const JESSICA_TENANT_ID = '55555555-5555-5555-5555-555555555510';

export const TENANTS = [
  {
    id: MARCUS_TENANT_ID,
    fullName: 'Marcus Alvarez',
    phoneE164: '+15715550201',
    email: 'marcus.alvarez@example.com',
  },
  {
    id: '55555555-5555-5555-5555-555555555502',
    fullName: 'Priya Banerjee',
    phoneE164: '+15715550202',
    email: 'priya.b@example.com',
  },
  {
    id: '55555555-5555-5555-5555-555555555503',
    fullName: 'Jordan Chen',
    phoneE164: '+15715550203',
    email: 'jchen@example.com',
  },
  {
    id: '55555555-5555-5555-5555-555555555504',
    fullName: 'Linda Diallo',
    phoneE164: '+15715550204',
    email: 'linda.d@example.com',
  },
  {
    id: '55555555-5555-5555-5555-555555555505',
    fullName: 'Ethan Ellis',
    phoneE164: '+15715550205',
    email: 'ethan.ellis@example.com',
  },
  {
    id: '55555555-5555-5555-5555-555555555506',
    fullName: 'Fatima Farid',
    phoneE164: '+15715550206',
    email: 'fatima.f@example.com',
  },
  {
    id: '55555555-5555-5555-5555-555555555507',
    fullName: 'Gavin Huang',
    phoneE164: '+15715550207',
    email: 'gavin.h@example.com',
  },
  {
    id: '55555555-5555-5555-5555-555555555508',
    fullName: 'Hannah Ito',
    phoneE164: '+15715550208',
    email: 'hannah.ito@example.com',
  },
  {
    id: '55555555-5555-5555-5555-555555555509',
    fullName: 'Ivan Jankowski',
    phoneE164: '+15715550209',
    email: 'ivan.j@example.com',
  },
  {
    id: JESSICA_TENANT_ID,
    fullName: 'Jessica Kim',
    phoneE164: '+15715550210',
    email: 'jessica.kim@example.com',
  },
] as const;

// ---------------------------------------------------------------------------
// VENDORS (3)
// ---------------------------------------------------------------------------

export const BELTWAY_PLUMBING_VENDOR_ID =
  '88888888-8888-8888-8888-888888888801';
export const CAPITAL_HVAC_VENDOR_ID = '88888888-8888-8888-8888-888888888802';
export const HANDYMAN_HANK_VENDOR_ID = '88888888-8888-8888-8888-888888888803';

export const VENDORS = [
  {
    id: BELTWAY_PLUMBING_VENDOR_ID,
    name: 'Beltway Plumbing Co',
    category: 'plumbing',
    phoneE164: '+15715550301',
    acceptanceRate: 0.92,
  },
  {
    id: CAPITAL_HVAC_VENDOR_ID,
    name: 'Capital HVAC Services',
    category: 'hvac',
    phoneE164: '+15715550302',
    acceptanceRate: 0.87,
  },
  {
    id: HANDYMAN_HANK_VENDOR_ID,
    name: 'Handyman Hank LLC',
    category: 'general',
    phoneE164: '+15715550303',
    acceptanceRate: 0.96,
  },
] as const;

// ---------------------------------------------------------------------------
// WORK_ORDERS (5, varied states)
// ---------------------------------------------------------------------------

/** Open emergency: water heater burst in Unit 101 (unassigned). */
export const WO_OPEN_EMERGENCY_ID = '77777777-7777-7777-7777-777777777701';

/** Assigned urgent: HVAC not cooling in Unit 201 (Capital HVAC). */
export const WO_ASSIGNED_HVAC_ID = '77777777-7777-7777-7777-777777777702';

/** Completed routine: leaky faucet in Unit 102 (Beltway Plumbing). */
export const WO_COMPLETED_FAUCET_ID = '77777777-7777-7777-7777-777777777704';

export const WORK_ORDERS = [
  {
    id: WO_OPEN_EMERGENCY_ID,
    status: 'open',
    category: 'plumbing',
    urgency: 'emergency',
    tenantId: MARCUS_TENANT_ID,
    unitId: UNIT_101_ID,
    vendorId: null,
  },
  {
    id: WO_ASSIGNED_HVAC_ID,
    status: 'assigned',
    category: 'hvac',
    urgency: 'urgent',
    tenantId: '55555555-5555-5555-5555-555555555504',
    unitId: '44444444-4444-4444-4444-444444444404',
    vendorId: CAPITAL_HVAC_VENDOR_ID,
  },
  {
    id: '77777777-7777-7777-7777-777777777703',
    status: 'in_progress',
    category: 'appliances',
    urgency: 'routine',
    tenantId: '55555555-5555-5555-5555-555555555506',
    unitId: '44444444-4444-4444-4444-444444444406',
    vendorId: HANDYMAN_HANK_VENDOR_ID,
  },
  {
    id: WO_COMPLETED_FAUCET_ID,
    status: 'completed',
    category: 'plumbing',
    urgency: 'routine',
    tenantId: '55555555-5555-5555-5555-555555555502',
    unitId: '44444444-4444-4444-4444-444444444402',
    vendorId: BELTWAY_PLUMBING_VENDOR_ID,
  },
  {
    id: '77777777-7777-7777-7777-777777777705',
    status: 'cancelled',
    category: 'general',
    urgency: 'routine',
    tenantId: '55555555-5555-5555-5555-555555555508',
    unitId: '44444444-4444-4444-4444-444444444408',
    vendorId: null,
  },
] as const;

// ---------------------------------------------------------------------------
// DOCUMENTS (6)
// ---------------------------------------------------------------------------

/** PostgreSQL CURRENT_DATE + whole-day interval, expressed as YYYY-MM-DD. */
export function seedRelativeDate(
  offsetDays: number,
  today = new Date(),
): string {
  const [year, month, day] = today
    .toISOString()
    .slice(0, 10)
    .split('-')
    .map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return result.toISOString().slice(0, 10);
}

export const DOCUMENTS = [
  {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccc01',
    type: 'lease',
    title: 'Lease — Marcus Alvarez',
    propertyId: OAKWOOD_PROPERTY_ID,
    unitId: UNIT_101_ID,
    tenantId: MARCUS_TENANT_ID,
    vendorId: null,
    expiryOffsetDays: 264,
    expiryDate: seedRelativeDate(264),
  },
  {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccc02',
    type: 'inspection',
    title: 'Move-in inspection — Unit 101',
    propertyId: OAKWOOD_PROPERTY_ID,
    unitId: UNIT_101_ID,
    tenantId: MARCUS_TENANT_ID,
    vendorId: null,
    expiryOffsetDays: null,
    expiryDate: null,
  },
  {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccc03',
    type: 'insurance',
    title: 'Property insurance — Oakwood Commons',
    propertyId: OAKWOOD_PROPERTY_ID,
    unitId: null,
    tenantId: null,
    vendorId: null,
    expiryOffsetDays: 174,
    expiryDate: seedRelativeDate(174),
  },
  {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccc04',
    type: 'tax',
    title: 'W-9 — preferred vendor',
    propertyId: null,
    unitId: null,
    tenantId: null,
    vendorId: BELTWAY_PLUMBING_VENDOR_ID,
    expiryOffsetDays: null,
    expiryDate: null,
  },
  {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccc05',
    type: 'lease',
    title: 'Lease — Jessica Kim',
    propertyId: SEVENTEENTH_PROPERTY_ID,
    unitId: UNIT_C_ID,
    tenantId: JESSICA_TENANT_ID,
    vendorId: null,
    expiryOffsetDays: -10,
    expiryDate: seedRelativeDate(-10),
  },
  {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccc06',
    type: 'notice',
    title: 'Late-rent notice — Unit C',
    propertyId: SEVENTEENTH_PROPERTY_ID,
    unitId: UNIT_C_ID,
    tenantId: JESSICA_TENANT_ID,
    vendorId: null,
    expiryOffsetDays: null,
    expiryDate: null,
  },
] as const;

// ---------------------------------------------------------------------------
// LEASES (10, all active) — one tenant per unit
// ---------------------------------------------------------------------------

export const LEASES = [
  {
    id: '66666666-6666-6666-6666-666666666601',
    unitId: UNIT_101_ID,
    tenantId: MARCUS_TENANT_ID,
    rentAmount: 1450.0,
  },
  {
    id: '66666666-6666-6666-6666-666666666602',
    unitId: '44444444-4444-4444-4444-444444444402',
    tenantId: '55555555-5555-5555-5555-555555555502',
    rentAmount: 1950.0,
  },
  {
    id: '66666666-6666-6666-6666-666666666603',
    unitId: '44444444-4444-4444-4444-444444444403',
    tenantId: '55555555-5555-5555-5555-555555555503',
    rentAmount: 1475.0,
  },
  {
    id: '66666666-6666-6666-6666-666666666604',
    unitId: '44444444-4444-4444-4444-444444444404',
    tenantId: '55555555-5555-5555-5555-555555555504',
    rentAmount: 2150.0,
  },
  {
    id: '66666666-6666-6666-6666-666666666605',
    unitId: '44444444-4444-4444-4444-444444444405',
    tenantId: '55555555-5555-5555-5555-555555555505',
    rentAmount: 2600.0,
  },
  {
    id: '66666666-6666-6666-6666-666666666606',
    unitId: '44444444-4444-4444-4444-444444444406',
    tenantId: '55555555-5555-5555-5555-555555555506',
    rentAmount: 1975.0,
  },
  {
    id: '66666666-6666-6666-6666-666666666607',
    unitId: UNIT_204_ID,
    tenantId: '55555555-5555-5555-5555-555555555507',
    rentAmount: 1425.0,
  },
  {
    id: '66666666-6666-6666-6666-666666666608',
    unitId: '44444444-4444-4444-4444-444444444408',
    tenantId: '55555555-5555-5555-5555-555555555508',
    rentAmount: 2250.0,
  },
  {
    id: '66666666-6666-6666-6666-666666666609',
    unitId: '44444444-4444-4444-4444-444444444409',
    tenantId: '55555555-5555-5555-5555-555555555509',
    rentAmount: 2300.0,
  },
  {
    id: '66666666-6666-6666-6666-666666666610',
    unitId: UNIT_C_ID,
    tenantId: JESSICA_TENANT_ID,
    rentAmount: 2950.0,
  },
] as const;

// ---------------------------------------------------------------------------
// PHONES (seeded numbers used by specs)
// ---------------------------------------------------------------------------

export const PHONES = {
  /** organizations.odesa_phone_number (the Odesa line callers dial). */
  ORG: '+15715550101',
  /** tenants.phone_e164 — Marcus Alvarez (verified-tenant flagship fixture). */
  MARCUS: '+15715550201',
  /** tenants.phone_e164 — Jessica Kim (escalated tenant). */
  JESSICA: '+15715550210',
  /** vendors.phone_e164 — Beltway Plumbing Co. */
  BELTWAY_PLUMBING: '+15715550301',
  /** vendors.phone_e164 — Capital HVAC Services. */
  CAPITAL_HVAC: '+15715550302',
  /** vendors.phone_e164 — Handyman Hank LLC. */
  HANDYMAN_HANK: '+15715550303',
  /** NOT seeded — the unknown-caller ghost number calls-page.spec.ts dials. */
  UNKNOWN_CALLER: '+15715559999',
} as const;

// ---------------------------------------------------------------------------
// Seeded demo voice call (backs /calls, /calls/[id], and the route-sweep manifest)
// ---------------------------------------------------------------------------

/** Completed inbound demo call from Marcus Alvarez → /calls/[id] fixture. */
export const SEED_VOICE_CALL_ID = '99999999-9999-9999-9999-999999999901';
