/**
 * Retell SMS inbound webhook — Retell SMS unification (2026-07-09).
 *
 * One endpoint serves BOTH Retell SMS webhook families:
 *   - `chat_inbound` (phone-number level, first tenant text): carries only
 *     numbers. We respond with a metadata/dynamic-variables echo so the
 *     chat's later lifecycle events can be correlated back to the org.
 *   - Chat lifecycle events (`chat_started`/`chat_ended`/`chat_analyzed`,
 *     `sms_chat` only): carry the transcript. We ingest tenant turns into
 *     the normal pipeline WITHOUT drafting (the Retell agent already
 *     replied) and record agent turns as auto_sent outbound rows.
 *
 * Replay safety: `chat_ended` and `chat_analyzed` repeat the same
 * transcript. Tenant turns dedup on the inbound unique index inside
 * `handleInbound`; agent turns claim `inbound_webhook_dedup`
 * (provider='retell', provider_message_id=message_id) before any insert.
 *
 * Dispatch-chat reconcile: when a chat corresponds to an approved-draft
 * send (matched via the echoed `metadata.odesa.message_id`, or by the
 * `chat_id` the approve route stored as `provider_message_id`), the
 * agent's actual outbound message is written onto that existing draft
 * row instead of inserting a duplicate.
 *
 * Auth reuses `verifyRetellWebhookAuth` (HMAC signature-first, fail-closed
 * under RETELL_REQUIRE_SIGNATURE) — identical policy to the voice webhooks.
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyRetellWebhookAuth } from "@/lib/agent/retell-auth";
import {
  extractChatMessages,
  extractInboundSmsMessages,
  parseRetellSmsWebhook,
  resolveChatNumbers,
  type ResolvedChatNumbers,
  type RetellChat,
} from "@/lib/messaging/retell";
import {
  handleInbound,
  resolveConversationForNumbers,
} from "@/lib/messaging/handle-inbound";
import { routeInbound } from "@/lib/messaging/route-inbound";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  applyInboundConsentCommand,
  parseConsentCommand,
} from "@/lib/messaging/consent";

export const maxDuration = 300;

type AdminClient = ReturnType<typeof createAdminClient>;

export async function POST(req: NextRequest) {
  return Sentry.startSpan({ name: "retell.sms.inbound", op: "webhook" }, () =>
    handleRetellPost(req),
  );
}

async function handleRetellPost(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  const auth = verifyRetellWebhookAuth(req, rawBody);
  if (!auth.ok) return auth.response;

  // Dashboard "save" pings arrive with an empty body — ack them.
  const trimmed = rawBody.trim();
  if (!trimmed || trimmed === "{}" || trimmed === "[]") {
    return NextResponse.json({ success: true, mode: "verification" });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = parseRetellSmsWebhook(body);
  if (parsed.kind === "ignored") {
    // Unrecognized events 200 — a 4xx/5xx here would only buy retry storms.
    return NextResponse.json({
      received: true,
      ignored: true,
      event: parsed.eventName,
    });
  }

  const admin = createAdminClient();

  if (parsed.kind === "chat_inbound") {
    return respondChatInbound(admin, parsed.fromNumber, parsed.toNumber);
  }

  return ingestChatEvent(admin, parsed.event, parsed.chat);
}

/**
 * Answer the number-level `chat_inbound` hook with the correlation echo.
 * Lifecycle events carry no phone numbers, so this echo is the ONLY way
 * a chat can later be attributed to an org/tenant.
 */
async function respondChatInbound(
  admin: AdminClient,
  fromNumber: string,
  toNumber: string,
): Promise<NextResponse> {
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("odesa_phone_number", toNumber)
    .limit(1)
    .maybeSingle();

  if (!org) {
    console.warn(
      `[retell sms webhook] chat_inbound for unknown org number ${toNumber}`,
    );
    return NextResponse.json({});
  }

  return NextResponse.json({
    chat_inbound: {
      metadata: {
        odesa: {
          from_number: fromNumber,
          to_number: toNumber,
          organization_id: org.id,
        },
      },
      dynamic_variables: {
        odesa_from_number: fromNumber,
        odesa_to_number: toNumber,
        odesa_organization_id: org.id,
      },
    },
  });
}

