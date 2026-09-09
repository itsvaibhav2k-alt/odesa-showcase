/**
 * Signed Retell webhook helper for e2e specs.
 *
 * The webhook route is signature-first (`verifyRetellWebhookAuth`): when
 * `RETELL_REQUIRE_SIGNATURE` is on — as it is in `.env.production.local` —
 * an unsigned POST is rejected 401 regardless of bearer. Production auth
 * must NOT be weakened for tests, so the specs sign exactly the way the
 * provider does (see `verifyRetellSignature` in
 * `src/lib/voice/providers/retell-adapter.ts`):
 *
 *   HMAC-SHA256(RETELL_API_KEY, rawBody + String(timestampMs))
 *   header: `x-retell-signature: v={timestampMs},d={hexDigest}`
 *
 * The raw body string that is signed MUST be byte-identical to what the
 * server receives, so callers send the returned `body` string verbatim
 * (never re-serialize).
 *
 * ENV CONTRACT: the spec process and the server must share RETELL_API_KEY.
 * Playwright loads `.env.production.local` first (see playwright.config.ts),
 * and `npm start` reads the same file — never override the key on only one
 * side; that drift is exactly the 401 this helper exists to prevent.
 */

import crypto from 'crypto';

export const RETELL_KEY = process.env.RETELL_API_KEY ?? 'retell-dev-test-key';

export interface SignedWebhookPost {
  /** Exact raw body to send — sign-then-send, never re-serialize. */
  body: string;
  headers: Record<string, string>;
}

export function signWebhookPost(
  payload: unknown,
  nowMs: number = Date.now(),
): SignedWebhookPost {
  const body = JSON.stringify(payload);
  const digest = crypto
    .createHmac('sha256', RETELL_KEY)
    .update(body + String(nowMs))
    .digest('hex');

  return {
    body,
    headers: {
      authorization: `Bearer ${RETELL_KEY}`,
      'content-type': 'application/json',
      'x-retell-signature': `v=${nowMs},d=${digest}`,
    },
  };
}
