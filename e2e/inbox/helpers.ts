/**
 * Local helpers for the inbox Playwright suite — wave 3 stage 4.
 *
 * The inbox specs need to:
 *
 *   1. provision a fresh org + auth user the test owns end-to-end so
 *      seeded rows can be cleaned up deterministically
 *   2. seed `messages` (pending_review drafts) and `action_proposals`
 *      so the buckets render real rows
 *   3. stand up a local mock Sendblue endpoint so Approve & Send
 *      doesn't hit the real provider — `LinqProvider.send()` reads
 *      `LINQ_API_URL` so we just point it at our localhost server
 *
 * Every helper is gated on `HAVE_SUPABASE`; when the local Supabase
 * stack isn't running the specs that import this module skip cleanly.
 */
import { createServer, type Server } from 'http';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';

import type { Database } from '../../src/types/database';

// ---------------------------------------------------------------------------
// Environment resolution (mirror onboarding/today helpers)
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

export type AdminClient = SupabaseClient<Database>;

export function createAdmin(): AdminClient {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Fresh org + tenant + lease provisioning
// ---------------------------------------------------------------------------

export interface InboxOwner {
  userId: string;
  organizationId: string;
  email: string;
  password: string;
  /** Best-effort cleanup of EVERY row created for this org. */
  teardown: () => Promise<void>;
}

/**
 * Creates an auth user, lets the post-signup trigger provision the
 * organisation, then assigns the org an `odesa_phone_number` (required
 * by approve/send) and seeds a property + unit so we can attach drafts
 * to a realistic tenant context.
 */
export async function provisionInboxOwner(
  prefix = 'inbox',
): Promise<InboxOwner> {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  const email = `${prefix}.${stamp}.${rand}@odesa.test`;
  const password = `inbox-test-${rand}`;

  const admin = createAdmin();
  const { data: created, error: createErr } = await admin.auth.admin.createUser(
    {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        organization_name: `Inbox Org ${stamp}-${rand}`,
        full_name: 'Inbox Test Owner',
      },
    },
  );

  if (createErr || !created.user) {
    throw new Error(
      `Failed to provision inbox owner: ${createErr?.message ?? 'no user'}`,
    );
  }
  const userId = created.user.id;

  const { data: userRow, error: userErr } = await admin
    .from('users')
    .select('organization_id')
    .eq('id', userId)
    .single();
  if (userErr || !userRow?.organization_id) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(
      `Signup trigger did not provision users row: ${userErr?.message ?? 'no row'}`,
    );
  }
  const organizationId = userRow.organization_id;

  // Make the org sendable: assign a phone number and ensure messaging
  // primary defaults to 'linq' (the column default — set explicitly to
  // be safe across schema drift).
  const phoneTail = String(rand).padStart(6, '0').slice(0, 6);
  await admin
    .from('organizations')
    .update({
      odesa_phone_number: `+1571${phoneTail}`,
      messaging_primary: 'linq',
    })
    .eq('id', organizationId);

  const teardown = async () => {
    // Order matters because of FK chains. Best-effort everywhere.
    await admin
      .from('action_proposals')
      .delete()
      .eq('organization_id', organizationId);
    await admin.from('messages').delete().eq('organization_id', organizationId);
    await admin
      .from('conversations')
      .delete()
      .eq('organization_id', organizationId);
    await admin.from('leases').delete().eq('organization_id', organizationId);
    await admin.from('tenants').delete().eq('organization_id', organizationId);
    await admin.from('units').delete().eq('organization_id', organizationId);
    await admin
      .from('properties')
      .delete()
      .eq('organization_id', organizationId);
    await admin.from('organizations').delete().eq('id', organizationId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  };

  return { userId, organizationId, email, password, teardown };
}

// ---------------------------------------------------------------------------
// Property / unit / tenant / lease scaffolding
// ---------------------------------------------------------------------------

export interface CreatePropertyInput {
  organizationId: string;
  name?: string;
}

export async function createProperty(
  admin: AdminClient,
  input: CreatePropertyInput,
): Promise<string> {
  const { data, error } = await admin
    .from('properties')
    .insert({
      organization_id: input.organizationId,
      name: input.name ?? 'Inbox Test Property',
      address_street: '1 Inbox Way',
      address_city: 'Arlington',
      address_state: 'VA',
      address_zip: '22201',
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`createProperty failed: ${error?.message ?? 'no row'}`);
  }
  return data.id;
}

export interface CreateUnitInput {
  organizationId: string;
  propertyId: string;
  label?: string;
  bedrooms?: number;
  bathrooms?: number;
}

