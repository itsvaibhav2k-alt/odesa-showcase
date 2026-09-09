import { expect, test } from "@playwright/test";

import { createMessagingMockHarness } from "../mocks/messaging-mock";
import {
  HAVE_SUPABASE,
  LINQ_TEST_SECRET,
  createAdmin,
  insertDraftForTenant,
  provisionMessagingFixture,
  signIn,
  type MessagingFixture,
} from "./helpers";

test.describe("messaging: consent, exactly-once, and delivery truth", () => {
  test.skip(!HAVE_SUPABASE, "Requires explicitly configured local Supabase");
  test.setTimeout(120_000);

  let fixture: MessagingFixture;

  test.beforeEach(async ({ request }) => {
    fixture = await provisionMessagingFixture({ messagingPrimary: "linq" });
    await createMessagingMockHarness(request).install({ claudeScripts: [] });
  });

  test.afterEach(async ({ request }) => {
    await createMessagingMockHarness(request)
      .uninstall()
      .catch(() => {});
    if (fixture) await fixture.teardown();
  });

  test("STOP suppresses approval at the final boundary; START/HELP use audited transitions", async ({
    page,
    request,
  }) => {
    const { draftId } = await insertDraftForTenant(
      fixture,
      "This must never leave Odesa",
    );
    await signIn(page, fixture.owner);

    const stopId = `stop-${Date.now()}`;
    const stop = await request.post("/api/messaging/inbound/linq", {
      headers: { "X-Linq-Signature": LINQ_TEST_SECRET },
      data: {
        message_handle: stopId,
        from_number: fixture.tenant.phoneE164,
        to_number: fixture.odesaPhoneE164,
        content: "  stop all  ",
        date_sent: new Date().toISOString(),
      },
    });
    expect(stop.status()).toBe(200);
    expect(await stop.json()).toMatchObject({
      success: true,
      data: { consentCommand: "stop", consentState: "suppressed" },
    });

    const approve = await page.request.post(
      `/api/messaging/drafts/${draftId}/approve`,
    );
    expect(approve.status()).toBe(409);
    expect(
      await createMessagingMockHarness(request).getRecorded(),
    ).toHaveLength(0);

    const admin = createAdmin();
    const { data: suppressedMessage } = await admin
      .from("messages")
      .select("delivery_status, provider_message_id")
      .eq("id", draftId)
      .single();
    expect(suppressedMessage).toMatchObject({
      delivery_status: "suppressed",
      provider_message_id: null,
    });

    const startId = `start-${Date.now()}`;
    const start = await request.post("/api/messaging/inbound/linq", {
      headers: { "X-Linq-Signature": LINQ_TEST_SECRET },
      data: {
        message_handle: startId,
        from_number: fixture.tenant.phoneE164,
        to_number: fixture.odesaPhoneE164,
        content: "START",
        date_sent: new Date().toISOString(),
      },
    });
    expect(await start.json()).toMatchObject({
      success: true,
      data: { consentCommand: "start", consentState: "opted_in" },
    });

    const help = await request.post("/api/messaging/inbound/linq", {
      headers: { "X-Linq-Signature": LINQ_TEST_SECRET },
      data: {
        message_handle: `help-${Date.now()}`,
        from_number: fixture.tenant.phoneE164,
        to_number: fixture.odesaPhoneE164,
        content: "HELP",
        date_sent: new Date().toISOString(),
      },
    });
    expect(await help.json()).toMatchObject({
      success: true,
      data: { consentCommand: "help", consentState: "opted_in" },
    });

    const { data: transitions } = await admin
      .from("messaging_consent_transitions")
      .select("command, from_state, to_state")
      .eq("organization_id", fixture.organizationId)
      .eq("recipient_e164", fixture.tenant.phoneE164)
      .order("occurred_at");
    expect(transitions).toEqual([
      { command: "stop", from_state: "unknown", to_state: "suppressed" },
      { command: "start", from_state: "suppressed", to_state: "opted_in" },
      { command: "help", from_state: "opted_in", to_state: "opted_in" },
    ]);
  });

  test("STOP cancels an approval lease before provider handoff", async ({
    page,
    request,
  }) => {
    const { draftId } = await insertDraftForTenant(
      fixture,
      "Race-safe message that must remain local",
    );
    await signIn(page, fixture.owner);
    const mock = createMessagingMockHarness(request);
    await mock.pauseBeforeHandoff(true);

    const approvePromise = page.request.post(
      `/api/messaging/drafts/${draftId}/approve`,
    );
    await expect.poll(() => mock.isHandoffPaused()).toBe(true);
    const stop = await request.post("/api/messaging/inbound/linq", {
      headers: { "X-Linq-Signature": LINQ_TEST_SECRET },
      data: {
        message_handle: `stop-race-${Date.now()}`,
        from_number: fixture.tenant.phoneE164,
        to_number: fixture.odesaPhoneE164,
        content: "STOP",
        date_sent: new Date().toISOString(),
      },
    });
    await mock.pauseBeforeHandoff(false);
    const approve = await approvePromise;

    expect(stop.status()).toBe(200);
    expect(approve.status()).toBe(409);
    expect(await mock.getRecorded()).toHaveLength(0);
    const { data: message } = await createAdmin()
      .from("messages")
      .select("delivery_status, provider_message_id")
      .eq("id", draftId)
      .single();
    expect(message).toMatchObject({
      delivery_status: "suppressed",
      provider_message_id: null,
    });
  });

  test("operator STOP is consumed as consent before the operator dispatcher", async ({
    request,
  }) => {
    const stop = await request.post("/api/messaging/inbound/linq", {
      headers: { "X-Linq-Signature": LINQ_TEST_SECRET },
      data: {
        message_handle: `operator-stop-${Date.now()}`,
        from_number: fixture.owner.phoneE164,
        to_number: fixture.odesaPhoneE164,
        content: "STOP",
        date_sent: new Date().toISOString(),
      },
    });
    expect(stop.status()).toBe(200);
    expect(await stop.json()).toMatchObject({
      success: true,
      data: {
        mode: "operator",
        consentCommand: "stop",
        consentState: "suppressed",
      },
    });
    expect(
      await createMessagingMockHarness(request).getRecorded(),
    ).toHaveLength(0);
    const { data: consent } = await createAdmin()
      .from("messaging_recipient_consents")
      .select("state")
      .eq("organization_id", fixture.organizationId)
      .eq("recipient_e164", fixture.owner.phoneE164)
      .single();
    expect(consent?.state).toBe("suppressed");
  });

  test("accepted then failed stays failed under duplicate and reordered webhooks", async ({
    page,
    request,
  }) => {
    const { draftId } = await insertDraftForTenant(
      fixture,
      "Delivery truth check",
    );
    await signIn(page, fixture.owner);
    expect(
      (
        await page.request.post(`/api/messaging/drafts/${draftId}/approve`)
      ).status(),
    ).toBe(200);

    const admin = createAdmin();
    const { data: accepted } = await admin
      .from("messages")
      .select("provider_message_id, delivery_status")
      .eq("id", draftId)
      .single();
    expect(accepted?.delivery_status).toBe("provider_accepted");
    const providerMessageId = accepted?.provider_message_id ?? "";
    const failedAt = "2026-07-11T12:02:00.000Z";

    const postEvent = (eventId: string, status: string, occurredAt: string) =>
      request.post("/api/messaging/delivery/linq", {
        headers: { "X-Linq-Signature": LINQ_TEST_SECRET },
        data: {
          event_id: eventId,
          message_handle: providerMessageId,
          status,
          occurred_at: occurredAt,
        },
      });
    expect((await postEvent("evt-failed", "failed", failedAt)).status()).toBe(
      200,
    );
    const duplicate = await postEvent("evt-failed", "failed", failedAt);
    expect(await duplicate.json()).toMatchObject({
      success: true,
      data: { duplicate: true },
    });
    expect(
      (
        await postEvent(
          "evt-old-accepted",
          "accepted",
          "2026-07-11T12:01:00.000Z",
        )
      ).status(),
    ).toBe(200);

    const { data: final } = await admin
      .from("messages")
      .select("delivery_status, delivery_error")
      .eq("id", draftId)
      .single();
    expect(final?.delivery_status).toBe("failed");
    expect(final?.delivery_error).toBeTruthy();
  });

  test("timestamp-less callbacks dedupe stably and delivered never regresses", async ({
    page,
    request,
  }) => {
    const { draftId } = await insertDraftForTenant(
      fixture,
      "Timestamp-less callback truth",
    );
    await signIn(page, fixture.owner);
    expect(
      (
        await page.request.post(`/api/messaging/drafts/${draftId}/approve`)
      ).status(),
    ).toBe(200);
    const admin = createAdmin();
    const { data: accepted } = await admin
      .from("messages")
      .select("provider_message_id")
      .eq("id", draftId)
      .single();
    const payload = {
      message_handle: accepted?.provider_message_id,
      status: "delivered",
    };
    const first = await request.post("/api/messaging/delivery/linq", {
      headers: { "X-Linq-Signature": LINQ_TEST_SECRET },
      data: payload,
    });
    const duplicate = await request.post("/api/messaging/delivery/linq", {
      headers: { "X-Linq-Signature": LINQ_TEST_SECRET },
      data: payload,
    });
    expect(first.status()).toBe(200);
    expect(await duplicate.json()).toMatchObject({
      success: true,
      data: { duplicate: true, pending: false },
    });
    await request.post("/api/messaging/delivery/linq", {
      headers: { "X-Linq-Signature": LINQ_TEST_SECRET },
      data: {
        message_handle: accepted?.provider_message_id,
        status: "sent",
      },
    });
    const { data: final } = await admin
      .from("messages")
      .select("delivery_status")
      .eq("id", draftId)
      .single();
    expect(final?.delivery_status).toBe("delivered");
  });

  test("ambiguous timeout retry produces at most one provider message", async ({
    page,
    request,
  }) => {
    const { draftId } = await insertDraftForTenant(
      fixture,
      "Exactly once despite timeout",
    );
    await signIn(page, fixture.owner);
    const mock = createMessagingMockHarness(request);
    await mock.ambiguousTimeout("linq", true);

    const first = await page.request.post(
      `/api/messaging/drafts/${draftId}/approve`,
    );
    expect(first.status()).toBe(502);
    const retry = await page.request.post(
      `/api/messaging/drafts/${draftId}/approve`,
    );
    expect(retry.status()).toBe(409);
    expect(await mock.getRecorded()).toHaveLength(1);

    const { data: row } = await createAdmin()
      .from("messages")
      .select("delivery_status, provider_message_id, draft_status")
      .eq("id", draftId)
      .single();
    expect(row).toMatchObject({
      delivery_status: "queued",
      provider_message_id: null,
      draft_status: "sending",
    });
  });
});
