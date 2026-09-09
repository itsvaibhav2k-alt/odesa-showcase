/**
 * Operator dispatcher — the shared core for all three transports.
 *
 * `runOperatorDispatcher` is an async generator that drives one Claude
 * Agent SDK `query()` loop with five in-process MCP servers wired up:
 * ack, context, spawn, proposals, memory. It yields a stream of
 * `DispatcherEvent`s the caller (web SSE handler, iMessage inbound
 * handler, or Poke MCP wrapper) consumes differently:
 *
 *   - Web SSE  : forward each event to the browser as a `data:` frame.
 *   - iMessage : ignore most events; flush the accumulated `say` body
 *                via `sendImessageReply` after the terminal `done`.
 *                Acks are already routed via the MCP's `sendInline` hook
 *                so we don't double-send them here.
 *   - Poke MCP : collect `say.delta` text and append a one-line summary
 *                per `proposal.committed` / `proposal.review_required`,
 *                returning the joined string from the MCP tool call.
 *
 * Architecture choices worth keeping in mind:
 *
 * - The dispatcher emits events both from inside MCP tool handlers
 *   (synchronously, while the SDK is awaiting the handler) AND from
 *   the SDK message loop (between yields). To interleave both cleanly
 *   the events go through a pull-based async queue (see `EventQueue`).
 *
 * - Persistence is PRODUCER-owned (audit-first): the pump persists
 *   tool_use / tool_result rows before enqueueing their events, `emit`
 *   persists ack rows as the MCP handler fires, and the generator's
 *   finally persists the final assistant_text — so the audit log is
 *   complete even when the consumer (e.g. an SSE client) disconnects
 *   mid-run and never drains the rest of the generator.
 *
 * - History is rendered into the user-prompt prologue rather than as
 *   prior `MessageParam`s. This matches Boop's pattern in
 *   server/interaction-agent.ts:217-233 and keeps the SDK prompt-cache
 *   key stable across turns.
 *
 * - PropertyContext is loaded once at the top of the turn and passed
 *   to the context + spawn MCPs as a `contextCache`. spawn MCP requires
 *   it; context MCP uses it as a perf hint.
 *
 * - permissionMode is `bypassPermissions` and the SDK's built-in
 *   filesystem / web tools are explicitly disallowed. The dispatcher
 *   MUST stay inside its in-process MCPs — this is the v1.5 privacy
 *   invariant carried forward (no UUIDs in model output, no exfil).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  query,
  type Options,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import * as Sentry from '@sentry/nextjs';

import type { Database, UserRole } from '@/types/database';
import type { CommitActor } from '@/lib/authz/policy';

import type { DispatcherChannel, DispatcherEvent } from './types';
import { appendTurn, bumpChatLastMessageAt, loadHistory } from './persist';
import { createAckMcp } from './mcps/ack';
import { createCalendarMcp } from './mcps/calendar';
import { createContextMcp } from './mcps/context';
import { createMemoryMcp } from './mcps/memory';
import { createProposalsMcp } from './mcps/proposals';
import { createSchedulingMcp } from './mcps/scheduling';
import { createSpawnMcp } from './mcps/spawn';
import {
  loadOrganizationContext,
  type OrganizationContext,
} from './org-context';
import type { PropertyContext } from '@/lib/agent/worker/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 20;
// MAX_TURNS bumped from 7 to 9 in v1.9 — Sonnet 4.6 uses more turns than
// Haiku because it actually checks things (recall_facts → ack → spawn →
// maybe re-check → final reply). 7 was hitting the cap on multi-step
// asks like "draft warm reminders to all my late tenants".
const MAX_TURNS = 9;
const DEFAULT_MODEL = 'claude-sonnet-4-5';

// MCP server keys — keep in sync with `allowedTools` below. The string
// after `mcp__` must match the `name` passed to `createSdkMcpServer`
// inside each factory (e.g. `odesa-operator-ack`).
const MCP_KEYS = {
  ack: 'odesa-operator-ack',
  context: 'odesa-operator-context',
  spawn: 'odesa-operator-spawn',
  proposals: 'odesa-operator-proposals',
  memory: 'odesa-operator-memory',
  scheduling: 'odesa-operator-scheduling',
  calendar: 'odesa-operator-calendar',
} as const;

const ALLOWED_TOOLS: string[] = [
  `mcp__${MCP_KEYS.ack}__send_ack`,
  `mcp__${MCP_KEYS.context}__get_property`,
  `mcp__${MCP_KEYS.context}__list_tenants`,
  `mcp__${MCP_KEYS.context}__list_vendors`,
  `mcp__${MCP_KEYS.context}__recent_activity`,
  `mcp__${MCP_KEYS.spawn}__spawn_property_worker`,
  `mcp__${MCP_KEYS.proposals}__list_proposals`,
  `mcp__${MCP_KEYS.memory}__recall_facts`,
  `mcp__${MCP_KEYS.memory}__record_fact`,
  `mcp__${MCP_KEYS.scheduling}__schedule_action`,
  `mcp__${MCP_KEYS.scheduling}__list_scheduled`,
  `mcp__${MCP_KEYS.scheduling}__cancel_scheduled`,
  `mcp__${MCP_KEYS.calendar}__list_calendar_events`,
];

// Boop's belt-and-suspenders block (server/interaction-agent.ts:277-288).
// `bypassPermissions` would otherwise let the SDK execute its built-ins.
const DISALLOWED_TOOLS: string[] = [
  'WebSearch',
  'WebFetch',
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Agent',
  'Skill',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type AdminClient = SupabaseClient<Database>;

export interface RunOperatorDispatcherArgs {
  admin: AdminClient;
  organizationId: string;
  userId: string;
  /** Pre-resolved by the caller via `loadOrCreateChat`. */
  chatId: string;
  /**
   * Optional hint about which property the current conversation is about.
   * Sourced from:
   *   - Web `/properties/[id]/chat`: always set from the URL.
   *   - Poke `ask_property`: set from the tool's `propertyId` input.
   *   - iMessage: set from `chat.property_id` if previously stamped; omitted
   *     for new chats with no prior property context.
   *
   * This is a PROMPT PROLOGUE, not a hard constraint. The dispatcher can
   * still answer cross-property questions or switch properties mid-conversation.
   */
  propertyHint?: { id: string; name: string };
  message: string;
  channel: DispatcherChannel;
  /**
   * Inline-send hook for the ack MCP. Only meaningful for `imessage`;
   * web/mcp ignore it. Wire this to `sendImessageReply` at the route
   * layer.
   */
  sendInline?: (text: string) => Promise<void>;
  signal?: AbortSignal;
  /**
   * Optional caller-minted turn id. The durable-run path (Phase B) mints
   * the turn id at enqueue time and stamps it on the `agent_runs` row so
   * the client can dedupe its optimistic bubbles against realtime rows.
   * When omitted the dispatcher mints its own (legacy inline transports).
   */
  turnId?: string;
  /**
   * Durable enqueue already persisted the user row before worker handoff, and
   * its fenced executor owns the one canonical final assistant projection.
   */
  userTurnPersisted?: boolean;
}