async function ingestChatEvent(
  admin: AdminClient,
  event: string,
  chat: RetellChat,
): Promise<NextResponse> {
  const numbers = resolveChatNumbers(chat);
  if (!numbers) {
    // Never guess org/tenant. 200 — retries can't fix a missing echo.
    console.warn(
      `[retell sms webhook] ${event} for chat ${chat.chat_id} has no metadata echo — skipped`,
    );
    return NextResponse.json({
      success: true,
      data: { skipped: "uncorrelatable_chat" },
    });
  }

  const route = await routeInbound(admin, {
    fromE164: numbers.fromNumber,
    toE164: numbers.toNumber,
    body: "",
    provider: "retell",
    receivedAt: new Date().toISOString(),
  });

  if (route.kind === "unknown_org") {
    console.warn(
      `[retell sms webhook] no organization for to=${numbers.toNumber}`,
    );
    return NextResponse.json({
      success: true,
      data: { skipped: "unknown_org" },
    });
  }

  const inbound = extractInboundSmsMessages(chat, numbers);
  for (const msg of inbound) {
    const command = parseConsentCommand(msg.body);
    if (command) {
      await applyInboundConsentCommand(
        route.kind === "operator"
          ? route.user.organizationId
          : route.organizationId,
        msg,
        command,
      );
    }
  }

  if (route.kind === "operator") {
    // Deliberate: operator flows stay on the legacy channel for V1. Running
    // handleOperatorInbound here would double-respond after the Retell
    // agent already replied in-chat. Dispatch sends can still be
    // operator-destined (e.g. owner notify), so reconcile before skipping.
    const reconciled = await reconcileDispatchTurns(admin, chat, numbers);
    if (reconciled === null) {
      return NextResponse.json(
        { success: false, error: "Reconcile failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({
      success: true,
      data: { skipped: "operator_legacy_channel", reconciled },
    });
  }

  // ---- Tenant turns: ingest WITHOUT drafting (agent already answered). ----
  let ingested = 0;
  let duplicates = 0;
  for (const msg of inbound) {
    const result = await handleInbound(msg, { skipDraft: true });
    if (!result.ok) {
      console.error(`[retell sms webhook] ingest failed: ${result.error}`);
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 },
      );
    }
    if (result.duplicate) duplicates += 1;
    else ingested += 1;
  }

  // ---- Agent turns: auto_sent outbound rows (or draft reconcile). ----
  const agentTurns = extractChatMessages(chat).filter(
    (m) => m.role === "agent",
  );
  let agentInserted = 0;
  let agentDuplicates = 0;
  let reconciled = 0;

  if (agentTurns.length > 0) {
    const resolved = await resolveConversationForNumbers(
      admin,
      numbers.fromNumber,
      numbers.toNumber,
    );
    if (!resolved) {
      console.error(
        `[retell sms webhook] conversation resolve failed for chat ${chat.chat_id}`,
      );
      return NextResponse.json(
        { success: false, error: "Conversation resolve failed" },
        { status: 500 },
      );
    }

    let reconcileTargetId = await findDispatchDraftRow(admin, chat, numbers);
    let lastSentAt: string | null = null;

    for (const turn of agentTurns) {
      // Claim BEFORE any write — the inbound unique index only covers
      // direction='inbound', so outbound replay safety lives here.
      const { error: claimErr } = await admin
        .from("inbound_webhook_dedup")
        .insert({
          provider: "retell",
          provider_message_id: turn.messageId,
        });
      if (claimErr) {
        if (claimErr.code === "23505") {
          agentDuplicates += 1;
          continue;
        }
        console.error(
          `[retell sms webhook] dedup claim failed: ${claimErr.message}`,
        );
        return NextResponse.json(
          { success: false, error: "Dedup claim failed" },
          { status: 500 },
        );
      }

      if (reconcileTargetId) {
        // Approved-draft send: the agent's actual message is ground truth —
        // write it onto the existing row instead of duplicating.
        let updateErr: { message: string } | null;
        try {
          ({ error: updateErr } = await admin
            .from("messages")
            .update({
              body: turn.body,
              sent_at: turn.sentAt,
              provider: "retell",
              provider_message_id: turn.messageId,
            })
            .eq("id", reconcileTargetId));
        } catch (err) {
          await releaseDedupClaim(admin, turn.messageId);
          console.error(`[retell sms webhook] reconcile threw: ${String(err)}`);
          return NextResponse.json(
            { success: false, error: "Reconcile failed" },
            { status: 500 },
          );
        }
        if (updateErr) {
          // Release the claim so Retell's retry can redo this turn instead
          // of reading the failure as an already-processed duplicate.
          await releaseDedupClaim(admin, turn.messageId);
          console.error(
            `[retell sms webhook] reconcile failed: ${updateErr.message}`,
          );
          return NextResponse.json(
            { success: false, error: "Reconcile failed" },
            { status: 500 },
          );
        }
        reconciled += 1;
        reconcileTargetId = null;
        lastSentAt = turn.sentAt;
        continue;
      }

      let insertErr: { message: string } | null;
      try {
        ({ error: insertErr } = await admin.from("messages").insert({
          organization_id: resolved.organizationId,
          conversation_id: resolved.conversationId,
          direction: "outbound",
          provider: "retell",
          body: turn.body,
          draft_status: "auto_sent",
          sent_at: turn.sentAt,
          provider_message_id: turn.messageId,
        }));
      } catch (err) {
        await releaseDedupClaim(admin, turn.messageId);
        console.error(`[retell sms webhook] agent insert threw: ${String(err)}`);
        return NextResponse.json(
          { success: false, error: "Agent message insert failed" },
          { status: 500 },
        );
      }
      if (insertErr) {
        await releaseDedupClaim(admin, turn.messageId);
        console.error(
          `[retell sms webhook] agent insert failed: ${insertErr.message}`,
        );
        return NextResponse.json(
          { success: false, error: "Agent message insert failed" },
          { status: 500 },
        );
      }
      agentInserted += 1;
      lastSentAt = turn.sentAt;
    }

    if (lastSentAt) {
      await admin
        .from("conversations")
        .update({ last_message_at: lastSentAt })
        .eq("id", resolved.conversationId);
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      event,
      ingested,
      duplicates,
      agentInserted,
      agentDuplicates,
      reconciled,
    },
  });
}

