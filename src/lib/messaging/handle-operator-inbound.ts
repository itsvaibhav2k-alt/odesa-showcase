/**
 * Operator-side inbound pipeline for iMessage — Phase 2.
 *
 * Drives the operator-facing iMessage flow when `routeInbound` says
 * the sender is a verified user. Mirrors `handle-inbound.ts` shape so
 * the route handler can fork without changing its response envelope.
 *
 * Pipeline:
 *   1. Resolve or open the operator chat for (org, user, channel='imessage').
 *   2. Wire `sendInline` to `sendImessageReply`, start the typing loop,
 *      drive `runOperatorDispatcher` to completion. If the chat has a
 *      stamped `property_id`, look up its name and pass `propertyHint`
 *      to the dispatcher as a prompt prologue hint.
 *   3. Accumulate `say.delta` chunks; tag `proposal.*` events into a
 *      side action-summary list; on `done` flush a single iMessage
 *      with `[narrative, '', ...actions].join('\n\n')`.
 *   4. try/finally always stops the typing loop.
 *
 * Durable path (Phase B, flag `ODESA_DURABLE_CHAT` /
 * `NEXT_PUBLIC_DURABLE_CHAT`): steps 3-4 move out of the webhook
 * request entirely. After the dedup claim + chat/propertyHint
 * resolution, we insert an `agent_runs(status='queued')` row, fire the
 * `odesa/operator-run.requested` Inngest event, and return in <1s —
 * which also kills Sendblue webhook-timeout retry duplicates. The
 * Inngest executor (`run-executor.ts`) drives the dispatcher, runs the
 * typing loop, and sends the composed reply. Flag off → the inline
 * path below is byte-identical to before.
 *
 * Never throws — webhook routes can't recover from a thrown 500 here
 * without dropping the operator's message. Errors come back as the
 * `ok: false` discriminated variant.
 */

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import type { WorkerActionType } from "@/lib/agent/worker/types";
import { REVIEW_ACTION_LABELS } from "@/lib/agent/worker/action-labels";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/lib/inngest/client";
// Event name comes from the dependency-free events module — importing
// it from functions/run-operator-dispatcher would statically pull
// run-executor + the Claude Agent SDK into Vercel webhook routes.
import { RUN_OPERATOR_DISPATCHER_EVENT } from "@/lib/inngest/events";
import { loadOrCreateChat } from "@/lib/agent/operator/persist";
import {
  sendImessageReply,
  startTypingLoop,
} from "@/lib/agent/operator/imessage";
import type { DispatcherEvent } from "@/lib/agent/operator/types";
import type { InboundMessage } from "./types";

export interface HandleOperatorInboundOk {
  ok: true;
  duplicate?: false;
  /** The operator_chats id this turn was appended to. */
  chatId: string;
  /** The combined narrative + actions body that was iMessaged back. */
  body: string;
}

/**
 * The provider retried a webhook another delivery already claimed in
 * `inbound_webhook_dedup`. The dispatcher was NOT run — a retry must
 * never double-reply — and the webhook should still 2xx.
 */
export interface HandleOperatorInboundDuplicate {
  ok: true;
  duplicate: true;
}

/**
 * Durable path (flag on): the run row + Inngest event are in; the
 * dispatcher runs out-of-band in the executor. No reply body exists
 * yet — the executor sends it when the run completes.
 */
export interface HandleOperatorInboundEnqueued {
  ok: true;
  duplicate?: false;
  enqueued: true;
  chatId: string;
  runId: string;
  turnId: string;
}

export interface HandleOperatorInboundErr {
  ok: false;
  error: string;
}

export type HandleOperatorInboundResult =
  | HandleOperatorInboundOk
  | HandleOperatorInboundDuplicate
  | HandleOperatorInboundEnqueued
  | HandleOperatorInboundErr;

export interface OperatorIdentity {
  id: string;
  organizationId: string;
}

/**
 * Drive a single operator turn end-to-end. Always returns; never
 * throws. The webhook route surfaces the discriminated result either
 * as 200/json or 500/json — both are acceptable to Linq/Twilio.
 */
