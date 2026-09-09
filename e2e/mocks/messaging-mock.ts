/**
 * Messaging mock harness — Phase 4.
 *
 * Wraps the in-process test hook exposed at `/api/messaging/test-hooks` so
 * specs can: install the mock, toggle per-provider failure, read the
 * list of recorded outbound sends, and reset between test cases.
 *
 * The actual mock lives on the Next server (see
 * `src/lib/messaging/test-hooks.ts`). This file is a thin HTTP client
 * so spec code stays expressive.
 */

import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { APIRequestContext } from "@playwright/test";

import { TEST_HOOKS_HEADERS } from "../fixtures/manifest";

export type MessagingProvider = "linq" | "twilio";

export interface RecordedMessage {
  provider: MessagingProvider;
  to: string;
  from: string;
  body: string;
  sentAt: string;
  providerMessageId: string;
}

export interface MessagingMockHarness {
  /** Install the mock and (optionally) set initial shouldFail flags. */
  install: (init?: {
    shouldFail?: Partial<Record<MessagingProvider, boolean>>;
    claudeScripts?: Array<{ matchPattern: string; reply: string }>;
  }) => Promise<void>;
  /** Remove the mock (call from test.afterEach). */
  uninstall: () => Promise<void>;
  /** Reset the recorded-sends list without uninstalling. */
  reset: () => Promise<void>;
  /** Toggle `shouldFail` for a provider. */
  shouldFail: (provider: MessagingProvider, value: boolean) => Promise<void>;
  ambiguousTimeout: (
    provider: MessagingProvider,
    value: boolean,
  ) => Promise<void>;
  pauseBeforeHandoff: (value: boolean) => Promise<void>;
  isHandoffPaused: () => Promise<boolean>;
  /** Read the current list of recorded outbound sends. */
  getRecorded: () => Promise<readonly RecordedMessage[]>;
  /** Replace the Claude mock scripts mid-test. */
  setClaudeScripts: (
    scripts: Array<{ matchPattern: string; reply: string }>,
  ) => Promise<void>;
}

const LOCK_DIR = join(tmpdir(), "odesa-messaging-mock.lock");
const LOCK_STALE_MS = 120_000;
const LOCK_TIMEOUT_MS = 120_000;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `/api/messaging/test-hooks` is process-global inside the Next dev server.
 * Playwright may run spec files in parallel, so serialize harness users across
 * worker processes to avoid one test uninstalling/resetting the mock while
 * another is approving a draft.
 */
async function acquireMessagingMockLock(): Promise<() => Promise<void>> {
  const started = Date.now();

  for (;;) {
    try {
      await mkdir(LOCK_DIR);
      return async () => {
        await rm(LOCK_DIR, { recursive: true, force: true });
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;

      const ageMs = await stat(LOCK_DIR)
        .then((s) => Date.now() - s.mtimeMs)
        .catch(() => 0);
      if (ageMs > LOCK_STALE_MS) {
        await rm(LOCK_DIR, { recursive: true, force: true });
        continue;
      }

      if (Date.now() - started > LOCK_TIMEOUT_MS) {
        throw new Error("Timed out waiting for messaging mock lock");
      }
      await sleep(100);
    }
  }
}

/**
 * Returns a harness bound to the given APIRequestContext. Every method
 * posts to `/api/messaging/test-hooks`.
 */
/**
 * The FS lock is a single machine-wide resource, and specs frequently use
 * DISTINCT harness instances for install (beforeEach) and uninstall
 * (afterEach). If the release handle lived on the instance, the acquiring
 * instance would go out of scope and the lock would leak — hanging every
 * later install() until the 120s stale timeout and blowing per-test budgets.
 * Holding it at module scope (per Playwright worker process) ties release to
 * uninstall regardless of which harness instance calls it.
 */
let activeMockLockRelease: (() => Promise<void>) | null = null;

export function createMessagingMockHarness(
  request: APIRequestContext,
): MessagingMockHarness {
  const url = "/api/messaging/test-hooks";

  return {
    async install(init) {
      if (!activeMockLockRelease) {
        activeMockLockRelease = await acquireMessagingMockLock();
      }
      try {
        await request.post(url, {
          headers: TEST_HOOKS_HEADERS,
          data: { action: "install", scripts: init?.claudeScripts ?? [] },
        });
        if (init?.shouldFail?.linq) {
          await request.post(url, {
            headers: TEST_HOOKS_HEADERS,
            data: {
              action: "set_should_fail",
              provider: "linq",
              value: true,
            },
          });
        }
        if (init?.shouldFail?.twilio) {
          await request.post(url, {
            headers: TEST_HOOKS_HEADERS,
            data: {
              action: "set_should_fail",
              provider: "twilio",
              value: true,
            },
          });
        }
      } catch (err) {
        await activeMockLockRelease?.();
        activeMockLockRelease = null;
        throw err;
      }
    },
    async uninstall() {
      try {
        await request.post(url, {
          headers: TEST_HOOKS_HEADERS,
          data: { action: "uninstall" },
        });
      } finally {
        await activeMockLockRelease?.();
        activeMockLockRelease = null;
      }
    },
    async reset() {
      await request.post(url, {
        headers: TEST_HOOKS_HEADERS,
        data: { action: "reset" },
      });
    },
    async shouldFail(provider, value) {
      await request.post(url, {
        headers: TEST_HOOKS_HEADERS,
        data: { action: "set_should_fail", provider, value },
      });
    },
    async ambiguousTimeout(provider, value) {
      await request.post(url, {
        headers: TEST_HOOKS_HEADERS,
        data: { action: "set_ambiguous_timeout", provider, value },
      });
    },
    async pauseBeforeHandoff(value) {
      await request.post(url, {
        headers: TEST_HOOKS_HEADERS,
        data: { action: "set_handoff_pause", value },
      });
    },
    async isHandoffPaused() {
      const resp = await request.get(url, { headers: TEST_HOOKS_HEADERS });
      const json = (await resp.json()) as {
        data?: { handoffPaused?: boolean };
      };
      return json.data?.handoffPaused ?? false;
    },
    async getRecorded() {
      const resp = await request.get(url, { headers: TEST_HOOKS_HEADERS });
      const json = (await resp.json()) as {
        success: boolean;
        data?: { recorded: RecordedMessage[] };
      };
      return json.data?.recorded ?? [];
    },
    async setClaudeScripts(scripts) {
      await request.post(url, {
        headers: TEST_HOOKS_HEADERS,
        data: { action: "set_claude_scripts", scripts },
      });
    },
  };
}
