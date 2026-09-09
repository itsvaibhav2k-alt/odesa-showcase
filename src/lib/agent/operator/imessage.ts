/**
 * iMessage helpers for the operator dispatcher.
 *
 * Ported from Boop's `server/sendblue.ts`. iMessage clients render
 * neither markdown nor messages above ~3000 chars cleanly, so every
 * outbound reply runs through `stripMarkdown` + `chunk` before being
 * handed to the org's primary `MessagingProvider`.
 *
 * The typing-indicator loop fires immediately and then every 5s while
 * the dispatcher is thinking. It routes through the provider abstraction
 * so test-hooks can intercept without monkey-patching `fetch`.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getPrimaryProvider } from "@/lib/messaging/provider";
import { createHash } from "node:crypto";
import { sendWithFailover } from "@/lib/messaging/send-with-failover";

const MAX_CHUNK = 2900;
const DEFAULT_TYPING_INTERVAL_MS = 5000;

/**
 * Strip Markdown so iMessage renders plain text. Order matters:
 * fenced code blocks are normalised first so the inner ``` markers
 * don't survive into the inline-code pass.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?|```/g, ""))
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)")
    .trim();
}

/**
 * Chunk a long message at line boundaries when possible, falling back
 * to a hard slice when a single line exceeds `size`. Sendblue / Linq
 * reject single iMessages above ~3000 chars.
 */
export function chunk(text: string, size = MAX_CHUNK): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let buf = "";
  for (const line of text.split(/\n/)) {
    if (line.length > size) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      for (let i = 0; i < line.length; i += size) {
        const slice = line.slice(i, i + size);
        if (i + size >= line.length) {
          buf = slice;
        } else {
          out.push(slice);
        }
      }
      continue;
    }
    if ((buf + "\n" + line).length > size) {
      if (buf) out.push(buf);
      buf = line;
    } else {
      buf = buf ? buf + "\n" + line : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

const DEFAULT_ASSISTANT_NAME = "Odesa";

/**
 * Send a (possibly long, possibly markdown-flavoured) reply to a
 * tenant via iMessage. Strips markdown, appends a per-org sign-off
 * (`— ${assistantName}`), chunks at 2900 chars, then sends each part
 * through the org's primary `MessagingProvider`.
 *
 * The sign-off is appended once to the full plain-text body before
 * chunking so a multi-chunk reply only signs off on the last segment.
 *
 * One failed chunk is logged and skipped — partial delivery is better
 * than dropping the whole reply.
 */
export async function sendImessageReply(args: {
  organizationId: string;
  toE164: string;
  text: string;
  idempotencyKey: string;
}): Promise<void> {
  const { organizationId, toE164, text, idempotencyKey } = args;
  const plain = stripMarkdown(text);
  if (!plain) return;

  const orgRow = await loadOrgImessageRow(organizationId);
  if (!orgRow?.fromE164) {
    console.error(
      `[imessage] org ${organizationId} has no odesa_phone_number — dropping reply`,
    );
    return;
  }

  // The operator is texting their OWN AI dispatcher; signing every reply
  // "— Odesa" reads bot-y and there's no ambiguity about who the sender is.
  // Keep the chunked plain text as-is. (The appendSignOff helper is still
  // exported for potential tenant-facing reuse, where the recipient may not
  // know the sender — but the operator hot path skips it.)
  const parts = chunk(plain);
  const logicalKey = createHash("sha256")
    .update(`${organizationId}\0${toE164}\0${plain}`)
    .digest("hex");
  for (const [index, part] of parts.entries()) {
    const result = await sendWithFailover(organizationId, {
      toE164,
      fromE164: orgRow.fromE164,
      body: part,
      idempotencyKey: `${idempotencyKey}:${logicalKey}:${index}`,
    });
    if (!result.ok) {
      console.error(
        `[imessage] safe dispatch failed for ${toE164}: ${result.status ?? "failed"}`,
      );
    }
  }
}

/**
 * Append a "— ${assistantName}" sign-off to a stripped reply if it isn't
 * already present (idempotent against accidental double-sign by the
 * model itself). Returns the original text unchanged when it already
 * ends with the sign-off marker.
 *
 * Exported for testing; the production hot path goes through
 * `sendImessageReply`.
 */
export function appendSignOff(plain: string, assistantName: string): string {
  const name = assistantName.trim() || DEFAULT_ASSISTANT_NAME;
  const trimmed = plain.trimEnd();
  // Idempotent — don't double-sign if the model already added it.
  const dashSig = `— ${name}`;
  const hyphenSig = `- ${name}`;
  if (trimmed.endsWith(dashSig) || trimmed.endsWith(hyphenSig)) {
    return trimmed;
  }
  return `${trimmed}\n\n${dashSig}`;
}

/**
 * Fire a typing-indicator immediately, then every `intervalMs` until
 * the returned stop function is called. If the org's primary provider
 * does not implement `sendTypingIndicator`, returns a no-op stop fn so
 * callers can still wrap their work in `try/finally { stopTyping() }`.
 */
export function startTypingLoop(args: {
  organizationId: string;
  toE164: string;
  intervalMs?: number;
}): () => void {
  const {
    organizationId,
    toE164,
    intervalMs = DEFAULT_TYPING_INTERVAL_MS,
  } = args;

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const provider = await getPrimaryProvider(organizationId);
      if (!provider.sendTypingIndicator) {
        if (timer) clearInterval(timer);
        timer = null;
        return;
      }
      await provider.sendTypingIndicator(toE164);
    } catch {
      /* non-fatal — typing-indicator is decorative */
    }
  };

  void tick();
  timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}

interface OrgImessageRow {
  fromE164: string | null;
  assistantName: string;
}

async function loadOrgImessageRow(
  organizationId: string,
): Promise<OrgImessageRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select("odesa_phone_number, assistant_name")
    .eq("id", organizationId)
    .single();
  if (error || !data) return null;
  return {
    fromE164: data.odesa_phone_number ?? null,
    assistantName:
      data.assistant_name && data.assistant_name.trim().length > 0
        ? data.assistant_name
        : DEFAULT_ASSISTANT_NAME,
  };
}
