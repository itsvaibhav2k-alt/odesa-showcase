/**
 * Inngest event contracts shared between the Vercel app and the
 * operator worker (src/worker/inngest-server.ts, deployed to Railway).
 *
 * This module is deliberately dependency-free. Vercel-side enqueue
 * callers (web chat route, iMessage inbound pipeline) MUST import the
 * dispatcher event name from here — importing it from
 * `functions/run-operator-dispatcher.ts` drags `run-executor` and the
 * Claude Agent SDK (whose linux-x64 native binary is ~249MB) into the
 * Vercel bundle, blowing the 250MB function cap. The worker app is the
 * only deployment allowed to load the real function.
 */

export const RUN_OPERATOR_DISPATCHER_EVENT = 'odesa/operator-run.requested';
export const RUN_OPERATOR_DISPATCHER_FN_ID = 'run-operator-dispatcher';

export const NOTIFY_LANDLORD_DEFERRED_EVENT = 'odesa/notify-landlord.deferred';
export const NOTIFY_LANDLORD_DEFERRED_FN_ID = 'deliver-deferred-notification';

/**
 * Payload for an owner SMS held back by quiet hours
 * (src/lib/messaging/quiet-hours.ts). `deliverAt` is the ISO instant of
 * the next 09:00 in the org's timezone, computed at emit time; the
 * handler sleeps until then and re-enters `notifyLandlord` with the
 * quiet-hours gate bypassed.
 */
export interface NotifyLandlordDeferredEventData {
  organizationId: string;
  body: string;
  deliverAt: string;
}

/**
 * Shape senders must put on the event. `chatId` is not read by the
 * handler body — it exists for the concurrency-key expression
 * (`event.data.chatId`, limit 1: at most one run per chat, mirroring
 * the DB-level partial unique index on `agent_runs(chat_id)`).
 */
export interface RunOperatorDispatcherEventData {
  runId: string;
  chatId: string;
}
