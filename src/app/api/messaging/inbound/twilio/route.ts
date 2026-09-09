/**
 * Twilio inbound webhook — Phase 4.
 *
 * Contract:
 *   POST /api/messaging/inbound/twilio
 *   Content-Type: application/x-www-form-urlencoded
 *   Headers: X-Twilio-Signature: <base64 HMAC-SHA1>
 *   Body:    Twilio-standard form params (MessageSid, From, To, Body,
 *            AccountSid, etc.)
 *
 * Flow:
 *   1. Read raw body (Twilio signs the form-url-encoded bytes).
 *   2. Verify HMAC-SHA1 signature with `TWILIO_AUTH_TOKEN` (falls back
 *      to a deterministic test token when that env var is unset).
 *   3. Normalise to `InboundMessage`.
 *   4. Delegate to `handleInbound()`.
 *   5. Return 200 with the new draft id.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  TwilioProvider,
  normaliseTwilioInbound,
  parseFormUrlEncoded,
  type TwilioWebhookBody,
} from "@/lib/messaging/twilio";
import { handleInbound } from "@/lib/messaging/handle-inbound";
import { handleOperatorInbound } from "@/lib/messaging/handle-operator-inbound";
import { routeInbound } from "@/lib/messaging/route-inbound";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  applyInboundConsentCommand,
  parseConsentCommand,
} from "@/lib/messaging/consent";

const provider = new TwilioProvider();

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const headers = lowerHeaders(req.headers);

  const verify = provider.verifyInbound({
    url: req.url,
    rawBody,
    headers,
  });
  if (!verify.ok) {
    console.warn(`[twilio webhook] signature rejected: ${verify.reason}`);
    return NextResponse.json(
      { success: false, error: "Invalid signature" },
      { status: 401 },
    );
  }

  const fields = parseFormUrlEncoded(rawBody);
  const body: TwilioWebhookBody = {
    MessageSid: fields.MessageSid,
    From: fields.From,
    To: fields.To,
    Body: fields.Body,
    AccountSid: fields.AccountSid,
  };

  const msg = normaliseTwilioInbound(body);
  if (!msg) {
    return NextResponse.json(
      { success: false, error: "Missing required fields (From/To/Body)" },
      { status: 400 },
    );
  }

  // Operator vs tenant fork. Operators (verified `users.phone_e164`)
  // get the dispatcher loop; everyone else falls through to the
  // tenant draft pipeline. `unknown_org` 200s — Twilio retries 5xx and
  // an unprovisioned receiving number is permanent.
  const admin = createAdminClient();
  const route = await routeInbound(admin, msg);

  if (route.kind === "unknown_org") {
    console.warn(`[twilio webhook] no organization for to=${msg.toE164}`);
    return NextResponse.json({
      success: true,
      data: { skipped: "unknown_org" },
    });
  }

  const consentCommand = parseConsentCommand(msg.body);
  const routedConsent = consentCommand
    ? await applyInboundConsentCommand(
        route.kind === "operator"
          ? route.user.organizationId
          : route.organizationId,
        msg,
        consentCommand,
      )
    : null;

  if (route.kind === "operator") {
    if (consentCommand && routedConsent) {
      return NextResponse.json({
        success: true,
        data: {
          mode: "operator",
          consentCommand,
          consentState: routedConsent.state,
        },
      });
    }
    const op = await handleOperatorInbound(msg, route.user);
    if (!op.ok) {
      console.error(`[twilio webhook] operator handle failed: ${op.error}`);
      return NextResponse.json(
        { success: false, error: op.error },
        { status: 500 },
      );
    }
    if (op.duplicate) {
      // Provider retry of an already-claimed delivery — dispatcher was
      // skipped. 200 so the provider stops retrying.
      return NextResponse.json({
        success: true,
        data: { duplicate: true, mode: "operator" },
      });
    }
    return NextResponse.json({
      success: true,
      data: { chatId: op.chatId, mode: "operator" },
    });
  }

  const result = await handleInbound(msg);
  if (!result.ok) {
    console.error(`[twilio webhook] handle failed: ${result.error}`);
    return NextResponse.json(
      { success: false, error: result.error },
      { status: 500 },
    );
  }

  if (result.duplicate) {
    // Provider retry of a message we already stored — no new draft was
    // generated. 200 so the provider stops retrying.
    return NextResponse.json({
      success: true,
      data: {
        duplicate: true,
        conversationId: result.conversationId,
        inboundMessageId: result.inboundMessageId,
      },
    });
  }

  if ("draftSkipped" in result && result.draftSkipped) {
    return NextResponse.json({
      success: true,
      data: {
        conversationId: result.conversationId,
        inboundMessageId: result.inboundMessageId,
        consentCommand: result.consentCommand,
        consentState: result.consentState,
      },
    });
  }

  if (!("draftMessageId" in result)) {
    return NextResponse.json(
      { success: false, error: "Inbound state incomplete" },
      { status: 500 },
    );
  }
  return NextResponse.json({
    success: true,
    data: {
      conversationId: result.conversationId,
      inboundMessageId: result.inboundMessageId,
      draftMessageId: result.draftMessageId,
      ...(result.draftSource ? { draftSource: result.draftSource } : {}),
    },
  });
}

function lowerHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}