export async function createUnit(
  admin: AdminClient,
  input: CreateUnitInput,
): Promise<string> {
  const { data, error } = await admin
    .from('units')
    .insert({
      organization_id: input.organizationId,
      property_id: input.propertyId,
      label: input.label ?? 'Apt 1',
      bedrooms: input.bedrooms ?? 1,
      bathrooms: input.bathrooms ?? 1,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`createUnit failed: ${error?.message ?? 'no row'}`);
  }
  return data.id;
}

export interface CreateTenantWithLeaseInput {
  organizationId: string;
  propertyId: string;
  unitId?: string;
  fullName: string;
  phoneE164: string;
  rentAmount?: number;
}

export interface CreateTenantWithLeaseResult {
  tenantId: string;
  unitId: string;
  leaseId: string;
}

/**
 * Inserts a tenant + lease pair so the inbox detail pane has a real
 * property / unit / rent context to render. If `unitId` is omitted we
 * also mint a unit on the supplied property.
 */
export async function createTenantWithLease(
  admin: AdminClient,
  input: CreateTenantWithLeaseInput,
): Promise<CreateTenantWithLeaseResult> {
  const unitId =
    input.unitId ??
    (await createUnit(admin, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
    }));

  const { data: tenant, error: tenantErr } = await admin
    .from('tenants')
    .insert({
      organization_id: input.organizationId,
      full_name: input.fullName,
      phone_e164: input.phoneE164,
    })
    .select('id')
    .single();
  if (tenantErr || !tenant) {
    throw new Error(
      `createTenantWithLease tenant failed: ${tenantErr?.message ?? 'no row'}`,
    );
  }

  const { data: lease, error: leaseErr } = await admin
    .from('leases')
    .insert({
      organization_id: input.organizationId,
      unit_id: unitId,
      tenant_id: tenant.id,
      status: 'active',
      rent_amount: input.rentAmount ?? 1800,
      rent_due_day: 1,
      start_date: '2026-01-01',
      end_date: '2027-01-01',
    })
    .select('id')
    .single();
  if (leaseErr || !lease) {
    throw new Error(
      `createTenantWithLease lease failed: ${leaseErr?.message ?? 'no row'}`,
    );
  }

  return { tenantId: tenant.id, unitId, leaseId: lease.id };
}

// ---------------------------------------------------------------------------
// Conversation + draft message seeding
// ---------------------------------------------------------------------------

export interface SeedDraftInput {
  organizationId: string;
  tenantId: string;
  conversationId?: string;
  body: string;
  /** Optional override for the draft provider; defaults to 'linq'. */
  provider?: 'linq' | 'twilio';
}

export interface SeedDraftResult {
  messageId: string;
  conversationId: string;
}

async function ensureConversation(
  admin: AdminClient,
  organizationId: string,
  tenantId: string,
  conversationId: string | undefined,
): Promise<string> {
  if (conversationId) return conversationId;
  const { data, error } = await admin
    .from('conversations')
    .insert({
      organization_id: organizationId,
      tenant_id: tenantId,
      channel: 'sms',
      status: 'open',
      last_message_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(
      `ensureConversation failed: ${error?.message ?? 'no row'}`,
    );
  }
  return data.id;
}

/**
 * Inserts a single outbound `pending_review` draft and bumps the
 * conversation's `last_message_at`. Returns the new ids so a test
 * can use them in subsequent assertions.
 */
export async function seedDraft(
  admin: AdminClient,
  input: SeedDraftInput,
): Promise<SeedDraftResult> {
  const conversationId = await ensureConversation(
    admin,
    input.organizationId,
    input.tenantId,
    input.conversationId,
  );

  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from('messages')
    .insert({
      organization_id: input.organizationId,
      conversation_id: conversationId,
      direction: 'outbound',
      provider: input.provider ?? 'linq',
      body: input.body,
      draft_status: 'pending_review',
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`seedDraft insert failed: ${error?.message ?? 'no row'}`);
  }

  await admin
    .from('conversations')
    .update({ last_message_at: nowIso })
    .eq('id', conversationId);

  return { messageId: data.id, conversationId };
}

// ---------------------------------------------------------------------------
// Action-proposal seeding
// ---------------------------------------------------------------------------

export interface SeedProposalInput {
  organizationId: string;
  propertyId: string;
  tenantId: string;
  conversationId: string;
  body: string;
  recipient: string;
  reasoning?: string;
  confidence?: number;
}

export interface SeedProposalResult {
  proposalId: string;
}

export async function seedProposal(
  admin: AdminClient,
  input: SeedProposalInput,
): Promise<SeedProposalResult> {
  const { data, error } = await admin
    .from('action_proposals')
    .insert({
      organization_id: input.organizationId,
      property_id: input.propertyId,
      worker_model: 'inbox-e2e',
      action_type: 'draft_sms_reply',
      payload: {
        body: input.body,
        recipient_phone: input.recipient,
      },
      reasoning: input.reasoning ?? 'Auto-generated for test',
      confidence: input.confidence ?? 0.7,
      gate_decision: 'review',
      status: 'proposed',
      routing: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        propertyId: input.propertyId,
      },
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`seedProposal failed: ${error?.message ?? 'no row'}`);
  }
  return { proposalId: data.id };
}