export async function handleOperatorInbound(
  msg: InboundMessage,
  user: OperatorIdentity,
): Promise<HandleOperatorInboundResult> {
  const admin = createAdminClient();
  let claimed = false;
  let completed = false;

  try {

  // ---- 0. Claim the webhook delivery (dedup). ----
  // The operator path writes no message row, so a provider retry would
  // otherwise re-run the entire dispatcher and double-reply. Claim
  // (provider, provider_message_id) BEFORE any side effects; a 23505
  // means an earlier delivery (or a concurrent retry) owns this id.
  // No provider id (legacy replays) → process as before.
  if (msg.providerMessageId) {
    try {
      const { error } = await admin.from("inbound_webhook_dedup").insert({
        provider: msg.provider,
        provider_message_id: msg.providerMessageId,
      });
      if (error) {
        if (error.code === "23505") {
          return { ok: true, duplicate: true };
        }
        // Fail closed: no side effects have run yet, so a 5xx retry
        // from the provider is safe here.
        return { ok: false, error: `dedup claim failed: ${error.message}` };
      }
      claimed = true;
    } catch (err) {
      return { ok: false, error: `dedup claim failed: ${errMsg(err)}` };
    }
  }

  // ---- 1. Open or resume the chat. ----
  let chatId: string;
  let propertyId: string | null;
  try {
    const chat = await loadOrCreateChat(admin, {
      organizationId: user.organizationId,
      userId: user.id,
      propertyId: null,
      channel: "imessage",
    });
    chatId = chat.id;
    propertyId = chat.property_id;
  } catch (err) {
    return { ok: false, error: `loadOrCreateChat failed: ${errMsg(err)}` };
  }

  // ---- 2. Build propertyHint from the chat's stamped property_id (if any). ----
  let propertyHint: { id: string; name: string } | undefined;
  if (propertyId !== null) {
    try {
      const { data: propRow } = await admin
        .from("properties")
        .select("name")
        .eq("id", propertyId)
        .maybeSingle();
      if (propRow) {
        propertyHint = { id: propertyId, name: propRow.name };
      }
      // If lookup returned null or failed, just leave propertyHint undefined —
      // the dispatcher can recover without the hint.
    } catch {
      // Non-fatal: proceed without the hint.
    }
  }

  // ---- 2b. Durable path (flag on): enqueue the run and return <1s. ----
  if (durableChatEnabled()) {
    const result = await enqueueDurableRun(admin, msg, user, chatId, propertyHint);
    completed = result.ok;
    return result;
  }

  // ---- 3. Drive the dispatcher. ----
  // Lazy import: the dispatcher statically imports the Claude Agent SDK,
  // which must stay out of the Vercel bundle. This legacy non-durable
  // branch only runs with the durable-chat flag off, so the cost lands
  // on first use. Imported before the typing loop starts so a rejected
  // import can't leak the loop or break the never-throws contract.
  let runOperatorDispatcher: (typeof import("@/lib/agent/operator/dispatcher"))["runOperatorDispatcher"];
  try {
    ({ runOperatorDispatcher } =
      await import("@/lib/agent/operator/dispatcher"));
  } catch (err) {
    return {
      ok: false,
      error: `dispatcher import failed: ${errMsg(err)}`,
    };
  }

  const stopTyping = startTypingLoop({
    organizationId: user.organizationId,
    toE164: msg.fromE164,
  });

  const sendInline = (text: string): Promise<void> =>
    sendImessageReply({
      organizationId: user.organizationId,
      toE164: msg.fromE164,
      text,
      idempotencyKey: `operator-inbound:${msg.provider}:${msg.providerMessageId ?? msg.receivedAt}`,
    });

  let narrative = "";
  const actions: string[] = [];

  try {
    for await (const event of runOperatorDispatcher({
      admin,
      organizationId: user.organizationId,
      userId: user.id,
      chatId,
      propertyHint,
      message: msg.body,
      channel: "imessage",
      sendInline,
    })) {
      reduceEvent(
        event,
        (chunk) => {
          narrative += chunk;
        },
        (line) => {
          actions.push(line);
        },
      );
    }
  } catch (err) {
    // Defensive — dispatcher contract says it never throws, but a
    // bug shouldn't take down the webhook.
    actions.push(`⚠ Dispatcher crashed: ${errMsg(err)}`);
  } finally {
    stopTyping();
  }

  const body = composeReply(narrative, actions);
  if (body.length > 0) {
    await safeSend(
      user.organizationId,
      msg.fromE164,
      body,
      `operator-inbound:${msg.provider}:${msg.providerMessageId ?? msg.receivedAt}:pending`,
    );
  }

  completed = true;
  return { ok: true, chatId, body };
  } finally {
    if (claimed && !completed && msg.providerMessageId) {
      await releaseOperatorDedupClaim(admin, msg.provider, msg.providerMessageId);
    }
  }
}

