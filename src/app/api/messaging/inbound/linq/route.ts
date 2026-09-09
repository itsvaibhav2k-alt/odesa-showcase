/**
 * Linq inbound webhook — Phase 4.
 *
 * Contract:
 *   POST /api/messaging/inbound/linq
 *   Headers: X-Linq-Signature: <LINQ_WEBHOOK_SECRET>
 *   Body:    JSON matching `LinqWebhookBody`
 *
 * Flow:
 *   1. Verify the shared-secret signature.
 *   2. Parse JSON; reject invalid bodies with 400.
 *   3. Normalise to `InboundMessage`.
 *   4. Call `handleInbound()` to land DB rows + Claude draft.
 *   5. Respond 200 with the new draft id so the provider (and our
 *      Playwright specs) can deep-link.
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  LinqProvider,
  normaliseLinqInbound,
  type LinqWebhookBody,
} from "@/lib/messaging/linq";
import { handleInbound } from "@/lib/messaging/handle-inbound";
import { handleOperatorInbound } from "@/lib/messaging/handle-operator-inbound";
import { routeInbound } from "@/lib/messaging/route-inbound";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  applyInboundConsentCommand,
  parseConsentCommand,
} from "@/lib/messaging/consent";

export const maxDuration = 300;

const provider = new LinqProvider();

export async function POST(req: NextRequest) {
  // T2b (2026-05-17): Sentry span — additive only, no logic changes.
  return Sentry.startSpan({ name: "linq.inbound", op: "webhook" }, () =>
    handleLinqPost(req),
  );
}

async function handleLinqPost(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const headers = lowerHeaders(req.headers);

  // Sendblue (and most webhook providers) ping the URL with an empty body
  // when the dashboard's "Save Configuration" runs. Ack those with 200 so
  // configuration save succeeds, without exposing real-message handling.
  const trimmed = rawBody.trim();
  if (!trimmed || trimmed === "{}" || trimmed === "[]") {
    return NextResponse.json({ success: true, mode: "verification" });
  }

  const verify = provider.verifyInbound({
    url: req.url,
    rawBody,
    headers,
  });
  if (!verify.ok) {
    console.warn(`[linq webhook] signature rejected: ${verify.reason}`);
    return NextResponse.json(
      { success: false, error: "Invalid signature" },
      { status: 401 },
    );
  }

  let body: LinqWebhookBody;
  try {
    body = rawBody ? (JSON.parse(rawBody) as LinqWebhookBody) : {};
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const msg = normaliseLinqInbound(body);
  if (!msg) {
    return NextResponse.json(
      { success: false, error: "Missing required fields (from/to/text)" },
      { status: 400 },
    );
  }

  // Operator vs tenant fork. Operators (verified `users.phone_e164`)
  // get the dispatcher loop; everyone else falls through to the
  // tenant draft pipeline. `unknown_org` 200s — Linq retries 5xx and
  // an unprovisioned receiving number is permanent.
  const admin = createAdminClient();
  const route = await routeInbound(admin, msg);

  if (route.kind === "unknown_org") {
    console.warn(`[linq webhook] no organization for to=${msg.toE164}`);
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
      console.error(`[linq webhook] operator handle failed: ${op.error}`);
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
    console.error(`[linq webhook] handle failed: ${result.error}`);
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
