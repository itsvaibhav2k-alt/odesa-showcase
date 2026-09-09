/**
 * Linq messaging provider — Phase 9.
 *
 * Linq is implemented against the Sendblue API (sendblue.co). The
 * `LINQ_` env-var prefix and the `'linq'` ProviderChoice value are
 * unchanged so no call-sites require updates.
 *
 * Signature scheme: Sendblue posts inbound webhooks with an
 * `sb-signing-secret` header carrying the secret set in their
 * dashboard. We also accept the legacy `x-linq-signature` header for
 * one-release backward compatibility with existing tests.
 *
 * Outbound sends and typing indicators use Node's native `fetch` with
 * AbortController. `LINQ_API_URL` (optional) overrides the default
 * Sendblue base URL.
 */

import type { MessagingProvider, VerifyInboundRequest } from "./provider";
import type {
  InboundMessage,
  OutboundMessage,
  SendResult,
  VerifyResult,
} from "./types";
import { getMessagingMockState, recordMockSend } from "./test-hooks";
import { constantTimeEqual } from "./sigs";

const DEFAULT_TEST_SECRET = "linq-test-secret";
const DEFAULT_BASE_URL = "https://api.sendblue.co/api";

/** Shape Sendblue posts to `/api/messaging/inbound/linq`. */
export interface LinqWebhookBody {
  accountEmail?: string;
  content?: string;
  is_outbound?: boolean;
  message_handle?: string;
  date_sent?: string;
  /** The other party's number — for inbound, this is the sender. */
  number?: string;
  /** Explicit sender (preferred over `number` when present). */
  from_number?: string;
  /** Your Sendblue (Odesa) number. */
  to_number?: string;
  was_downgraded?: boolean;
  media_url?: string;
}

export class LinqProvider implements MessagingProvider {
  readonly name = "linq" as const;

  verifyInbound(req: VerifyInboundRequest): VerifyResult {
    const provided =
      req.headers["sb-signing-secret"] ?? req.headers["x-linq-signature"] ?? "";
    if (!provided) {
      return { ok: false, reason: "Missing signature" };
    }
    const expected =
      process.env.LINQ_WEBHOOK_SECRET ??
      (getMessagingMockState() ? DEFAULT_TEST_SECRET : null);
    if (!expected) {
      return { ok: false, reason: "Linq webhook secret not configured" };
    }
    if (!constantTimeEqual(provided, expected)) {
      return { ok: false, reason: "Signature mismatch" };
    }
    return { ok: true };
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    // Test-only short-circuit: when a mock has been installed, record
    // the send and honour the `shouldFail` toggle. Production never
    // enters this branch because the mock state is undefined.
    const mock = getMessagingMockState();
    if (mock) {
      if (mock.shouldTimeoutAfterAccept.linq) {
        recordMockSend("linq", msg);
        return {
          ok: false,
          provider: this.name,
          error: "linq mock ambiguous timeout",
          certainty: "ambiguous",
        };
      }
      if (mock.shouldFail.linq) {
        return {
          ok: false,
          provider: this.name,
          error: "linq mock forced failure",
        };
      }
      const providerMessageId = recordMockSend("linq", msg);
      return { ok: true, provider: this.name, providerMessageId };
    }

    const keyId = process.env.LINQ_API_KEY_ID;
    const secret = process.env.LINQ_API_SECRET_KEY;
    if (!keyId || !secret) {
      return {
        ok: false,
        provider: this.name,
        error: "LINQ_API_KEY_ID / LINQ_API_SECRET_KEY not set",
      };
    }

    const base = process.env.LINQ_API_URL ?? DEFAULT_BASE_URL;
    const url = `${base}/send-message`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "sb-api-key-id": keyId,
          "sb-api-secret-key": secret,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(msg.idempotencyKey
            ? { "Idempotency-Key": msg.idempotencyKey }
            : {}),
        },
        body: JSON.stringify({
          number: msg.toE164,
          content: msg.body,
          from_number: msg.fromE164,
        }),
      });

      clearTimeout(timer);

      if (res.ok) {
        const json = (await res.json()) as { message_handle?: string };
        if (!json.message_handle) {
          return {
            ok: false,
            provider: this.name,
            error: "Sendblue 200 missing message_handle",
          };
        }
        return {
          ok: true,
          provider: this.name,
          providerMessageId: json.message_handle,
        };
      }

      const text = await res.text().catch(() => "");
      const truncated = text.slice(0, 200);
      return {
        ok: false,
        provider: this.name,
        error: `Sendblue ${res.status}: ${truncated}`,
        certainty: res.status >= 500 ? "ambiguous" : "definitive",
      };
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        provider: this.name,
        error: `Sendblue fetch failed: ${message}`,
        certainty: "ambiguous",
      };
    }
  }

  async sendTypingIndicator(toE164: string): Promise<void> {
    const keyId = process.env.LINQ_API_KEY_ID;
    const secret = process.env.LINQ_API_SECRET_KEY;
    if (!keyId || !secret) return;

    const base = process.env.LINQ_API_URL ?? DEFAULT_BASE_URL;
    const url = `${base}/send-typing-indicator?number=${encodeURIComponent(toE164)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);

    try {
      await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "sb-api-key-id": keyId,
          "sb-api-secret-key": secret,
        },
        body: "",
      });
    } catch {
      // Typing indicator is decorative — swallow all errors.
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Pure normalisation helpers (invoked by handle-inbound)
// ---------------------------------------------------------------------------

/**
 * Normalise a raw Sendblue payload to the shared `InboundMessage` shape.
 * Returns null for outbound echoes or payloads missing required fields.
 */
export function normaliseLinqInbound(
  body: LinqWebhookBody,
): InboundMessage | null {
  if (body.is_outbound === true) return null;
  const fromE164 = body.from_number ?? body.number;
  const toE164 = body.to_number;
  const content = body.content;
  if (!fromE164 || !toE164 || !content) return null;
  return {
    fromE164,
    toE164,
    body: content.trim(),
    providerMessageId: body.message_handle,
    provider: "linq",
    receivedAt: body.date_sent ?? new Date().toISOString(),
    ...(body.date_sent ? { providerOccurredAt: body.date_sent } : {}),
  };
}