/** Release an unfinished operator claim so a provider retry can safely retry. */
async function releaseOperatorDedupClaim(
  admin: SupabaseClient<Database>,
  provider: InboundMessage['provider'],
  providerMessageId: string,
): Promise<void> {
  try {
    const { error } = await admin
      .from('inbound_webhook_dedup')
      .delete()
      .eq('provider', provider)
      .eq('provider_message_id', providerMessageId);
    if (error) {
      console.error(
        `[handle-operator-inbound] dedup release failed: ${error.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[handle-operator-inbound] dedup release failed: ${errMsg(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Internal — durable enqueue (Phase B, flag-gated)
// ---------------------------------------------------------------------------

const BUSY_REPLY =
  "Still working on your last message — give me a moment, then send that again.";

/**
 * Server-side read of the durable-chat flag. `NEXT_PUBLIC_DURABLE_CHAT`
 * is the client-visible flag the web surface uses; `ODESA_DURABLE_CHAT`
 * is its server twin for server-only rollouts. Either being 'true'
 * turns the durable path on (same read-direct-from-process.env idiom
 * as `ODESA_CITATION_ENFORCEMENT` in commit-gate.ts).
 */
function durableChatEnabled(): boolean {
  return (
    process.env.ODESA_DURABLE_CHAT === "true" ||
    process.env.NEXT_PUBLIC_DURABLE_CHAT === "true"
  );
}

/**
 * Local-dev convenience: when Inngest isn't reachable, the run may
 * execute inline (fire-and-forget, same agent_runs lifecycle).
 * Production NEVER falls back inline; `DURABLE_CHAT_REQUIRE_INNGEST`
 * forces the same strictness locally.
 */
function allowInlineFallback(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DURABLE_CHAT_REQUIRE_INNGEST !== "true"
  );
}

/**
 * Insert the durable run intent + fire the Inngest event. The webhook
 * returns immediately; the executor owns typing, dispatch, and the
 * reply send from here.
 *
 * Failure semantics:
 *   - `agent_runs` insert 23505 → the partial unique index
 *     `uq_agent_runs_active_chat` fired: a run is already queued or
 *     running for this chat. We tell the operator we're busy (safe —
 *     the dedup claim above means a provider retry can't get here) and
 *     report ok so the webhook 2xxes.
 *   - `inngest.send` failure in dev → inline fallback via Next's
 *     `after()` (or a detached promise outside a request scope) so the
 *     run still executes through the same claim/heartbeat/finalize
 *     lifecycle.
 *   - `inngest.send` failure in prod → mark the run failed
 *     (conditional on still-queued) and let the watchdog's notify
 *     bucket apologize within ~2 minutes. Never inline in prod.
 */
async function enqueueDurableRun(
  admin: SupabaseClient<Database>,
  msg: InboundMessage,
  user: OperatorIdentity,
  chatId: string,
  propertyHint: { id: string; name: string } | undefined,
): Promise<HandleOperatorInboundResult> {
  const runId = randomUUID();
  const turnId = randomUUID();

  const { error: insertError } = await admin.from("agent_runs").insert({
    id: runId,
    organization_id: user.organizationId,
    user_id: user.id,
    chat_id: chatId,
    turn_id: turnId,
    surface: "imessage",
    channel: "imessage",
    message: msg.body,
    property_hint: propertyHint ?? null,
    reply_to_e164: msg.fromE164,
    status: "queued",
  });
  if (insertError) {
    if (insertError.code === "23505") {
      await safeSend(
        user.organizationId,
        msg.fromE164,
        BUSY_REPLY,
        `operator-inbound:${msg.provider}:${msg.providerMessageId ?? msg.receivedAt}:busy`,
      );
      return { ok: true, chatId, body: BUSY_REPLY };
    }
    return {
      ok: false,
      error: `agent_runs insert failed: ${insertError.message}`,
    };
  }

  // One immediate typing burst so the operator sees life before the
  // executor claims the run (which restarts the loop). startTypingLoop
  // fires once synchronously; invoking the stop fn right away cancels
  // the 5s repeat without suppressing that first burst.
  startTypingLoop({
    organizationId: user.organizationId,
    toE164: msg.fromE164,
  })();

  try {
    await inngest.send({
      name: RUN_OPERATOR_DISPATCHER_EVENT,
      data: { runId, chatId },
    });
  } catch (err) {
    if (allowInlineFallback()) {
      console.warn(
        `[handle-operator-inbound] inngest.send failed (${errMsg(err)}) — ` +
          `dev inline fallback for run ${runId}`,
      );
      scheduleInlineExecution(runId);
    } else {
      console.error(
        `[handle-operator-inbound] inngest.send failed for run ${runId}: ${errMsg(err)}`,
      );
      const { error: failError } = await admin
        .from("agent_runs")
        .update({
          status: "failed",
          error: `inngest_send_failed: ${errMsg(err)}`,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId)
        .eq("status", "queued");
      if (failError) {
        // Row stays queued; the watchdog's never_started bucket
        // catches it in 10 minutes instead of 2. Log loudly.
        console.error(
          `[handle-operator-inbound] could not mark run ${runId} failed: ${failError.message}`,
        );
      }
    }
  }

  return { ok: true, enqueued: true, chatId, runId, turnId };
}

/**
 * Dev-only inline execution: same `executeAgentRun` lifecycle the
 * Inngest function drives, detached from the webhook response. Lazy
 * imports break the module cycle (run-executor imports reduceEvent /
 * composeReply from this file) and keep `next/server` out of the
 * webhook's hot path. `after()` defers until the response is flushed;
 * outside a request scope (tests) it throws and we fall back to a
 * detached promise.
 */
function scheduleInlineExecution(runId: string): void {
  const work = async (): Promise<void> => {
    try {
      const { executeAgentRun } =
        await import("@/lib/agent/operator/run-executor");
      await executeAgentRun(runId);
    } catch (err) {
      console.error(
        `[handle-operator-inbound] inline run ${runId} failed: ${errMsg(err)}`,
      );
    }
  };
  void (async (): Promise<void> => {
    try {
      const { after } = await import("next/server");
      after(work);
    } catch {
      void work();
    }
  })();
}

// ---------------------------------------------------------------------------
// Internal — event reducer (exported for tests)
// ---------------------------------------------------------------------------

export function reduceEvent(
  event: DispatcherEvent,
  appendNarrative: (chunk: string) => void,
  appendAction: (line: string) => void,
): void {
  switch (event.type) {
    case "say.delta":
      appendNarrative(event.text);
      return;
    case "proposal.committed": {
      // When the wave-6 handler reported a soft failure, render a
      // failure line instead of "✓ Done" — the proposal row is committed
      // but the side effect didn't land. Without this, the operator sees
      // a misleading success ack while the DB is unchanged.
      if (event.handlerOutcome && !event.handlerOutcome.ok) {
        const action = reviewActionLabel(event.proposal.action_type);
        const reason = humanizeHandlerError(event.handlerOutcome.error);
        appendAction(`⚠ Couldn't complete ${action.toLowerCase()} — ${reason}`);
        return;
      }
      const summary = formatProposalSummary(
        event.proposal.action_type,
        toRecord(event.proposal.payload),
        null,
      );
      appendAction(summary);
      return;
    }
    case "proposal.review_required": {
      appendAction(
        formatReviewProposalSummary(
          event.proposal.action_type,
          toRecord(event.proposal.payload),
          safeReviewDestination(event.reviewUrl),
        ),
      );
      return;
    }
    case "tool.error":
      // Never render internal failure detail on the operator's SMS
      // thread — SDK subprocess crashes ("Claude Code process exited
      // with code 1", binary paths) read as broken product, and worse,
      // leak infrastructure internals to whoever holds the phone. Full
      // detail goes to host logs; the thread gets one friendly line
      // (composeReply collapses repeats within a run).
      console.error(
        `[operator-reply] tool.error suppressed from SMS — ${event.name}: ${event.message}`,
      );
      appendAction(OPERATOR_ERROR_SMS_LINE);
      return;
    case "ack":
    case "tool.use":
    case "tool.result":
    case "proposal.recorded":
    case "done":
      // Acks already routed via sendInline. tool.use/result + recorded
      // are audit-only on iMessage. done is the terminator we already
      // observe via the for-await ending.
      return;
  }
}

