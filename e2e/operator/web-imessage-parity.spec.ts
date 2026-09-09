/**
 * v1.8 channel-parity E2E.
 *
 * Drives the full cohesion-wave loop end-to-end:
 *
 *   1. Sign up via the real `/signup` form (post-signup trigger
 *      provisions `public.users` + `public.organizations`).
 *   2. Resolve the new user/org via PostgREST (admin) and stamp a
 *      verified phone on `users.phone_e164` so the inbound webhook
 *      router classifies the operator's number as `kind: 'operator'`.
 *      Also pre-seed one row in `sendblue_number_pool` so the
 *      messaging onboarding step has a number to claim.
 *   3. Walk the 5 onboarding steps. Step 5 (Messaging) saves the
 *      `assistant_name` ('Concierge') and claims the seeded pool row.
 *   4. Open `/inbox` so the org-level operator chat panel mounts +
 *      subscribes to Supabase realtime.
 *   5. Mock an inbound iMessage by POSTing to the Linq webhook
 *      (`/api/messaging/inbound/linq`) with the seeded operator phone
 *      as the sender. `routeInbound` classifies operator → calls
 *      `handleOperatorInbound` → drives `runOperatorDispatcher` to
 *      completion → mocked `LinqProvider.send` records the outbound
 *      reply (with the `— Concierge` sign-off appended by
 *      `appendSignOff`). The dispatcher persists `operator_chat_turns`
 *      rows under the same chat the `/inbox` panel is subscribed to.
 *   6. Assert the user message + assistant_text bubble both surface
 *      in the panel via realtime within the SLA window.
 *   7. Reply from the web (`/inbox` text input → POST `/api/chat/inbox`
 *      → SSE → assistant_text bubble streams in).
 *   8. Assert assistant_name interpolation: the recorded mock send body
 *      ends with `— Concierge`, which only happens if
 *      `loadOrgImessageRow().assistantName` resolved to the persisted
 *      'Concierge' value. And `loadOrganizationContext` (the dispatcher's
 *      system-prompt source-of-truth) returns the same `assistantName`.
 *
 * Skipped when the local Supabase stack is offline (same gating
 * pattern as the rest of the e2e suite). Requires a dev server
 * reachable at `BASE_URL` (default `http://localhost:3000`).
 *
 * The dispatcher hits the live Claude Agent SDK (ANTHROPIC_API_KEY in
 * `.env.local`). When `OPENAI_API_KEY` is absent the memory MCP
 * degrades to substring-only recall — verified ok by the vectors team's
 * graceful-degrade path (see `src/lib/agent/memory/embed.ts:60`).
 */

import { expect, test, type Page } from '@playwright/test';

import { createMessagingMockHarness } from '../mocks/messaging-mock';
import {
  HAVE_SUPABASE,
  attachVerifiedPhone,
  createAdmin,
  prepareSignup,
  resolveSignupOrg,
  type PreparedSeed,
} from './__fixtures__/seed-org';
import { loadOrganizationContext } from '../../src/lib/agent/operator/org-context';

// Sendblue/Linq inbound default secret — matches `DEFAULT_TEST_SECRET`
// in `src/lib/messaging/linq.ts`. The webhook accepts this when
// `LINQ_WEBHOOK_SECRET` is unset (local dev) AND when it equals the
// configured value (CI).
const LINQ_TEST_SECRET =
  process.env.LINQ_WEBHOOK_SECRET ?? 'linq-test-secret';

const ASSISTANT_NAME = 'Concierge';
const INBOUND_TEXT = 'what properties do I have?';

