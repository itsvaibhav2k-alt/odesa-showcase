import type { InboundMessage } from "./types";
import { createAdminClient } from "@/lib/supabase/admin";

export type ConsentCommand = "stop" | "start" | "help";

const COMMANDS: Readonly<Record<string, ConsentCommand>> = {
  STOP: "stop",
  STOPALL: "stop",
  UNSUBSCRIBE: "stop",
  CANCEL: "stop",
  END: "stop",
  QUIT: "stop",
  START: "start",
  UNSTOP: "start",
  YES: "start",
  HELP: "help",
  INFO: "help",
};

export function parseConsentCommand(body: string): ConsentCommand | null {
  const normalized = body
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "");
  return COMMANDS[normalized] ?? null;
}

export async function applyInboundConsentCommand(
  organizationId: string,
  msg: InboundMessage,
  command: ConsentCommand,
): Promise<{ state: "unknown" | "opted_in" | "suppressed"; changed: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("apply_messaging_consent_command", {
    p_organization_id: organizationId,
    p_recipient_e164: msg.fromE164,
    p_command: command,
    p_provider: msg.provider,
    p_provider_message_id: msg.providerMessageId ?? null,
    p_occurred_at: msg.providerOccurredAt ?? null,
  });
  const row = data?.[0];
  if (error || !row) {
    throw new Error(
      `consent transition failed: ${error?.message ?? "no result"}`,
    );
  }
  return { state: row.state, changed: row.changed };
}