export const OPERATOR_ERROR_SMS_LINE =
  "⚠ Something went wrong on my end — that didn’t go through. It’s logged; check this thread or Owner Queue before trying again.";

export function composeReply(narrative: string, actions: string[]): string {
  const parts: string[] = [];
  const trimmed = narrative.trim();
  if (trimmed.length > 0) parts.push(trimmed);
  // Multiple tool.error events in one run (e.g. a crash-retry loop)
  // each append the same generic line; the owner should read it once.
  let errorLineSeen = false;
  const deduped = actions.filter((line) => {
    if (line !== OPERATOR_ERROR_SMS_LINE) return true;
    if (errorLineSeen) return false;
    errorLineSeen = true;
    return true;
  });
  if (deduped.length > 0) parts.push(deduped.join("\n"));
  return parts.join("\n\n");
}

function reviewActionLabel(actionType: WorkerActionType): string {
  return REVIEW_ACTION_LABELS[actionType];
}

/**
 * Deterministic review copy derived from validated proposal payload, never the
 * model's success claim. Known review routes collapse to their public landing
 * page so proposal UUIDs cannot leak into customer-facing messages.
 */
function formatReviewProposalSummary(
  actionType: WorkerActionType,
  payload: Record<string, unknown>,
  destination: string,
): string {
  if (actionType === "update_rent") {
    const tenant = describeLeaseSubject(payload, null);
    const rent = pickNumber(payload, "rentAmount", null, "rent_amount");
    const amount = rent === null ? "a new amount" : `$${rent.toLocaleString("en-US")}/month`;
    return `⏳ Rent change for ${tenant} to ${amount} — needs review: ${destination}`;
  }

  return `⏳ ${reviewActionLabel(actionType)} — needs review: ${destination}`;
}

