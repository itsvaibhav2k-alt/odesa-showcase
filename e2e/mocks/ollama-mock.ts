/**
 * Ollama HTTP mock server — v1.5 Privacy Mode.
 *
 * Privacy Mode routes property-worker calls through the customer's
 * own Ollama host instead of Anthropic. The `OllamaProvider` in
 * `src/lib/agent/providers/ollama.ts` POSTs to `${OLLAMA_HOST}/api/chat`
 * with a body shaped per Ollama's chat-completion API. This module
 * stands up a local Node `http` server that:
 *
 *   - Listens on a free ephemeral port (`startOllamaMock()` returns it).
 *   - Accepts POST `/api/chat` and POST `/api/generate` (the older
 *     Ollama endpoint some clients still hit) and POST `/api/show` /
 *     GET `/api/tags` so health-check probes (the Privacy Mode UI
 *     button) get well-formed replies.
 *   - Returns scripted responses in Ollama's exact JSON shape — every
 *     field the SDK reads is populated so the worker sees a faithful
 *     stand-in.
 *   - Records every request body so specs can assert on the prompt
 *     content + sampling parameters.
 *
 * Why a real HTTP server vs an in-process stub:
 *   The OllamaProvider runs inside the Next server process, which is
 *   spawned by `playwright.config.ts` webServer. To intercept the
 *   provider we'd need either (a) a real HTTP listener it talks to,
 *   or (b) test-hooks state on the Next side (the route the agent
 *   would dispatch to). We chose (a) because it exercises the actual
 *   network code path — the same path that runs in production.
 *
 * Lifecycle:
 *   - Spec calls `startOllamaMock({ scripts })`, gets `{ port, baseUrl, ... }`.
 *   - Spec sets `OLLAMA_HOST=baseUrl` on the property's privacy_mode
 *     config (via the v1.5 fixture's `setPropertyPrivacyMode` helper).
 *   - Worker calls hit the mock; spec asserts on `getRecordedCalls()`.
 *   - Spec calls `handle.stop()` in afterEach.
 *
 * Concurrency:
 *   The server uses an ephemeral port (`port: 0`). Many concurrent
 *   tests can each stand up their own instance. State is per-instance
 *   (no globals) so parallel workers don't collide.
 */

import { createServer, type Server } from 'http';
import { AddressInfo } from 'net';

// =====================================================================
// Public types
// =====================================================================

/** One scripted Ollama chat response. FIFO queue: first match wins. */
export interface OllamaMockScript {
  /** Optional: only match when the request body's `model` contains this. */
  matchModel?: string;
  /**
   * Optional regex (JS source, case-insensitive) tested against the
   * concatenation of every `messages[].content` in the request.
   */
  matchPattern?: string;
  /** Reply shape; either a plain string (becomes `message.content`) or a full reply. */
  reply: string | OllamaMockReply;
  /** Default true; when true the script is removed after one match. */
  consumeOnce?: boolean;
}

/** Faithful stand-in for Ollama's /api/chat response shape. */
export interface OllamaMockReply {
  model: string;
  created_at?: string;
  message: {
    role: 'assistant';
    content: string;
    /** Optional tool calls (Ollama 0.4+). Worker layer reads this. */
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: Record<string, unknown>;
      };
    }>;
  };
  done: boolean;
  done_reason?: 'stop' | 'length';
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/** Recorded call shape used in spec assertions. */
export interface OllamaRecordedCall {
  /** Path the client hit (e.g. '/api/chat'). */
  path: string;
  method: string;
  /** Parsed JSON body if Content-Type was JSON; null otherwise. */
  body: Record<string, unknown> | null;
  /** ISO timestamp the request was received. */
  receivedAt: string;
}

export interface OllamaMockOptions {
  /** Pin to a specific port (default: ephemeral). */
  port?: number;
  /** Initial script queue. */
  scripts?: OllamaMockScript[];
  /**
   * Default reply when no script matches. If absent, returns a generic
   * "OK" assistant message so specs that don't care about the body
   * don't have to script anything.
   */
  defaultReply?: OllamaMockReply | string;
}

export interface OllamaMockHandle {
  port: number;
  baseUrl: string;
  /** Full URL the property's `ollama_host` column should be set to. */
  ollamaHost: string;
  setScripts: (scripts: OllamaMockScript[]) => void;
  appendScripts: (scripts: OllamaMockScript[]) => void;
  reset: () => void;
  getRecordedCalls: () => readonly OllamaRecordedCall[];
  stop: () => Promise<void>;
}

// =====================================================================
// Internal helpers
// =====================================================================

function buildDefaultReply(model: string): OllamaMockReply {
  return {
    model,
    created_at: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: 'OK',
    },
    done: true,
    done_reason: 'stop',
    total_duration: 1_000_000,
    load_duration: 100_000,
    prompt_eval_count: 50,
    prompt_eval_duration: 200_000,
    eval_count: 5,
    eval_duration: 700_000,
  };
}