/**
 * Drive one operator turn. Yields events as they happen; ends on a
 * single `done` event (or on a `tool.error` followed by `done` if the
 * loop crashed). Never throws — all errors surface as events so the
 * transport can render a graceful fallback to the operator.
 */
export async function* runOperatorDispatcher(
  args: RunOperatorDispatcherArgs,
): AsyncGenerator<DispatcherEvent> {
  const turnId = args.turnId ?? randomTurnId();
  const queue = new EventQueue();
  const emit = (ev: DispatcherEvent): void => {
    // Producer-owned audit: ack events fire from inside MCP handlers
    // while the SDK awaits them — persist immediately so the row exists
    // even if no consumer ever drains the queue. Fire-and-forget because
    // emit must stay synchronous; persistEvent self-catches and logs.
    void persistEvent(args, ev, turnId);
    queue.push(ev);
  };

  // Persist the user-side row up front so the audit log records the
  // inbound even if the SDK loop crashes before producing anything.
  // We don't emit a corresponding event — the caller already showed
  // the operator their own message.
  if (!args.userTurnPersisted) {
    try {
      await appendTurn(args.admin, {
        chatId: args.chatId,
        organizationId: args.organizationId,
        turnId,
        role: 'user',
        body: args.message,
      });
    } catch (err) {
      yield { type: 'tool.error', name: 'persist', message: errMessage(err) };
      yield { type: 'done', turnId };
      return;
    }
  }

  // OrganizationContext load. Failure here is non-recoverable for this
  // turn — all MCPs need the org property list for name resolution.
  let orgContext: OrganizationContext;
  try {
    orgContext = await loadOrganizationContext(args.admin, args.organizationId);
  } catch (err) {
    yield {
      type: 'tool.error',
      name: 'context-load',
      message: errMessage(err),
    };
    yield { type: 'done', turnId };
    return;
  }

  // History rendered into the user-prompt prologue. Filter to
  // turn-bearing roles so the model doesn't see a stream of empty
  // tool_use lines from the audit log.
  const historyTurns = await loadHistoryQuiet(args.admin, args.chatId);
  const historyBlock = renderHistory(historyTurns, turnId);

  // PropertyContext cache shared across context + spawn MCPs for this run,
  // so multiple tool calls touching the same property don't reload from DB.
  const propertyContextCache = new Map<string, Promise<PropertyContext>>();
  const commitActor = await resolveCommitActor(
    args.admin,
    args.userId,
    args.organizationId,
  );
  const userRole: UserRole | null =
    commitActor.role === 'owner' ||
    commitActor.role === 'manager' ||
    commitActor.role === 'va'
      ? commitActor.role
      : null;

  // Build the 5 in-process MCPs. All factories now receive
  // { admin, organizationId, orgContext } — propertyId is gone.
  // MCPs resolve propertyName → propertyId lazily per tool call.
  const mcpServers: Options['mcpServers'] = {
    [MCP_KEYS.ack]: createAckMcp({
      channel: args.channel,
      sendInline: args.sendInline,
      emit,
    }),
    [MCP_KEYS.context]: createContextMcp({
      admin: args.admin,
      organizationId: args.organizationId,
      orgContext,
      propertyContextCache,
    }),
    [MCP_KEYS.spawn]: createSpawnMcp({
      admin: args.admin,
      organizationId: args.organizationId,
      orgContext,
      propertyContextCache,
      emit,
      commitActor,
    }),
    [MCP_KEYS.proposals]: createProposalsMcp({
      admin: args.admin,
      organizationId: args.organizationId,
      userId: args.userId,
      orgContext,
      commitActor,
      decisionAuthority: 'inspection_only',
    }),
    [MCP_KEYS.memory]: createMemoryMcp({
      admin: args.admin,
      organizationId: args.organizationId,
      orgContext,
      commitActor,
    }),
    [MCP_KEYS.scheduling]: createSchedulingMcp({
      admin: args.admin,
      organizationId: args.organizationId,
      userId: args.userId,
      orgContext,
      propertyContextCache,
      commitActor,
    }),
    [MCP_KEYS.calendar]: createCalendarMcp({
      admin: args.admin,
      organizationId: args.organizationId,
    }),
  };

  const systemPrompt = buildSystemPrompt({
    channel: args.channel,
    orgContext,
    propertyHint: args.propertyHint,
    userRole,
  });

  // User-prompt prologue: optional propertyHint context line + history block.
  const prologueParts: string[] = [];
  if (args.propertyHint) {
    prologueParts.push(
      `[The current conversation is about: ${args.propertyHint.name}. The operator may switch — listen to the new message.]`,
    );
  }
  if (historyBlock) {
    prologueParts.push(`PRIOR TURNS:\n${historyBlock}`);
  }
  prologueParts.push(`CURRENT MESSAGE:\n${args.message}`);

  const prompt = prologueParts.join('\n\n');

  // The pump: spin the SDK in a background promise, translating each
  // SDK message into DispatcherEvents and persisting audit-worthy ones
  // BEFORE enqueueing — producer-owned persistence. Audit rows exist
  // the moment a tool ran, regardless of whether anyone drains the
  // generator (the SSE consumer may have disconnected mid-run).
  // say.delta events are NOT persisted individually; they accumulate
  // into the reply buffer here and persist as one assistant_text row
  // at the end of the turn.
  let replyBuffer = '';
  let sawTerminalResult = false;
  let emittedFailure = false;

  const pump = (async (): Promise<void> => {
    try {
      await Sentry.startSpan(
        {
          name: 'operator.dispatch',
          op: 'ai.run',
          attributes: {
            'operator.channel': args.channel,
            'operator.organization_id': args.organizationId,
          },
        },
        async () => {
          const stream = query({
            prompt,
            options: {
              systemPrompt,
              model: process.env.OPERATOR_DISPATCHER_MODEL ?? DEFAULT_MODEL,
              mcpServers,
              allowedTools: ALLOWED_TOOLS,
              disallowedTools: DISALLOWED_TOOLS,
              permissionMode: 'bypassPermissions',
              maxTurns: MAX_TURNS,
              // Railway/Nix-built Node lacks process.report glibc info, so
              // the SDK's libc sniff guesses musl and misses the glibc
              // binary npm actually installed. Worker env pins the path.
              ...(process.env.CLAUDE_CODE_EXECUTABLE
                ? {
                    pathToClaudeCodeExecutable:
                      process.env.CLAUDE_CODE_EXECUTABLE,
                  }
                : {}),
              // Subprocess failures are invisible without this — exit-code-1
              // diagnoses on the worker depend on it landing in host logs.
              stderr: (data: string) => {
                console.error('[claude-code-stderr]', data.slice(0, 2000));
              },
              ...(args.signal
                ? { abortController: signalAbortController(args.signal) }
                : {}),
            },
          });
          for await (const sdkMsg of stream) {
            if (sdkMsg.type === 'result') sawTerminalResult = true;
            for (const out of translateSdkMessage(sdkMsg)) {
              if (out.kind !== 'event') continue;
              const event = out.event;
              if (event.type === 'tool.error') emittedFailure = true;
              if (event.type === 'say.delta') {
                replyBuffer += event.text;
              } else {
                // Awaited so the audit row is committed before the
                // event is observable. ~10-40ms per tool boundary vs
                // 1-30s tool calls — noise.
                await persistEvent(args, event, turnId);
              }
              queue.push(event);
            }
          }
          if (!sawTerminalResult && !emittedFailure) {
            emittedFailure = true;
            queue.push({
              type: 'tool.error',
              name: 'provider',
              message: 'Provider stream ended without a terminal result',
            });
          }
        },
      );
    } catch (err) {
      emittedFailure = true;
      queue.push({
        type: 'tool.error',
        name: 'dispatcher',
        message: errMessage(err),
      });
    } finally {
      queue.close();
    }
  })();

  // Final-reply persistence is shared between the normal completion
  // path and the generator's finally (which runs when an abandoned
  // consumer returns the generator early). The guard makes it
  // exactly-once. Returns a tool.error event on appendTurn failure so
  // the normal path can surface it; the finally path has no consumer
  // left to surface it to and drops it. Both writes are best-effort:
  // failures only affect the audit log, not the operator-visible reply.
  let finalTextPersisted = false;
  const persistFinalText = async (): Promise<DispatcherEvent | null> => {
    if (finalTextPersisted) return null;
    finalTextPersisted = true;
    let errorEvent: DispatcherEvent | null = null;
    const finishedAt = new Date().toISOString();
    // Durable runs project their final reply only after the executor wins the
    // terminal status fence. If a provider ignores abort and this generator's
    // finally runs late, appending here would place stale model text beside the
    // executor's canonical failure row.
    if (!args.userTurnPersisted && replyBuffer.trim().length > 0) {
      try {
        await appendTurn(args.admin, {
          chatId: args.chatId,
          organizationId: args.organizationId,
          turnId,
          role: 'assistant_text',
          body: replyBuffer,
        });
      } catch (err) {
        errorEvent = {
          type: 'tool.error',
          name: 'persist',
          message: errMessage(err),
        };
      }
    }
    try {
      await bumpChatLastMessageAt(args.admin, args.chatId, finishedAt);
    } catch {
      /* swallow — non-critical, logged by persist's error itself */
    }
    return errorEvent;
  };

  // Drain. Persistence already happened producer-side; this loop only
  // forwards events to the consumer. The try/finally guarantees the
  // final assistant_text + chat bump persist even when the consumer
  // disappears mid-stream: breaking out of a for-await (or an SSE
  // disconnect handler) calls the generator's return(), which runs
  // the finally below.
  try {
    for await (const event of queue) {
      yield event;
    }

    // Queue closed → the pump has settled. Surfacing a pump error here
    // would be a programmer bug; we already pushed it as an event.
    await pump.catch(() => undefined);

    const persistError = await persistFinalText();
    if (persistError) {
      yield persistError;
    }

    yield { type: 'done', turnId };
  } finally {
    // Abandoned-consumer path (a no-op after normal completion): wait
    // for the pump to finish executing so the reply buffer is complete,
    // then persist it exactly once.
    await pump.catch(() => undefined);
    await persistFinalText();
  }
}

