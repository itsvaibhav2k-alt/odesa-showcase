/**
 * Ack MCP — `send_ack`.
 *
 * The dispatcher uses this to surface short "I'm working on it" lines
 * mid-tool-call so the operator's thread doesn't feel dead during a
 * multi-second spawn or commit. Per-channel transport:
 *
 *   - `imessage`: route through `sendInline` (the dispatcher wires this
 *     to `sendImessageReply`). iMessage has no native streaming; the
 *     ack lands as its own bubble.
 *   - `web`: emit the `ack` DispatcherEvent — the SSE encoder ships it
 *     to the chat UI as a subtle italic line.
 *   - `mcp`: no-op for transport (Poke MCP can't interject mid-call),
 *     but we still emit the event so persist.ts captures the
 *     `assistant_ack` turn for the audit log.
 *
 * The event always emits regardless of channel. The persist consumer
 * writes one operator_chat_turns row per ack so Recent Activity in
 * the dashboard renders the full play-by-play.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { DispatcherChannel, DispatcherEvent } from '../types';

export interface CreateAckMcpDeps {
  channel: DispatcherChannel;
  /**
   * Inline send hook. Required for `imessage`; ignored for `web`/`mcp`.
   * Errors are logged but never re-thrown — a missed ack must not
   * abort the dispatcher turn.
   */
  sendInline?: (text: string) => Promise<void>;
  emit: (event: DispatcherEvent) => void;
}

export function createAckMcp(deps: CreateAckMcpDeps) {
  return createSdkMcpServer({
    name: 'odesa-operator-ack',
    version: '0.1.0',
    // 16 tools total — always in the prompt; deferral behind ToolSearch
    // costs a full model round trip per fresh conversation.
    alwaysLoad: true,
    tools: [
      tool(
        'send_ack',
        'Send a short "I am working on it" line to keep the operator thread feeling responsive during multi-second tool runs. Use this BEFORE spawning a property worker or other slow tool. Keep messages under one sentence.',
        {
          message: z
            .string()
            .min(1)
            .max(200)
            .describe('The ack text. One short sentence.'),
        },
        async (args) => {
          const { message } = args;

          if (deps.channel === 'imessage' && deps.sendInline) {
            try {
              await deps.sendInline(message);
            } catch (err) {
              console.error(
                `[ack] inline send failed (channel=imessage): ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            }
          }

          deps.emit({ type: 'ack', text: message });

          return {
            content: [{ type: 'text' as const, text: 'Ack sent.' }],
          };
        },
      ),
    ],
  });
}
