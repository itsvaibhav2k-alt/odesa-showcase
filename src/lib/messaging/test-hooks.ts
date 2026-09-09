/**
 * Test hooks for messaging providers — Phase 4.
 *
 * The Playwright suite needs to assert outbound sends without touching
 * real Linq/Twilio APIs. Two choices were considered:
 *
 *   1. Module-mocking via vitest/jest — rejected: Playwright runs the
 *      real Next server in a separate process, so module mocks in the
 *      spec process wouldn't apply.
 *   2. Shared test-hook state (this module) — chosen: the mock state
 *      lives on the Next server process, and specs toggle it via an
 *      internal `/api/messaging/test-hooks` endpoint (created next to the
 *      public routes).
 *
 * Production never installs a mock state object, so the `send()` code
 * paths short-circuit only when test instrumentation is active.
 */

import type { ProviderChoice } from "./types";
import type { OutboundMessage } from "./types";

export interface RecordedSend {
  provider: ProviderChoice;
  to: string;
  from: string;
  body: string;
  providerMessageId: string;
  sentAt: string;
}

export interface MessagingMockState {
  shouldFail: Record<ProviderChoice, boolean>;
  shouldTimeoutAfterAccept: Record<ProviderChoice, boolean>;
  pauseBeforeHandoff: boolean;
  handoffPaused: boolean;
  handoffResolvers: Array<() => void>;
  recorded: RecordedSend[];
  /** Number of concurrent Playwright harnesses using the process-global mock. */
  refCount: number;
}

// Pinned to globalThis so Next's dev-mode HMR doesn't reset state
// between /api/messaging/test-hooks and /api/messaging/inbound/* hits.
const GLOBAL_KEY = "__odesaMessagingMockState__";
type GlobalWithMock = typeof globalThis & {
  [GLOBAL_KEY]?: { state: MessagingMockState | null };
};

function slot(): { state: MessagingMockState | null } {
  const g = globalThis as GlobalWithMock;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { state: null };
  return g[GLOBAL_KEY]!;
}

function getState(): MessagingMockState | null {
  return slot().state;
}

function setState(next: MessagingMockState | null): void {
  slot().state = next;
}

export function installMessagingMock(): MessagingMockState {
  const current = getState();
  if (current) {
    current.refCount += 1;
    // Each harness starts from a non-failing provider state; recorded sends
    // are intentionally retained so parallel harnesses can slice from their
    // own install offset instead of racing on process-global resets.
    current.shouldFail = { linq: false, twilio: false, retell: false };
    current.shouldTimeoutAfterAccept = {
      linq: false,
      twilio: false,
      retell: false,
    };
    current.pauseBeforeHandoff = false;
    current.handoffPaused = false;
    current.handoffResolvers.splice(0).forEach((resolve) => resolve());
    return current;
  }

  const fresh: MessagingMockState = {
    shouldFail: { linq: false, twilio: false, retell: false },
    shouldTimeoutAfterAccept: { linq: false, twilio: false, retell: false },
    pauseBeforeHandoff: false,
    handoffPaused: false,
    handoffResolvers: [],
    recorded: [],
    refCount: 1,
  };
  setState(fresh);
  return fresh;
}

export function uninstallMessagingMock(): void {
  const current = getState();
  if (!current) return;
  current.refCount -= 1;
  if (current.refCount <= 0) {
    setState(null);
  }
}

export function getMessagingMockState(): MessagingMockState | null {
  return getState();
}

export function setShouldFail(provider: ProviderChoice, value: boolean): void {
  let current = getState();
  if (!current) current = installMessagingMock();
  current.shouldFail[provider] = value;
}

export function setShouldTimeoutAfterAccept(
  provider: ProviderChoice,
  value: boolean,
): void {
  let current = getState();
  if (!current) current = installMessagingMock();
  current.shouldTimeoutAfterAccept[provider] = value;
}

export function resetRecorded(): void {
  const current = getState();
  if (current) current.recorded = [];
}

export function setPauseBeforeHandoff(value: boolean): void {
  let current = getState();
  if (!current) current = installMessagingMock();
  current.pauseBeforeHandoff = value;
  if (!value) {
    current.handoffPaused = false;
    current.handoffResolvers.splice(0).forEach((resolve) => resolve());
  }
}

export async function waitAtTestHandoff(): Promise<void> {
  const current = getState();
  if (!current?.pauseBeforeHandoff) return;
  current.handoffPaused = true;
  await new Promise<void>((resolve) => current.handoffResolvers.push(resolve));
}

export function getRecorded(): readonly RecordedSend[] {
  return getState()?.recorded ?? [];
}

/**
 * Called from `LinqProvider.send()` / `TwilioProvider.send()` to record
 * a successful mock send. Generates a deterministic-ish synthetic
 * provider-message-id so specs can assert non-empty identifiers.
 */
export function recordMockSend(
  provider: ProviderChoice,
  msg: OutboundMessage,
): string {
  let current = getState();
  if (!current) current = installMessagingMock();
  const counter = current.recorded.length + 1;
  const providerMessageId = `${provider}-mock-${Date.now()}-${counter}`;
  current.recorded.push({
    provider,
    to: msg.toE164,
    from: msg.fromE164,
    body: msg.body,
    providerMessageId,
    sentAt: new Date().toISOString(),
  });
  return providerMessageId;
}
