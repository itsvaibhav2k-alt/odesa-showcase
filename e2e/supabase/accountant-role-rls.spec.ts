import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import type { Database, Json } from '../../src/types/database';
import {
  ANON_KEY,
  SERVICE_ROLE_KEY,
  SUPABASE_URL,
} from '../fixtures/manifest';

type Client = SupabaseClient<Database>;

const PASSWORD = 'accountant-local-security-password-1';
const ORG = 'accc0000-0000-4000-8000-000000000001';
const P1 = 'accc0100-0000-4000-8000-000000000001';
const P2 = 'accc0100-0000-4000-8000-000000000002';
const U1 = 'accc0200-0000-4000-8000-000000000001';
const U2 = 'accc0200-0000-4000-8000-000000000002';
const T1 = 'accc0300-0000-4000-8000-000000000001';
const T2 = 'accc0300-0000-4000-8000-000000000002';
const L1 = 'accc0400-0000-4000-8000-000000000001';
const L2 = 'accc0400-0000-4000-8000-000000000002';
const RENT_INCLUDED = 'accc0500-0000-4000-8000-000000000001';
const RENT_EXCLUDED = 'accc0500-0000-4000-8000-000000000002';
const VENDOR = 'accc0600-0000-4000-8000-000000000001';
const CROSS_ORG = 'accc9999-0000-4000-8000-000000000001';
const CROSS_PROPERTY = 'accc9999-0000-4000-8000-000000000002';
const PAYMENT_REAL = 'accc1000-0000-4000-8000-000000000001';
const PAYMENT_UNDATED = 'accc1000-0000-4000-8000-000000000002';
const PAYMENT_EXCLUDED = 'accc1000-0000-4000-8000-000000000003';
const DOCUMENT_LEASE = 'accc2000-0000-4000-8000-000000000001';
const DOCUMENT_PROPERTY = 'accc2000-0000-4000-8000-000000000002';
const DOCUMENT_WITHHELD = 'accc2000-0000-4000-8000-000000000003';
const DOCUMENT_EXCLUDED = 'accc2000-0000-4000-8000-000000000004';
const DOCUMENT_OWNER_DELETE = 'accc2000-0000-4000-8000-000000000005';
const PROVIDER_KEY = 'accc3000-0000-4000-8000-000000000001';
const CALLBACK_INBOX = 'accc7000-0000-4000-8000-000000000001';

const EMAILS = {
  owner: 'accountant.security.owner@galaxy-accountant.test',
  explicit: 'accountant.security.explicit@galaxy-accountant.test',
  scope: 'accountant.security.scope@galaxy-accountant.test',
  revoked: 'accountant.security.revoked@galaxy-accountant.test',
  ambiguous: 'accountant.security.ambiguous@galaxy-accountant.test',
  manager: 'accountant.security.manager@galaxy-accountant.test',
  va: 'accountant.security.va@galaxy-accountant.test',
} as const;

const MEMBERSHIPS = {
  owner: 'accc4000-0000-4000-8000-000000000001',
  scope: 'accc4000-0000-4000-8000-000000000002',
  revoked: 'accc4000-0000-4000-8000-000000000003',
  ambiguous1: 'accc4000-0000-4000-8000-000000000004',
  ambiguous2: 'accc4000-0000-4000-8000-000000000005',
  manager: 'accc4000-0000-4000-8000-000000000006',
  va: 'accc4000-0000-4000-8000-000000000007',
} as const;

const PROPERTY_KEYS = [
  'lease_end_date', 'lease_id', 'lease_start_date', 'lease_status',
  'property_archived_at', 'property_id', 'property_name', 'tenant_id',
  'tenant_name', 'unit_id', 'unit_label',
].sort();
const RENT_KEYS = [
  'amount_due_cents', 'amount_paid_cents', 'cycle_month', 'due_date',
  'lease_id', 'property_archived_at', 'property_id', 'property_name',
  'rent_event_id', 'status', 'tenant_id', 'tenant_name', 'unit_id',
  'unit_label', 'waived_amount_cents', 'waived_at',
].sort();
const PAYMENT_KEYS = [
  'amount_cents', 'currency', 'lease_id', 'matched', 'paid_at', 'payment_id',
  'period_basis', 'property_archived_at', 'property_id', 'property_name',
  'receipt_present', 'rent_event_id', 'status', 'tenant_id', 'tenant_name',
  'unit_id', 'unit_label',
].sort();
const DOCUMENT_KEYS = [
  'created_at', 'document_id', 'evidence_class', 'expiry_date', 'lease_id',
  'lease_status', 'property_archived_at', 'property_id', 'property_name',
  'tenant_id', 'tenant_name', 'title', 'type', 'unit_id', 'unit_label',
].sort();
const FORBIDDEN_KEYS = [
  'organization_id', 'address_street', 'address_city', 'address_state',
  'address_zip', 'phone_e164', 'email', 'rent_amount', 'rent_due_day',
  'late_fee_policy', 'file_key', 'uploaded_by', 'receipt_url',
  'payment_link_url', 'stripe_payment_intent_id', 'stripe_customer_id',
  'payment_method_type', 'record_created_at', 'updated_at',
];

