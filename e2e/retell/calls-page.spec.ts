/**
 * /calls console + /calls/[id] dossier — the Voice Operator control-room UI,
 * driven by REAL engine output (not rows injected into the page).
 *
 * Three calls are simulated through the actual lifecycle (webhook call_started
 * → tools → webhook call_ended) so the page renders live derived state, then the
 * flagship surface is asserted against the full owner-queue-link matrix:
 *
 *   Call A — CLEAN RESOLVED. Verified tenant (Marcus), maintenance_request →
 *     create_work_order + a SAFE confirmation SMS. No approvals, no risk flags →
 *     green "Resolved by Odesa"; nextMove "No owner action needed" (NO owner-queue
 *     link); named actions ("Work order created" · "Confirmation SMS sent") and a
 *     real /work-orders drilldown.
 *
 *   Call B — NEEDS REVIEW, owner-queue link PRESENT. Verified tenant,
 *     payment_dispute (→ a risk flag) plus a risky rent-reminder SMS the policy
 *     DRAFTS instead of sending (→ a real approval in the compiled outcome). A
 *     `voice_call_review` proposal is created; the dossier's next move links to
 *     /owner-queue.
 *
 *   Call C — NEEDS REVIEW, owner-queue link ABSENT. Unknown caller → a
 *     `unknown_caller_needs_review` risk flag but NO property, so no proposal is
 *     queued; the dossier routes to the honest privacy line, never a spurious
 *     owner-queue link, and leaks no seeded-tenant identity.
 *
 * WHY Call B DRAFTS an SMS (rather than a plain payment-dispute): the UI's
 * owner-queue link is derived from the COMPILED `outcome` (nextMove needs a
 * `proposal` record OR approvalCount > 0 + a property). `compileOutcome` runs in
 * the webhook BEFORE the `voice_call_review` proposal is written, so that
 * proposal's id never lands in the stored outcome — a plain payment-dispute
 * (safe SMS) has approvalCount 0 and renders an INBOX link despite a DB proposal
 * existing. Drafting the SMS puts a real approval INTO the outcome, so the
 * owner-queue link is honest and present. (Verified against
 * src/lib/voice/outcomes.ts + src/components/calls/call-copy.ts.)
 *
 * Requires the local Supabase stack + Galaxy seed (skips otherwise). Every row
 * created is deleted in afterEach via the admin client.
 *
 * ENV CONTRACT (Retell auth — do not drift): tool routes bearer-authenticate
 * against `RETELL_API_KEY`; the webhook route is signature-FIRST and, with
 * RETELL_REQUIRE_SIGNATURE on (as in .env.production.local), rejects unsigned
 * posts 401. This spec therefore signs webhook posts exactly like the provider
 * (see e2e/retell/signed-webhook.ts) and bearer-auths tools with the same key.
 * Playwright and `npm start` both load .env.production.local first, so the key
 * matches automatically. When you point BASE_URL at an EXTERNALLY-started
 * server, launch it with the identical RETELL_API_KEY and do NOT override the
 * key on only one side — that drift 401s every POST and is a harness bug,
 * never a production-auth bug. Production auth stays untouched.
 */
import {
  expect,
  test,
  type APIRequestContext,
  type ConsoleMessage,
} from "@playwright/test";

