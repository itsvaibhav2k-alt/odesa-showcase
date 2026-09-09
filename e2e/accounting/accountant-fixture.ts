import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/types/database';
import {
  GALAXY_ORG_ID,
  LEASES,
  OAKWOOD_PROPERTY_ID,
  SEVENTEENTH_PROPERTY_ID,
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
} from '../fixtures/manifest';

type Client = SupabaseClient<Database>;

export const ACCOUNTANT_QA_EMAIL = 'accountant.qa@galaxy-accountant.test';
export const ACCOUNTANT_QA_PASSWORD = 'accountant-local-browser-password-1';
export const ACCOUNTANT_QA_USER_ID = 'acca0000-0000-4000-8000-000000000001';
export const ACCOUNTANT_QA_MEMBERSHIP_ID = 'acca0000-0000-4000-8000-000000000002';
export const ACCOUNTANT_ARCHIVED_PROPERTY_ID = 'acca1000-0000-4000-8000-000000000001';

const UNIT_OUTSTANDING = 'acca1100-0000-4000-8000-000000000001';
const UNIT_MISSING = 'acca1100-0000-4000-8000-000000000002';
const UNIT_WAIVED = 'acca1100-0000-4000-8000-000000000003';
const TENANT_OUTSTANDING = 'acca1200-0000-4000-8000-000000000001';
const TENANT_MISSING = 'acca1200-0000-4000-8000-000000000002';
const TENANT_WAIVED = 'acca1200-0000-4000-8000-000000000003';
const LEASE_OUTSTANDING = 'acca1300-0000-4000-8000-000000000001';
const LEASE_MISSING = 'acca1300-0000-4000-8000-000000000002';
const LEASE_WAIVED = 'acca1300-0000-4000-8000-000000000003';
const RENT_OUTSTANDING = 'acca1400-0000-4000-8000-000000000001';
const RENT_WAIVED = 'acca1400-0000-4000-8000-000000000002';

export const PAYMENT_CONFIRMED = 'acca2000-0000-4000-8000-000000000001';
export const PAYMENT_UNMATCHED = 'acca2000-0000-4000-8000-000000000002';
export const PAYMENT_TIMESTAMP_MISSING = 'acca2000-0000-4000-8000-000000000003';
export const PAYMENT_PENDING = 'acca2000-0000-4000-8000-000000000004';
export const PAYMENT_OTHER = 'acca2000-0000-4000-8000-000000000005';
export const PAYMENT_EXCLUDED = 'acca2000-0000-4000-8000-000000000006';
export const PAYMENT_HISTORICAL_UNMATCHED = 'acca2000-0000-4000-8000-000000000007';

export const DOCUMENT_LEASE = 'acca3000-0000-4000-8000-000000000001';
export const DOCUMENT_PROPERTY = 'acca3000-0000-4000-8000-000000000002';
export const DOCUMENT_WITHHELD = 'acca3000-0000-4000-8000-000000000003';
export const DOCUMENT_ARCHIVED = 'acca3000-0000-4000-8000-000000000004';
export const DOCUMENT_EXCLUDED = 'acca3000-0000-4000-8000-000000000005';

const FIXTURE_PAYMENTS = [
  PAYMENT_CONFIRMED,
  PAYMENT_UNMATCHED,
  PAYMENT_TIMESTAMP_MISSING,
  PAYMENT_PENDING,
  PAYMENT_OTHER,
  PAYMENT_EXCLUDED,
  PAYMENT_HISTORICAL_UNMATCHED,
];
const FIXTURE_DOCUMENTS = [
  DOCUMENT_LEASE,
  DOCUMENT_PROPERTY,
  DOCUMENT_WITHHELD,
  DOCUMENT_ARCHIVED,
  DOCUMENT_EXCLUDED,
];
const FIXTURE_RENT_EVENTS = [RENT_OUTSTANDING, RENT_WAIVED];
const FIXTURE_LEASES = [LEASE_OUTSTANDING, LEASE_MISSING, LEASE_WAIVED];
const FIXTURE_TENANTS = [TENANT_OUTSTANDING, TENANT_MISSING, TENANT_WAIVED];
const FIXTURE_UNITS = [UNIT_OUTSTANDING, UNIT_MISSING, UNIT_WAIVED];

