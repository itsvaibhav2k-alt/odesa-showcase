/**
 * Operator dispatcher type contract — v1.6.
 *
 * Shared shapes consumed by:
 *   - this directory's dispatcher.ts (event producer, persist consumer)
 *   - this directory's persist.ts (chat + turn row mapping)
 *   - this directory's mcps/* (tool implementations may emit events)
 *   - src/app/api/chat/property/[id]/route.ts (SSE encoder)
 *   - src/app/api/mcp/sse/route.ts (Poke MCP — collects events to a string)
 *   - src/lib/messaging/handle-operator-inbound.ts (iMessage transport)
 *
 * Only types and pure helpers belong here. Anything that touches I/O
 * (Supabase, Linq, Anthropic) lives in dispatcher.ts / persist.ts /
 * imessage.ts so this file stays cheap to import from anywhere
 * (including UI client components for ChatMessage type narrowing).
 *
 * The DispatcherEvent union mirrors the user-visible fan-out for one
 * model turn. The dispatcher emits events in this order:
 *
 *   ack? → (tool.use → tool.result)* → say.delta* →
 *     (proposal.recorded → proposal.committed | proposal.review_required)? →
 *     (tool.error)? → done
 *
 * The web SSE transport streams them as-is. The MCP transport collects
 * `say.delta` text + appends a one-line summary per `proposal.committed`
 * / `proposal.review_required`. The iMessage transport flushes the
 * final concatenated `say` body via `sendImessageReply` after `done`.
 */

import type { Database } from '@/types/database';
import type { ActionProposal } from '@/lib/agent/worker/types';

// Re-exported for downstream consumers — the dispatcher's spawn MCP
// validates incoming spawn_property_worker tool inputs against the
// existing v1.5 worker action union, so consumers only need one import.
export {
  WORKER_ACTION_TYPES,
  type WorkerActionType,
} from '@/lib/agent/worker/types';

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------
//
// Mirrors operator_chats.channel CHECK constraint. Add a value here ⇒
// add it to the migration's CHECK list ⇒ regen types. Keep all three
// in sync.

export type DispatcherChannel = 'imessage' | 'web' | 'mcp';

// ---------------------------------------------------------------------------
// DispatcherEvent — discriminated union of everything the loop emits
// ---------------------------------------------------------------------------
//
// Intentionally serializable: every field is JSON-clean so the SSE
// encoder can ship events as `data: ${JSON.stringify(evt)}\n\n` with
// no special-casing. Tool inputs/results pass through as `unknown`
// because the per-tool zod schemas live in mcps/*; the dispatcher
// shouldn't re-encode them.
//
// `ack`     — operator-visible "I'm working on it" line. Direct iMessage
//             pre-spawns this so the thread doesn't feel dead during a
//             multi-second tool run. Web renders it as a subtle italic
//             line. MCP drops it (no live thread to interject into).
// `say.delta` — incremental assistant-text chunk. Web concatenates
//             into one streamed message; iMessage and MCP collect the
//             full string and flush at the end of the turn.
// `tool.use` / `tool.result` — surfaced primarily for the audit log;
//             web optionally renders them as collapsed "what I did"
//             rows. `toolUseId` ties the pair together (same id Claude
//             uses on the wire).
// `proposal.recorded` — the spawn MCP just persisted a fresh proposal.
//             This carries the full `ActionProposal` (with id) so the
//             persist layer can stamp `proposal_id` on the audit row.
// `proposal.committed` — the gate decided 'auto' AND commitProposal
//             succeeded. The same proposal payload is included so the
//             UI/transport can render a "Sent ✓" affordance.
// `proposal.review_required` — gate decided 'review'. The dispatcher
//             includes a `reviewUrl` pointing at the Owner Queue
//             queue so the iMessage transport can text it inline and
//             web can deep-link the inline ProposedActionCard.
// `tool.error` — a tool handler threw. The dispatcher converts it to
//             a soft assistant message ("I couldn't pull that up — try
//             again?") downstream of this event; the event itself is
//             for the audit log.
// `done`    — terminal event. `turnId` is the same id we wrote on
//             every operator_chat_turns row from this turn.

/**
 * Handler outcome attached to `proposal.committed` for successful wave-6
 * write actions. Failed handlers persist a failed/unsupported proposal and
 * emit tool.error instead; they never produce this success event.
 *
 * Absent on the event for legacy draft action_types (draft_sms_reply,
 * dispatch_vendor, polish_briefing, etc.) which commit through dedicated
 * branches in commit.ts that don't return a handler-style result.
 */
export interface ProposalHandlerOutcome {
  ok: boolean;
  /** Stable error string when ok=false. Mirrors HandlerErr.error. */
  error?: string;
  /** Confidence score the handler returned (0..1). */
  confidence?: number;
  /** True iff the handler short-circuited on a natural-key match. */
  idempotent?: boolean;
}

export type DispatcherEvent =
  | { type: 'ack'; text: string }
  | { type: 'say.delta'; text: string }
  | { type: 'tool.use'; name: string; input: unknown; toolUseId: string }
  | { type: 'tool.result'; toolUseId: string; result: unknown }
  | { type: 'proposal.recorded'; proposal: ActionProposal }
  | {
      type: 'proposal.committed';
      proposal: ActionProposal;
      /** Wave-6 handler outcome; absent for legacy draft actions. */
      handlerOutcome?: ProposalHandlerOutcome;
    }
  | {
      type: 'proposal.review_required';
      proposal: ActionProposal;
      reviewUrl: string;
    }
  | { type: 'tool.error'; name: string; message: string }
  | { type: 'done'; turnId: string };

// ---------------------------------------------------------------------------
// Database row aliases
// ---------------------------------------------------------------------------
//
// Source-of-truth row shapes from the regenerated Database type. We
// alias here for terseness in dispatcher / persist / handler signatures
// — never re-declare columns. (Drift between alias and DB row is a
// privacy-mode-class regression risk; let the generator remain the
// single source of truth.)

export type OperatorChatRow =
  Database['public']['Tables']['operator_chats']['Row'];

export type OperatorChatTurnRow =
  Database['public']['Tables']['operator_chat_turns']['Row'];

// Discrete role union mirroring the operator_chat_turns.role CHECK
// constraint. Exported so persist.ts can narrow appendTurn's `role`
// arg without restating the values.
export type OperatorChatTurnRole = NonNullable<OperatorChatTurnRow['role']> &
  ('user' | 'assistant_text' | 'assistant_ack' | 'tool_use' | 'tool_result');

// Status union matching operator_chats.status CHECK. Shared by
// persist.ts (markChatClosed) and the dashboard chat list filter.
export type OperatorChatStatus = NonNullable<OperatorChatRow['status']> &
  ('open' | 'closed');