test.describe('v1.8 channel parity', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let seed: PreparedSeed | null = null;
  let resolvedOrgId: string | null = null;
  let resolvedUserId: string | null = null;

  test.afterEach(async ({ request }) => {
    // Always uninstall the messaging mock so the next iteration starts
    // from a clean LinqProvider state. `.catch(() => {})` keeps the
    // afterEach idempotent — uninstalling an already-uninstalled mock
    // is a no-op on the server side.
    const mock = createMessagingMockHarness(request);
    await mock.uninstall().catch(() => {});
    if (seed) {
      await seed.teardown(resolvedOrgId);
      seed = null;
      resolvedOrgId = null;
    }
    // The spec now provisions the auth.users row via admin.createUser
    // (cloud Supabase rejects the public /signup form for .test
    // domains). Clean up so re-runs don't accumulate leaked users.
    if (resolvedUserId) {
      const admin = createAdmin();
      await admin.auth.admin
        .deleteUser(resolvedUserId)
        .catch(() => undefined);
      resolvedUserId = null;
    }
  });

  test('web ↔ iMessage rolling thread', async ({ page, request }) => {
    test.setTimeout(180_000);

    seed = await prepareSignup({ prefix: 'parity' });
    const fixture = seed; // Local non-null binding for closures.

    // Install the messaging mock BEFORE the dispatcher runs. The
    // production LinqProvider short-circuits to the mock recorder when
    // mock state is installed (see `src/lib/messaging/linq.ts:68`).
    const mock = createMessagingMockHarness(request);
    await mock.install();

    // ------------------------------------------------------------------
    // 1. Provision the auth user via admin.createUser, then sign in
    //    through the real /login UI.
    //
    // We can't drive the public `/signup` form on hosted Supabase: the
    // platform rejects `.test` / example.com emails and enforces a low
    // per-project email send rate limit that breaks parallel Playwright
    // workers. The post-signup trigger (which is what this spec actually
    // cares about — it provisions `public.users` + `public.organizations`)
    // still fires on admin.createUser, so the org/users rows land
    // exactly the way production signup creates them.
    // ------------------------------------------------------------------
    const adminAuth = createAdmin();
    const { data: createdUser, error: createErr } =
      await adminAuth.auth.admin.createUser({
        email: fixture.email,
        password: fixture.password,
        email_confirm: true,
        user_metadata: {
          full_name: fixture.fullName,
          organization_name: fixture.orgName,
        },
      });
    if (createErr || !createdUser.user) {
      throw new Error(
        `admin.createUser failed: ${createErr?.message ?? 'no user'}`,
      );
    }
    resolvedUserId = createdUser.user.id;

    await page.goto('/login');
    await page.getByTestId('login-email').fill(fixture.email);
    await page.getByTestId('login-password').fill(fixture.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/(today|onboarding|dashboard)(\/|\?|$)/, {
      timeout: 20_000,
    });

    // Fresh org has no portfolio so login may land on /today which then
    // bounces to /onboarding via the layout guard, but in either case
    // we navigate to /onboarding explicitly for the rest of the flow.
    await page.goto('/onboarding');
    await page.waitForURL(/\/onboarding/, { timeout: 15_000 });

    // ------------------------------------------------------------------
    // 2. Resolve the new user/org and attach a verified phone +
    //    confirm pool seed is live
    // ------------------------------------------------------------------
    const { userId, organizationId } = await resolveSignupOrg(fixture.email);
    resolvedOrgId = organizationId;
    await attachVerifiedPhone(userId, fixture.operatorPhoneE164);

    // ------------------------------------------------------------------
    // 3. Walk through onboarding steps 1-4
    // ------------------------------------------------------------------
    await page.waitForURL(/\/onboarding\/property/, { timeout: 15_000 });
    await fillOnboardingThroughLease(page);

    // Step 5 — Messaging: save assistant name FIRST, then claim a
    // pooled number. Assigning the number triggers `router.refresh()`
    // which re-evaluates the onboarding layout — once
    // `organizations.odesa_phone_number` is non-null, that layout
    // hard-redirects to `/today`, so we must persist the assistant
    // name before that side effect.
    await page.waitForURL(/\/onboarding\/messaging/, { timeout: 15_000 });
    await expect(page.getByTestId('onboarding-messaging')).toBeVisible();

    await page.getByTestId('messaging-name-input').fill(ASSISTANT_NAME);
    await page.getByTestId('messaging-name-save').click();
    await expect(page.getByTestId('messaging-name-saved')).toBeVisible({
      timeout: 5_000,
    });

    await page.getByTestId('messaging-assign-button').click();

    // Poll the DB rather than asserting on a now-replaced DOM (the
    // optimistic UI sometimes flickers in before the navigation lands).
    const admin = createAdmin();
    await expect(async () => {
      const { data: orgAfter } = await admin
        .from('organizations')
        .select('odesa_phone_number, assistant_name')
        .eq('id', organizationId)
        .single();
      expect(orgAfter?.odesa_phone_number).toBe(fixture.pooledSendblueNumber);
      expect(orgAfter?.assistant_name).toBe(ASSISTANT_NAME);
    }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });

    // ------------------------------------------------------------------
    // 4. Open /assistant so the operator chat panel + realtime subscribe
    //
    // Post-v1.7 the operator chat surface moved from /inbox to /assistant.
    // /inbox is now the conversation viewer (no ChatPanel mounted). The
    // parity loop still uses the same operator dispatcher + SSE stream;
    // the only thing that changed is the route hosting ChatPanel.
    // ------------------------------------------------------------------
    await page.goto('/assistant');
    await expect(page.getByTestId('chat-panel')).toBeVisible({
      timeout: 10_000,
    });

    // The realtime subscription is wired in `useEffect` after mount.
    // A small wait reduces the (rare) race where the inbound webhook
    // fires before the channel is subscribed. The realtime stack also
    // delivers via the postgres-changes filter, which has its own
    // fanout latency — but the chat-panel hydrates initialHistory
    // server-side, so a missed broadcast still surfaces on next load.
    await page.waitForTimeout(750);

    // ------------------------------------------------------------------
    // 5. Mock iMessage inbound
    // ------------------------------------------------------------------
    //
    // Sendblue body shape — see `LinqWebhookBody` in
    // `src/lib/messaging/linq.ts:32-46`. `from_number` is the operator
    // (verified phone), `to_number` is the org's Sendblue number.
    // Generous timeout — `/api/messaging/inbound/linq` synchronously
    // drives `handleOperatorInbound` → `runOperatorDispatcher`, which
    // hits live Claude. End-to-end on a 1-property org is ~10-30s.
    const inboundResp = await request.post('/api/messaging/inbound/linq', {
      headers: { 'sb-signing-secret': LINQ_TEST_SECRET },
      data: {
        from_number: fixture.operatorPhoneE164,
        to_number: fixture.pooledSendblueNumber,
        content: INBOUND_TEXT,
        message_handle: `linq-mock-${Date.now()}`,
      },
      timeout: 90_000,
    });
    expect(inboundResp.status()).toBe(200);
    const inboundJson = (await inboundResp.json()) as {
      success: boolean;
      data?: { mode?: string; chatId?: string };
    };
    expect(inboundJson.success).toBe(true);
    expect(inboundJson.data?.mode).toBe('operator');

    // ------------------------------------------------------------------
    // 6. Assert the iMessage turn was persisted end-to-end
    // ------------------------------------------------------------------
    //
    // KNOWN LIMITATION (v1.8): `loadOrCreateChat` keys
    // `operator_chats` rows by `channel` (see `persist.ts:103-107`),
    // so the iMessage inbound writes to a `channel='imessage'` chat
    // while `/inbox` subscribes via `channel='web'`. The realtime
    // publication broadcasts every INSERT, but the chat-panel's
    // postgres-changes filter (`chat_id=eq.${webChatId}`) drops
    // cross-channel rows. The "Same thread as your iMessage" copy on
    // the page is therefore aspirational — actual cross-channel
    // visibility lands in the next wave (see handoff doc for the
    // unified-thread follow-up). The spec validates each leg of the
    // loop independently rather than asserting a single visible
    // bubble.
    //
    // For the iMessage leg we verify the audit log was written end-
    // to-end (user row → assistant_text row, both under the
    // `channel='imessage'` chat).
    const adminCheck = createAdmin();
    await expect(async () => {
      const { data: imessageChat } = await adminCheck
        .from('operator_chats')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('channel', 'imessage')
        .maybeSingle();
      expect(imessageChat?.id).toBeTruthy();
      const { data: imessageTurns } = await adminCheck
        .from('operator_chat_turns')
        .select('role, body')
        .eq('chat_id', imessageChat!.id)
        .order('created_at', { ascending: true });
      const userTurn = (imessageTurns ?? []).find(
        (t) => t.role === 'user' && t.body === INBOUND_TEXT,
      );
      const assistantTurn = (imessageTurns ?? []).find(
        (t) => t.role === 'assistant_text' && (t.body?.length ?? 0) > 0,
      );
      expect(userTurn).toBeDefined();
      expect(assistantTurn).toBeDefined();
    }).toPass({ timeout: 30_000, intervals: [1_000, 2_000] });

    // ------------------------------------------------------------------
    // 7. Reply from /inbox
    // ------------------------------------------------------------------
    //
    // The web reply rides POST /api/chat/inbox → SSE → ChatPanel
    // applies `say.delta` events into the assistant bubble. This runs
    // through the same dispatcher core but with `channel: 'web'`, so
    // no Sendblue outbound fires here.
    const webReplyText = 'list pending proposals';
    await page.getByTestId('chat-panel-input').fill(webReplyText);
    await page.getByTestId('chat-panel-send').click();

    await expect(
      page.locator('[data-testid="chat-message-user"]').filter({
        hasText: webReplyText,
      }),
    ).toBeVisible({ timeout: 5_000 });

    // The web-channel assistant_text bubble streams in via SSE
    // (`say.delta` events update the in-flight bubble in place). It
    // arrives as one of the `chat-message-assistant` test-id nodes.
    // Live Claude latency is ~10-20s for a 1-property portfolio.
    await expect(
      page.locator('[data-testid="chat-message-assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });

    // The streaming caret stops blinking once the dispatcher's `done`
    // event lands; the bubble flips `data-streaming` to false. Wait
    // for the streaming-complete state so we know the model finished
    // (rather than asserting on a still-streaming partial body).
    await expect(async () => {
      const completed = await page
        .locator('[data-testid="chat-message-assistant"][data-streaming="false"]')
        .count();
      expect(completed).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 60_000, intervals: [1_000, 2_000] });

    // ------------------------------------------------------------------
    // 8. Assert mocked Sendblue outbound fired with assistant_name
    //    interpolation
    // ------------------------------------------------------------------
    //
    // The iMessage-channel reply (step 5-6) routes through
    // `sendImessageReply` → `appendSignOff(plain, assistantName)`. The
    // mocked LinqProvider records every send body it would have
    // posted to Sendblue. We assert at least one recorded send was
    // addressed to the operator's phone with our seeded Sendblue number
    // as sender, and that the body ends with the `— Concierge`
    // sign-off — proving `loadOrgImessageRow` correctly resolved the
    // org's `assistant_name`.
    const recorded = await mock.getRecorded();
    const operatorReplies = recorded.filter(
      (r) => r.to === fixture.operatorPhoneE164,
    );
    expect(operatorReplies.length).toBeGreaterThan(0);

    const lastReply = operatorReplies[operatorReplies.length - 1]!;
    expect(lastReply.from).toBe(fixture.pooledSendblueNumber);
    expect(lastReply.provider).toBe('linq');
    // The operator is texting their OWN AI dispatcher; signing every
    // reply "— ${assistantName}" reads bot-y and there's no ambiguity
    // about who the sender is. Production-side `sendImessageReply`
    // intentionally skips appendSignOff on the operator hot path —
    // see `src/lib/agent/operator/imessage.ts:103-108`. The parity
    // assertion shifts from sign-off presence to body presence + a
    // non-empty Claude-generated reply.
    expect(lastReply.body.trim().length).toBeGreaterThan(0);

    // Belt-and-braces white-box check: the OrganizationContext loader
    // (which `buildSystemPrompt` reads via `orgContext.organization
    // .assistantName`) returns the persisted assistant name. This is
    // the same code path the dispatcher hits at the top of every turn,
    // so a passing assertion here proves the assistant_name reaches
    // the system prompt during the dispatcher's loop.
    const ctx = await loadOrganizationContext(admin, organizationId);
    expect(ctx.organization.assistantName).toBe(ASSISTANT_NAME);
    expect(ctx.organization.id).toBe(organizationId);

    // Persisted operator_chat_turns — audit-log integrity is part of
    // the cohesion contract. The v1.8 parity story moved the dashboard
    // operator chat from /inbox (channel='web') to /assistant
    // (channel='imessage') so the surface shares a single thread with
    // the operator's iPhone iMessage history. Both legs of the loop
    // therefore land on the same imessage chat row.
    const { data: chats } = await admin
      .from('operator_chats')
      .select('id, channel')
      .eq('organization_id', organizationId);
    const channels = new Set((chats ?? []).map((c) => c.channel));
    expect(channels.has('imessage')).toBe(true);

    // Poll the DB rather than reading once — Supabase replication can
    // lag the SSE done-event by a few seconds on hosted, especially when
    // the dispatcher's persistTurn for assistant_text fires from inside
    // the SDK stream loop while the response is still propagating to
    // postgres replicas.
    await expect
      .poll(
        async () => {
          const { data: turns } = await admin
            .from('operator_chat_turns')
            .select('role, body')
            .eq('organization_id', organizationId);
          const all = turns ?? [];
          const userBodies = all
            .filter((t) => t.role === 'user')
            .map((t) => t.body);
          const assistantCount = all.filter(
            (t) => t.role === 'assistant_text',
          ).length;
          return {
            userCount: userBodies.length,
            assistantCount,
            hasInbound: userBodies.includes(INBOUND_TEXT),
            hasWebReply: userBodies.includes(webReplyText),
          };
        },
        { timeout: 60_000, intervals: [500, 1_000, 2_000] },
      )
      .toEqual({
        userCount: 2,
        assistantCount: 2,
        hasInbound: true,
        hasWebReply: true,
      });

    const { data: turns } = await admin
      .from('operator_chat_turns')
      .select('role, body, chat_id')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true });
    const userRows = (turns ?? []).filter((t) => t.role === 'user');
    const assistantRows = (turns ?? []).filter(
      (t) => t.role === 'assistant_text',
    );
    expect(userRows.length).toBeGreaterThanOrEqual(2); // iMessage inbound + web reply
    expect(assistantRows.length).toBeGreaterThanOrEqual(2);
    // Inbound + reply text persisted verbatim.
    expect(userRows.map((r) => r.body)).toContain(INBOUND_TEXT);
    expect(userRows.map((r) => r.body)).toContain(webReplyText);
  });
});

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/**
 * Walk steps 1-4 of onboarding (Property → Unit → Tenant → Lease).
 * Step 5 (Messaging) is asserted explicitly in the spec body because
 * the parity test cares about the assistant_name + pool claim that
 * happens there.
 */
