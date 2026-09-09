/**
 * Claude API mock harness — Phase 4.
 *
 * The Claude mock actually lives in
 * `src/lib/messaging/claude-draft.ts` (module-scoped state on the Next
 * process). Specs install scripts + read the recorded requests via the
 * `/api/messaging/test-hooks` endpoint — the harness in
 * `./messaging-mock.ts` already exposes `setClaudeScripts` so this
 * module just re-exports the relevant shapes.
 */

import type { APIRequestContext } from '@playwright/test';

import { TEST_HOOKS_HEADERS } from '../fixtures/manifest';

export interface ClaudeMockScript {
  /** JS regex source matched (case-insensitive) against the inbound body. */
  matchPattern: string;
  /** Text the mock returns when the pattern matches. */
  reply: string;
}

export interface ClaudeRecordedRequest {
  systemPrompt: string;
  history: Array<{ role: 'tenant' | 'assistant'; body: string }>;
  latestInbound: string;
}

/** Fetch the ordered list of draft-generation requests recorded so far. */
export async function getClaudeRecorded(
  request: APIRequestContext,
): Promise<readonly ClaudeRecordedRequest[]> {
  const resp = await request.get('/api/messaging/test-hooks', {
    headers: TEST_HOOKS_HEADERS,
  });
  const json = (await resp.json()) as {
    success: boolean;
    data?: { claudeRecorded: ClaudeRecordedRequest[] };
  };
  return json.data?.claudeRecorded ?? [];
}