function normaliseReply(
  reply: string | OllamaMockReply,
  fallbackModel: string,
): OllamaMockReply {
  if (typeof reply === 'string') {
    return {
      model: fallbackModel,
      created_at: new Date().toISOString(),
      message: { role: 'assistant', content: reply },
      done: true,
      done_reason: 'stop',
      total_duration: 1_000_000,
      load_duration: 100_000,
      prompt_eval_count: 50,
      prompt_eval_duration: 200_000,
      eval_count: 5,
      eval_duration: 700_000,
    };
  }
  return { ...reply, model: reply.model ?? fallbackModel };
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function concatPrompt(body: Record<string, unknown> | null): string {
  if (!body) return '';
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    const prompt = body.prompt;
    return typeof prompt === 'string' ? prompt : '';
  }
  return messages
    .map((m) => {
      if (m && typeof m === 'object' && 'content' in m) {
        const c = (m as { content?: unknown }).content;
        return typeof c === 'string' ? c : '';
      }
      return '';
    })
    .join('\n');
}

function selectScript(
  scripts: OllamaMockScript[],
  body: Record<string, unknown> | null,
): { script: OllamaMockScript; idx: number } | null {
  const model = body?.model;
  const modelStr = typeof model === 'string' ? model : '';
  const promptStr = concatPrompt(body);
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i]!;
    if (s.matchModel && !modelStr.includes(s.matchModel)) continue;
    if (s.matchPattern) {
      const re = new RegExp(s.matchPattern, 'i');
      if (!re.test(promptStr)) continue;
    }
    return { script: s, idx: i };
  }
  return null;
}

// =====================================================================
// Public API
// =====================================================================

/**
 * Stand up an Ollama-shaped HTTP mock and return its handle.
 *
 * @example
 * test.beforeEach(async () => {
 *   ollama = await startOllamaMock({
 *     scripts: [{ matchModel: 'llama3', reply: 'rent is due on the 1st' }],
 *   });
 *   await setPropertyPrivacyMode(propId, 'on_prem', ollama.ollamaHost);
 * });
 * test.afterEach(async () => {
 *   await ollama.stop();
 * });
 */
export async function startOllamaMock(
  opts: OllamaMockOptions = {},
): Promise<OllamaMockHandle> {
  let scripts: OllamaMockScript[] = [...(opts.scripts ?? [])];
  const recorded: OllamaRecordedCall[] = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = tryParseJson(raw);
      const path = req.url ?? '/';
      const method = req.method ?? 'GET';

      recorded.push({
        path,
        method,
        body,
        receivedAt: new Date().toISOString(),
      });

      // Health-probe endpoints (used by Privacy Mode "test connection" UI).
      if (method === 'GET' && path === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            models: [
              {
                name: 'llama3.3:70b',
                modified_at: new Date().toISOString(),
                size: 39_000_000_000,
              },
            ],
          }),
        );
        return;
      }
      if (method === 'POST' && path === '/api/show') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            modelfile: 'FROM llama3.3:70b',
            parameters: 'num_ctx 8192',
            template: '{{ .Prompt }}',
          }),
        );
        return;
      }

      // Chat / generate — return a scripted or default reply.
      if (
        method === 'POST' &&
        (path === '/api/chat' || path === '/api/generate')
      ) {
        const fallbackModel =
          (body?.model as string | undefined) ?? 'llama3.3:70b';
        const match = selectScript(scripts, body);
        let reply: OllamaMockReply;
        if (match) {
          reply = normaliseReply(match.script.reply, fallbackModel);
          if (match.script.consumeOnce !== false) {
            scripts.splice(match.idx, 1);
          }
        } else if (opts.defaultReply !== undefined) {
          reply = normaliseReply(opts.defaultReply, fallbackModel);
        } else {
          reply = buildDefaultReply(fallbackModel);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(reply));
        return;
      }

      // Anything else → 404 (mirrors a real Ollama).
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `not found: ${path}` }));
    });
    req.on('error', () => {
      try {
        res.writeHead(500);
        res.end();
      } catch {
        // socket already closed; nothing to do
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const port = addr.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    port,
    baseUrl,
    ollamaHost: baseUrl,
    setScripts(next) {
      scripts = [...next];
    },
    appendScripts(more) {
      scripts.push(...more);
    },
    reset() {
      recorded.length = 0;
      scripts = [];
    },
    getRecordedCalls() {
      return recorded as readonly OllamaRecordedCall[];
    },
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

// =====================================================================
// Convenience builders
// =====================================================================

/** Plain text reply. */
export function ollamaTextReply(
  text: string,
  model = 'llama3.3:70b',
): OllamaMockReply {
  return {
    model,
    created_at: new Date().toISOString(),
    message: { role: 'assistant', content: text },
    done: true,
    done_reason: 'stop',
  };
}

/** Tool-use reply (Ollama 0.4+ shape). */
export function ollamaToolReply(
  toolName: string,
  args: Record<string, unknown>,
  model = 'llama3.3:70b',
): OllamaMockReply {
  return {
    model,
    created_at: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: toolName, arguments: args } }],
    },
    done: true,
    done_reason: 'stop',
  };
}