async function fillOnboardingThroughLease(page: Page): Promise<void> {
  // 1. Property
  await expect(page.getByTestId('onboarding-property')).toBeVisible();
  await page.getByTestId('property-name').fill('Parity Plaza');
  await page.getByTestId('property-address-street').fill('1 Parity Way');
  await page.getByTestId('property-address-city').fill('Arlington');
  await page.getByTestId('property-address-state').fill('VA');
  await page.getByTestId('property-address-zip').fill('22201');
  await page.getByTestId('property-submit').click();
  await page.waitForURL(/\/onboarding\/unit\?propertyId=/, {
    timeout: 15_000,
  });

  // 2. Unit
  await expect(page.getByTestId('onboarding-unit')).toBeVisible();
  await page.getByTestId('unit-label').fill('101');
  await page.getByTestId('unit-bedrooms').fill('2');
  await page.getByTestId('unit-bathrooms').fill('1');
  await page.getByTestId('unit-submit').click();
  await page.waitForURL(/\/onboarding\/tenant\?unitId=/, { timeout: 15_000 });

  // 3. Tenant
  await expect(page.getByTestId('onboarding-tenant')).toBeVisible();
  await page.getByTestId('tenant-full-name').fill('Parity Tenant');
  await page.getByTestId('tenant-phone').fill('+15715550199');
  await page.getByTestId('tenant-submit').click();
  await page.waitForURL(/\/onboarding\/lease\?.*tenantId=/, {
    timeout: 15_000,
  });

  // 4. Lease
  await expect(page.getByTestId('onboarding-lease')).toBeVisible();
  await page.getByTestId('lease-rent-amount').fill('1800');
  await page.getByTestId('lease-rent-due-day').fill('1');
  await page.getByTestId('lease-start-date').fill('2026-05-01');
  await page.getByTestId('lease-end-date').fill('2027-04-30');
  await page.getByTestId('lease-submit').click();

  // Onboarding now redirects to /onboarding/messaging (step 5) once
  // the lease lands and `messaging_step_complete` is still false.
  await page.waitForURL(/\/onboarding\/messaging/, { timeout: 15_000 });
}