import {
  GALAXY_ORG_ID,
  HAVE_SUPABASE,
  createAdmin,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from '../today/helpers';
import { isBenignConsoleError } from '../route-sweep/console-guard';
import { createMessagingMockHarness } from '../mocks/messaging-mock';
import { signWebhookPost } from './signed-webhook';
import type { Database } from '../../src/types/database';

const RETELL_KEY = process.env.RETELL_API_KEY ?? "retell-dev-test-key";
const GALAXY_ORG_PHONE = "+15715550101";
const GALAXY_TENANT_PHONE = "+15715550201"; // Marcus Alvarez (seeded)
const GHOST_PHONE = "+15715559999"; // unseeded → unknown_caller

const HEADERS = { authorization: `Bearer ${RETELL_KEY}` };
const RUN = Date.now();

/** Risky body the SMS policy must DRAFT, never send (proven by voice-operator F5). */
const RISKY_SMS_BODY =
  "Reminder: your rent is late, please arrange a payment plan with us.";

interface Cleanup {
  callIds: string[];
  conversationIds: string[];
  workOrderIds: string[];
  proposalIds: string[];
}

function cleanupBucket(): Cleanup {
  return {
    callIds: [],
    conversationIds: [],
    workOrderIds: [],
    proposalIds: [],
  };
}

async function sweep(c: Cleanup): Promise<void> {
  const admin = createAdmin();
  for (const id of c.proposalIds) {
    await admin.from("action_proposals").delete().eq("id", id);
  }
  for (const id of c.conversationIds) {
    await admin.from("messages").delete().eq("conversation_id", id);
    await admin.from("conversations").delete().eq("id", id);
  }
  for (const id of c.workOrderIds) {
    await admin.from("work_orders").delete().eq("id", id);
  }
  for (const id of c.callIds) {
    await admin.from("voice_calls").delete().eq("retell_call_id", id);
  }
}

async function webhook(
  request: APIRequestContext,
  event: "call_started" | "call_ended",
  call: Record<string, unknown>,
) {
  // Signed like the real provider — required when RETELL_REQUIRE_SIGNATURE
  // is on. Send the signed raw body verbatim, never re-serialized.
  const signed = signWebhookPost({ event, call });
  return request.post('/api/retell/webhook', {
    headers: signed.headers,
    data: signed.body,
  });
}

async function tool(
  request: APIRequestContext,
  name: string,
  data: Record<string, unknown>,
) {
  return request.post(`/api/retell/tools/${name}`, { headers: HEADERS, data });
}

/** voice_calls.id (the /calls/[id] route param) for a given retell_call_id. */
async function callDbId(retellCallId: string): Promise<string> {
  const admin = createAdmin();
  const { data } = await admin
    .from("voice_calls")
    .select("id")
    .eq("retell_call_id", retellCallId)
    .single();
  if (!data?.id) throw new Error(`no voice_calls row for ${retellCallId}`);
  return data.id;
}

/**
 * Track a UI-created test call (the retell id + its conversation) so the shared
 * afterEach sweep removes it — mirrors the inline cleanup the existing test-call
 * spec does, extracted so the scenario test can reuse it per call.
 */
async function trackTestCall(url: string, c: Cleanup): Promise<void> {
  const id = url.match(/\/calls\/([a-f0-9-]+)/)?.[1];
  if (!id) return;
  const admin = createAdmin();
  const { data: call } = await admin
    .from("voice_calls")
    .select("retell_call_id, conversation_id")
    .eq("id", id)
    .single();
  if (!call) return;
  c.callIds.push(call.retell_call_id);
  if (call.conversation_id) c.conversationIds.push(call.conversation_id);
}

/**
 * Snapshot the org's voice_settings row BEFORE a mutating test (guardrail 5).
 * Returns a restore fn: upsert the exact row back if it existed, else delete
 * ONLY the row the test itself created. It NEVER blindly wipes a seeded row
 * other specs may depend on.
 */
async function snapshotVoiceSettings(
  orgId: string,
): Promise<() => Promise<void>> {
  const admin = createAdmin();
  const { data: existing } = await admin
    .from("voice_settings")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();

  return async () => {
    const restoreAdmin = createAdmin();
    if (existing) {
      await restoreAdmin
        .from("voice_settings")
        .upsert(
          existing as Database["public"]["Tables"]["voice_settings"]["Insert"],
          {
            onConflict: "organization_id",
          },
        );
    } else {
      await restoreAdmin
        .from("voice_settings")
        .delete()
        .eq("organization_id", orgId);
    }
  };
}

/**
 * Route the flagship fixture's numbers to the seeded Galaxy org and its Marcus
 * Alvarez tenant on a clean local DB. A later seed migration
 * (galaxy_owns_sendblue_number) repointed BOTH to real Sendblue numbers, so
 * resolveCaller/retell-auth no longer match GALAXY_ORG_PHONE (against
 * organizations.odesa_phone_number) or GALAXY_TENANT_PHONE (against
 * tenants.phone_e164). Snapshot the EXACT prior values (guardrail-5 contract,
 * same as snapshotVoiceSettings) and return one restore fn that writes them
 * back verbatim — never a blind clear. Marcus keeps his seeded active lease →
 * unit → property, so the verified-tenant work-order + proposal fixtures
 * resolve unchanged; only his phone_e164 is borrowed for the test window.
 */
async function routeGalaxyCallFixtures(): Promise<() => Promise<void>> {
  const admin = createAdmin();

  const { data: org } = await admin
    .from("organizations")
    .select("odesa_phone_number")
    .eq("id", GALAXY_ORG_ID)
    .maybeSingle();
  const prevOrgPhone = org?.odesa_phone_number ?? null;

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, phone_e164")
    .eq("organization_id", GALAXY_ORG_ID)
    .eq("full_name", "Marcus Alvarez")
    .maybeSingle();
  if (!tenant) {
    throw new Error(
      "flagship fixture requires the seeded 'Marcus Alvarez' Galaxy tenant",
    );
  }
  const prevTenantPhone = tenant.phone_e164;

  await admin
    .from("organizations")
    .update({ odesa_phone_number: GALAXY_ORG_PHONE })
    .eq("id", GALAXY_ORG_ID);
  await admin
    .from("tenants")
    .update({ phone_e164: GALAXY_TENANT_PHONE })
    .eq("id", tenant.id);

  return async () => {
    const restoreAdmin = createAdmin();
    await restoreAdmin
      .from("organizations")
      .update({ odesa_phone_number: prevOrgPhone })
      .eq("id", GALAXY_ORG_ID);
    await restoreAdmin
      .from("tenants")
      .update({ phone_e164: prevTenantPhone })
      .eq("id", tenant.id);
  };
}

// ---------------------------------------------------------------------------
// Fixtures — simulate three real calls that end in DISTINCT derived states.
// ---------------------------------------------------------------------------

/** Call A: verified tenant, maintenance → work order + safe SMS → RESOLVED clean. */
async function simulateResolvedCall(
  request: APIRequestContext,
  c: Cleanup,
): Promise<{ retellId: string; workOrderId: string }> {
  const retellId = `voice-calls-e2e-${RUN}-resolved`;
  c.callIds.push(retellId);

  const started = await webhook(request, "call_started", {
    call_id: retellId,
    from_number: GALAXY_TENANT_PHONE,
    to_number: GALAXY_ORG_PHONE,
  });
  expect(started.status()).toBe(200);

  const reported = await tool(request, "report_intents", {
    call_id: retellId,
    from_number: GALAXY_TENANT_PHONE,
    to_number: GALAXY_ORG_PHONE,
    args: { intents: ["maintenance_request"] },
  });
  expect(reported.status()).toBe(200);
  expect((await reported.json()).caller_kind).toBe("verified_tenant");

  const wo = await tool(request, "create_work_order", {
    call_id: retellId,
    from_number: GALAXY_TENANT_PHONE,
    to_number: GALAXY_ORG_PHONE,
    args: {
      description: "Kitchen sink leaking, contained under the sink",
      category: "plumbing",
      urgency: "routine",
    },
  });
  expect(wo.status()).toBe(200);
  const workOrderId = (await wo.json()).work_order_id as string;
  c.workOrderIds.push(workOrderId);

  const sms = await tool(request, "send_sms_followup", {
    call_id: retellId,
    from_number: GALAXY_TENANT_PHONE,
    to_number: GALAXY_ORG_PHONE,
    args: { body: "We received your request. A work order was created." },
  });
  expect(sms.status()).toBe(200);
  const smsBody = await sms.json();
  // Safe body must NOT be demoted to a draft — this is what keeps the call clean.
  expect(smsBody.drafted ?? false).toBe(false);
  c.conversationIds.push(smsBody.conversation_id);

  const ended = await webhook(request, "call_ended", {
    call_id: retellId,
    from_number: GALAXY_TENANT_PHONE,
    to_number: GALAXY_ORG_PHONE,
    transcript:
      "Tenant: My kitchen sink is leaking under the cabinet. Agent: Is there active flooding? Tenant: No, it is contained.",
  });
  expect(ended.status()).toBe(200);
  const endedBody = await ended.json();
  c.conversationIds.push(endedBody.conversation_id);
  // A clean resolved call must NOT queue an owner-review proposal.
  expect(endedBody.proposal_id).toBeNull();

  return { retellId, workOrderId };
}

/** Call B: verified tenant, payment dispute + risky SMS drafted → NEEDS REVIEW + proposal. */
async function simulateOwnerQueueCall(
  request: APIRequestContext,
  c: Cleanup,
): Promise<{ retellId: string }> {
  const retellId = `voice-calls-e2e-${RUN}-review`;
  c.callIds.push(retellId);

  const started = await webhook(request, "call_started", {
    call_id: retellId,
    from_number: GALAXY_TENANT_PHONE,
    to_number: GALAXY_ORG_PHONE,
  });
  expect(started.status()).toBe(200);

  const reported = await tool(request, "report_intents", {
    call_id: retellId,
    from_number: GALAXY_TENANT_PHONE,
    to_number: GALAXY_ORG_PHONE,
    args: {
      intents: ["payment_dispute"],
      facts: { paymentClaim: { claimed: true, method: "zelle" } },
    },
  });
  expect(reported.status()).toBe(200);

  // Risky rent-reminder body → policy DRAFTS it → an approval lands in the outcome.
  const sms = await tool(request, "send_sms_followup", {
    call_id: retellId,
    from_number: GALAXY_TENANT_PHONE,
    to_number: GALAXY_ORG_PHONE,
    args: { body: RISKY_SMS_BODY },
  });
  expect(sms.status()).toBe(200);
  const smsBody = await sms.json();
  expect(smsBody.drafted).toBe(true); // fixture must actually produce the draft state
  c.conversationIds.push(smsBody.conversation_id);

  // The draft's own proposal (draft_sms_reply) — clean it up like voice-operator F5.
  const admin = createAdmin();
  const { data: draftProposals } = await admin
    .from("action_proposals")
    .select("id")
    .eq("action_type", "draft_sms_reply")
    .contains("routing", { conversationId: smsBody.conversation_id });
  for (const p of draftProposals ?? []) c.proposalIds.push(p.id);

  const ended = await webhook(request, "call_ended", {
    call_id: retellId,
    from_number: GALAXY_TENANT_PHONE,
    to_number: GALAXY_ORG_PHONE,
    transcript:
      "Tenant: I already paid my rent through Zelle but the portal still shows me as late.",
  });
  expect(ended.status()).toBe(200);
  const endedBody = await ended.json();
  c.conversationIds.push(endedBody.conversation_id);
  // A verified tenant with a property + something needing eyes DOES queue review.
  expect(endedBody.proposal_id).toBeTruthy();
  c.proposalIds.push(endedBody.proposal_id);

  return { retellId };
}

/** Call C: unknown caller → NEEDS REVIEW (risk flag) but NO property → NO proposal. */
async function simulateUnknownCallerCall(
  request: APIRequestContext,
  c: Cleanup,
): Promise<{ retellId: string }> {
  const retellId = `voice-calls-e2e-${RUN}-unknown`;
  c.callIds.push(retellId);

  const started = await webhook(request, "call_started", {
    call_id: retellId,
    from_number: GHOST_PHONE,
    to_number: GALAXY_ORG_PHONE,
  });
  expect(started.status()).toBe(200);
  // First disclosure channel is EMPTY for unknown callers (privacy invariant).
  expect((await started.json()).retell_llm_dynamic_variables).toEqual({});

  const reported = await tool(request, "report_intents", {
    call_id: retellId,
    from_number: GHOST_PHONE,
    to_number: GALAXY_ORG_PHONE,
    args: {
      intents: ["unknown_general"],
      facts: { callerStatedReason: "calling about the apartment" },
    },
  });
  expect(reported.status()).toBe(200);
  expect((await reported.json()).caller_kind).toBe("unknown_caller");

  const ended = await webhook(request, "call_ended", {
    call_id: retellId,
    from_number: GHOST_PHONE,
    to_number: GALAXY_ORG_PHONE,
    transcript: "Caller: Hi, I am calling about the apartment listing.",
  });
  expect(ended.status()).toBe(200);
  const endedBody = await ended.json();
  c.conversationIds.push(endedBody.conversation_id);
  // No property → the NOT NULL guard forbids a proposal.
  expect(endedBody.proposal_id).toBeNull();

  return { retellId };
}

// ---------------------------------------------------------------------------

test.describe("calls console — /calls + /calls/[id]", () => {
  test.skip(!HAVE_SUPABASE, "requires local Supabase env (SUPABASE_URL etc.)");

  let cleanup: Cleanup;
  let owner: SeededOwner | null = null;
  // Set by the settings-mutating tests only; restores the org's voice_settings
  // row in afterEach (upsert snapshot back, or delete if the test created it).
  let restoreSettings: (() => Promise<void>) | null = null;
  // Set by the webhook-seeded flagship test: restores the exact prior Galaxy
  // org + tenant phone numbers, and uninstalls the messaging mock, in afterEach.
  let restoreFixtures: (() => Promise<void>) | null = null;
  let restoreMessaging: (() => Promise<void>) | null = null;

  test.beforeEach(() => {
    cleanup = cleanupBucket();
    owner = null;
    restoreSettings = null;
    restoreFixtures = null;
    restoreMessaging = null;
  });

  test.afterEach(async () => {
    await sweep(cleanup);
    if (restoreSettings) await restoreSettings();
    if (restoreFixtures) await restoreFixtures();
    if (restoreMessaging) await restoreMessaging();
    if (owner) await owner.teardown();
  });

  test("renders the flagship console and drills into honest, eligibility-correct dossiers", async ({
    page,
    request,
  }) => {
    // Guard real sends: Call A's safe-confirmation SMS would otherwise hit the
    // org's live Linq provider. The mock records sends instead (the drafted
    // decision is deterministic policy, so the assertions are unaffected).
    const messaging = createMessagingMockHarness(request);
    await messaging.install();
    restoreMessaging = () => messaging.uninstall();

    // Route GALAXY_ORG_PHONE / GALAXY_TENANT_PHONE to the seeded Galaxy org +
    // Marcus so call_started/resolveCaller resolve on a clean local DB
    // (restored verbatim after).
    restoreFixtures = await routeGalaxyCallFixtures();

    // --- Arrange: three real calls in distinct derived states. ---------------
    const resolved = await simulateResolvedCall(request, cleanup);
    const ownerQueue = await simulateOwnerQueueCall(request, cleanup);
    const unknown = await simulateUnknownCallerCall(request, cleanup);
    const resolvedId = await callDbId(resolved.retellId);
    const ownerQueueId = await callDbId(ownerQueue.retellId);
    const unknownId = await callDbId(unknown.retellId);

    owner = await provisionGalaxyOwner();
    await signIn(page, { email: owner.email, password: owner.password });

    // Scope console capture to the /calls surfaces only (after sign-in chrome).
    const consoleErrors: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (!isBenignConsoleError(text)) consoleErrors.push(text);
    });

    // --- /calls index: exactly thesis → 4 KPIs → status strip → rows. --------
    await page.goto("/calls");
    await expect(page.getByTestId("calls-page")).toBeVisible();

    const thesis = page.getByTestId("calls-thesis");
    await expect(thesis).toBeVisible();
    await expect(thesis).toContainText("Call operations");

    await expect(page.getByTestId("calls-kpi-total")).toBeVisible();
    await expect(page.getByTestId("calls-kpi-resolved")).toBeVisible();
    await expect(page.getByTestId("calls-kpi-review")).toBeVisible();
    await expect(page.getByTestId("calls-kpi-actions")).toBeVisible();

    // Setup and local-simulation commands belong under Settings, not in the
    // owner's daily evidence register.
    await expect(page.getByTestId("calls-settings-link")).toHaveCount(0);
    await expect(page.getByTestId("calls-scripts-link")).toHaveCount(0);
    await expect(page.getByTestId("calls-test-link")).toHaveCount(0);

    await expect(page.getByTestId("voice-readiness-strip")).toBeVisible();
    await expect(page.getByTestId("voice-readiness-heading")).toHaveText(
      "Integration status",
    );

    // Needs-review KPI is Today-scoped; assert >= 1 (Calls B + C), never a
    // cross-scope equality against the "recent" row list (different scopes by design).
    const reviewKpiText =
      (await page.getByTestId("calls-kpi-review").textContent()) ?? "";
    const reviewKpiCount = parseInt(
      (reviewKpiText.match(/\d+/) ?? ["0"])[0],
      10,
    );
    expect(reviewKpiCount).toBeGreaterThanOrEqual(1);

    // Row chips match each fixture's real derived state. Each register row is a
    // real /calls/[id] link, located by its stable call id.
    const rowFor = (id: string) =>
      page.locator(`[data-testid="call-row"][data-call-id="${id}"]`);

    const resolvedRow = rowFor(resolvedId);
    await expect(resolvedRow).toBeVisible();
    await expect(resolvedRow).toContainText("Resolved by Odesa");
    await expect(
      resolvedRow.locator('[data-status-tone="green"]'),
    ).toBeVisible();

    const ownerQueueRow = rowFor(ownerQueueId);
    await expect(ownerQueueRow).toBeVisible();
    await expect(ownerQueueRow).toContainText("Needs review");
    await expect(
      ownerQueueRow.locator('[data-status-tone="clay"]'),
    ).toBeVisible();

    const unknownRow = rowFor(unknownId);
    await expect(unknownRow).toBeVisible();
    await expect(unknownRow).toContainText("Needs review");
    await expect(unknownRow.locator('[data-status-tone="clay"]')).toBeVisible();

    expect(
      consoleErrors,
      `console errors on /calls:\n${consoleErrors.join("\n")}`,
    ).toEqual([]);

    // --- Select a register row → investigation drawer; then explicitly open the
    // complete Call Review Studio (Call B: proposal-backed). -----------------
    await ownerQueueRow.click();
    const investigation = page.getByTestId("call-investigation-drawer");
    await expect(investigation).toBeVisible();
    await expect(investigation).toContainText("Needs review");
    const openFullReview = page.getByTestId("call-investigation-open-full");
    await expect(openFullReview).toHaveAttribute("href", `/calls/${ownerQueueId}`);
    await openFullReview.click();
    await page.waitForURL(new RegExp(`/calls/${ownerQueueId}`));
    await expect(page.getByTestId("call-detail-page")).toBeVisible();

    // Proposal-backed call → the prominent next-move panel deep-links to the
    // owner queue with the honest label.
    const nextMove = page.getByTestId("call-next-move");
    await expect(nextMove).toBeVisible();
    await expect(nextMove).toContainText("Review in owner queue");
    await expect(page.getByTestId("call-next-move-link")).toHaveAttribute(
      "href",
      "/owner-queue",
    );

    await expect(page.getByTestId("call-transcript")).toContainText(
      "paid my rent through Zelle",
    );

    expect(
      consoleErrors,
      `console errors on /calls/[id] (owner-queue):\n${consoleErrors.join("\n")}`,
    ).toEqual([]);

    // --- Call A dossier (resolved): summary, named actions, drilldown, NO queue.
    await page.goto(`/calls/${resolvedId}`);
    await expect(page.getByTestId("call-detail-page")).toBeVisible();

    // Humanized outcome summary (never a raw compiler string).
    await expect(page.getByTestId("call-detail-page")).toContainText(
      "maintenance",
    );

    // Action counts resolve to NAMED actions, never a vague "2 actions".
    const did = page.getByTestId("call-did");
    await expect(did).toContainText("Work order created");
    await expect(did).toContainText("Confirmation SMS sent");

    // Drilldown points at a real route (the work order this call created).
    await expect(
      page.locator(`a[href="/work-orders/${resolved.workOrderId}"]`).first(),
    ).toBeVisible();

    // Transcript renders.
    await expect(page.getByTestId("call-transcript")).toContainText(
      "kitchen sink",
    );

    // No proposal → next move needs no owner action, and NO owner-queue link exists.
    await expect(page.getByTestId("call-next-move")).toContainText(
      "No owner action needed",
    );
    await expect(
      page.getByTestId("call-detail-page").locator('a[href="/owner-queue"]'),
    ).toHaveCount(0);

    expect(
      consoleErrors,
      `console errors on /calls/[id] (resolved):\n${consoleErrors.join("\n")}`,
    ).toEqual([]);

    // --- Call C dossier (unknown caller): needs review, NO queue link, no leak.
    await page.goto(`/calls/${unknownId}`);
    await expect(page.getByTestId("call-detail-page")).toBeVisible();

    // Risk flag without a proposal → the honest privacy line in the next-move
    // panel, never a spurious owner-queue link.
    await expect(page.getByTestId("call-next-move")).toContainText(
      "Identity not verified; no private data disclosed",
    );
    await expect(
      page.getByTestId("call-detail-page").locator('a[href="/owner-queue"]'),
    ).toHaveCount(0);

    // The whole dossier leaks no seeded-tenant identity or balances.
    const unknownDetailText =
      (await page.getByTestId("call-detail-page").textContent()) ?? "";
    expect(unknownDetailText).not.toMatch(/Marcus|Alvarez/);
    expect(unknownDetailText).not.toMatch(/\$\d/);

    expect(
      consoleErrors,
      `console errors on /calls/[id] (unknown):\n${consoleErrors.join("\n")}`,
    ).toEqual([]);
  });

  test("test-call button creates a safe test call artifact", async ({
    page,
  }) => {
    owner = await provisionGalaxyOwner();
    await signIn(page, { email: owner.email, password: owner.password });

    // Navigate to the test-call page
    await page.goto("/calls/test");
    await expect(page.getByTestId("calls-test-page")).toBeVisible();

    // Find and click the test-call button
    const testCallSection = page.getByTestId("calls-test-call");
    await expect(testCallSection).toBeVisible();

    const testCallButton = page.getByTestId("test-call-button");
    await expect(testCallButton).toBeVisible();
    await expect(testCallButton).toHaveText(/Run safe test call/);

    // Click the button and wait for navigation
    await testCallButton.click();

    // Should navigate to the call detail page
    await page.waitForURL(/\/calls\/[a-f0-9-]+/, { timeout: 10000 });

    // Verify we're on a call detail page
    await expect(page.getByTestId("call-detail-page")).toBeVisible();

    // Should show test call content
    await expect(page.getByTestId("call-transcript")).toBeVisible();
    await expect(page.getByTestId("call-transcript")).toContainText(
      "kitchen sink",
    );

    // Should show as a completed test call
    await expect(page.getByTestId("call-detail-page")).toContainText(
      "maintenance",
    );

    // Clean up the test call
    const callId = page.url().split("/calls/")[1];
    if (callId) {
      const admin = createAdmin();
      const { data: call } = await admin
        .from("voice_calls")
        .select("id, retell_call_id, conversation_id")
        .eq("id", callId)
        .single();

      if (call) {
        cleanup.callIds.push(call.retell_call_id);
        if (call.conversation_id) {
          cleanup.conversationIds.push(call.conversation_id);
        }
      }
    }
  });

  test("voice settings edit round-trip", async ({ page }) => {
    owner = await provisionGalaxyOwner();
    // Snapshot BEFORE any mutation so afterEach restores the seeded row exactly.
    restoreSettings = await snapshotVoiceSettings(owner.organizationId);
    await signIn(page, { email: owner.email, password: owner.password });

    const consoleErrors: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (!isBenignConsoleError(text)) consoleErrors.push(text);
    });

    // Unique so the effective-prompt assertion cannot match seeded default copy.
    const newClosing = `Please end every call by confirming the ticket number. ${RUN}`;
    const newTopic = `Do not discuss neighbor disputes ${RUN}`;

    await page.goto("/calls/settings");
    await expect(page.getByTestId("calls-settings-page")).toBeVisible();

    const editor = page.getByTestId("voice-config-editor");
    await expect(editor).toBeVisible();

    // Edit closing guidance + append a topics-to-avoid line, then save knowledge.
    const avoid = page.locator("#voice-config-avoid");
    const currentAvoid = await avoid.inputValue();
    await avoid.fill(`${currentAvoid}\n${newTopic}`);
    await page.locator("#voice-config-closing").fill(newClosing);

    await page.getByTestId("voice-config-save-knowledge").click();
    await expect(editor.getByText("Saved", { exact: true })).toBeVisible();

    // Reload → persisted values re-hydrate the inputs from the DB.
    await page.reload();
    await expect(page.getByTestId("calls-settings-page")).toBeVisible();
    await expect(page.locator("#voice-config-closing")).toHaveValue(newClosing);
    await expect(page.locator("#voice-config-avoid")).toHaveValue(
      new RegExp(newTopic),
    );

    // Effective agent prompt reflects the new closing (server-assembled, additive).
    // Scope to the <pre> — newClosing also lives in the #voice-config-closing
    // textarea, so an unscoped getByText matches two nodes.
    await page.getByText("View effective agent prompt").click();
    await expect(
      page.locator("pre").filter({ hasText: newClosing }),
    ).toBeVisible();

    expect(
      consoleErrors,
      `console errors:\n${consoleErrors.join("\n")}`,
    ).toEqual([]);
  });

  test("script override customized badge", async ({ page }) => {
    owner = await provisionGalaxyOwner();
    restoreSettings = await snapshotVoiceSettings(owner.organizationId);
    await signIn(page, { email: owner.email, password: owner.password });

    const consoleErrors: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (!isBenignConsoleError(text)) consoleErrors.push(text);
    });

    const note = `Owner note ${RUN}: prioritize documented payment proof.`;

    await page.goto("/calls/scripts");
    await expect(page.getByTestId("calls-scripts-page")).toBeVisible();

    const row = page.getByTestId("call-script-row-rent_payment_dispute");
    await expect(row).toBeVisible();
    const customized = page.getByTestId(
      "call-script-customized-rent_payment_dispute",
    );
    await expect(customized).toHaveCount(0); // seeded default: no override yet

    // Expand the row, add a note, save → the "Customized" badge appears.
    await row.locator("button").first().click();
    await page.getByTestId("call-script-notes-rent_payment_dispute").fill(note);
    await page.getByTestId("call-script-save-rent_payment_dispute").click();
    await expect(customized).toBeVisible();

    // Persists across reload (badge lives in the always-rendered header).
    await page.reload();
    await expect(page.getByTestId("calls-scripts-page")).toBeVisible();
    await expect(customized).toBeVisible();

    // Remove the customization → the badge disappears.
    await row.locator("button").first().click(); // re-expand (reload collapsed it)
    await page.getByTestId("call-script-remove-rent_payment_dispute").click();
    await expect(customized).toHaveCount(0);

    expect(
      consoleErrors,
      `console errors:\n${consoleErrors.join("\n")}`,
    ).toEqual([]);
  });

  test("scenario test calls land in honest dossiers", async ({ page }) => {
    owner = await provisionGalaxyOwner();
    await signIn(page, { email: owner.email, password: owner.password });

    const consoleErrors: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (!isBenignConsoleError(text)) consoleErrors.push(text);
    });

    await page.goto("/calls/test");
    await expect(page.getByTestId("calls-test-page")).toBeVisible();

    // --- Dispute scenario → honest inbox/review next move, never owner-queue. --
    await page.getByTestId("test-call-button-dispute").click();
    await page.waitForURL(/\/calls\/[a-f0-9-]+/, { timeout: 10_000 });
    await expect(page.getByTestId("call-detail-page")).toBeVisible();
    await trackTestCall(page.url(), cleanup);

    const disputeMove = page.getByTestId("call-next-move");
    await expect(disputeMove).toBeVisible();
    await expect(disputeMove).toContainText(/inbox/i);
    // Records for review — it routes to the inbox, and NEVER implies a queued
    // proposal via an owner-queue deep link.
    await expect(page.getByTestId("call-next-move-link")).toHaveAttribute(
      "href",
      "/inbox",
    );
    await expect(
      page.getByTestId("call-detail-page").locator('a[href="/owner-queue"]'),
    ).toHaveCount(0);

    // --- Back to the test page, run the unknown-caller scenario. --------------
    await page.goto("/calls/test");
    await expect(page.getByTestId("calls-test-page")).toBeVisible();

    await page.getByTestId("test-call-button-unknown").click();
    await page.waitForURL(/\/calls\/[a-f0-9-]+/, { timeout: 10_000 });
    await expect(page.getByTestId("call-detail-page")).toBeVisible();
    await trackTestCall(page.url(), cleanup);

    await expect(page.getByTestId("call-next-move")).toContainText(
      "Identity not verified; no private data disclosed",
    );
    await expect(page.getByTestId("call-next-move-link")).toHaveCount(0);

    // Privacy: no dollar amounts, no seeded-tenant identity anywhere in the dossier.
    const unknownText =
      (await page.getByTestId("call-detail-page").textContent()) ?? "";
    expect(unknownText).not.toMatch(/Marcus|Alvarez/);
    expect(unknownText).not.toMatch(/\$\d/);

    // Transcript export controls are present; copy must not crash the page. We
    // deliberately do NOT read clipboard contents (no OS permission in CI).
    await expect(page.getByTestId("transcript-copy")).toBeVisible();
    await expect(page.getByTestId("transcript-download")).toBeVisible();
    await page.getByTestId("transcript-copy").click();
    await expect(page.getByTestId("call-detail-page")).toBeVisible();

    expect(
      consoleErrors,
      `console errors:\n${consoleErrors.join("\n")}`,
    ).toEqual([]);
  });
});
