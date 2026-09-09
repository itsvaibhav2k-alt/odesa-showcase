/**
 * Local helpers for the tenant-portal Playwright suite (Wave 0).
 *
 * `provisionPortalTenant()` mirrors `provisionGalaxyUser` in
 * `e2e/today/helpers.ts`: the admin client seeds a fresh tenant (unique
 * phone) + active lease + current-month rent_event inside the seeded
 * Galaxy org, and returns ids + a teardown. `signInPortal()` drives the
 * real /portal/login OTP flow, pulling the 6-digit code out of the
 * messaging mock via /api/messaging/test-hooks — the spec must install
 * `createMessagingMockHarness` BEFORE calling it.
 *
 * Same HAVE_SUPABASE gating pattern as e2e/today/helpers.ts.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

import type { Database } from '../../src/types/database';
import {
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  GALAXY_ORG_ID,
  TEST_HOOKS_HEADERS,
} from '../fixtures/manifest';

export { HAVE_SUPABASE, GALAXY_ORG_ID } from '../fixtures/manifest';

export function createAdmin(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface ProvisionPortalTenantOptions {
  /** Current-month rent_event state (default 'owing': pending, $0 paid). */
  rent?: 'owing' | 'paid';
  /** Also insert a Stripe-shaped rent_payments row with a receipt link. */
  withPayment?: boolean;
  /**
   * Also seed a conversation with one sent outbound + one inbound + one
   * UNAPPROVED draft (sent_at null) — the draft body must NEVER render
   * in the portal.
   */
  withThread?: boolean;
}

export interface SeededPortalTenant {
  organizationId: string;
  propertyId: string;
  unitId: string;
  tenantId: string;
  leaseId: string;
  rentEventId: string;
  phoneE164: string;
  fullName: string;
  /** "Portal E2E Property … · Unit P-…" as the portal renders it. */
  addressLine: string;
  /** Set when `withThread` — bodies to assert on. */
  thread: { sentBody: string; inboundBody: string; draftBody: string } | null;
  teardown: () => Promise<void>;
}