function safeReviewDestination(reviewUrl: string): string {
  return reviewUrl.startsWith("/escalations") ? "/escalations" : "/owner-queue";
}

// ---------------------------------------------------------------------------
// formatProposalSummary — natural-language past-tense narration
// ---------------------------------------------------------------------------
//
// Renders a single line per committed proposal so the iMessage reply
// reads like the operator did the thing, not like a tool log. The
// caller appends the summary BELOW the assistant's text reply (see
// `composeReply`'s `[narrative, '', ...actions].join('\n\n')` shape).
//
// `payload` is always present (snapshot from the recorded proposal).
// `data` is optional and reserved for future use when the dispatcher
// surfaces the handler's return-value row alongside the proposal.

const ACTION_LABELS: Record<string, string> = {
  draft_sms_reply: "Drafted SMS reply",
  dispatch_vendor: "Drafted vendor dispatch",
  polish_briefing: "Polished briefing",
  classify_intent: "Classified intent",
  confirm_emergency: "Confirmed emergency",
  update_rulebook: "Drafted rulebook edit",
};

/**
 * Natural-language past-tense summary for a committed proposal.
 *
 * @param actionType - the proposal's action_type discriminator.
 * @param payload    - the proposal's payload (snapshot of model output
 *                     for draft actions, or dispatcher-supplied for
 *                     write actions).
 * @param data       - optional handler return-value row. Reserved for
 *                     future enrichment; current callers pass null.
 */
