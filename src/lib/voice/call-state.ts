/**
 * Call-state reducer — the single place live CallSession state changes.
 *
 * WHY a pure reducer instead of ad-hoc mutation in tool routes:
 *   - The session lives in `voice_calls.session` jsonb and is touched by
 *     multiple HTTP boundaries (webhook, report_intents, every tool route).
 *     If each of them hand-edited the object, the shape would drift and no
 *     test could replay a call. One reducer = one contract = replayable
 *     scripted calls in vitest, byte-for-byte.
 *   - Immutability is load-bearing: session-store reads jsonb, folds events,
 *     writes back. A reducer that mutated its input would corrupt retry /
 *     compare-and-set paths silently. Every branch below spreads; nothing
 *     mutates the incoming session or event.
 *   - Timestamps are ISO strings carried on the event (`at`), never
 *     Date.now() here — the engine stays deterministic under test.
 *
 * riskFlagsFor derives flags from state rather than storing them eagerly:
 * flags are a function of facts + actions + caller kind, so recomputing at
 * read time can never go stale or double-append.
 *
 * NO side effects, NO Supabase, NO imports beyond './types'.
 */

import type { CallEvent, CallSession } from './types';

/** call_started payload → fresh session. Caller starts unknown until resolved. */
export interface CreateSessionInit {
  retellCallId: string;
  organizationId: string;
  direction: 'inbound' | 'outbound';
  fromNumber: string;
  toNumber: string;
  /** ISO timestamp supplied by the caller — never generated here. */
  startedAt: string;
}

/**
 * Build the initial CallSession from a call_started payload.
 *
 * @param init - Identity fields from the webhook's call_started event.
 * @returns A fresh session: 'unknown_caller', empty stacks, no links.
 */
export function createSession(init: CreateSessionInit): CallSession {
  return {
    retellCallId: init.retellCallId,
    organizationId: init.organizationId,
    direction: init.direction,
    fromNumber: init.fromNumber,
    toNumber: init.toNumber,
    callerKind: 'unknown_caller',
    tenantId: null,
    vendorId: null,
    propertyId: null,
    unitId: null,
    startedAt: init.startedAt,
    endedAt: null,
    intents: [],
    facts: {},
    actions: [],
    smsSent: [],
    smsDrafted: [],
    approvalsNeeded: [],
    riskFlags: [],
  };
}

/** Append preserving order, skipping values already present (ids and intents must not dupe). */
function appendUnique<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? [...list] : [...list, value];
}

/**
 * Fold one CallEvent into the session. Pure and immutable: always returns a
 * new object, never touches the input.
 *
 * @param session - Current session state (not mutated).
 * @param event - The event to apply.
 * @returns New session; the same shape, structurally fresh.
 */
export function reduceCallEvent(session: CallSession, event: CallEvent): CallSession {
  switch (event.type) {
    case 'call_started':
      // Idempotent replay of the opening payload — re-asserts identity fields.
      return {
        ...session,
        retellCallId: event.retellCallId,
        organizationId: event.organizationId,
        direction: event.direction,
        fromNumber: event.fromNumber,
        toNumber: event.toNumber,
        startedAt: event.at,
      };
    case 'caller_resolved':
      // Resolution is authoritative: absent ids mean "no link", not "keep old".
      return {
        ...session,
        callerKind: event.callerKind,
        tenantId: event.tenantId ?? null,
        vendorId: event.vendorId ?? null,
        propertyId: event.propertyId ?? null,
        unitId: event.unitId ?? null,
      };
    case 'intent_added':
      return { ...session, intents: appendUnique(session.intents, event.intent) };
    case 'fact_collected':
      return { ...session, facts: { ...session.facts, ...event.facts } };
    case 'action_taken': {
      const next: CallSession = { ...session, actions: [...session.actions, event.entry] };
      if (event.entry.outcome !== 'drafted') return next;
      // A drafted action carries the record it drafted: message → smsDrafted,
      // proposal → approvalsNeeded. Dedup'd so a paired sms_drafted /
      // approval_queued event for the same id cannot double-count.
      const messageId = event.entry.ids?.message;
      const proposalId = event.entry.ids?.proposal;
      return {
        ...next,
        smsDrafted: messageId ? appendUnique(next.smsDrafted, messageId) : [...next.smsDrafted],
        approvalsNeeded: proposalId
          ? appendUnique(next.approvalsNeeded, proposalId)
          : [...next.approvalsNeeded],
      };
    }
    case 'sms_sent':
      return { ...session, smsSent: appendUnique(session.smsSent, event.messageId) };
    case 'sms_drafted':
      return { ...session, smsDrafted: appendUnique(session.smsDrafted, event.messageId) };
    case 'approval_queued':
      return {
        ...session,
        approvalsNeeded: appendUnique(session.approvalsNeeded, event.proposalId),
      };
    case 'call_ended':
      return { ...session, endedAt: event.at };
    default: {
      const exhaustive: never = event;
      void exhaustive;
      return session;
    }
  }
}

/**
 * Derive risk flags from current session state. Recomputed, never stored
 * incrementally, so flags cannot go stale or duplicate.
 *
 * @param session - Session to inspect.
 * @returns Flags in a stable order (tests rely on it).
 */
export function riskFlagsFor(session: CallSession): string[] {
  const flags: string[] = [];
  const screen = session.facts.emergencyScreen;
  if (screen?.activeFlooding === true || screen?.electricalDanger === true) {
    flags.push('emergency_screen_positive');
  }
  if (session.facts.paymentClaim?.claimed === true) {
    // The caller claims payment the ledger may not show — owner must reconcile.
    flags.push('payment_claim_ledger_conflict');
  }
  if (session.facts.upset === true) {
    flags.push('caller_upset');
  }
  if (session.callerKind === 'unknown_caller' || session.callerKind === 'ambiguous') {
    flags.push('unknown_caller_needs_review');
  }
  if (session.actions.some((entry) => entry.tier === 4 && entry.outcome === 'blocked')) {
    flags.push('tier4_action_attempted');
  }
  return flags;
}
