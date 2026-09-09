import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/messaging/provider";
import { normalizeDeliveryStatus } from "@/lib/messaging/delivery";
import { parseFormUrlEncoded } from "@/lib/messaging/twilio";
import type { ProviderChoice } from "@/lib/messaging/types";
import type { Json } from "@/types/database";

interface Params {
  params: Promise<{ provider: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { provider: rawProvider } = await params;
  if (!["linq", "twilio", "retell"].includes(rawProvider)) {
    return NextResponse.json(
      { success: false, error: "Unknown provider" },
      { status: 404 },
    );
  }
  const provider = rawProvider as ProviderChoice;
  const rawBody = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const verified = getProvider(provider).verifyInbound({
    url: req.url,
    rawBody,
    headers,
  });
  if (!verified.ok) {
    return NextResponse.json(
      { success: false, error: "Invalid signature" },
      { status: 401 },
    );
  }

  const parsed = parseDeliveryPayload(
    provider,
    rawBody,
    req.headers.get("content-type") ?? "",
  );
  if (!parsed) {
    return NextResponse.json(
      { success: false, error: "Invalid delivery event" },
      { status: 400 },
    );
  }
  const { data, error } = await createAdminClient().rpc(
    "reconcile_message_delivery_event",
    {
      p_provider: provider,
      p_provider_message_id: parsed.providerMessageId,
      p_provider_event_id: parsed.providerEventId,
      p_status: parsed.status,
      p_occurred_at: parsed.occurredAt,
      p_raw_payload: parsed.raw as Json,
    },
  );
  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Reconcile failed",
      },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true, data: data?.[0] ?? null });
}

interface ParsedDelivery {
  providerMessageId: string;
  providerEventId: string;
  status: NonNullable<ReturnType<typeof normalizeDeliveryStatus>>;
  occurredAt: string | null;
  raw: Record<string, unknown>;
}

function parseDeliveryPayload(
  provider: ProviderChoice,
  rawBody: string,
  contentType: string,
): ParsedDelivery | null {
  let raw: Record<string, unknown>;
  if (
    provider === "twilio" ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    raw = parseFormUrlEncoded(rawBody);
  } else {
    try {
      raw = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const string = (...keys: string[]) => {
    for (const key of keys)
      if (typeof raw[key] === "string" && raw[key]) return raw[key] as string;
    return null;
  };
  const providerMessageId = string(
    "MessageSid",
    "message_handle",
    "message_id",
    "chat_id",
  );
  const rawStatus = string("MessageStatus", "status", "delivery_status");
  const status = rawStatus ? normalizeDeliveryStatus(rawStatus) : null;
  if (!providerMessageId || !status) return null;
  const occurredAtRaw = string(
    "Timestamp",
    "timestamp",
    "occurred_at",
    "event_timestamp",
  );
  const occurredAt =
    occurredAtRaw && !Number.isNaN(Date.parse(occurredAtRaw))
      ? new Date(occurredAtRaw).toISOString()
      : null;
  const providerEventId =
    string("EventSid", "event_id", "id") ??
    createHash("sha256")
      .update(
        `${provider}\0${providerMessageId}\0${status}\0${occurredAtRaw ?? "no-provider-time"}`,
      )
      .digest("hex");
  return { providerMessageId, providerEventId, status, occurredAt, raw };
}