/**
 * Resolve the authenticated human once per dispatcher turn. A missing row or
 * read failure remains a user actor with a null role, so sensitive commits
 * fail closed instead of being upgraded to system autonomy.
 */
async function resolveCommitActor(
  admin: AdminClient,
  userId: string,
  organizationId: string,
): Promise<Extract<CommitActor, { kind: 'user' }>> {
  try {
    const { data } = await admin
      .from('users')
      .select('role')
      .eq('id', userId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    return { kind: 'user', role: data?.role ?? null };
  } catch {
    return { kind: 'user', role: null };
  }
}

// ---------------------------------------------------------------------------
// SDK → DispatcherEvent translation
// ---------------------------------------------------------------------------
//
// A single SDK message can produce 0..N DispatcherEvents (an assistant
// turn might carry both a text and a tool_use block). 'noop' results
// represent SDK messages we deliberately ignore (system, status,
// partial-streaming, etc — the dispatcher does NOT expose mid-token
// streaming yet; one full text block per assistant turn).

type Translated = { kind: 'event'; event: DispatcherEvent } | { kind: 'noop' };

function translateSdkMessage(msg: SDKMessage): Translated[] {
  if (msg.type === 'assistant') {
    const out: Translated[] = [];
    const blocks = (msg.message?.content ?? []) as Array<{
      type: string;
      text?: string;
      name?: string;
      input?: unknown;
      id?: string;
    }>;
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        out.push({
          kind: 'event',
          event: { type: 'say.delta', text: block.text },
        });
      } else if (block.type === 'tool_use') {
        if (block.name && block.id) {
          out.push({
            kind: 'event',
            event: {
              type: 'tool.use',
              name: block.name,
              input: block.input ?? null,
              toolUseId: block.id,
            },
          });
        } else {
          out.push({
            kind: 'event',
            event: {
              type: 'tool.error',
              name: 'model-output',
              message: 'Provider returned a malformed tool request',
            },
          });
        }
      }
    }
    return out;
  }

  if (msg.type === 'user') {
    // Tool-result blocks come back through the user channel. Anthropic
    // shapes them as `{type:'tool_result', tool_use_id, content}` (or
    // a string body in older shapes). We pass content through as the
    // result payload; downstream consumers / audit log render it.
    const out: Translated[] = [];
    const messageContent = msg.message?.content;
    const blocks = Array.isArray(messageContent)
      ? (messageContent as Array<{
          type: string;
          tool_use_id?: string;
          content?: unknown;
          is_error?: boolean;
        }>)
      : [];
    for (const block of blocks) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        out.push({
          kind: 'event',
          event: {
            type: 'tool.result',
            toolUseId: block.tool_use_id,
            result: block.content ?? null,
          },
        });
        if (block.is_error === true) {
          out.push({
            kind: 'event',
            event: {
              type: 'tool.error',
              name: 'tool-result',
              message: 'A dispatcher tool reported an error result',
            },
          });
        }
      }
    }
    return out;
  }

  if (msg.type === 'result') {
    const result = msg as unknown as Record<string, unknown>;
    const subtype = result['subtype'];
    const failed =
      result['is_error'] === true ||
      (typeof subtype === 'string' && subtype !== 'success');
    if (failed) {
      return [
        {
          kind: 'event',
          event: {
            type: 'tool.error',
            name: 'provider',
            message:
              typeof subtype === 'string'
                ? `Provider result: ${subtype}`
                : 'Provider returned an error result',
          },
        },
      ];
    }
  }

  // result / system / status / partial / etc. — we don't surface
  // these. (Token-level streaming would come from
  // `stream_event` partial messages, which we deliberately don't
  // enable for now.)
  return [{ kind: 'noop' }];
}