// Migration-boundary suites deliberately widen additive table/RPC names.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (client: Client, name: string): any => (client as any).from(name);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (client: Client, name: string, args?: Record<string, unknown>): any =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).rpc(name, args);

function assertLoopback(): void {
  const url = new URL(SUPABASE_URL);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error(`Refusing non-loopback Supabase host ${url.hostname}`);
  }
  if (!ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error('Local Supabase keys are required; this suite never skips.');
  }
}

function client(key: string): Client {
  return createClient<Database>(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signIn(email: string): Promise<Client> {
  const auth = client(ANON_KEY);
  const { data, error } = await auth.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}`);
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

function rows(value: unknown, label: string): Record<string, unknown>[] {
  expect(Array.isArray(value), `${label} must be an array`).toBe(true);
  return value as Record<string, unknown>[];
}

function exact(rowsToCheck: Record<string, unknown>[], keys: string[]): void {
  for (const row of rowsToCheck) {
    expect(Object.keys(row).sort()).toEqual(keys);
    for (const key of FORBIDDEN_KEYS) expect(row).not.toHaveProperty(key);
  }
}

function requireNoError(
  result: { error?: { message: string } | null },
  label: string,
): void {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

interface Fixture {
  admin: Client;
  ids: Record<keyof typeof EMAILS, string>;
  explicitMembership: string;
  clients: Record<keyof typeof EMAILS, Client>;
  currentRentEvent: string;
  consentId: string;
  commandEventId: string;
  consentTransitionId: string;
}

let fixture: Fixture | null = null;

async function removeStale(admin: Client): Promise<void> {
  const fixtureEmails = Object.values(EMAILS);
  // Delete fixture organizations first. Their membership cascades are the
  // intentional last-owner-guard escape, and every data row below is scoped
  // to one of these two fixed fictional organizations.
  for (const organizationId of [ORG, CROSS_ORG]) {
    const removed = await table(admin, 'organizations')
      .delete()
      .eq('id', organizationId);
    if (removed.error) {
      throw new Error(
        `organization cleanup failed for ${organizationId}: ${removed.error.message}`,
      );
    }
  }
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw new Error(`auth list failed: ${listed.error.message}`);
  for (const user of listed.data.users) {
    if ((fixtureEmails as string[]).includes(user.email ?? '')) {
      const deleted = await admin.auth.admin.deleteUser(user.id);
      if (deleted.error && !/not found/i.test(deleted.error.message)) {
        throw new Error(`auth cleanup failed for ${user.email}: ${deleted.error.message}`);
      }
    }
  }
}

async function setup(): Promise<Fixture> {
  assertLoopback();
  const admin = client(SERVICE_ROLE_KEY);
  await removeStale(admin);
  try {
  const ids = {} as Fixture['ids'];
  for (const [key, email] of Object.entries(EMAILS) as Array<
    [keyof typeof EMAILS, string]
  >) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `Galaxy ${key} fixture` },
    });
    if (error || !data.user) throw new Error(`create user failed: ${email}`);
    ids[key] = data.user.id;
  }

  const organizations = await table(admin, 'organizations').insert([
    {
      id: ORG,
      name: 'Galaxy Accountant Security',
      slug: 'galaxy-accountant-security',
      timezone: 'America/New_York',
    },
    {
      id: CROSS_ORG,
      name: 'Fictional cross-org boundary',
      slug: 'galaxy-accountant-cross-boundary',
      timezone: 'America/New_York',
    },
  ]);
  if (organizations.error) {
    throw new Error(`organization fixture insert failed: ${organizations.error.message}`);
  }

  const consentCommand = await rpc(admin, 'apply_messaging_consent_command', {
    p_organization_id: ORG,
    p_recipient_e164: '+12025550144',
    p_command: 'stop',
    p_provider: 'linq',
    p_provider_message_id: 'fictional-consent-provider-id',
    p_occurred_at: '2026-08-01T12:00:00.000Z',
  });
  requireNoError(consentCommand, 'private consent fixture failed');
  const commandEvent = await table(admin, 'messaging_consent_command_events')
    .select('id')
    .eq('organization_id', ORG)
    .eq('provider_message_id', 'fictional-consent-provider-id')
    .single();
  requireNoError(commandEvent, 'private command event lookup failed');
  const consentTransition = await table(admin, 'messaging_consent_transitions')
    .select('id, consent_id')
    .eq('command_event_id', commandEvent.data.id)
    .single();
  requireNoError(consentTransition, 'private consent transition lookup failed');
  const callback = await table(admin, 'message_delivery_callback_inbox').insert({
    id: CALLBACK_INBOX,
    organization_id: ORG,
    provider: 'linq',
    provider_event_id: 'fictional-callback-event-id',
    provider_message_id: 'fictional-callback-message-id',
    status: 'delivered',
    occurred_at: '2026-08-02T12:00:00.000Z',
    raw_payload: { private_provider_field: 'never expose' },
  });
  requireNoError(callback, 'private callback fixture failed');

  const properties = await table(admin, 'properties').insert([
    {
      id: P1,
      organization_id: ORG,
      name: 'Galaxy Ledger House',
      address_street: '100 Fictional Ledger Way',
      address_city: 'Testville',
      address_state: 'VA',
      address_zip: '00000',
      timezone: 'America/New_York',
    },
    {
      id: P2,
      organization_id: ORG,
      name: 'Galaxy Archive Annex',
      address_street: '200 Fictional Archive Way',
      address_city: 'Testville',
      address_state: 'VA',
      address_zip: '00000',
      timezone: 'America/New_York',
      archived_at: '2026-07-31T00:00:00.000Z',
    },
    {
      id: CROSS_PROPERTY,
      organization_id: CROSS_ORG,
      name: 'Forbidden Cross-org Property',
      timezone: 'America/New_York',
    },
  ]);
  if (properties.error) {
    throw new Error(`property fixture insert failed: ${properties.error.message}`);
  }

  const units = await table(admin, 'units').insert([
    { id: U1, organization_id: ORG, property_id: P1, label: 'A-101' },
    { id: U2, organization_id: ORG, property_id: P2, label: 'Z-202' },
  ]);
  if (units.error) throw new Error(`unit fixture insert failed: ${units.error.message}`);

  const tenants = await table(admin, 'tenants').insert([
    {
      id: T1,
      organization_id: ORG,
      full_name: 'Avery Fiction',
      phone_e164: '+12025550141',
      email: 'avery.fiction@tenant.invalid',
    },
    {
      id: T2,
      organization_id: ORG,
      full_name: 'Rowan Fiction',
      phone_e164: '+12025550142',
      email: 'rowan.fiction@tenant.invalid',
    },
  ]);
  if (tenants.error) {
    throw new Error(`tenant fixture insert failed: ${tenants.error.message}`);
  }

  const leases = await table(admin, 'leases').insert([
    {
      id: L1,
      organization_id: ORG,
      unit_id: U1,
      tenant_id: T1,
      rent_amount: 1450,
      rent_due_day: 1,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      status: 'active',
    },
    {
      id: L2,
      organization_id: ORG,
      unit_id: U2,
      tenant_id: T2,
      rent_amount: 2950,
      rent_due_day: 1,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      status: 'active',
    },
  ]);
  if (leases.error) throw new Error(`lease fixture insert failed: ${leases.error.message}`);

  const rentEvents = await table(admin, 'rent_events').insert([
    {
      id: RENT_INCLUDED,
      organization_id: ORG,
      lease_id: L1,
      cycle_month: '2026-08-01',
      amount_due: 1450,
      amount_paid: 1450,
      status: 'paid',
      due_date: '2026-08-01',
    },
    {
      id: RENT_EXCLUDED,
      organization_id: ORG,
      lease_id: L2,
      cycle_month: '2026-08-01',
      amount_due: 2950,
      amount_paid: 0,
      status: 'escalated',
      due_date: '2026-08-01',
    },
  ]);
  if (rentEvents.error) {
    throw new Error(`rent fixture insert failed: ${rentEvents.error.message}`);
  }

  const vendor = await table(admin, 'vendors').insert({
    id: VENDOR,
    organization_id: ORG,
    name: 'Private Fictional Vendor',
    category: 'general',
    phone_e164: '+12025550143',
  });
  requireNoError(vendor, 'vendor fixture insert failed');

  const primaryMemberships = await table(admin, 'organization_memberships').insert([
    { id: MEMBERSHIPS.owner, user_id: ids.owner, organization_id: ORG, role: 'owner', status: 'active', all_properties: true },
    { id: MEMBERSHIPS.scope, user_id: ids.scope, organization_id: ORG, role: 'accountant', status: 'active', all_properties: false },
    { id: MEMBERSHIPS.revoked, user_id: ids.revoked, organization_id: ORG, role: 'accountant', status: 'active', all_properties: false },
    { id: MEMBERSHIPS.manager, user_id: ids.manager, organization_id: ORG, role: 'manager', status: 'active', all_properties: false },
    { id: MEMBERSHIPS.va, user_id: ids.va, organization_id: ORG, role: 'va', status: 'active', all_properties: false },
  ]);
  requireNoError(primaryMemberships, 'primary memberships insert failed');
  const ambiguousMemberships = await table(admin, 'organization_memberships').insert([
    { id: MEMBERSHIPS.ambiguous1, user_id: ids.ambiguous, organization_id: ORG, role: 'accountant', status: 'active', all_properties: true },
    { id: MEMBERSHIPS.ambiguous2, user_id: ids.ambiguous, organization_id: CROSS_ORG, role: 'accountant', status: 'active', all_properties: true },
  ]);
  requireNoError(ambiguousMemberships, 'ambiguous memberships insert failed');
  const adjacentGrants = await table(admin, 'membership_property_grants').insert([
    { membership_id: MEMBERSHIPS.manager, organization_id: ORG, property_id: P1 },
    { membership_id: MEMBERSHIPS.va, organization_id: ORG, property_id: P1 },
  ]);
  requireNoError(adjacentGrants, 'adjacent grants insert failed');
  // A deleted membership is the revoked-membership fixture.
  const revoked = await table(admin, 'organization_memberships')
    .delete()
    .eq('id', MEMBERSHIPS.revoked);
  requireNoError(revoked, 'revoked membership delete failed');

  const owner = await signIn(EMAILS.owner);
  const invitation = await rpc(owner, 'create_organization_invitation', {
    p_organization_id: ORG,
    p_email: EMAILS.explicit,
    p_role: 'accountant',
    p_all_properties: false,
    p_property_ids: [P1],
  });
  if (invitation.error) throw new Error(invitation.error.message);
  const invitationPayload = invitation.data as Record<string, Json>;
  const explicit = await signIn(EMAILS.explicit);
  const claim = await rpc(explicit, 'claim_organization_invitation', {
    p_token: invitationPayload.token,
  });
  expect(claim.error).toBeNull();
  expect((claim.data as Record<string, unknown>).status).toBe('claimed');
  const membershipResult = await table(admin, 'organization_memberships')
    .select('id')
    .eq('user_id', ids.explicit)
    .eq('organization_id', ORG)
    .single();
  requireNoError(membershipResult, 'claimed membership lookup failed');
  const explicitMembership = membershipResult.data.id as string;

  const currentRentEvent = RENT_INCLUDED;
  const paymentInsert = await table(admin, 'rent_payments').insert([
    {
      id: PAYMENT_REAL, organization_id: ORG, lease_id: L1, tenant_id: T1,
      rent_event_id: currentRentEvent, stripe_payment_intent_id: 'pi_fictional_accountant_real',
      stripe_customer_id: 'cus_private_fixture', amount_cents: 145000, status: 'succeeded',
      paid_at: '2026-08-04T16:00:00.000Z', payment_method_type: 'card',
      receipt_url: 'https://provider.invalid/private-receipt',
      created_at: '2026-08-04T16:01:00.000Z',
    },
    {
      id: PAYMENT_UNDATED, organization_id: ORG, lease_id: L1, tenant_id: T1,
      stripe_payment_intent_id: 'pi_fictional_accountant_undated', amount_cents: 25000,
      status: 'succeeded', paid_at: null, created_at: '2026-08-05T12:00:00.000Z',
    },
    {
      id: PAYMENT_EXCLUDED, organization_id: ORG,
      lease_id: L2,
      tenant_id: T2,
      stripe_payment_intent_id: 'pi_fictional_accountant_excluded', amount_cents: 295000,
      status: 'succeeded', paid_at: '2026-08-03T10:00:00.000Z',
      created_at: '2026-08-03T10:01:00.000Z',
    },
  ]);
  if (paymentInsert.error) {
    throw new Error(`payment fixture insert failed: ${paymentInsert.error.message}`);
  }
  const documentInsert = await table(admin, 'documents').insert([
    { id: DOCUMENT_LEASE, organization_id: ORG, lease_id: L1, type: 'lease', title: 'Executed lease evidence', accountant_evidence_class: 'lease_evidence', file_key: 'private/never-expose.pdf' },
    { id: DOCUMENT_PROPERTY, organization_id: ORG, property_id: P1, type: 'tax', title: 'Property tax evidence', accountant_evidence_class: 'property_accounting_evidence', file_key: 'private/tax.pdf' },
    { id: DOCUMENT_WITHHELD, organization_id: ORG, property_id: P1, type: 'insurance', title: 'Withheld private document', accountant_evidence_class: null, file_key: 'private/withheld.pdf' },
    { id: DOCUMENT_EXCLUDED, organization_id: ORG, property_id: P2, type: 'hoa', title: 'Excluded property evidence', accountant_evidence_class: 'property_accounting_evidence' },
  ]);
  if (documentInsert.error) {
    throw new Error(`document fixture insert failed: ${documentInsert.error.message}`);
  }
  const providerInsert = await table(admin, 'mcp_api_keys').insert({
    id: PROVIDER_KEY, organization_id: ORG, user_id: ids.owner,
    key_hash: 'f'.repeat(64), key_prefix: 'fictional_', label: 'Never-used fixture key',
  });
  if (providerInsert.error) {
    throw new Error(`provider fixture insert failed: ${providerInsert.error.message}`);
  }

  const clients = {} as Fixture['clients'];
  for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) {
    clients[key] = key === 'owner' ? owner : key === 'explicit' ? explicit : await signIn(EMAILS[key]);
  }
  return {
    admin,
    ids,
    explicitMembership,
    clients,
    currentRentEvent,
    consentId: consentTransition.data.consent_id as string,
    commandEventId: commandEvent.data.id as string,
    consentTransitionId: consentTransition.data.id as string,
  };
  } catch (error) {
    await removeStale(admin);
    throw error;
  }
}

async function cleanup(): Promise<void> {
  const admin = fixture?.admin ?? client(SERVICE_ROLE_KEY);
  await removeStale(admin);
  const orgCount = await table(admin, 'organizations').select('id', { count: 'exact', head: true }).in('id', [ORG, CROSS_ORG]);
  const paymentCount = await table(admin, 'rent_payments').select('id', { count: 'exact', head: true }).in('id', [PAYMENT_REAL, PAYMENT_UNDATED, PAYMENT_EXCLUDED]);
  const documentCount = await table(admin, 'documents').select('id', { count: 'exact', head: true }).in('id', [DOCUMENT_LEASE, DOCUMENT_PROPERTY, DOCUMENT_WITHHELD, DOCUMENT_EXCLUDED, DOCUMENT_OWNER_DELETE]);
  const profileCount = await table(admin, 'profiles').select('id', { count: 'exact', head: true }).in('email', Object.values(EMAILS));
  const providerCount = await table(admin, 'mcp_api_keys').select('id', { count: 'exact', head: true }).eq('id', PROVIDER_KEY);
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw new Error(`auth cleanup proof failed: ${listed.error.message}`);
  const authUsers = listed.data.users.filter((user) =>
    (Object.values(EMAILS) as string[]).includes(user.email ?? ''),
  ).length;
  const counts = { orgs: orgCount.count ?? -1, payments: paymentCount.count ?? -1, documents: documentCount.count ?? -1, profiles: profileCount.count ?? -1, providerKeys: providerCount.count ?? -1, authUsers };
  console.log(`ACCOUNTANT_SECURITY_CLEANUP ${JSON.stringify(counts)}`);
  expect(counts).toEqual({ orgs: 0, payments: 0, documents: 0, profiles: 0, providerKeys: 0, authUsers: 0 });
  fixture = null;
}

test.describe.serial('Accountant database security contract', () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    fixture = await setup();
  });
  test.afterAll(async () => {
    test.setTimeout(120_000);
    await cleanup();
  });

  test('fails closed and exposes only exact capability-and-scope projections', async () => {
    test.setTimeout(120_000);
    if (!fixture) throw new Error('fixture missing');
    const { admin, clients: c, explicitMembership } = fixture;

    await test.step('invitation, five-capability ceiling, and direct canonical denials', async () => {
      const role = await rpc(c.explicit, 'current_user_role');
      expect(role).toMatchObject({ data: 'accountant', error: null });
      for (const capability of ['view_dashboard', 'view_rent', 'view_financials', 'view_documents', 'export_financials']) {
        expect((await rpc(c.explicit, 'current_user_has_capability', { p_capability: capability })).data).toBe(true);
      }
      for (const capability of ['view_calls', 'view_inbox', 'record_payment', 'manage_team_access', 'access_all_properties']) {
        expect((await rpc(c.explicit, 'current_user_has_capability', { p_capability: capability })).data).toBe(false);
      }

      const ownMembership = await table(c.explicit, 'organization_memberships')
        .select('id, user_id, organization_id, role, status, all_properties')
        .eq('id', explicitMembership);
      expect(ownMembership.error).toBeNull();
      expect(ownMembership.data).toEqual([
        {
          id: explicitMembership,
          user_id: fixture!.ids.explicit,
          organization_id: ORG,
          role: 'accountant',
          status: 'active',
          all_properties: false,
        },
      ]);
      const knownOtherMembership = await table(c.explicit, 'organization_memberships')
        .select('*')
        .eq('id', MEMBERSHIPS.manager);
      expect(knownOtherMembership).toMatchObject({ error: null, data: [] });

      for (const membershipId of [explicitMembership, MEMBERSHIPS.manager]) {
        const updated = await table(c.explicit, 'organization_memberships')
          .update({ updated_at: '2026-08-06T00:00:00.000Z' })
          .eq('id', membershipId)
          .select('id');
        expect(updated).toMatchObject({ error: null, data: [] });
        const deleted = await table(c.explicit, 'organization_memberships')
          .delete()
          .eq('id', membershipId)
          .select('id');
        expect(deleted).toMatchObject({ error: null, data: [] });
      }
      expect(
        (await table(admin, 'organization_memberships')
          .select('id')
          .in('id', [explicitMembership, MEMBERSHIPS.manager])).data,
      ).toHaveLength(2);

      const direct = [
        ['profiles', fixture!.ids.explicit], ['users', fixture!.ids.explicit],
        ['organizations', ORG], ['properties', P1], ['units', U1], ['tenants', T1],
        ['leases', L1], ['vendors', VENDOR],
        ['rent_events', fixture!.currentRentEvent], ['rent_payments', PAYMENT_REAL],
        ['documents', DOCUMENT_LEASE], ['mcp_api_keys', PROVIDER_KEY],
        ['messaging_recipient_consents', fixture!.consentId],
        ['messaging_consent_command_events', fixture!.commandEventId],
        ['messaging_consent_transitions', fixture!.consentTransitionId],
        ['message_delivery_callback_inbox', CALLBACK_INBOX],
      ] as const;
      for (const [name, id] of direct) {
        const result = await table(c.explicit, name).select('*').eq('id', id);
        expect(result.error, `${name}: ${result.error?.message ?? 'ok'}`).toBeNull();
        expect(result.data, name).toEqual([]);
      }
      const update = await table(c.explicit, 'properties')
        .update({ name: 'Unauthorized mutation' }).eq('id', P1).select('id');
      expect(update.data).toEqual([]);
      expect((await table(admin, 'properties').select('name').eq('id', P1).single()).data.name).toBe('Galaxy Ledger House');
    });

    await test.step('exact scoped projections, payment-time honesty, and document classification', async () => {
      const contextResult = await rpc(c.explicit, 'accountant_property_lease_context', { p_capability: 'view_dashboard' });
      expect(contextResult.error).toBeNull();
      const context = rows(contextResult.data, 'context');
      expect(new Set(context.map((row) => row.property_id))).toEqual(new Set([P1]));
      exact(context, PROPERTY_KEYS);

      const rentResult = await rpc(c.explicit, 'accountant_rent_events', { p_cycle_start: '2026-08-01', p_cycle_end: '2026-08-01' });
      expect(rentResult.error).toBeNull();
      const rent = rows(rentResult.data, 'rent');
      expect(rent.length).toBeGreaterThan(0);
      expect(new Set(rent.map((row) => row.property_id))).toEqual(new Set([P1]));
      exact(rent, RENT_KEYS);

      const paymentResult = await rpc(c.explicit, 'accountant_payment_history', { p_from: '2026-08-01T00:00:00Z', p_before: '2026-09-01T00:00:00Z', p_include_recorded_exceptions: true });
      expect(paymentResult.error).toBeNull();
      const payments = rows(paymentResult.data, 'payments');
      expect(payments.map((row) => row.payment_id).sort()).toEqual([PAYMENT_REAL, PAYMENT_UNDATED].sort());
      exact(payments, PAYMENT_KEYS);
      expect(payments.find((row) => row.payment_id === PAYMENT_REAL)).toMatchObject({ paid_at: '2026-08-04T16:00:00+00:00', period_basis: 'payment_time', matched: true });
      expect(payments.find((row) => row.payment_id === PAYMENT_UNDATED)).toMatchObject({ paid_at: null, period_basis: 'record_created_exception', matched: false });

      const documentResult = await rpc(c.explicit, 'accountant_document_index');
      expect(documentResult.error).toBeNull();
      const documents = rows(documentResult.data, 'documents');
      expect(documents.map((row) => row.document_id).sort()).toEqual([DOCUMENT_LEASE, DOCUMENT_PROPERTY].sort());
      exact(documents, DOCUMENT_KEYS);
      expect(JSON.stringify(documents)).not.toContain('Withheld private document');

      const invalidClass = await table(admin, 'documents').insert({
        organization_id: ORG, lease_id: L1, property_id: P1, type: 'lease',
        title: 'Invalid mixed classification', accountant_evidence_class: 'lease_evidence',
      });
      expect(invalidClass.error).not.toBeNull();
    });

    await test.step('no public direct-id oracle and deny-only capability narrowing', async () => {
      expect((await rpc(c.explicit, 'visible_property_ids')).data).toEqual([]);
      expect((await rpc(c.explicit, 'can_see_property', { p_property_id: P1 })).data).toBe(false);
      expect((await rpc(c.explicit, 'unit_property_id', { p_unit_id: U1 })).data).toBeNull();
      expect((await rpc(c.explicit, 'lease_property_id', { p_lease_id: L1 })).data).toBeNull();
      expect((await rpc(c.explicit, 'tenant_property_ids', { p_tenant_id: T1 })).data).toEqual([]);
      expect((await rpc(c.explicit, 'document_property_id', { p_document_id: DOCUMENT_LEASE })).data).toBeNull();

      await table(admin, 'membership_capability_overrides').insert({ membership_id: explicitMembership, capability: 'view_documents', effect: 'deny' });
      expect((await rpc(c.explicit, 'current_user_has_capability', { p_capability: 'view_documents' })).data).toBe(false);
      expect((await rpc(c.explicit, 'accountant_document_index')).error).not.toBeNull();
      expect((await rpc(c.explicit, 'accountant_rent_events', { p_cycle_start: '2026-08-01', p_cycle_end: '2026-08-01' })).error).toBeNull();
      await table(admin, 'membership_capability_overrides').delete().eq('membership_id', explicitMembership);

      const malicious = await table(admin, 'membership_capability_overrides').insert({ membership_id: explicitMembership, capability: 'view_calls', effect: 'allow' });
      expect(malicious.error).not.toBeNull();
      expect((await rpc(c.explicit, 'current_user_has_capability', { p_capability: 'view_calls' })).data).toBe(false);
    });

    await test.step('all, explicit, zero, revoked, suspended, ambiguous, and cross-org scope', async () => {
      await table(admin, 'organization_memberships').update({ all_properties: true }).eq('id', MEMBERSHIPS.scope);
      const allContext = rows((await rpc(c.scope, 'accountant_property_lease_context', { p_capability: 'view_dashboard' })).data, 'all context');
      expect(new Set(allContext.map((row) => row.property_id))).toEqual(new Set([P1, P2]));
      expect(allContext.find((row) => row.property_id === P2)?.property_archived_at).toBe('2026-07-31T00:00:00+00:00');

      await table(admin, 'organization_memberships').update({ all_properties: false }).eq('id', MEMBERSHIPS.scope);
      expect((await rpc(c.scope, 'accountant_property_lease_context', { p_capability: 'view_dashboard' })).data).toEqual([]);
      await table(admin, 'membership_property_grants').insert({ membership_id: MEMBERSHIPS.scope, organization_id: ORG, property_id: P2 });
      expect(new Set(rows((await rpc(c.scope, 'accountant_property_lease_context', { p_capability: 'view_dashboard' })).data, 'explicit p2').map((row) => row.property_id))).toEqual(new Set([P2]));
      await table(admin, 'membership_property_grants').delete().eq('membership_id', MEMBERSHIPS.scope);
      expect((await rpc(c.scope, 'accountant_property_lease_context', { p_capability: 'view_dashboard' })).data).toEqual([]);

      await table(admin, 'organization_memberships').update({ status: 'suspended' }).eq('id', MEMBERSHIPS.scope);
      expect((await rpc(c.scope, 'current_user_role')).data).toBeNull();
      expect(
        (await table(c.scope, 'organization_memberships').select('id')).data,
      ).toEqual([]);
      expect((await rpc(c.scope, 'accountant_property_lease_context', { p_capability: 'view_dashboard' })).error).not.toBeNull();
      await table(admin, 'organization_memberships').update({ status: 'active' }).eq('id', MEMBERSHIPS.scope);

      expect((await rpc(c.revoked, 'current_user_role')).data).toBeNull();
      expect((await rpc(c.revoked, 'accountant_property_lease_context', { p_capability: 'view_dashboard' })).error).not.toBeNull();
      expect((await rpc(c.ambiguous, 'current_user_role')).data).toBeNull();
      expect(
        (await table(c.ambiguous, 'organization_memberships').select('id')).data,
      ).toEqual([]);
      expect((await rpc(c.ambiguous, 'accountant_property_lease_context', { p_capability: 'view_dashboard' })).error).not.toBeNull();

      const injection = await table(admin, 'membership_property_grants').insert({ membership_id: explicitMembership, organization_id: ORG, property_id: CROSS_PROPERTY });
      expect(injection.error).not.toBeNull();
    });

    await test.step('adjacent Owner, Manager, and VA behavior remains intact', async () => {
      expect((await table(c.owner, 'properties').select('id').in('id', [P1, P2])).data).toHaveLength(2);
      for (const adjacent of [c.manager, c.va]) {
        expect((await table(adjacent, 'properties').select('id').eq('id', P1)).data).toHaveLength(1);
        expect((await table(adjacent, 'properties').select('id').eq('id', P2)).data).toEqual([]);
        expect((await rpc(adjacent, 'accountant_property_lease_context', { p_capability: 'view_dashboard' })).error).not.toBeNull();
      }
      expect((await rpc(c.manager, 'current_user_has_capability', { p_capability: 'view_rent' })).data).toBe(true);
      expect((await rpc(c.va, 'current_user_has_capability', { p_capability: 'view_documents' })).data).toBe(true);
      expect((await rpc(c.va, 'current_user_has_capability', { p_capability: 'view_rent' })).data).toBe(false);
      expect((await rpc(c.owner, 'accountant_document_index')).error).not.toBeNull();

      const rekey = await table(c.owner, 'organization_memberships')
        .update({ id: 'accc4000-0000-4000-8000-000000000099' })
        .eq('id', MEMBERSHIPS.scope)
        .select('id');
      expect(rekey.error).not.toBeNull();
      expect(
        (await table(admin, 'organization_memberships')
          .select('id')
          .eq('id', MEMBERSHIPS.scope)
          .single()).data?.id,
      ).toBe(MEMBERSHIPS.scope);
    });

    await test.step('Owner lease deletion preserves shipped SET NULL behavior', async () => {
      const document = await table(admin, 'documents').insert({
        id: DOCUMENT_OWNER_DELETE,
        organization_id: ORG,
        lease_id: L2,
        type: 'lease',
        title: 'Owner deletion compatibility evidence',
        accountant_evidence_class: 'lease_evidence',
      });
      requireNoError(document, 'owner compatibility document insert failed');
      const deletion = await table(c.owner, 'leases').delete().eq('id', L2);
      expect(deletion.error).toBeNull();
      const retained = await table(admin, 'documents')
        .select('lease_id, accountant_evidence_class')
        .eq('id', DOCUMENT_OWNER_DELETE)
        .single();
      expect(retained).toMatchObject({
        error: null,
        data: { lease_id: null, accountant_evidence_class: null },
      });
    });
  });
});