/**
 * Locate the approved-draft `messages` row a dispatch chat should
 * reconcile onto: prefer the `message_id` we threaded through the
 * `create-sms-chat` metadata; otherwise match the `chat_id` the approve
 * route stored as `provider_message_id` on the draft.
 */
async function findDispatchDraftRow(
  admin: AdminClient,
  chat: RetellChat,
  numbers: ResolvedChatNumbers,
): Promise<string | null> {
  if (numbers.messageId) {
    let query = admin
      .from("messages")
      .select("id")
      .eq("id", numbers.messageId)
      .eq("direction", "outbound");
    if (numbers.organizationId)
      query = query.eq("organization_id", numbers.organizationId);
    const { data } = await query.limit(1).maybeSingle();
    if (data) return data.id;
  }
  let query = admin
    .from("messages")
    .select("id")
    .eq("provider", "retell")
    .eq("provider_message_id", chat.chat_id)
    .eq("direction", "outbound");
  if (numbers.organizationId)
    query = query.eq("organization_id", numbers.organizationId);
  const { data } = await query.limit(1).maybeSingle();
  return data?.id ?? null;
}

/**
 * Reconcile-only pass for chats whose ingest path is skipped (operator-
 * destined dispatch sends): write the agent's actual message onto the
 * matching draft row. Returns the reconcile count, or null on a write
 * failure (claim released so Retell's retry can redo it).
 */
async function reconcileDispatchTurns(
  admin: AdminClient,
  chat: RetellChat,
  numbers: ResolvedChatNumbers,
): Promise<number | null> {
  const targetId = await findDispatchDraftRow(admin, chat, numbers);
  if (!targetId) return 0;

  const turn = extractChatMessages(chat).find((m) => m.role === "agent");
  if (!turn) return 0;

  const { error: claimErr } = await admin.from("inbound_webhook_dedup").insert({
    provider: "retell",
    provider_message_id: turn.messageId,
  });
  if (claimErr) {
    if (claimErr.code === "23505") return 0; // replay — already reconciled
    console.error(
      `[retell sms webhook] dedup claim failed: ${claimErr.message}`,
    );
    return null;
  }

  let updateErr: { message: string } | null;
  try {
    ({ error: updateErr } = await admin
      .from("messages")
      .update({
        body: turn.body,
        sent_at: turn.sentAt,
        provider: "retell",
        provider_message_id: turn.messageId,
      })
      .eq("id", targetId));
  } catch (err) {
    await releaseDedupClaim(admin, turn.messageId);
    console.error(`[retell sms webhook] reconcile threw: ${String(err)}`);
    return null;
  }
  if (updateErr) {
    await releaseDedupClaim(admin, turn.messageId);
    console.error(
      `[retell sms webhook] reconcile failed: ${updateErr.message}`,
    );
    return null;
  }
  return 1;
}

/** Undo a dedup claim after a failed write so retries aren't misread as duplicates. */
async function releaseDedupClaim(
  admin: AdminClient,
  messageId: string,
): Promise<void> {
  await admin
    .from("inbound_webhook_dedup")
    .delete()
    .eq("provider", "retell")
    .eq("provider_message_id", messageId);
}