export function formatProposalSummary(
  actionType: string,
  payload: Record<string, unknown>,
  data: Record<string, unknown> | null,
): string {
  switch (actionType) {
    case "create_property": {
      const name = pickString(payload, "name", data, "name") ?? "property";
      const street =
        pickString(payload, "addressStreet", data, "address_street") ?? "";
      const city =
        pickString(payload, "addressCity", data, "address_city") ?? "";
      const state =
        pickString(payload, "addressState", data, "address_state") ?? "";
      const zip = pickString(payload, "addressZip", data, "address_zip") ?? "";
      const cityState = [city, state].filter(Boolean).join(" ");
      const cityStateZip = [cityState, zip].filter(Boolean).join(" ");
      const tail = [street, cityStateZip].filter(Boolean).join(", ");
      return tail ? `✓ Created "${name}" at ${tail}.` : `✓ Created "${name}".`;
    }
    case "add_unit": {
      const label = pickString(payload, "label", data, "label") ?? "unit";
      const beds = pickNumber(payload, "bedrooms", data, "bedrooms");
      const baths = pickNumber(payload, "bathrooms", data, "bathrooms");
      const dims =
        beds !== null && baths !== null ? ` (${beds}br/${baths}ba)` : "";
      return `✓ Added unit ${label}${dims}.`;
    }
    case "add_tenant": {
      const name =
        pickString(payload, "fullName", data, "full_name") ?? "tenant";
      const phone = pickString(payload, "phoneE164", data, "phone_e164");
      return phone
        ? `✓ Added tenant ${name} (${phone}).`
        : `✓ Added tenant ${name}.`;
    }
    case "set_lease_terms": {
      const rent = pickNumber(payload, "rentAmount", data, "rent_amount");
      const dueDay = pickNumber(payload, "rentDueDay", data, "rent_due_day");
      const tenant = describeLeaseSubject(payload, data);
      const rentStr = rent !== null ? `$${rent.toLocaleString()}/mo` : "rent";
      const dueStr = dueDay !== null ? `, due day ${dueDay}` : "";
      return `✓ Set lease for ${tenant}: ${rentStr}${dueStr}.`;
    }
    case "update_rent": {
      const rent = pickNumber(payload, "rentAmount", data, "rent_amount");
      const tenant = describeLeaseSubject(payload, data);
      const rentStr = rent !== null ? `$${rent.toLocaleString()}/mo` : "rent";
      return `✓ Updated ${tenant}'s rent to ${rentStr}.`;
    }
    case "send_tenant_message": {
      const tenant = describeTenantSubject(payload, data);
      return `✓ Sent message to ${tenant}.`;
    }
    case "log_maintenance_ticket": {
      const summary =
        pickString(payload, "summary", data, "summary") ?? "maintenance";
      const severity =
        pickString(payload, "severity", data, "severity") ?? "medium";
      return `✓ Logged ticket: ${summary} (${severity}).`;
    }
    case "update_property_rules": {
      const property = describePropertySubject(payload, data);
      return `✓ Updated ${property} rules.`;
    }
    case "archive_lease": {
      const tenant = describeLeaseSubject(payload, data);
      const reason = pickString(payload, "reason", data, "reason");
      return reason
        ? `✓ Archived ${tenant}'s lease (${reason}).`
        : `✓ Archived ${tenant}'s lease.`;
    }
    case "add_appliance": {
      const type = pickString(payload, "type", data, "type") ?? "appliance";
      const make = pickString(payload, "make", data, "make");
      const model = pickString(payload, "model", data, "model");
      const makeModel = [make, model].filter(Boolean).join(" ");
      const unitLabel = describeApplianceUnit(payload);
      const where = unitLabel ? ` in ${unitLabel}` : "";
      const tail = makeModel ? `: ${makeModel}` : "";
      return `✓ Logged ${type}${tail}${where}.`;
    }
    case "update_appliance": {
      // Type may ride top-level (when caller is retyping) OR live inside
      // applianceRef when the ref carries it as the disambiguator.
      const topLevel = pickString(payload, "type", data, "type");
      const ref = payload["applianceRef"];
      let refType: string | null = null;
      if (ref && typeof ref === "object") {
        const refRec = ref as Record<string, unknown>;
        if (typeof refRec["type"] === "string" && refRec["type"]) {
          refType = refRec["type"];
        }
      }
      const type = topLevel ?? refType ?? "appliance";
      return `✓ Updated ${type} details.`;
    }
    case "set_property_vendor": {
      const category =
        pickString(payload, "category", data, "category") ?? "vendor";
      const property = describePropertySubject(payload, data);
      const vendor = describeVendorSubject(payload, data);
      const vendorTail = vendor ? `: ${vendor}` : "";
      return `✓ Set ${category} for ${property}${vendorTail}.`;
    }
    case "update_tenant_preference": {
      const tenant = describeTenantSubject(payload, data);
      const fields = describeTenantPrefFields(payload);
      return fields
        ? `✓ Updated ${tenant}'s preferences: ${fields}.`
        : `✓ Updated ${tenant}'s preferences.`;
    }
    case "request_rent_payment": {
      const tenant = describeTenantSubject(payload, data);
      const amountCents = pickNumber(
        payload,
        "amountCents",
        data,
        "amount_cents",
      );
      const monthLabel =
        pickString(payload, "monthLabel", data, "month_label") ??
        deriveMonthLabel(pickString(payload, "dueDate", data, "due_date"));
      const dollars =
        amountCents !== null
          ? `$${(amountCents / 100).toLocaleString("en-US")}`
          : "their rent";
      return monthLabel
        ? `✓ Sent rent link to ${tenant} (${dollars} for ${monthLabel}).`
        : `✓ Sent rent link to ${tenant} (${dollars}).`;
    }
    case "schedule_calendar_event": {
      const summary =
        pickString(payload, "summary", data, "summary") ?? "event";
      const startIso = pickString(payload, "startIso", data, "start_iso");
      const when = startIso ? formatCalendarWhen(startIso) : null;
      return when ? `✓ Booked ${summary} ${when}.` : `✓ Booked ${summary}.`;
    }
    case "cancel_calendar_event": {
      const summary = pickString(payload, "summary", data, "summary");
      return summary
        ? `✓ Canceled ${summary}.`
        : `✓ Canceled the calendar event.`;
    }
    default: {
      const label =
        ACTION_LABELS[actionType] ??
        REVIEW_ACTION_LABELS[actionType as WorkerActionType] ??
        "Completed property operation";
      return `✓ ${label} (auto)`;
    }
  }
}

