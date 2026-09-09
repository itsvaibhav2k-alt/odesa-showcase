/**
 * Playwright helpers for the Phase 4 messaging suite.
 *
 * Responsibilities:
 *   - Provision a throwaway organisation + owner that we can freely
 *     blast inbound webhooks at without stomping on the Galaxy seed.
 *   - Compute the Linq / Twilio webhook signatures specs need to pass
 *     signature verification.
 *   - Tear everything down on `afterEach` (auth user, stub org,
 *     tenants, conversations, messages).
 */

import { createHmac } from "crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { APIRequestContext, Page } from "@playwright/test";

import type {
  Database,
  MessagingProviderChoice,
} from "../../src/types/database";

export const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

export const HAVE_SUPABASE = Boolean(
  SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY,
);

// Test credentials used by the providers when no real env vars are
// present. Must match the defaults in `src/lib/messaging/linq.ts` and
// `src/lib/messaging/twilio.ts`. When cloud env overrides them
// (LINQ_WEBHOOK_SECRET / TWILIO_AUTH_TOKEN), prefer the live value so
// signed webhooks match what the dev server is verifying against.
export const LINQ_TEST_SECRET =
  process.env.LINQ_WEBHOOK_SECRET ?? "linq-test-secret";
export const TWILIO_TEST_TOKEN =
  process.env.TWILIO_AUTH_TOKEN ?? "twilio-test-token";

export function createAdmin(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface MessagingFixture {
  owner: {
    userId: string;
    email: string;
    password: string;
    phoneE164: string;
  };
  organizationId: string;
  /** Unique Odesa-side phone, used as the `to` in webhook payloads. */
  odesaPhoneE164: string;
  /** Tenant sending the inbound message (pre-seeded with a lease). */
  tenant: {
    id: string;
    phoneE164: string;
    fullName: string;
  };
  teardown: () => Promise<void>;
}

let counter = 0;

function uniqDigits(): string {
  counter += 1;
  return String(Date.now()).slice(-6) + String(counter).padStart(4, "0");
}

async function createUserWithRetry(
  admin: SupabaseClient<Database>,
  email: string,
  password: string,
  orgName: string,
): Promise<{ id: string }> {
  const maxAttempts = 4;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          organization_name: orgName,
          full_name: "Messaging Owner",
        },
      });
      if (error || !data.user) {
        lastError = error ?? new Error("no user returned");
      } else {
        return { id: data.user.id };
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `createUser failed after ${maxAttempts} attempts: ${message}`,
  );
}

/**
 * Provision a fresh org (with unique Odesa number), an owner account,
 * and one seeded tenant so inbound flow tests have a target. Every
 * call hands back a `teardown` that removes every row we created.
 */
export async function provisionMessagingFixture(
  opts: { messagingPrimary?: MessagingProviderChoice } = {},
): Promise<MessagingFixture> {
  const admin = createAdmin();
  const stamp = uniqDigits();
  const email = `msg.owner.${stamp}@messaging.test`;
  const password = `msg-${stamp}-secret`;
  const odesaPhoneE164 = `+1555${stamp}`;
  const tenantPhoneE164 = `+1666${stamp}`;
  const ownerPhoneE164 = `+1777${stamp}`;
  const orgName = `Messaging Org ${stamp}`;

  const { id: userId } = await createUserWithRetry(
    admin,
    email,
    password,
    orgName,
  );

  const { data: userRow } = await admin
    .from("users")
    .select("organization_id")
    .eq("id", userId)
    .single();
  const organizationId = userRow?.organization_id ?? "";
  if (!organizationId) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(
      "Post-signup trigger did not populate users.organization_id",
    );
  }

  // Stamp the Odesa phone + messaging_primary on the stub org the
  // trigger created (so inbound handler can resolve org by phone).
  await admin
    .from("organizations")
    .update({
      odesa_phone_number: odesaPhoneE164,
      messaging_primary: opts.messagingPrimary ?? "linq",
    })
    .eq("id", organizationId);
  await admin
    .from("users")
    .update({
      phone_e164: ownerPhoneE164,
      phone_verified_at: new Date().toISOString(),
    })
    .eq("id", userId);

  // Pre-seed a tenant so the inbound handler doesn't have to upsert.
  const { data: tenantRow, error: tenantErr } = await admin
    .from("tenants")
    .insert({
      organization_id: organizationId,
      full_name: "Msg Test Tenant",
      phone_e164: tenantPhoneE164,
    })
    .select("id, phone_e164, full_name")
    .single();
  if (tenantErr || !tenantRow) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    await admin.from("organizations").delete().eq("id", organizationId);
    throw new Error(`tenant insert failed: ${tenantErr?.message}`);
  }

  const teardown = async () => {
    // Cascades handle properties/units/tenants/leases/conversations/
    // messages on org delete; we still blow away the auth user first.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    await admin.from("organizations").delete().eq("id", organizationId);
  };

  return {
    owner: { userId, email, password, phoneE164: ownerPhoneE164 },
    organizationId,
    odesaPhoneE164,
    tenant: {
      id: tenantRow.id,
      phoneE164: tenantRow.phone_e164,
      fullName: tenantRow.full_name,
    },
    teardown,
  };
}