const COUNT_TABLES = [
  'properties',
  'units',
  'tenants',
  'leases',
  'rent_events',
  'rent_payments',
  'documents',
  'profiles',
  'organization_memberships',
  'membership_property_grants',
] as const;

export type AccountantFixtureCounts = Record<(typeof COUNT_TABLES)[number], number> & {
  auth_users: number;
};

export interface AccountantBrowserFixture {
  admin: Client;
  before: AccountantFixtureCounts;
  seeded: AccountantFixtureCounts;
  cleanup: () => Promise<{ before: AccountantFixtureCounts; after: AccountantFixtureCounts }>;
}

// Test fixtures straddle additive migration tables by design.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function table(client: Client, name: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).from(name);
}

function assertLoopback(): void {
  const host = new URL(SUPABASE_URL).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
    throw new Error(`Refusing non-loopback Supabase fixture host ${host}`);
  }
  if (!SERVICE_ROLE_KEY) throw new Error('Local service role key is required');
}

function adminClient(): Client {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function requireNoError(
  result: { error?: { message: string } | null },
  label: string,
): void {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

async function counts(admin: Client): Promise<AccountantFixtureCounts> {
  const result = {} as AccountantFixtureCounts;
  for (const name of COUNT_TABLES) {
    const counted = await table(admin, name).select('*', {
      count: 'exact',
      head: true,
    });
    requireNoError(counted, `count ${name}`);
    if (counted.count === null) throw new Error(`count ${name} was null`);
    result[name] = counted.count;
  }
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (users.error) throw new Error(`count auth users: ${users.error.message}`);
  result.auth_users = users.data.users.length;
  return result;
}

async function removeFixtureRows(admin: Client): Promise<void> {
  const cleanup = [
    ['rent_payments', 'id', FIXTURE_PAYMENTS],
    ['documents', 'id', FIXTURE_DOCUMENTS],
    ['rent_events', 'id', FIXTURE_RENT_EVENTS],
    ['leases', 'id', FIXTURE_LEASES],
    ['tenants', 'id', FIXTURE_TENANTS],
    ['units', 'id', FIXTURE_UNITS],
  ] as const;
  for (const [name, column, ids] of cleanup) {
    const deleted = await table(admin, name).delete().in(column, ids);
    requireNoError(deleted, `cleanup ${name}`);
  }
  requireNoError(
    await table(admin, 'membership_property_grants')
      .delete()
      .eq('membership_id', ACCOUNTANT_QA_MEMBERSHIP_ID),
    'cleanup property grants',
  );
  requireNoError(
    await table(admin, 'organization_memberships')
      .delete()
      .eq('id', ACCOUNTANT_QA_MEMBERSHIP_ID),
    'cleanup membership',
  );
  requireNoError(
    await table(admin, 'properties')
      .delete()
      .eq('id', ACCOUNTANT_ARCHIVED_PROPERTY_ID),
    'cleanup archived property',
  );

  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw new Error(`cleanup auth list: ${listed.error.message}`);
  for (const user of listed.data.users) {
    if (user.id === ACCOUNTANT_QA_USER_ID || user.email === ACCOUNTANT_QA_EMAIL) {
      const deleted = await admin.auth.admin.deleteUser(user.id);
      if (deleted.error && !/not found/i.test(deleted.error.message)) {
        throw new Error(`cleanup auth user: ${deleted.error.message}`);
      }
    }
  }
  requireNoError(
    await table(admin, 'profiles').delete().eq('id', ACCOUNTANT_QA_USER_ID),
    'cleanup profile residue',
  );
}

export async function provisionAccountantBrowserFixture(): Promise<AccountantBrowserFixture> {
  assertLoopback();
  const admin = adminClient();
  await removeFixtureRows(admin);
  const before = await counts(admin);

  try {
    const created = await admin.auth.admin.createUser({
      id: ACCOUNTANT_QA_USER_ID,
      email: ACCOUNTANT_QA_EMAIL,
      password: ACCOUNTANT_QA_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'Galaxy Reconciliation Accountant' },
    });
    if (created.error || !created.data.user) {
      throw new Error(`create Accountant auth user: ${created.error?.message ?? 'missing user'}`);
    }

    requireNoError(
      await table(admin, 'properties').insert({
        id: ACCOUNTANT_ARCHIVED_PROPERTY_ID,
        organization_id: GALAXY_ORG_ID,
        name: 'Galaxy Archive Ledger',
        address_street: '300 Fictional Archive Lane',
        address_city: 'Testville',
        address_state: 'VA',
        address_zip: '00000',
        timezone: 'America/New_York',
        archived_at: '2026-07-15T00:00:00.000Z',
      }),
      'seed archived property',
    );
    requireNoError(
      await table(admin, 'units').insert([
        { id: UNIT_OUTSTANDING, organization_id: GALAXY_ORG_ID, property_id: ACCOUNTANT_ARCHIVED_PROPERTY_ID, label: 'AR-1' },
        { id: UNIT_MISSING, organization_id: GALAXY_ORG_ID, property_id: ACCOUNTANT_ARCHIVED_PROPERTY_ID, label: 'AR-2' },
        { id: UNIT_WAIVED, organization_id: GALAXY_ORG_ID, property_id: ACCOUNTANT_ARCHIVED_PROPERTY_ID, label: 'AR-3' },
      ]),
      'seed archived units',
    );
    requireNoError(
      await table(admin, 'tenants').insert([
        { id: TENANT_OUTSTANDING, organization_id: GALAXY_ORG_ID, full_name: 'Nova Ledger', phone_e164: '+12025550151', email: 'nova.ledger@tenant.invalid' },
        { id: TENANT_MISSING, organization_id: GALAXY_ORG_ID, full_name: 'Orion Ledger', phone_e164: '+12025550152', email: 'orion.ledger@tenant.invalid' },
        { id: TENANT_WAIVED, organization_id: GALAXY_ORG_ID, full_name: 'Sol Ledger', phone_e164: '+12025550153', email: 'sol.ledger@tenant.invalid' },
      ]),
      'seed archived tenants',
    );
    requireNoError(
      await table(admin, 'leases').insert([
        { id: LEASE_OUTSTANDING, organization_id: GALAXY_ORG_ID, unit_id: UNIT_OUTSTANDING, tenant_id: TENANT_OUTSTANDING, rent_amount: 1800, rent_due_day: 1, start_date: '2026-01-01', end_date: '2026-12-31', status: 'active' },
        { id: LEASE_MISSING, organization_id: GALAXY_ORG_ID, unit_id: UNIT_MISSING, tenant_id: TENANT_MISSING, rent_amount: 1600, rent_due_day: 1, start_date: '2026-01-01', end_date: '2026-12-31', status: 'active' },
        { id: LEASE_WAIVED, organization_id: GALAXY_ORG_ID, unit_id: UNIT_WAIVED, tenant_id: TENANT_WAIVED, rent_amount: 800, rent_due_day: 1, start_date: '2026-01-01', end_date: '2026-12-31', status: 'active' },
      ]),
      'seed archived leases',
    );
    requireNoError(
      await table(admin, 'rent_events').insert([
        { id: RENT_OUTSTANDING, organization_id: GALAXY_ORG_ID, lease_id: LEASE_OUTSTANDING, cycle_month: '2026-08-01', amount_due: 1800, amount_paid: 0, status: 'late_3', due_date: '2026-08-01' },
        { id: RENT_WAIVED, organization_id: GALAXY_ORG_ID, lease_id: LEASE_WAIVED, cycle_month: '2026-08-01', amount_due: 800, amount_paid: 800, status: 'paid', due_date: '2026-08-01', waived_amount: 200, waived_at: '2026-08-03T12:00:00.000Z', waived_reason: 'Fictional QA evidence only' },
      ]),
      'seed archived rent events',
    );

    const seededRent = await table(admin, 'rent_events')
      .select('id, lease_id')
      .eq('cycle_month', '2026-08-01')
      .in('lease_id', [LEASES[0].id, LEASES[9].id]);
    requireNoError(seededRent, 'resolve included/excluded seed rent events');
    const oakwoodRentId = seededRent.data.find(
      (row: { id: string; lease_id: string }) => row.lease_id === LEASES[0].id,
    )?.id;
    const excludedRentId = seededRent.data.find(
      (row: { id: string; lease_id: string }) => row.lease_id === LEASES[9].id,
    )?.id;
    if (!oakwoodRentId || !excludedRentId) {
      throw new Error('seeded August rent events are missing');
    }

    const paymentRows = [
      { id: PAYMENT_CONFIRMED, organization_id: GALAXY_ORG_ID, lease_id: LEASES[0].id, tenant_id: LEASES[0].tenantId, rent_event_id: oakwoodRentId, stripe_payment_intent_id: 'pi_fictional_browser_confirmed', stripe_customer_id: 'cus_private_browser_confirmed', amount_cents: 145000, currency: 'usd', status: 'succeeded', paid_at: '2026-08-04T15:00:00.000Z', created_at: '2026-08-04T15:01:00.000Z', receipt_url: 'https://provider.invalid/private-confirmed' },
      { id: PAYMENT_UNMATCHED, organization_id: GALAXY_ORG_ID, lease_id: LEASES[0].id, tenant_id: LEASES[0].tenantId, rent_event_id: null, stripe_payment_intent_id: 'pi_fictional_browser_unmatched', stripe_customer_id: 'cus_private_browser_unmatched', amount_cents: 43000, currency: 'usd', status: 'succeeded', paid_at: '2026-08-05T16:00:00.000Z', created_at: '2026-08-05T16:01:00.000Z', receipt_url: null },
      { id: PAYMENT_TIMESTAMP_MISSING, organization_id: GALAXY_ORG_ID, lease_id: LEASE_WAIVED, tenant_id: TENANT_WAIVED, rent_event_id: RENT_WAIVED, stripe_payment_intent_id: 'pi_fictional_browser_missing_time', stripe_customer_id: null, amount_cents: 80000, currency: 'usd', status: 'succeeded', paid_at: null, created_at: '2026-08-06T12:00:00.000Z', receipt_url: null },
      { id: PAYMENT_PENDING, organization_id: GALAXY_ORG_ID, lease_id: LEASES[0].id, tenant_id: LEASES[0].tenantId, rent_event_id: null, stripe_payment_intent_id: 'pi_fictional_browser_pending', stripe_customer_id: null, amount_cents: 12000, currency: 'usd', status: 'pending', paid_at: null, created_at: '2026-08-06T13:00:00.000Z', receipt_url: null },
      { id: PAYMENT_OTHER, organization_id: GALAXY_ORG_ID, lease_id: LEASES[0].id, tenant_id: LEASES[0].tenantId, rent_event_id: null, stripe_payment_intent_id: 'pi_fictional_browser_failed', stripe_customer_id: null, amount_cents: 9000, currency: 'usd', status: 'failed', paid_at: null, created_at: '2026-08-06T14:00:00.000Z', receipt_url: null },
      { id: PAYMENT_EXCLUDED, organization_id: GALAXY_ORG_ID, lease_id: LEASES[9].id, tenant_id: LEASES[9].tenantId, rent_event_id: excludedRentId, stripe_payment_intent_id: 'pi_fictional_browser_excluded', stripe_customer_id: 'cus_private_browser_excluded', amount_cents: 295000, currency: 'usd', status: 'succeeded', paid_at: '2026-08-03T10:00:00.000Z', created_at: '2026-08-03T10:01:00.000Z', receipt_url: 'https://provider.invalid/private-excluded' },
      { id: PAYMENT_HISTORICAL_UNMATCHED, organization_id: GALAXY_ORG_ID, lease_id: LEASES[0].id, tenant_id: LEASES[0].tenantId, rent_event_id: null, stripe_payment_intent_id: 'pi_fictional_browser_historical', stripe_customer_id: null, amount_cents: 31000, currency: 'usd', status: 'succeeded', paid_at: '2026-07-05T16:00:00.000Z', created_at: '2026-07-05T16:01:00.000Z', receipt_url: null },
    ];
    requireNoError(await table(admin, 'rent_payments').insert(paymentRows), 'seed payment evidence');

    requireNoError(
      await table(admin, 'documents').insert([
        { id: DOCUMENT_LEASE, organization_id: GALAXY_ORG_ID, lease_id: LEASES[0].id, type: 'lease', title: 'Executed Oakwood lease evidence', accountant_evidence_class: 'lease_evidence', file_key: 'private/browser/oakwood-lease.pdf', created_at: '2026-08-01T10:00:00.000Z' },
        { id: DOCUMENT_PROPERTY, organization_id: GALAXY_ORG_ID, property_id: OAKWOOD_PROPERTY_ID, type: 'tax', title: 'Oakwood tax close evidence', accountant_evidence_class: 'property_accounting_evidence', file_key: 'private/browser/oakwood-tax.pdf', created_at: '2026-08-01T11:00:00.000Z' },
        { id: DOCUMENT_WITHHELD, organization_id: GALAXY_ORG_ID, property_id: OAKWOOD_PROPERTY_ID, type: 'insurance', title: 'Withheld owner-only insurance file', accountant_evidence_class: null, file_key: 'private/browser/withheld.pdf', created_at: '2026-08-01T12:00:00.000Z' },
        { id: DOCUMENT_ARCHIVED, organization_id: GALAXY_ORG_ID, property_id: ACCOUNTANT_ARCHIVED_PROPERTY_ID, type: 'hoa', title: 'Archived ledger supporting evidence', accountant_evidence_class: 'property_accounting_evidence', file_key: 'private/browser/archive.pdf', created_at: '2026-08-01T13:00:00.000Z' },
        { id: DOCUMENT_EXCLUDED, organization_id: GALAXY_ORG_ID, property_id: SEVENTEENTH_PROPERTY_ID, type: 'tax', title: 'Excluded property private evidence', accountant_evidence_class: 'property_accounting_evidence', file_key: 'private/browser/excluded.pdf', created_at: '2026-08-01T14:00:00.000Z' },
      ]),
      'seed classified document evidence',
    );

    requireNoError(
      await table(admin, 'organization_memberships').insert({
        id: ACCOUNTANT_QA_MEMBERSHIP_ID,
        user_id: ACCOUNTANT_QA_USER_ID,
        organization_id: GALAXY_ORG_ID,
        role: 'accountant',
        status: 'active',
        all_properties: false,
      }),
      'seed Accountant membership',
    );
    requireNoError(
      await table(admin, 'membership_property_grants').insert([
        { membership_id: ACCOUNTANT_QA_MEMBERSHIP_ID, organization_id: GALAXY_ORG_ID, property_id: OAKWOOD_PROPERTY_ID },
        { membership_id: ACCOUNTANT_QA_MEMBERSHIP_ID, organization_id: GALAXY_ORG_ID, property_id: ACCOUNTANT_ARCHIVED_PROPERTY_ID },
      ]),
      'seed Accountant property grants',
    );

    const seeded = await counts(admin);
    return {
      admin,
      before,
      seeded,
      cleanup: async () => {
        await removeFixtureRows(admin);
        const after = await counts(admin);
        return { before, after };
      },
    };
  } catch (error) {
    await removeFixtureRows(admin);
    throw error;
  }
}