/** First day of the current month as YYYY-MM-01 (rent_events.cycle_month). */
function currentCycleMonth(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

/**
 * Seeds a fresh tenant + active lease + current-month rent_event in the
 * Galaxy org. The phone is unique per call (+1571555 + random 1000-9999 —
 * seeded fixture numbers all use 0xxx suffixes, so no collision with
 * supabase/seed.sql) which keeps the OTP flow's multi-match logic out of
 * play and the per-phone rate limiter fresh per test.
 */
export async function provisionPortalTenant(
  options: ProvisionPortalTenantOptions = {},
): Promise<SeededPortalTenant> {
  const hostname = new URL(SUPABASE_URL).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
    throw new Error(
      `Refusing to provision an e2e tenant against non-local Supabase host: ${hostname}`,
    );
  }

  const admin = createAdmin();
  const stamp = Date.now();
  const suffix = 1000 + Math.floor(Math.random() * 9000);
  const phoneE164 = `+1571555${suffix}`;
  const fullName = `Portal Tester ${stamp}-${suffix}`;

  const { data: property, error: propErr } = await admin
    .from('properties')
    .insert({
      organization_id: GALAXY_ORG_ID,
      name: `Portal E2E Property ${stamp}-${suffix}`,
    })
    .select('id')
    .single();
  if (propErr || !property) {
    throw new Error(`portal tenant: property insert failed: ${propErr?.message}`);
  }

  const teardownIds = {
    propertyId: property.id,
    tenantId: '',
    leaseId: '',
    conversationId: '',
  };
  const teardown = async () => {
    // Reverse dependency order; portal_otps is not in the generated types
    // yet (pre-regen) and may not exist if the migration hasn't applied —
    // swallow that one.
    if (teardownIds.tenantId) {
      await admin
        .from('portal_otps' as never)
        .delete()
        .eq('tenant_id', teardownIds.tenantId)
        .then(() => undefined, () => undefined);
      await admin
        .from('messaging_recipient_consents')
        .delete()
        .eq('recipient_e164', phoneE164)
        .then(() => undefined, () => undefined);
    }
    if (teardownIds.conversationId) {
      await admin
        .from('messages')
        .delete()
        .eq('conversation_id', teardownIds.conversationId);
      await admin
        .from('conversations')
        .delete()
        .eq('id', teardownIds.conversationId);
    }
    if (teardownIds.tenantId) {
      await admin
        .from('work_orders')
        .delete()
        .eq('tenant_id', teardownIds.tenantId);
    }
    if (teardownIds.leaseId) {
      await admin.from('rent_payments').delete().eq('lease_id', teardownIds.leaseId);
      await admin.from('rent_events').delete().eq('lease_id', teardownIds.leaseId);
      await admin.from('leases').delete().eq('id', teardownIds.leaseId);
    }
    if (teardownIds.tenantId) {
      await admin.from('tenants').delete().eq('id', teardownIds.tenantId);
    }
    // Units cascade with the property in some schemas but not others —
    // delete explicitly, then the property.
    await admin.from('units').delete().eq('property_id', teardownIds.propertyId);
    await admin.from('properties').delete().eq('id', teardownIds.propertyId);
  };

  try {
    const { data: unit, error: unitErr } = await admin
      .from('units')
      .insert({
        organization_id: GALAXY_ORG_ID,
        property_id: property.id,
        label: `P-${suffix}`,
      })
      .select('id')
      .single();
    if (unitErr || !unit) {
      throw new Error(`portal tenant: unit insert failed: ${unitErr?.message}`);
    }

    const { data: tenant, error: tenantErr } = await admin
      .from('tenants')
      .insert({
        organization_id: GALAXY_ORG_ID,
        full_name: fullName,
        phone_e164: phoneE164,
      })
      .select('id')
      .single();
    if (tenantErr || !tenant) {
      throw new Error(`portal tenant: tenant insert failed: ${tenantErr?.message}`);
    }
    teardownIds.tenantId = tenant.id;

    const { data: lease, error: leaseErr } = await admin
      .from('leases')
      .insert({
        organization_id: GALAXY_ORG_ID,
        unit_id: unit.id,
        tenant_id: tenant.id,
        rent_amount: 1500,
        rent_due_day: 1,
        status: 'active',
        start_date: '2026-01-01',
      })
      .select('id')
      .single();
    if (leaseErr || !lease) {
      throw new Error(`portal tenant: lease insert failed: ${leaseErr?.message}`);
    }
    teardownIds.leaseId = lease.id;

    const cycle = currentCycleMonth();
    const paid = options.rent === 'paid';
    const { data: rentEvent, error: reErr } = await admin
      .from('rent_events')
      .insert({
        organization_id: GALAXY_ORG_ID,
        lease_id: lease.id,
        cycle_month: cycle,
        due_date: cycle,
        amount_due: 1500,
        amount_paid: paid ? 1500 : 0,
        status: paid ? 'paid' : 'pending',
      })
      .select('id')
      .single();
    if (reErr || !rentEvent) {
      throw new Error(`portal tenant: rent_event insert failed: ${reErr?.message}`);
    }

    if (options.withPayment) {
      const { error: payErr } = await admin.from('rent_payments').insert({
        organization_id: GALAXY_ORG_ID,
        tenant_id: tenant.id,
        lease_id: lease.id,
        rent_event_id: rentEvent.id,
        amount_cents: 150000,
        status: 'succeeded',
        paid_at: new Date().toISOString(),
        payment_method_type: 'card',
        receipt_url: 'https://pay.stripe.test/receipts/portal-e2e',
        stripe_payment_intent_id: `pi_portal_e2e_${stamp}${suffix}`,
      });
      if (payErr) {
        throw new Error(`portal tenant: rent_payment insert failed: ${payErr.message}`);
      }
    }

    let thread: SeededPortalTenant['thread'] = null;
    if (options.withThread) {
      const { data: conversation, error: convErr } = await admin
        .from('conversations')
        .insert({
          organization_id: GALAXY_ORG_ID,
          tenant_id: tenant.id,
          channel: 'sms',
          last_message_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (convErr || !conversation) {
        throw new Error(
          `portal tenant: conversation insert failed: ${convErr?.message}`,
        );
      }
      teardownIds.conversationId = conversation.id;

      thread = {
        sentBody: `Portal e2e sent reply ${stamp}-${suffix}`,
        inboundBody: `Portal e2e inbound question ${stamp}-${suffix}`,
        draftBody: `UNAPPROVED-DRAFT-SECRET ${stamp}-${suffix} must never render`,
      };
      const base = Date.now();
      const { error: msgErr } = await admin.from('messages').insert([
        {
          organization_id: GALAXY_ORG_ID,
          conversation_id: conversation.id,
          direction: 'inbound',
          body: thread.inboundBody,
          provider: 'twilio',
          // Neutral values for inbound rows, matching handle-inbound.ts
          draft_status: 'auto_sent',
          delivery_status: 'delivered',
          created_at: new Date(base - 2 * 60_000).toISOString(),
        },
        {
          organization_id: GALAXY_ORG_ID,
          conversation_id: conversation.id,
          direction: 'outbound',
          body: thread.sentBody,
          provider: 'twilio',
          draft_status: 'approved',
          delivery_status: 'delivered',
          sent_at: new Date(base - 60_000).toISOString(),
          created_at: new Date(base - 60_000).toISOString(),
        },
        {
          // The unapproved draft: outbound with sent_at NULL — must be
          // invisible in the portal thread.
          organization_id: GALAXY_ORG_ID,
          conversation_id: conversation.id,
          direction: 'outbound',
          body: thread.draftBody,
          provider: 'twilio',
          draft_status: 'pending_review',
          delivery_status: 'draft',
          created_at: new Date(base).toISOString(),
        },
      ]);
      if (msgErr) {
        throw new Error(`portal tenant: messages insert failed: ${msgErr.message}`);
      }
    }

    return {
      organizationId: GALAXY_ORG_ID,
      propertyId: property.id,
      unitId: unit.id,
      tenantId: tenant.id,
      leaseId: lease.id,
      rentEventId: rentEvent.id,
      phoneE164,
      fullName,
      // No address_street on the e2e property → the portal falls back to
      // "property name · Unit label".
      addressLine: `Portal E2E Property ${stamp}-${suffix} · Unit P-${suffix}`,
      thread,
      teardown,
    };
  } catch (err) {
    await teardown().catch(() => {});
    throw err;
  }
}

/**
 * Reads the latest OTP code texted to `phoneE164` from the messaging
 * mock's recorded sends (GET /api/messaging/test-hooks, gated by
 * MESSAGING_TEST_HOOKS=1 + TEST_HOOKS_SECRET — same calling pattern as
 * e2e/mocks/messaging-mock.ts). Polls briefly in case the recorded send
 * lands just after the form transition.
 */
export async function fetchPortalOtpCode(
  request: APIRequestContext,
  phoneE164: string,
): Promise<string> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const resp = await request.get('/api/messaging/test-hooks', {
      headers: TEST_HOOKS_HEADERS,
    });
    const json = (await resp.json()) as {
      data?: { recorded?: Array<{ to: string; body: string }> };
    };
    const mine = (json.data?.recorded ?? []).filter((r) => r.to === phoneE164);
    const last = mine[mine.length - 1];
    const code = last?.body.match(/\b(\d{6})\b/)?.[1];
    if (code) return code;
    if (Date.now() > deadline) {
      throw new Error(
        `No OTP recorded for the provisioned portal phone (recorded sends: ${
          json.data?.recorded?.length ?? 0
        }) — is the messaging mock installed?`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Drives the real /portal/login UI end-to-end: enter phone → request
 * code → read the code from the messaging mock → submit → land on
 * /portal. Requires the messaging mock to be installed first
 * (createMessagingMockHarness(request).install()).
 */
export async function signInPortal(
  page: Page,
  phoneE164: string,
): Promise<void> {
  // The production OTP limiter is 30 requests per IP / 15 minutes. A full
  // Playwright run signs in many independently provisioned tenants through
  // one loopback address, so give each unique phone a deterministic TEST-NET
  // IPv6 address instead of letting the harness throttle itself.
  const phoneSuffix = phoneE164.replace(/\D/g, '').slice(-8);
  await page.setExtraHTTPHeaders({
    'x-forwarded-for': `2001:db8::${phoneSuffix}`,
  });
  await page.goto('/portal/login');
  await page.getByTestId('portal-phone-input').fill(phoneE164);
  await page.getByTestId('portal-phone-submit').click();
  await expect(page.getByTestId('portal-code-input')).toBeVisible({
    timeout: 10_000,
  });

  const code = await fetchPortalOtpCode(page.request, phoneE164);
  await page.getByTestId('portal-code-input').fill(code);
  await page.getByTestId('portal-code-submit').click();
  // Exactly /portal — NOT /portal/login (which would also match a loose
  // /\/portal/ regex).
  await page.waitForURL((url) => url.pathname === '/portal', {
    timeout: 15_000,
  });
}