// ---------------------------------------------------------------------------
// Persistence side-effects per emitted event
// ---------------------------------------------------------------------------
//
// Producer-owned: tool.use / tool.result rows are persisted from the
// pump (awaited, before the event is enqueued); ack is persisted as
// `assistant_ack` from `emit` as the MCP handler fires. proposal
// events ride on the same tool.use audit row that produced them, so we
// don't double-write here. assistant_text is persisted at the end of
// the turn (single row carrying the full reply). Returns null for
// event types with no audit row; the returned promise never rejects.

function persistEvent(
  args: RunOperatorDispatcherArgs,
  event: DispatcherEvent,
  turnId: string,
): Promise<unknown> | null {
  switch (event.type) {
    case 'ack':
      return appendTurn(args.admin, {
        chatId: args.chatId,
        organizationId: args.organizationId,
        turnId,
        role: 'assistant_ack',
        body: event.text,
      }).catch((err) => {
        console.error(`[dispatcher] ack persist failed: ${errMessage(err)}`);
      });
    case 'tool.use':
      return appendTurn(args.admin, {
        chatId: args.chatId,
        organizationId: args.organizationId,
        turnId,
        role: 'tool_use',
        toolName: event.name,
        toolInput: event.input,
        toolUseId: event.toolUseId,
      }).catch((err) => {
        console.error(
          `[dispatcher] tool_use persist failed: ${errMessage(err)}`,
        );
      });
    case 'tool.result':
      return appendTurn(args.admin, {
        chatId: args.chatId,
        organizationId: args.organizationId,
        turnId,
        role: 'tool_result',
        toolUseId: event.toolUseId,
        toolResult: event.result,
      }).catch((err) => {
        console.error(
          `[dispatcher] tool_result persist failed: ${errMessage(err)}`,
        );
      });
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
//
// Org-level prompt — adapted from Boop's interaction-agent.ts:16-111.
// Changes from the v1.6 per-property prompt:
//   1. Scope widened from one property to the full org portfolio — the
//      model now sees all N properties and picks the right one per turn.
//   2. Tool list updated: all property tools now take `propertyName`
//      (not baked-in — resolved server-side per call).
//   3. Optional `propertyHint` block rendered at the end when the caller
//      knows which property was last discussed (e.g. web URL, prior stamp).
//   4. Channel-conditional tone block retained from the original.

interface BuildSystemPromptArgs {
  channel: DispatcherChannel;
  orgContext: OrganizationContext;
  propertyHint?: { id: string; name: string };
  userRole?: UserRole | null;
}

export function buildSystemPrompt(args: BuildSystemPromptArgs): string {
  const { orgContext, propertyHint } = args;
  const n = orgContext.properties.length;
  const propertyList = orgContext.properties
    .map(
      (p) =>
        `- ${p.name} — ${p.address} (${p.timezone}, autonomy=${p.autonomyLevel})`,
    )
    .join('\n');

  const tone = toneBlock(args.channel);
  const assistantName = orgContext.organization.assistantName;
  const orgName = orgContext.organization.name;

  const hintBlock = propertyHint
    ? `\n[Last turn was about: ${propertyHint.name}. The operator may stay on this property or switch — read the new message.]`
    : '';

  const roleBoundary =
    args.userRole === 'va'
      ? `VA workspace boundary (higher priority than the general tool catalog below):
- The current operator is a VA working in a bounded preparation workspace, not the owner.
- Use read tools to gather facts, summarize work, and prepare owner handoffs. Never imply this VA approved, sent, scheduled, cancelled, dispatched, paid, waived, or changed owner-controlled work.
- Proposal decisions happen only in Owner Queue. list_proposals and list_scheduled are inspection-only. Do not attempt to commit, reject, schedule, or cancel work from chat.
- spawn_property_worker may be used for a draft that remains in owner review or for an already-supported internal record. Treat tenant-facing, money, lease, vendor-dispatch, and calendar commitments as owner handoffs.`
      : '';

  const proposalFlow =
    args.userRole === 'va'
      ? `VA proposal flow:
- Surface review-required proposals as owner handoffs and keep their review URL as context only.
- If the VA asks to approve, reject, send, schedule, or commit, summarize what the owner needs to decide instead.
- Never claim a proposal was committed unless a permitted tool returned success.`
      : `Proposal flow:
- Read-only inference and provider-free internal record capture may complete automatically. Tenant-facing, money, lease, vendor, calendar, archival, and policy commitments always return "needs review" regardless of confidence.
- For "needs review", say what was prepared and that it is in Owner Queue. Do not repeat internal ids or action_type values.
- Chat may inspect and explain proposals, but it cannot approve or decline them. Even when the operator says "send it", "yes", or "go ahead", direct them to Owner Queue for the explicit decision.
- Never claim a review-required proposal was committed.`;

  return `You are ${assistantName}, the AI property operations assistant for ${orgName}, helping an owner-operated landlord run ${n} ${n === 1 ? 'property' : 'properties'}:
${propertyList}

You are reaching them via ${args.channel}.

You are a DISPATCHER, not a doer. Your job:
1. Figure out which property the operator is asking about — from the message, prior turns, or by asking.
2. For every tool call that touches a property, pass \`propertyName\` so the right property is loaded.
3. Decide: answer directly (cached above), look up details with the read tools, or spawn a property worker for actions (text a tenant, schedule a vendor, draft a notice).
4. When spawning a worker: pass NAMES, never UUIDs. Describe the human outcome and whether it is in Owner Queue; never expose proposal ids, tool names, payload JSON, or policy enums.

Grounding rule:
- Your sources are this preamble (the property list, org context) and any tool results you fetch this turn. Your training data does NOT count as a source.
- If the answer is not in the loaded context (rulebook, recent turns, memory_facts, vendors, tenants, leases) or a tool result, say so. Don't fabricate.

Source-bounded asking:
- If you can't answer from the loaded org context, the properties list, or available tools, ask the operator a direct one-line question. Don't guess. Don't apologize. One sentence.
- Specifically: when the operator references a property name that isn't in the list above, ask which property they mean — don't invent details, don't pick a similar-sounding one without confirming.
- If the message is ambiguous about which property, ASK — don't guess.

Reply discipline:
- Keep replies tight; this is iMessage.

${tone}

${roleBoundary}${roleBoundary ? '\n' : ''}

Acknowledgment rule (operator UX):
BEFORE every spawn_property_worker call, you MUST call send_ack first with a short 1-sentence message. The operator otherwise sees nothing for 10-30 seconds while the worker runs.
Order: send_ack → spawn_property_worker → (wait) → final reply.
Skip the ack ONLY for quick reads (single lookup, proposal commit).

${proposalFlow}

Tools:
- get_property(propertyName) — full details for one property
- list_tenants(propertyName) — tenants + units
- list_vendors(propertyName, category?) — vendor roster
- recent_activity(propertyName, daysBack?) — recent SMS / proposals / notes
- list_proposals(propertyName?, status?) — pending or all proposals (omit propertyName for portfolio view)
- recall_facts(propertyName?, query, limit?) — durable memory; org-wide if propertyName omitted
- record_fact(propertyName, factText) — persist an owner-stated fact ("remember", "note that", "FYI"). Returns the new fact id.
- spawn_property_worker(propertyName?, action_type, prompt?, tenantName?, vendorName?, payload?) — sub-agent for property-scoped action OR portfolio mutation
- schedule_action(propertyName, triggerAt, actionType, actionPrompt, tenantName?, conditionType, sinceReminderDescription?) — schedule a future-conditional action. Use for "if X by Friday, send Y". triggerAt is ISO 8601 (convert "friday 9am" to ISO using the org's timezone). conditionType is one of: rent_unpaid (tenant unpaid by trigger_at), tenant_no_response (tenant hasn't replied since a specific proposal), always (unconditional). Anything outside those three: tell the operator to ping you back.
- list_scheduled(propertyName?, status?) — list scheduled actions for the org
- cancel_scheduled(scheduleDescription, reason?) — cancel by paraphrasing what you're cancelling
- list_calendar_events(startIso, endIso?, query?) — peek at the operator's connected Google Calendar before scheduling. Read-only.
- send_ack(message) — quick ack while you think

Portfolio actions:
Use spawn_property_worker to capture an internal record or prepare an Owner Queue proposal:
- create_property: create a new property
- add_unit: add a unit to a property
- add_tenant: propose adding a tenant (and optionally linking to a unit)
- set_lease_terms / update_rent / archive_lease: propose lease changes
- send_tenant_message: prepare a tenant message for review
- log_maintenance_ticket: file a maintenance ticket
- update_property_rules: propose a rulebook change

Safety disposition is explicit, not confidence-based:
- Internal, provider-free record capture (properties, units, appliances, maintenance tickets) may complete automatically when valid.
- Tenant-facing sends; payment links or requests; rent, lease, waiver, or rule changes; vendor selection or dispatch; calendar writes; archival; and other external commitments must remain in Owner Queue until explicit human review.

For these write actions, pass a structured \`payload\` matching the action_type instead of a \`prompt\` (the dispatcher itself produces the payload — there's no per-property worker LLM in the loop). Refs inside the payload (propertyRef, tenantRef, unitRef, leaseRef) MUST be NESTED name-based objects, not hoisted to the payload's top level. Use propertyName, tenantName, and unitLabel from grounded tool results; never place UUIDs in model output. Concrete examples:
  - add_unit: \`{ propertyRef: { propertyName: "Vaba House" }, label: "1", bedrooms: 3, bathrooms: 2 }\`
  - add_tenant: \`{ fullName: "Test Person", phoneE164: "+15555550100", unitRef: { unitLabel: "1", propertyName: "Vaba House" } }\`
  - set_lease_terms: \`{ leaseRef: { tenantName: "Test Person" }, rentAmount: 2400, rentDueDay: 1, startDate: "2026-06-01" }\`

Unit labels are short identifiers ('1', '2B', '100') — never a person's name. If the owner hasn't named the unit, ask.

Sequencing rule (CRITICAL):
- When chaining multiple write spawns (e.g. add_unit → add_tenant → set_lease_terms), AWAIT each tool result before issuing the next call. Each spawn returns a one-line confirmation; read it before deciding what to do next.
- A review-required proposal is not a completed record. Never continue a chain as if a tenant, lease, rent change, or other commitment exists merely because its proposal was recorded.
- After the owner explicitly approves add_tenant with a unitRef, its handler creates a pending lease; only then prepare set_lease_terms. Preparing lease terms before that commit can fail with \`lease_not_found_attach_unit_first\`.
- If a spawn returns "Invalid payload" or any error, fix the shape and retry — DO NOT continue chaining as if it succeeded. The handler outcome shows up on the next turn's tool result.

Google Calendar:
You can prepare calendar writes for Owner Queue via spawn_property_worker:
- schedule_calendar_event: propose vendor visits, showings, or inspections. Payload shape: \`{ summary, description?, attendees?: ["a@b.com"], startIso, endIso, location?, propertyRef?, tenantRef? }\`. Use ISO 8601 timestamps (convert times using the property's timezone).
- cancel_calendar_event: propose removing a booked event by id. Payload: \`{ eventId }\`. Get the id from list_calendar_events.
- list_calendar_events (direct read-only tool): peek at upcoming events before scheduling so you don't double-book. Pass \`startIso\` (required) and optional \`endIso\` / \`query\`.
If the operator's Google Calendar isn't connected, the spawn returns \`calendar_not_connected\`. Narrate "connect Google Calendar in settings first" and don't retry. Don't fabricate an event id or pretend a booking succeeded when it didn't.

Rent collection:
- request_rent_payment: prepare an Owner Queue proposal when the owner asks to send a rent link or reminder. Do not claim a link or SMS was sent before explicit review and a successful commit. Payload: \`{ tenantRef: { tenantName } | { tenantId }, amountCents?, dueDate? }\`.
- For amount/dueDate: leave blank to use the tenant's active lease defaults (rent_amount × 100 cents, next rent_due_day). Pass them only when the owner specifies an off-cycle amount or date.

Property data depth (Wave 7):
You can capture property facts as you encounter them in conversation:
- add_appliance / update_appliance: when a tenant or owner mentions an appliance (fridge, hvac, washer, dryer, water_heater, dishwasher, oven, microwave, other). Payload shape: \`{ propertyRef, unitRef?, type, make?, model?, serialNumber?, installDate?, warrantyExpiresAt?, notes? }\`. Omit unitRef for property-wide units (shared HVAC, water heater).
- set_property_vendor: prepare an Owner Queue proposal when the owner says "for vaba use Joe Plumbing" or "set the plumber here to X". Payload: \`{ propertyRef, category, vendorRef }\`. Category is one of {plumbing, electrical, hvac, landscaping, general, pest, roof, cleaning, locksmith}. The vendorRef must already exist in the org's vendor roster — list_vendors to confirm before spawning.
- update_tenant_preference: prepare an Owner Queue proposal for the current composite preference action because it can affect contact behavior or deposit facts. Payload: \`{ tenantRef, preferredChannel?, language?, emergencyContactName?, emergencyContactPhone?, parkingSpace?, pets? }\`. Pets is an array of \`{type, name?, depositPaid?}\`.

Agent-fill UX rule:
- When data is needed for an action (a make/model for warranty lookup, a vendor for dispatch, a tenant's preferred channel) and that data isn't already in the loaded context, ASK the owner inline first — one short question — before spawning the worker.
- Once they answer, call the relevant spawn tool. Narrate the returned outcome: captured automatically for a safe internal record, or prepared for Owner Queue review for a commitment. Default \`confidence: 0.7\` for facts the owner just told you (you didn't visually confirm a serial sticker, you took their word for it).
- Use \`confidence: 1.0\` ONLY when the owner explicitly confirms in the current turn ("yes that's right, the fridge is a Samsung RF28") — not when they merely state it the first time. The owner UI confirms via click on the badge; that path is separate.
- Never invent a make/model/serial. If the owner doesn't know, leave the optional fields out.

Confidence never overrides the safety disposition. If a reference is ambiguous (multiple tenants match), ask the owner to disambiguate before spawning. Use past tense only when the tool actually completed a safe internal capture; otherwise say the proposal is ready in Owner Queue. If a write fails, narrate the failure honestly rather than claiming success.
${hintBlock}`;
}

function toneBlock(channel: DispatcherChannel): string {
  if (channel === 'web') {
    return `Tone: Warm, concise, slightly structured. The operator is at a desktop with proper rendering — short paragraphs and the occasional bullet list are fine. Markdown links/code OK. Aim for replies under 600 chars.`;
  }
  // imessage + mcp share the terse-and-warm style.
  return `Tone: Warm, witty, concise. Write like you're texting a friend who happens to also be your colleague — direct, no fluff. Plain text. NO markdown headers, code fences, or bullet dumps unless the operator asked for a list. Keep replies under ~400 chars when you can.

Identity discipline:
- Do NOT reintroduce yourself ("Hi! I'm Odesa...") on every turn. The operator already knows who you are. A simple greeting back ("hey", "what's up") is plenty.
- Do NOT sign off with "— ${'${'}assistantName${'}'}" or any name. The transport already attributes the message to you.

Emoji discipline:
- Skip decorative emoji (🏠, 🎯, 💼, ✨, etc.). They're noise.
- Status flags are fine when they ARE the content: ✅ for paid, 🚩 for late, ⏳ for awaiting review. One per item, not garnish.

Capability honesty:
- For future-conditional or scheduled requests ("if X by Friday, send Y"), use schedule_action. Don't fabricate cron primitives, "auto-send", "locked-in checks", or session-only timers — schedule_action is the verb, the Inngest function is the durable mechanism, you don't need to invent anything.
- schedule_action supports three condition types only: rent_unpaid, tenant_no_response, always. If the operator's request doesn't fit one of those, say so and ask them to ping you at the time instead.
- For integrations not in the tool list (external portals, mortgage data, calendar APIs, screen-scrapers, etc.), say "I don't have that integration" and stop. Do not invent it.`;
}

// ---------------------------------------------------------------------------
// History rendering
// ---------------------------------------------------------------------------
//
// Render the trailing chat into a "ROLE: body" block for the user-
// prompt prologue. Skip the current turn's user row (we just wrote it
// above; the model already has the message via `args.message`). Also
// skip tool_use / tool_result rows — the model only needs to see the
// dialogue, not its own bookkeeping.

function renderHistory(
  turns: Awaited<ReturnType<typeof loadHistory>>,
  currentTurnId: string,
): string {
  const lines: string[] = [];
  for (const t of turns) {
    if (t.turn_id === currentTurnId) continue;
    if (t.role === 'tool_use' || t.role === 'tool_result') continue;
    if (!t.body) continue;
    const tag =
      t.role === 'assistant_text' || t.role === 'assistant_ack'
        ? 'ASSISTANT'
        : 'OPERATOR';
    lines.push(`${tag}: ${t.body}`);
  }
  return lines.join('\n');
}

async function loadHistoryQuiet(
  admin: AdminClient,
  chatId: string,
): Promise<Awaited<ReturnType<typeof loadHistory>>> {
  try {
    return await loadHistory(admin, chatId, HISTORY_LIMIT);
  } catch {
    // History is decorative — if the load fails (RLS hiccup, transient),
    // proceed with an empty prior-turns block rather than aborting the
    // operator's request.
    return [];
  }
}

// ---------------------------------------------------------------------------
// EventQueue — pull-based async queue for interleaving emit() + pump
// ---------------------------------------------------------------------------
//
// Events are pushed either by MCP handlers via `emit` or by the pump as
// it translates SDK messages (both persist their audit rows before/as
// they push). The generator's for-await consumer drains in arrival
// order. Closing the queue ends the iteration after any buffered items
// drain.

class EventQueue implements AsyncIterable<DispatcherEvent> {
  private buf: DispatcherEvent[] = [];
  private waiter: ((v: IteratorResult<DispatcherEvent>) => void) | null = null;
  private closed = false;

  push(event: DispatcherEvent): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: event, done: false });
      return;
    }
    this.buf.push(event);
  }

  close(): void {
    this.closed = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<DispatcherEvent> {
    return {
      next: (): Promise<IteratorResult<DispatcherEvent>> => {
        if (this.buf.length > 0) {
          return Promise.resolve({ value: this.buf.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise<IteratorResult<DispatcherEvent>>((resolve) => {
          this.waiter = resolve;
        });
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function randomTurnId(): string {
  return `turn_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function signalAbortController(signal: AbortSignal): AbortController {
  const ctrl = new AbortController();
  if (signal.aborted) {
    ctrl.abort(signal.reason);
  } else {
    signal.addEventListener('abort', () => ctrl.abort(signal.reason), {
      once: true,
    });
  }
  return ctrl;
}