/**
 * Map a handler's stable error string to a human-readable reason for
 * the iMessage narration. Unknown codes stay in internal evidence only.
 */
export function humanizeHandlerError(error: string | undefined): string {
  if (!error) return "handler did not complete";
  switch (error) {
    case "lease_not_found_attach_unit_first":
      return "the tenant isn't on a unit yet — attach a unit first.";
    case "lease_not_found":
      return "no matching lease was found.";
    case "ambiguous_lease":
      return "multiple matching leases — please disambiguate.";
    case "ambiguous_property":
      return "multiple properties match that name — be more specific.";
    case "ambiguous_tenant":
      return "multiple tenants match that name — be more specific.";
    case "ambiguous_unit":
      return "multiple units match that label — be more specific.";
    case "property_not_found":
      return "the property name didn't match anything.";
    case "tenant_not_found":
      return "the tenant name didn't match anything.";
    case "unit_not_found":
      return "the unit label didn't match anything.";
    case "calendar_not_connected":
      return "connect Google Calendar in settings first.";
    case "event_not_found":
      return "that calendar event isn't on the calendar (already cancelled?).";
    default:
      return "the operation needs reconciliation before another attempt.";
  }
}

// ---------------------------------------------------------------------------
// formatProposalSummary helpers
// ---------------------------------------------------------------------------

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function pickString(
  payload: Record<string, unknown>,
  payloadKey: string,
  data: Record<string, unknown> | null,
  dataKey: string,
): string | null {
  const fromPayload = payload[payloadKey];
  if (typeof fromPayload === "string" && fromPayload.length > 0) {
    return fromPayload;
  }
  if (data) {
    const fromData = data[dataKey];
    if (typeof fromData === "string" && fromData.length > 0) {
      return fromData;
    }
  }
  return null;
}

function pickNumber(
  payload: Record<string, unknown>,
  payloadKey: string,
  data: Record<string, unknown> | null,
  dataKey: string,
): number | null {
  const fromPayload = payload[payloadKey];
  if (typeof fromPayload === "number" && Number.isFinite(fromPayload)) {
    return fromPayload;
  }
  if (data) {
    const fromData = data[dataKey];
    if (typeof fromData === "number" && Number.isFinite(fromData)) {
      return fromData;
    }
  }
  return null;
}

function describeLeaseSubject(
  payload: Record<string, unknown>,
  data: Record<string, unknown> | null,
): string {
  const ref = payload["leaseRef"];
  if (ref && typeof ref === "object") {
    const refRec = ref as Record<string, unknown>;
    if (typeof refRec["tenantName"] === "string" && refRec["tenantName"]) {
      return refRec["tenantName"];
    }
  }
  const fromData = data ? data["tenant_name"] : undefined;
  if (typeof fromData === "string" && fromData.length > 0) {
    return fromData;
  }
  return "tenant";
}