/**
 * Webhook + draft routes sometimes hit hosted-Supabase tail latency
 * (3-15s spikes). Give the client a 30s timeout so those are absorbed
 * inside the test instead of surfacing as a flaky 10s APIRequest abort.
 */
export const API_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Signature computation
// ---------------------------------------------------------------------------

export function linqSignature(): string {
  return LINQ_TEST_SECRET;
}

export function twilioSignature(
  url: string,
  params: Record<string, string>,
  token: string = TWILIO_TEST_TOKEN,
): string {
  const sortedKeys = Object.keys(params).sort();
  const joined = sortedKeys.reduce(
    (acc, k) => acc + k + (params[k] ?? ""),
    url,
  );
  return createHmac("sha1", token).update(joined, "utf8").digest("base64");
}

export function buildTwilioForm(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

// ---------------------------------------------------------------------------
// UI sign-in helper (shared pattern)
// ---------------------------------------------------------------------------

export async function signIn(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(credentials.email);
  await page.getByTestId("login-password").fill(credentials.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/(today|dashboard|onboarding)/, { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Helpers for inserting a pending_review draft directly (for approve /
// edit / reject specs that don't want to run the whole inbound flow).
// ---------------------------------------------------------------------------

export interface CreatedDraft {
  conversationId: string;
  draftId: string;
}

export async function insertDraftForTenant(
  fixture: MessagingFixture,
  body: string,
): Promise<CreatedDraft> {
  const admin = createAdmin();

  // Ensure an open conversation exists.
  const { data: openConv } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", fixture.organizationId)
    .eq("tenant_id", fixture.tenant.id)
    .eq("channel", "sms")
    .eq("status", "open")
    .maybeSingle();

  let conversationId = openConv?.id ?? null;
  if (!conversationId) {
    const { data, error } = await admin
      .from("conversations")
      .insert({
        organization_id: fixture.organizationId,
        tenant_id: fixture.tenant.id,
        channel: "sms",
        status: "open",
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`conversation insert failed: ${error?.message}`);
    }
    conversationId = data.id;
  }

  const { data: draft, error } = await admin
    .from("messages")
    .insert({
      organization_id: fixture.organizationId,
      conversation_id: conversationId,
      direction: "outbound",
      provider: "linq",
      body,
      draft_status: "pending_review",
    })
    .select("id")
    .single();
  if (error || !draft) {
    throw new Error(`draft insert failed: ${error?.message}`);
  }

  return { conversationId, draftId: draft.id };
}

// ---------------------------------------------------------------------------
// Wait helper — poll for a row that the webhook handler inserts.
// ---------------------------------------------------------------------------

export async function waitForDraftForConversation(
  request: APIRequestContext,
  conversationId: string,
  timeoutMs = 5_000,
): Promise<{ id: string; body: string } | null> {
  void request;
  const admin = createAdmin();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await admin
      .from("messages")
      .select("id, body")
      .eq("conversation_id", conversationId)
      .eq("draft_status", "pending_review")
      .limit(1)
      .maybeSingle();
    if (data) return { id: data.id, body: data.body ?? "" };
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