// ---------------------------------------------------------------------------
// Mock Sendblue server
// ---------------------------------------------------------------------------

export interface MockSendbluePost {
  number?: string;
  content?: string;
  from_number?: string;
}

export interface MockSendblueServer {
  baseUrl: string;
  sentRequests: MockSendbluePost[];
  close: () => Promise<void>;
}

/**
 * Stands up a localhost HTTP server that acts as a stand-in for the
 * Sendblue REST API. It echoes a `{ message_handle }` for any POST to
 * `/api/send-message` and records the request body so tests can
 * assert "exactly one outbound was sent with this body".
 *
 * Sets `process.env.LINQ_API_URL` so `LinqProvider.send()` calls hit
 * us instead of the real Sendblue endpoint. Restore the original
 * value via the returned `close()` to avoid bleeding state across
 * tests.
 */
export async function mockSendblueServer(): Promise<MockSendblueServer> {
  const sentRequests: MockSendbluePost[] = [];

  const server: Server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/send-message') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let parsed: MockSendbluePost = {};
        try {
          parsed = JSON.parse(raw) as MockSendbluePost;
        } catch {
          // Sendblue would 400 here; for our mock we still record so
          // the test can see the bad payload.
          parsed = {};
        }
        sentRequests.push(parsed);
        const handle = `mock-handle-${cryptoRandom()}`;
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message_handle: handle }));
      });
      return;
    }
    if (req.method === 'POST' && req.url?.startsWith('/api/send-typing')) {
      res.statusCode = 204;
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('mock Sendblue server failed to bind to a port');
  }
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  const previous = process.env.LINQ_API_URL;
  process.env.LINQ_API_URL = baseUrl;

  return {
    baseUrl,
    sentRequests,
    close: () =>
      new Promise<void>((resolve) => {
        if (previous === undefined) {
          delete process.env.LINQ_API_URL;
        } else {
          process.env.LINQ_API_URL = previous;
        }
        server.close(() => resolve());
      }),
  };
}

function cryptoRandom(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return String(Date.now()) + '-' + Math.floor(Math.random() * 1e9).toString(16);
}

// ---------------------------------------------------------------------------
// OTP extraction helper
// ---------------------------------------------------------------------------

/**
 * Pulls the most recent 6-digit verification code out of the mock
 * Sendblue's recorded request log. The verify-phone server action in
 * `src/app/(dashboard)/settings/integrations/actions.ts` formats the
 * outbound body as `Your Odesa verification code: NNNNNN`, so we walk
 * the recorded sends from newest to oldest and return the first
 * matching code we find. Returns null if no code is present yet — the
 * caller can poll if needed (the `requestPhoneVerification` action
 * runs synchronously, so the recording is available the moment the
 * server action resolves).
 */
export function extractOtpFromMockSendblue(
  server: MockSendblueServer,
): string | null {
  for (let i = server.sentRequests.length - 1; i >= 0; i -= 1) {
    const body = server.sentRequests[i]?.content ?? '';
    const match = body.match(/\b(\d{6})\b/);
    if (match?.[1]) return match[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export interface CleanupTestRowsInput {
  organizationId: string;
  /** Optional body prefix (used by tests that seed multiple drafts). */
  prefix?: string;
}

/**
 * Best-effort cleanup of seeded rows. Order mirrors `provisionInboxOwner`'s
 * teardown so we never trip an FK constraint.
 */
export async function cleanupTestRows(
  admin: AdminClient,
  input: CleanupTestRowsInput,
): Promise<void> {
  const { organizationId, prefix } = input;
  if (prefix) {
    await admin
      .from('messages')
      .delete()
      .eq('organization_id', organizationId)
      .ilike('body', `${prefix}%`);
    return;
  }
  await admin
    .from('action_proposals')
    .delete()
    .eq('organization_id', organizationId);
  await admin.from('messages').delete().eq('organization_id', organizationId);
  await admin
    .from('conversations')
    .delete()
    .eq('organization_id', organizationId);
}

// ---------------------------------------------------------------------------
// UI sign-in helper (mirrors onboarding helpers)
// ---------------------------------------------------------------------------

export async function signInOwner(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(credentials.email);
  await page.getByTestId('login-password').fill(credentials.password);
  await page.getByTestId('login-submit').click();
  // Fresh org has no portfolio so login routes the user to /onboarding;
  // tests will navigate to /inbox manually after auth lands.
  await page.waitForURL(/\/(onboarding|today|inbox|dashboard)(\/|\?|$)/, {
    timeout: 15_000,
  });
}
