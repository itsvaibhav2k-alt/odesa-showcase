/**
 * Integration suite for the reconcile_succeeded_rent_payment RPC
 * (supabase/migrations/20260710005946_atomic_stripe_rent_reconciliation.sql).
 *
 * Pure supabase-js — no page/browser usage, so it runs without a web
 * server (same pattern as e2e/supabase/rls.spec.ts). Exercises the
 * money-critical invariants directly against local Postgres:
 *
 *   - full + partial payments update rent_events.amount_paid (clamped
 *     at amount_due) and derive status from the balance;
 *   - replays and concurrent deliveries apply the amount exactly once;
 *   - provider amount/currency mismatches fail closed (zero mutation);
 *   - unlinked payments never touch rent_events;
 *   - anon role cannot execute the function (REVOKE verified);
 *   - the /financials read model (collected from rent_events.amount_paid)
 *     agrees with the rent_payments row after reconciliation.
 *
 * Skipped when the local Supabase env is absent.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import type { Database } from '../../src/types/database';

// =====================================================================
// Environment resolution (mirrors e2e/supabase/rls.spec.ts)
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
// Helpers
// =====================================================================

type Admin = SupabaseClient<Database>;

const PAID_AT = '2026-07-01T12:00:00.000Z';

function createAdmin(): Admin {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** dollars → integer cents, same defensive shape as financials/queries.ts. */
function dollarsToCents(dollars: number | string | null | undefined): number {
  if (dollars === null || dollars === undefined) return 0;
  const value = typeof dollars === 'string' ? Number(dollars) : dollars;
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

async function insertAndReturnId(
  admin: Admin,
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

interface SeededCase {
  leaseId: string;
  rentEventId: string | null;
  rentPaymentId: string;
  intentId: string;
}

interface SeedCaseOptions {
  dueDollars?: number;
  paidDollars?: number;
  amountCents: number;
  currency?: string;
  linked?: boolean;
}

let intentCounter = 0;

interface ReconcileResult {
  data: unknown;
  error: { message: string } | null;
}

/** Reconcile RPC call with the standard args; overrides for mismatch cases. */
async function callReconcile(
  client: Admin,
  intentId: string,
  overrides: {
    providerAmountCents?: number;
    providerCurrency?: string;
  } = {},
): Promise<ReconcileResult> {
  const { data, error } = await client.rpc(
    'reconcile_succeeded_rent_payment',
    {
      p_stripe_payment_intent_id: intentId,
      p_paid_at: PAID_AT,
      p_payment_method_type: 'card',
      p_receipt_url: 'https://pay.stripe.com/receipts/e2e',
      p_provider_amount_cents: overrides.providerAmountCents,
      p_provider_currency: overrides.providerCurrency,
    },
  );
  return { data, error };
}

// =====================================================================
// Suite
// =====================================================================

test.describe('reconcile_succeeded_rent_payment RPC', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let admin: Admin;
  let orgId: string;
  let userId: string;
  let unitId: string;
  let tenantId: string;
  /** Leases created by the current test — deleted (CASCADE) afterEach. */
  let caseLeaseIds: string[] = [];

  test.beforeAll(async () => {
    admin = createAdmin();

    const stamp = Date.now();
    const email = `stripe.recon.${stamp}@odesa.test`;
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password: `pw-${stamp}-Aa1!`,
        email_confirm: true,
        user_metadata: {
          organization_name: `Stripe Recon Org ${stamp}`,
          full_name: 'Stripe Recon Owner',
        },
      });
    if (createErr || !created.user) {
      throw new Error(`createUser failed: ${createErr?.message ?? 'unknown'}`);
    }
    userId = created.user.id;

    const { data: userRow, error: userErr } = await admin
      .from('users')
      .select('organization_id')
      .eq('id', userId)
      .single();
    if (userErr || !userRow) {
      throw new Error(`users read-back failed: ${userErr?.message ?? 'no row'}`);
    }
    orgId = userRow.organization_id;

    const propertyId = await insertAndReturnId(admin, 'properties', {
      organization_id: orgId,
      name: 'Recon Test Property',
      address_street: '1 Reconciliation Way',
      address_city: 'Arlington',
      address_state: 'VA',
      address_zip: '22201',
    });
    unitId = await insertAndReturnId(admin, 'units', {
      organization_id: orgId,
      property_id: propertyId,
      label: 'R1',
      bedrooms: 1,
      bathrooms: 1.0,
      square_feet: 650,
    });
    tenantId = await insertAndReturnId(admin, 'tenants', {
      organization_id: orgId,
      full_name: 'Recon Tenant',
      phone_e164: `+1571555${Math.floor(1000 + Math.random() * 8999)}`,
      email: `recon.tenant.${stamp}@example.com`,
    });
  });

  test.afterEach(async () => {
    // Each test's lease cascades its rent_events + rent_payments away,
    // so the org's rent_events set is empty between tests (keeps the
    // org-level read-model assertion in the last test hermetic).
    for (const leaseId of caseLeaseIds) {
      await admin.from('leases').delete().eq('id', leaseId);
    }
    caseLeaseIds = [];
  });

  test.afterAll(async () => {
    if (orgId) await admin.from('organizations').delete().eq('id', orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  /** Seed one lease + rent_event (unless unlinked) + pending rent_payment. */
  async function seedCase(options: SeedCaseOptions): Promise<SeededCase> {
    const {
      dueDollars = 2000.0,
      paidDollars = 0,
      amountCents,
      currency = 'usd',
      linked = true,
    } = options;

    const leaseId = await insertAndReturnId(admin, 'leases', {
      organization_id: orgId,
      unit_id: unitId,
      tenant_id: tenantId,
      rent_amount: dueDollars,
      rent_due_day: 1,
      late_fee_policy: { grace_days: 3, fixed_fee_cents: 5000 },
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      status: 'active',
    });
    caseLeaseIds.push(leaseId);

    const rentEventId = await insertAndReturnId(admin, 'rent_events', {
      organization_id: orgId,
      lease_id: leaseId,
      cycle_month: '2026-07-01',
      amount_due: dueDollars,
      amount_paid: paidDollars,
      status: 'pending',
      due_date: '2026-07-01',
    });

    intentCounter += 1;
    const intentId = `pi_e2e_recon_${Date.now()}_${intentCounter}`;
    const rentPaymentId = await insertAndReturnId(admin, 'rent_payments', {
      organization_id: orgId,
      lease_id: leaseId,
      tenant_id: tenantId,
      rent_event_id: linked ? rentEventId : null,
      stripe_payment_intent_id: intentId,
      amount_cents: amountCents,
      currency,
      status: 'pending',
    });

    // The rent_events row is ALWAYS seeded — for unlinked cases it acts
    // as the canary proving the RPC mutates no rent_events row.
    return { leaseId, rentEventId, rentPaymentId, intentId };
  }

  async function readPayment(id: string) {
    const { data, error } = await admin
      .from('rent_payments')
      .select('status, paid_at, payment_method_type, receipt_url, amount_cents')
      .eq('id', id)
      .single();
    if (error || !data) throw new Error(`payment read failed: ${error?.message}`);
    return data;
  }

  async function readEvent(id: string) {
    const { data, error } = await admin
      .from('rent_events')
      .select('amount_due, amount_paid, status')
      .eq('id', id)
      .single();
    if (error || !data) throw new Error(`event read failed: ${error?.message}`);
    return data;
  }

  test('full payment: amount_paid = due, status paid, applied = full amount', async () => {
    const seeded = await seedCase({ dueDollars: 2000.0, amountCents: 200000 });

    const { data, error } = await callReconcile(admin, seeded.intentId, {
      providerAmountCents: 200000,
      providerCurrency: 'usd',
    });

    expect(error).toBeNull();
    const row = (data as Array<Record<string, unknown>>)[0]!;
    expect(row).toMatchObject({
      payment_id: seeded.rentPaymentId,
      rent_event_id: seeded.rentEventId,
      applied_cents: 200000,
      paid_cents_after: 200000,
      due_cents: 200000,
      event_status: 'paid',
      replay: false,
      overpayment_cents: 0,
    });

    const payment = await readPayment(seeded.rentPaymentId);
    expect(payment.status).toBe('succeeded');
    expect(payment.paid_at).toBeTruthy();
    expect(payment.payment_method_type).toBe('card');
    expect(payment.receipt_url).toBe('https://pay.stripe.com/receipts/e2e');

    const event = await readEvent(seeded.rentEventId!);
    expect(dollarsToCents(event.amount_paid)).toBe(200000);
    expect(event.status).toBe('paid');
  });

  test('partial payment: amount_paid increments, status stays non-paid, outstanding honest', async () => {
    const seeded = await seedCase({ dueDollars: 2000.0, amountCents: 50000 });

    const { data, error } = await callReconcile(admin, seeded.intentId, {
      providerAmountCents: 50000,
      providerCurrency: 'usd',
    });

    expect(error).toBeNull();
    const row = (data as Array<Record<string, unknown>>)[0]!;
    expect(row).toMatchObject({
      applied_cents: 50000,
      paid_cents_after: 50000,
      due_cents: 200000,
      event_status: 'pending',
      replay: false,
      overpayment_cents: 0,
    });

    const event = await readEvent(seeded.rentEventId!);
    expect(dollarsToCents(event.amount_paid)).toBe(50000);
    expect(event.status).not.toBe('paid');
    // Outstanding derived the same way the read model does it.
    expect(
      dollarsToCents(event.amount_due) - dollarsToCents(event.amount_paid),
    ).toBe(150000);
  });

  test('replay: second call returns replay=true with stable values, amount applied exactly once', async () => {
    const seeded = await seedCase({ dueDollars: 2000.0, amountCents: 200000 });

    const first = await callReconcile(admin, seeded.intentId, {
      providerAmountCents: 200000,
      providerCurrency: 'usd',
    });
    expect(first.error).toBeNull();

    const second = await callReconcile(admin, seeded.intentId, {
      providerAmountCents: 200000,
      providerCurrency: 'usd',
    });
    expect(second.error).toBeNull();
    const replayRow = (second.data as Array<Record<string, unknown>>)[0]!;
    expect(replayRow).toMatchObject({
      payment_id: seeded.rentPaymentId,
      rent_event_id: seeded.rentEventId,
      applied_cents: 0,
      paid_cents_after: 200000,
      due_cents: 200000,
      event_status: 'paid',
      replay: true,
      overpayment_cents: 0,
    });

    // Stable: a third replay returns the identical result.
    const third = await callReconcile(admin, seeded.intentId, {
      providerAmountCents: 200000,
      providerCurrency: 'usd',
    });
    expect(third.error).toBeNull();
    expect((third.data as unknown[])[0]).toEqual(replayRow);

    // Incremented exactly once.
    const event = await readEvent(seeded.rentEventId!);
    expect(dollarsToCents(event.amount_paid)).toBe(200000);
  });

  test('terminal statuses are replay-guarded: a refunded payment is never re-succeeded or re-applied', async () => {
    const seeded = await seedCase({ dueDollars: 2000.0, amountCents: 200000 });

    // Simulate a refund landing before a late/resent succeeded webhook.
    const { error: refundError } = await admin
      .from('rent_payments')
      .update({ status: 'refunded' })
      .eq('id', seeded.rentPaymentId);
    expect(refundError).toBeNull();

    const { data, error } = await callReconcile(admin, seeded.intentId, {
      providerAmountCents: 200000,
      providerCurrency: 'usd',
    });

    // Zero mutation: refunded stays refunded, the cycle is untouched.
    expect(error).toBeNull();
    const row = (data as Array<Record<string, unknown>>)[0]!;
    expect(row.replay).toBe(true);
    expect(row.applied_cents).toBe(0);

    const payment = await readPayment(seeded.rentPaymentId);
    expect(payment.status).toBe('refunded');
    const event = await readEvent(seeded.rentEventId!);
    expect(dollarsToCents(event.amount_paid)).toBe(0);
    expect(event.status).toBe('pending');
  });

  test('concurrency: two simultaneous calls apply the amount exactly once', async () => {
    const seeded = await seedCase({ dueDollars: 2000.0, amountCents: 200000 });

    const results = await Promise.allSettled([
      callReconcile(admin, seeded.intentId, {
        providerAmountCents: 200000,
        providerCurrency: 'usd',
      }),
      callReconcile(admin, seeded.intentId, {
        providerAmountCents: 200000,
        providerCurrency: 'usd',
      }),
    ]);

    const rows: Array<Record<string, unknown>> = [];
    for (const result of results) {
      expect(result.status).toBe('fulfilled');
      if (result.status === 'fulfilled') {
        expect(result.value.error).toBeNull();
        rows.push((result.value.data as Array<Record<string, unknown>>)[0]!);
      }
    }

    // One call applied; the other blocked on the row lock, re-read a
    // succeeded row, and replayed.
    const replays = rows.filter((r) => r.replay === true);
    const applies = rows.filter((r) => r.replay === false);
    expect(replays).toHaveLength(1);
    expect(applies).toHaveLength(1);
    expect(applies[0]!.applied_cents).toBe(200000);
    expect(replays[0]!.applied_cents).toBe(0);

    const event = await readEvent(seeded.rentEventId!);
    expect(dollarsToCents(event.amount_paid)).toBe(200000);
  });

  test('amount mismatch fails closed: payment stays pending, event untouched', async () => {
    const seeded = await seedCase({ dueDollars: 2000.0, amountCents: 50000 });

    const { error } = await callReconcile(admin, seeded.intentId, {
      providerAmountCents: 999999,
      providerCurrency: 'usd',
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain('amount_mismatch');

    const payment = await readPayment(seeded.rentPaymentId);
    expect(payment.status).toBe('pending');
    const event = await readEvent(seeded.rentEventId!);
    expect(dollarsToCents(event.amount_paid)).toBe(0);
    expect(event.status).toBe('pending');
  });

  test('currency mismatch fails closed: payment stays pending, event untouched', async () => {
    const seeded = await seedCase({ dueDollars: 2000.0, amountCents: 50000 });

    const { error } = await callReconcile(admin, seeded.intentId, {
      providerAmountCents: 50000,
      providerCurrency: 'eur',
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain('currency_mismatch');

    const payment = await readPayment(seeded.rentPaymentId);
    expect(payment.status).toBe('pending');
    const event = await readEvent(seeded.rentEventId!);
    expect(dollarsToCents(event.amount_paid)).toBe(0);
    expect(event.status).toBe('pending');
  });

  test('unlinked payment: own row updated, no rent_events row mutated', async () => {
    const seeded = await seedCase({
      dueDollars: 2000.0,
      amountCents: 50000,
      linked: false,
    });

    const { data, error } = await callReconcile(admin, seeded.intentId, {
      providerAmountCents: 50000,
      providerCurrency: 'usd',
    });

    expect(error).toBeNull();
    const row = (data as Array<Record<string, unknown>>)[0]!;
    expect(row).toMatchObject({
      payment_id: seeded.rentPaymentId,
      rent_event_id: null,
      applied_cents: 0,
      paid_cents_after: 0,
      due_cents: 0,
      event_status: null,
      replay: false,
      overpayment_cents: 0,
    });

    const payment = await readPayment(seeded.rentPaymentId);
    expect(payment.status).toBe('succeeded');

    // The seeded (never-linked) rent_events row is untouched.
    const event = await readEvent(seeded.rentEventId!);
    expect(dollarsToCents(event.amount_paid)).toBe(0);
    expect(event.status).toBe('pending');
  });

  test('privilege: anon-key client cannot execute the rpc (REVOKE verified)', async () => {
    const seeded = await seedCase({ dueDollars: 2000.0, amountCents: 200000 });

    const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await callReconcile(anon, seeded.intentId, {
      providerAmountCents: 200000,
      providerCurrency: 'usd',
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/permission denied/i);

    // Fail closed: nothing moved.
    const payment = await readPayment(seeded.rentPaymentId);
    expect(payment.status).toBe('pending');
  });

  test('cross-read-model agreement: financials collected from rent_events matches the payment row', async () => {
    const seeded = await seedCase({ dueDollars: 2000.0, amountCents: 200000 });

    const { error } = await callReconcile(admin, seeded.intentId, {
      providerAmountCents: 200000,
      providerCurrency: 'usd',
    });
    expect(error).toBeNull();

    // Query rent_events the way src/lib/financials/queries.ts does:
    // billed = Σ amount_due, collected = Σ amount_paid, per org.
    const { data: events, error: eventsError } = await admin
      .from('rent_events')
      .select('lease_id, cycle_month, amount_due, amount_paid, status, due_date')
      .eq('organization_id', orgId);
    expect(eventsError).toBeNull();

    let billedCents = 0;
    let collectedCents = 0;
    for (const event of events ?? []) {
      billedCents += dollarsToCents(event.amount_due);
      collectedCents += dollarsToCents(event.amount_paid);
    }

    expect(billedCents).toBe(200000);
    expect(collectedCents).toBe(200000); // == $2000.00 collected
    expect(billedCents - collectedCents).toBe(0); // no phantom outstanding

    // Agreement with the payment row: the read model reports exactly
    // what Stripe captured.
    const payment = await readPayment(seeded.rentPaymentId);
    expect(payment.status).toBe('succeeded');
    expect(payment.amount_cents).toBe(collectedCents);
  });
});
