/**
 * Supabase RLS isolation regression suite for v1.5 surfaces.
 *
 * Covers the three new tables introduced by migration
 * `20260428000000_property_workers.sql`:
 *   - memory_facts
 *   - action_proposals
 *   - meta_insights
 *
 * Mirrors the pattern in `rls.spec.ts`: provision two orgs via the
 * post-signup trigger, seed one row in each table per org via the admin
 * client, then verify cross-org reads/writes are denied under each org's
 * authenticated user JWT.
 *
 * Skipped when SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY are not set.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import type { Database } from '../../src/types/database';

// =====================================================================
// Environment resolution
// =====================================================================

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  '';

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  '';

const HAVE_SUPABASE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY);

// =====================================================================
// Types
// =====================================================================

interface SeededOrg {
  orgId: string;
  userId: string;
  email: string;
  password: string;
  propertyId: string;
  memoryFactId: string;
  actionProposalId: string;
  metaInsightId: string;
}

const V15_TABLES = ['memory_facts', 'action_proposals', 'meta_insights'] as const;

// =====================================================================
// Helpers
// =====================================================================

function createAdmin(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function createUserClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function insertAndReturnId(
  admin: SupabaseClient<Database>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from(table) as any)
    .insert(row)
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(
      `insert into ${table} failed: ${error?.message ?? 'no row returned'}`,
    );
  }
  return data.id as string;
}

async function seedOrg(
  admin: SupabaseClient<Database>,
  orgName: string,
  ownerEmail: string,
  ownerPassword: string,
): Promise<SeededOrg> {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
    user_metadata: {
      organization_name: orgName,
      full_name: `${orgName} Owner`,
    },
  });

  if (createErr || !created.user) {
    throw new Error(
      `createUser failed for ${ownerEmail}: ${createErr?.message ?? 'unknown'}`,
    );
  }

  const userId = created.user.id;

  const { data: userRow, error: userErr } = await admin
    .from('users')
    .select('organization_id')
    .eq('id', userId)
    .single();

  if (userErr || !userRow) {
    throw new Error(
      `Failed to read back users row for ${ownerEmail}: ${userErr?.message ?? 'no row'}`,
    );
  }

  const orgId = userRow.organization_id;

  const propertyId = await insertAndReturnId(admin, 'properties', {
    organization_id: orgId,
    name: `${orgName} HQ`,
    address_street: '1 Worker Way',
    address_city: 'Arlington',
    address_state: 'VA',
    address_zip: '22201',
  });

  const memoryFactId = await insertAndReturnId(admin, 'memory_facts', {
    organization_id: orgId,
    property_id: propertyId,
    fact_type: 'building_quirk',
    content: { note: `${orgName} elevator runs slow on cold mornings` },
    confidence: 0.8,
    source: 'observed',
  });

  const actionProposalId = await insertAndReturnId(admin, 'action_proposals', {
    organization_id: orgId,
    property_id: propertyId,
    worker_model: 'haiku-4-5',
    action_type: 'draft_sms_reply',
    payload: { body: `Thanks for the message — ${orgName}` },
    reasoning: 'Tenant asked routine question; reply is non-sensitive.',
    confidence: 0.9,
    gate_decision: 'auto',
  });

  const metaInsightId = await insertAndReturnId(admin, 'meta_insights', {
    organization_id: orgId,
    pattern_type: 'seasonal_complaint_spike',
    affected_property_ids: [propertyId],
    insight: `${orgName} sees AC complaints in week 3 of July.`,
    recommended_action: { type: 'proactive_thermostat_tips', timing: 'july_w2' },
  });

  return {
    orgId,
    userId,
    email: ownerEmail,
    password: ownerPassword,
    propertyId,
    memoryFactId,
    actionProposalId,
    metaInsightId,
  };
}

async function signInAndGetClient(
  email: string,
  password: string,
): Promise<SupabaseClient<Database>> {
  const authClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error(
      `signInWithPassword failed for ${email}: ${error?.message ?? 'no session'}`,
    );
  }
  return createUserClient(data.session.access_token);
}

async function teardownOrg(
  admin: SupabaseClient<Database>,
  org: SeededOrg,
): Promise<void> {
  // ON DELETE CASCADE on organizations wipes the v1.5 children too
  // (memory_facts, action_proposals, meta_insights).
  await admin.from('organizations').delete().eq('id', org.orgId);
  await admin.auth.admin.deleteUser(org.userId);
}

// =====================================================================
// Tests
// =====================================================================

test.describe('supabase RLS isolation — v1.5 surfaces', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let admin: SupabaseClient<Database>;
  let orgA: SeededOrg;
  let orgB: SeededOrg;
  let clientA: SupabaseClient<Database>;
  let clientB: SupabaseClient<Database>;

  test.beforeAll(async () => {
    admin = createAdmin();

    const stamp = Date.now();
    orgA = await seedOrg(
      admin,
      `RLS V15 A ${stamp}`,
      `rls.v15.a.${stamp}@odesa.test`,
      'rls-v15-test-password-a',
    );
    orgB = await seedOrg(
      admin,
      `RLS V15 B ${stamp}`,
      `rls.v15.b.${stamp}@odesa.test`,
      'rls-v15-test-password-b',
    );

    clientA = await signInAndGetClient(orgA.email, orgA.password);
    clientB = await signInAndGetClient(orgB.email, orgB.password);
  });

  test.afterAll(async () => {
    if (!admin) return;
    if (orgA) await teardownOrg(admin, orgA);
    if (orgB) await teardownOrg(admin, orgB);
  });

  test('user A sees only org A rows across v1.5 tables', async () => {
    for (const table of V15_TABLES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (clientA.from(table) as any).select(
        'organization_id, id',
      );

      expect(error, `select on ${table} should not error`).toBeNull();
      expect(data, `select on ${table} should return rows`).not.toBeNull();

      for (const row of data as Array<{ organization_id: string; id: string }>) {
        expect(
          row.organization_id,
          `${table} row leaked from org B under user A JWT`,
        ).toBe(orgA.orgId);
      }
    }
  });

  test('user B sees only org B rows across v1.5 tables', async () => {
    for (const table of V15_TABLES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (clientB.from(table) as any).select(
        'organization_id, id',
      );

      expect(error, `select on ${table} should not error`).toBeNull();
      expect(data, `select on ${table} should return rows`).not.toBeNull();

      for (const row of data as Array<{ organization_id: string; id: string }>) {
        expect(
          row.organization_id,
          `${table} row leaked from org A under user B JWT`,
        ).toBe(orgB.orgId);
      }
    }
  });

  test('user A cannot directly read specific org B v1.5 row ids', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: fact } = await (clientA.from('memory_facts') as any)
      .select('id')
      .eq('id', orgB.memoryFactId)
      .maybeSingle();
    expect(fact).toBeNull();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: proposal } = await (clientA.from('action_proposals') as any)
      .select('id')
      .eq('id', orgB.actionProposalId)
      .maybeSingle();
    expect(proposal).toBeNull();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: insight } = await (clientA.from('meta_insights') as any)
      .select('id')
      .eq('id', orgB.metaInsightId)
      .maybeSingle();
    expect(insight).toBeNull();
  });

  test('user A cannot INSERT a memory_facts row with organization_id = org B', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (clientA.from('memory_facts') as any).insert({
      organization_id: orgB.orgId,
      property_id: orgB.propertyId,
      fact_type: 'building_quirk',
      content: { note: 'should fail' },
      source: 'observed',
    });

    expect(error, 'cross-org insert into memory_facts must be rejected').not.toBeNull();
  });

  test('user B cannot INSERT an action_proposals row with organization_id = org A', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (clientB.from('action_proposals') as any).insert({
      organization_id: orgA.orgId,
      property_id: orgA.propertyId,
      worker_model: 'haiku-4-5',
      action_type: 'draft_sms_reply',
      payload: { body: 'hijack' },
      reasoning: 'attempted cross-org insert',
      confidence: 0.5,
      gate_decision: 'auto',
    });

    expect(error, 'cross-org insert into action_proposals must be rejected').not.toBeNull();
  });

  test('user A cannot UPDATE an org B memory_facts row', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (clientA.from('memory_facts') as any)
      .update({ confidence: 0.01 })
      .eq('id', orgB.memoryFactId)
      .select();

    // RLS filters the target row out before the UPDATE applies.
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);

    // Re-read as admin to confirm the row is unchanged.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: unchanged } = await (admin.from('memory_facts') as any)
      .select('confidence')
      .eq('id', orgB.memoryFactId)
      .single();
    expect(Number(unchanged?.confidence)).not.toBe(0.01);
  });

  test('user A cannot DELETE an org B meta_insights row', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (clientA.from('meta_insights') as any)
      .delete()
      .eq('id', orgB.metaInsightId)
      .select();

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: stillThere } = await (admin.from('meta_insights') as any)
      .select('id')
      .eq('id', orgB.metaInsightId)
      .maybeSingle();
    expect(stillThere).not.toBeNull();
  });
});