function describeTenantSubject(
  payload: Record<string, unknown>,
  data: Record<string, unknown> | null,
): string {
  const ref = payload["tenantRef"];
  if (ref && typeof ref === "object") {
    const refRec = ref as Record<string, unknown>;
    if (typeof refRec["tenantName"] === "string" && refRec["tenantName"]) {
      return refRec["tenantName"];
    }
  }
  const fromData = data ? data["full_name"] : undefined;
  if (typeof fromData === "string" && fromData.length > 0) {
    return fromData;
  }
  return "tenant";
}

function describePropertySubject(
  payload: Record<string, unknown>,
  data: Record<string, unknown> | null,
): string {
  const ref = payload["propertyRef"];
  if (ref && typeof ref === "object") {
    const refRec = ref as Record<string, unknown>;
    if (typeof refRec["propertyName"] === "string" && refRec["propertyName"]) {
      return `"${refRec["propertyName"]}"`;
    }
  }
  const fromData = data ? data["name"] : undefined;
  if (typeof fromData === "string" && fromData.length > 0) {
    return `"${fromData}"`;
  }
  return "property";
}

function describeVendorSubject(
  payload: Record<string, unknown>,
  data: Record<string, unknown> | null,
): string | null {
  const ref = payload["vendorRef"];
  if (ref && typeof ref === "object") {
    const refRec = ref as Record<string, unknown>;
    if (typeof refRec["vendorName"] === "string" && refRec["vendorName"]) {
      return refRec["vendorName"];
    }
  }
  const fromData = data ? data["vendor_name"] : undefined;
  if (typeof fromData === "string" && fromData.length > 0) {
    return fromData;
  }
  return null;
}

function describeApplianceUnit(
  payload: Record<string, unknown>,
): string | null {
  const ref = payload["unitRef"];
  if (ref && typeof ref === "object") {
    const refRec = ref as Record<string, unknown>;
    const label = refRec["unitLabel"];
    if (typeof label === "string" && label.length > 0) {
      return `unit ${label}`;
    }
  }
  return null;
}

/**
 * Render the prefs-changed list for `update_tenant_preference`. Skips
 * source/confidence (handler bookkeeping); maps payload keys to short
 * human phrases. Returns `null` when no UI-visible fields were set.
 */
function describeTenantPrefFields(
  payload: Record<string, unknown>,
): string | null {
  const out: string[] = [];
  const channel = payload["preferredChannel"];
  if (typeof channel === "string" && channel.length > 0) {
    out.push(`prefers ${channel}`);
  }
  const lang = payload["language"];
  if (typeof lang === "string" && lang.length > 0) {
    out.push(`language ${lang}`);
  }
  const eName = payload["emergencyContactName"];
  if (typeof eName === "string" && eName.length > 0) {
    out.push(`emergency contact ${eName}`);
  }
  const parking = payload["parkingSpace"];
  if (typeof parking === "string" && parking.length > 0) {
    out.push(`parking ${parking}`);
  }
  const pets = payload["pets"];
  if (Array.isArray(pets)) {
    out.push(`${pets.length} pet${pets.length === 1 ? "" : "s"}`);
  }
  return out.length > 0 ? out.join(", ") : null;
}

/**
 * Render an ISO due date as a human month label ("June 2026"). Returns
 * null when the input is missing or unparsable so the caller falls back
 * to "their rent" copy.
 */
function deriveMonthLabel(dueDate: string | null): string | null {
  if (!dueDate) return null;
  const parsed = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Format an ISO calendar timestamp into human-friendly "Tue Jun 3 at 2pm".
 * Returns null when the input doesn't parse so the caller can fall back to
 * a tag-less narration.
 */
function formatCalendarWhen(iso: string): string | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const datePart = parsed.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timePart = parsed
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(":00", "")
    .replace(" ", "")
    .toLowerCase();
  return `${datePart} at ${timePart}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function safeSend(
  organizationId: string,
  toE164: string,
  text: string,
  idempotencyKey: string,
): Promise<void> {
  try {
    await sendImessageReply({ organizationId, toE164, text, idempotencyKey });
  } catch (err) {
    console.error(
      `[handle-operator-inbound] sendImessageReply failed: ${errMsg(err)}`,
    );
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
