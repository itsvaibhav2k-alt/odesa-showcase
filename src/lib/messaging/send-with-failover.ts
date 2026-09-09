/**
 * Outbound send with provider failover — Phase 4.
 *
 * Flow:
 *   1. Load the org's primary provider choice.
 *   2. Call `primary.send(msg)`. If it succeeds, we're done.
 *   3. On error, call `fallback.send(msg)` — unless the primary has no
 *      fallback partner (Retell), in which case the failure surfaces
 *      immediately (primary-only mode).
 *   4. If both fail, return a combined error.
 *
 * The return shape records which provider actually delivered so the
 * caller can persist `provider` on the `messages` row. Upstream code
 * (the draft-approve route) reads that and stores it.
 */

import {
  getPrimaryProviderChoice,
  getProvider,
  getOppositeProvider,
} from "./provider";
import type {
  OutboundDispatchMessage,
  OutboundMessage,
  ProviderChoice,
} from "./types";
import {
  claimOutboundDispatch,
  leaseOutboundAttempt,
  beginOutboundAttempt,
  recordDispatchAccepted,
  recordDispatchFailure,
} from "./dispatch-store";
import { waitAtTestHandoff } from "./test-hooks";

export interface FailoverSuccess {
  ok: true;
  provider: ProviderChoice;
  providerMessageId: string;
  attempted: ProviderChoice[];
  /** True when the primary failed and the fallback succeeded. */
  failedOver: boolean;
  /** True when an idempotent retry recovered already-accepted state. */
  replayed?: boolean;
}

export interface FailoverFailure {
  ok: false;
  status?: "failed" | "ambiguous" | "suppressed" | "in_flight";
  attempted: ProviderChoice[];
  errors: Array<{ provider: ProviderChoice; error: string }>;
}

export type FailoverResult = FailoverSuccess | FailoverFailure;

export async function sendWithFailover(
  organizationId: string,
  msg: OutboundDispatchMessage,
): Promise<FailoverResult> {
  const startedAt = Date.now();
  const claim = await claimOutboundDispatch({
    organizationId,
    messageId: msg.messageId,
    recipientE164: msg.toE164,
    idempotencyKey: msg.idempotencyKey,
    body: msg.body,
  });
  if (claim.kind === "suppressed") {
    return { ok: false, status: "suppressed", attempted: [], errors: [] };
  }
  if (claim.kind === "in_flight") {
    return { ok: false, status: "in_flight", attempted: [], errors: [] };
  }
  if (claim.kind === "replay") {
    return {
      ok: true,
      provider: claim.provider,
      providerMessageId: claim.providerMessageId,
      attempted: [],
      failedOver: false,
      replayed: true,
    };
  }
  const dispatchId = claim.dispatchId;
  const primaryChoice = await getPrimaryProviderChoice(organizationId);
  const primary = getProvider(primaryChoice);
  const fallback = getOppositeProvider(primaryChoice);

  console.log(
    `[provider-send] start org=${organizationId} primary=${primaryChoice}`,
  );

  const attempted: ProviderChoice[] = [];
  const errors: FailoverFailure["errors"] = [];

  // Thread the org id so providers that support correlation metadata
  // (Retell create-sms-chat) can echo it onto their webhooks.
  const outbound: OutboundMessage = { ...msg, organizationId };

  const primaryLease = await leaseOutboundAttempt(dispatchId, primary.name);
  if (primaryLease.kind !== "leased") {
    return {
      ok: false,
      status: primaryLease.kind,
      attempted: [],
      errors: [],
    };
  }
  await waitAtTestHandoff();
  // This is the durable handoff boundary. STOP can cancel the lease until
  // this transaction marks it network-started. Once this returns true,
  // request bytes may enter the provider and cancellation is no longer a
  // truthful guarantee; provider idempotency + reconciliation take over.
  if (
    !(await beginOutboundAttempt(
      primaryLease.attemptId,
      primaryLease.leaseToken,
    ))
  ) {
    return { ok: false, status: "suppressed", attempted: [], errors: [] };
  }

  attempted.push(primary.name);
  const primaryResult = await primary.send(outbound);
  if (primaryResult.ok) {
    await recordDispatchAccepted(
      primaryLease.attemptId,
      primaryResult.providerMessageId,
    );
    console.log(
      `[provider-send] end org=${organizationId} provider=${primary.name} id=${primaryResult.providerMessageId} failedOver=false ms=${Date.now() - startedAt}`,
    );
    return {
      ok: true,
      provider: primary.name,
      providerMessageId: primaryResult.providerMessageId,
      attempted,
      failedOver: false,
    };
  }
  errors.push({ provider: primary.name, error: primaryResult.error });
  const primaryCertainty = primaryResult.certainty ?? "definitive";
  await recordDispatchFailure(
    primaryLease.attemptId,
    primaryCertainty,
    primaryResult.error,
    fallback === null,
  );

  if (primaryCertainty === "ambiguous") {
    return { ok: false, status: "ambiguous", attempted, errors };
  }

  if (!fallback) {
    // Primary-only mode: no fallback partner (Retell). Fail cleanly so
    // the caller reverts the draft — never reroute via a legacy channel.
    console.error(
      `[provider-send] failed org=${organizationId} attempted=${attempted.join(",")} (no fallback) ms=${Date.now() - startedAt}`,
    );
    return { ok: false, status: "failed", attempted, errors };
  }

  const fallbackLease = await leaseOutboundAttempt(dispatchId, fallback.name);
  if (fallbackLease.kind !== "leased") {
    return { ok: false, status: fallbackLease.kind, attempted, errors };
  }
  await waitAtTestHandoff();
  if (
    !(await beginOutboundAttempt(
      fallbackLease.attemptId,
      fallbackLease.leaseToken,
    ))
  ) {
    return { ok: false, status: "suppressed", attempted, errors };
  }

  attempted.push(fallback.name);
  const fallbackResult = await fallback.send(outbound);
  if (fallbackResult.ok) {
    await recordDispatchAccepted(
      fallbackLease.attemptId,
      fallbackResult.providerMessageId,
    );
    console.log(
      `[provider-send] end org=${organizationId} provider=${fallback.name} id=${fallbackResult.providerMessageId} failedOver=true ms=${Date.now() - startedAt}`,
    );
    return {
      ok: true,
      provider: fallback.name,
      providerMessageId: fallbackResult.providerMessageId,
      attempted,
      failedOver: true,
    };
  }
  errors.push({ provider: fallback.name, error: fallbackResult.error });
  const fallbackCertainty = fallbackResult.certainty ?? "definitive";
  await recordDispatchFailure(
    fallbackLease.attemptId,
    fallbackCertainty,
    fallbackResult.error,
    true,
  );

  console.error(
    `[provider-send] failed org=${organizationId} attempted=${attempted.join(",")} ms=${Date.now() - startedAt}`,
  );
  return {
    ok: false,
    status: fallbackCertainty === "ambiguous" ? "ambiguous" : "failed",
    attempted,
    errors,
  };
}
