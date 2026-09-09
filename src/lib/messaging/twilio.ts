/**
 * Twilio messaging provider — Phase 4.
 *
 * Signature scheme (per Twilio spec):
 *   expected = base64( HMAC-SHA1( authToken, url + sortedParams ) )
 *   where `sortedParams` = params sorted by key, each concatenated as
 *   `${key}${value}` with no separator. Twilio's webhook signer uses
 *   the form-url-encoded body (application/x-www-form-urlencoded),
 *   which we parse out of the raw body.
 *
 * Live credentials are read from `TWILIO_AUTH_TOKEN`. When absent the
 * verifier fails closed, except while the explicit messaging test harness
 * is installed; that state may use `DEFAULT_TEST_TOKEN` deterministically.
 *
 * Outbound sends go through the shared test-hook channel (see
 * `./test-hooks.ts`). In production the `.send()` path returns an
 * error until Phase 9 wires the live REST client — which is fine: the
 * failover path is what we actually exercise in this phase.
 */

import { createHmac } from "crypto";

import type { MessagingProvider, VerifyInboundRequest } from "./provider";
import type {
  InboundMessage,
  OutboundMessage,
  SendResult,
  VerifyResult,
} from "./types";
import { getMessagingMockState, recordMockSend } from "./test-hooks";
import { constantTimeEqual } from "./sigs";

const DEFAULT_TEST_TOKEN = "twilio-test-token";

/** Shape the Twilio webhook posts (form-encoded). */
export interface TwilioWebhookBody {
  MessageSid?: string;
  From?: string;
  To?: string;
  Body?: string;
  AccountSid?: string;
}

export class TwilioProvider implements MessagingProvider {
  readonly name = "twilio" as const;

  verifyInbound(req: VerifyInboundRequest): VerifyResult {
    const provided = req.headers["x-twilio-signature"] ?? "";
    if (!provided) {
      return { ok: false, reason: "Missing X-Twilio-Signature header" };
    }
    const token =
      process.env.TWILIO_AUTH_TOKEN ??
      (getMessagingMockState() ? DEFAULT_TEST_TOKEN : null);
    if (!token) {
      return { ok: false, reason: "Twilio webhook secret not configured" };
    }
    const params = parseFormUrlEncoded(req.rawBody);
    const expected = computeTwilioSignature(token, req.url, params);
    if (!constantTimeEqual(provided, expected)) {
      return { ok: false, reason: "Signature mismatch" };
    }
    return { ok: true };
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const mock = getMessagingMockState();
    if (mock) {
      if (mock.shouldTimeoutAfterAccept.twilio) {
        recordMockSend("twilio", msg);
        return {
          ok: false,
          provider: this.name,
          error: "twilio mock ambiguous timeout",
          certainty: "ambiguous",
        };
      }
      if (mock.shouldFail.twilio) {
        return {
          ok: false,
          provider: this.name,
          error: "twilio mock forced failure",
        };
      }
      const providerMessageId = recordMockSend("twilio", msg);
      return { ok: true, provider: this.name, providerMessageId };
    }

    return {
      ok: false,
      provider: this.name,
      error: "Twilio live API not configured",
    };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Compute the base64 HMAC-SHA1 signature Twilio expects.
 *
 * Steps:
 *   1. Start with the full URL including query string (no trailing slash
 *      manipulation).
 *   2. Sort the form params by key.
 *   3. Append `${key}${value}` for each sorted entry.
 *   4. HMAC-SHA1 the resulting string with the account auth token.
 *   5. Base64-encode the binary digest.
 */
export function computeTwilioSignature(
  token: string,
  url: string,
  params: Record<string, string>,
): string {
  const sortedKeys = Object.keys(params).sort();
  const joined = sortedKeys.reduce(
    (acc, key) => acc + key + (params[key] ?? ""),
    url,
  );
  return createHmac("sha1", token).update(joined, "utf8").digest("base64");
}

/**
 * Parse an `application/x-www-form-urlencoded` raw body into a flat
 * record. Duplicate keys keep the last value — Twilio never repeats
 * a key in the documented contract.
 */
export function parseFormUrlEncoded(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  const params = new URLSearchParams(raw);
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * Normalise a raw Twilio payload to the shared `InboundMessage` shape.
 * Returns null if the payload is missing required fields.
 */
export function normaliseTwilioInbound(
  body: TwilioWebhookBody,
): InboundMessage | null {
  if (!body.From || !body.To || !body.Body) return null;
  return {
    fromE164: body.From,
    toE164: body.To,
    body: body.Body.trim(),
    providerMessageId: body.MessageSid,
    provider: "twilio",
    receivedAt: new Date().toISOString(),
  };
}
