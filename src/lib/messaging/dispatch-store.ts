import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProviderChoice } from "./types";

export type DispatchClaim =
  | { kind: "claimed"; dispatchId: string }
  | { kind: "suppressed"; dispatchId: string }
  | { kind: "in_flight"; dispatchId: string }
  | {
      kind: "replay";
      dispatchId: string;
      provider: ProviderChoice;
      providerMessageId: string;
    };

export type AttemptLease =
  | { kind: "leased"; attemptId: string; leaseToken: string }
  | { kind: "suppressed" | "in_flight" };

export async function claimOutboundDispatch(args: {
  organizationId: string;
  messageId?: string;
  recipientE164: string;
  idempotencyKey: string;
  body: string;
}): Promise<DispatchClaim> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_outbound_message_dispatch", {
    p_organization_id: args.organizationId,
    p_message_id: args.messageId ?? null,
    p_recipient_e164: args.recipientE164,
    p_idempotency_key: args.idempotencyKey,
    p_body_sha256: createHash("sha256").update(args.body).digest("hex"),
  });
  const row = data?.[0];
  if (error || !row)
    throw new Error(`dispatch claim failed: ${error?.message ?? "no result"}`);
  if (
    row.outcome === "replay" &&
    row.canonical_provider &&
    row.canonical_provider_message_id
  ) {
    return {
      kind: "replay",
      dispatchId: row.dispatch_id,
      provider: row.canonical_provider,
      providerMessageId: row.canonical_provider_message_id,
    };
  }
  if (row.outcome === "suppressed")
    return { kind: "suppressed", dispatchId: row.dispatch_id };
  if (row.outcome === "claimed")
    return { kind: "claimed", dispatchId: row.dispatch_id };
  return { kind: "in_flight", dispatchId: row.dispatch_id };
}

export async function recordDispatchAccepted(
  attemptId: string,
  providerMessageId: string,
): Promise<void> {
  const { error } = await createAdminClient().rpc(
    "record_outbound_dispatch_accepted",
    {
      p_attempt_id: attemptId,
      p_provider_message_id: providerMessageId,
    },
  );
  if (error)
    throw new Error(`dispatch acceptance persistence failed: ${error.message}`);
}

export async function leaseOutboundAttempt(
  dispatchId: string,
  provider: ProviderChoice,
): Promise<AttemptLease> {
  const { data, error } = await createAdminClient().rpc(
    "lease_outbound_message_attempt",
    {
      p_dispatch_id: dispatchId,
      p_provider: provider,
      p_lease_seconds: 120,
    },
  );
  const row = data?.[0];
  if (error || !row)
    throw new Error(`attempt lease failed: ${error?.message ?? "no result"}`);
  if (row.outcome === "leased" && row.attempt_id && row.lease_token) {
    return {
      kind: "leased",
      attemptId: row.attempt_id,
      leaseToken: row.lease_token,
    };
  }
  return { kind: row.outcome === "suppressed" ? "suppressed" : "in_flight" };
}

export async function beginOutboundAttempt(
  attemptId: string,
  leaseToken: string,
): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc(
    "begin_outbound_message_attempt",
    { p_attempt_id: attemptId, p_lease_token: leaseToken },
  );
  if (error) throw new Error(`attempt handoff failed: ${error.message}`);
  return data === true;
}

export async function recordDispatchFailure(
  attemptId: string,
  certainty: "definitive" | "ambiguous",
  errorMessage: string,
  terminal: boolean,
): Promise<void> {
  const { error } = await createAdminClient().rpc(
    "record_outbound_dispatch_failure",
    {
      p_attempt_id: attemptId,
      p_ambiguous: certainty === "ambiguous",
      p_error: errorMessage,
      p_terminal: terminal,
    },
  );
  if (error)
    throw new Error(`dispatch failure persistence failed: ${error.message}`);
}
