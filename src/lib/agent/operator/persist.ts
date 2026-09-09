/**
 * Persistence helpers for the operator dispatcher.
 *
 * Wraps the Supabase admin client around the three operator-side
 * tables added in 20260502000000_operator_chats.sql:
 *
 *   - operator_chats        (one row per open thread)
 *   - operator_chat_turns   (one row per model/tool turn unit)
 *
 * The dispatcher (src/lib/agent/operator/dispatcher.ts) calls into
 * this module at three points per request:
 *
 *   1. `loadOrCreateChat` — at the top of the turn, to resolve the
 *      operator_chats row the rest of the turn appends against.
 *   2. `loadHistory`      — to feed prior turns into the model context.
 *   3. `appendTurn`       — once per DispatcherEvent that carries
 *      audit-worthy content (user msg, assistant text, tool_use,
 *      tool_result, ack).
 *
 * Plus a mid-turn helper for state mutations:
 *
 *   - `bumpChatLastMessageAt` — keep the open-chat partial index hot
 *      so the next loadOrCreateChat can find this row in O(log n).
 *
 * All writes use the admin client because the dispatcher runs from
 * webhook + MCP routes that have no `auth.uid()` JWT. RLS is still
 * enforced for any operator-facing reads from the dashboard pages.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';

import type {
  DispatcherChannel,
  OperatorChatRow,
  OperatorChatTurnRow,
  OperatorChatTurnRole,
} from './types';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a write to operator_chats / operator_chat_turns fails or
 * a required lookup unexpectedly returns no rows. Callers (dispatcher,
 * route handlers) surface as a 5xx — the operator is mid-conversation,
 * we can't silently drop a turn.
 */
export class OperatorPersistError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'OperatorPersistError';
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// loadOrCreateChat
// ---------------------------------------------------------------------------
//
// Find the most recent OPEN chat for (organizationId, userId, channel,
// propertyId|null) and return it. If none exists, INSERT a fresh one.
//
// `propertyId` is part of the key because:
//   - direct-iMessage opens with propertyId=null and the dispatcher
//     stamps the last-discussed property as a hint. Two parallel direct-
//     iMessage threads (rare; but if the operator switches mid-day)
//     should reuse the same null-property row to preserve history.
//   - web `/inbox` (org-level) opens with propertyId=null and pins a
//     SINGLE rolling thread per (org, user) — the operator-facing twin of
//     the iMessage thread. The dispatcher may stamp `chat.property_id`
//     mid-conversation as a propertyHint for prompt continuity, but
//     subsequent inbound turns still arrive with propertyId=null and
//     must reuse the same row (matched via `.is('property_id', null)`).
//   - web `/properties/[id]/chat` always opens with the URL-bound
//     propertyId. The dashboard wants one chat per property, not a
//     shared scratch chat.
//   - mcp `ask_property` always passes a concrete propertyId from the
//     Poke tool input.
//
// Important: `eq('property_id', null)` does NOT match NULL rows in
// PostgREST — we use `.is(...)` for the null branch.

export interface LoadOrCreateChatArgs {
  organizationId: string;
  userId: string;
  /** Null on the first turn of a direct-iMessage thread, before disambiguation. */
  propertyId: string | null;
  channel: DispatcherChannel;
}

export async function loadOrCreateChat(
  admin: SupabaseClient<Database>,
  args: LoadOrCreateChatArgs,
): Promise<OperatorChatRow> {
  const baseQuery = admin
    .from('operator_chats')
    .select('*')
    .eq('organization_id', args.organizationId)
    .eq('user_id', args.userId)
    .eq('channel', args.channel)
    .eq('status', 'open');

  // For direct-iMessage there is one rolling thread per (org, user) — the
  // operator can swing between properties inline, and the `property_id`
  // stamp on the chat is just the most recently discussed property hint.
  // Without this branch, after a property hint is stamped the next turn
  // arrives with `propertyId=null` and `is.null` matches nothing,
  // spawning a fresh chat per turn and erasing history.
  // Web/mcp flows scope by `property_id`: an explicit propertyId pins the
  // per-property thread; a null propertyId on `web` matches the single
  // org-level `/inbox` rolling thread (mirrors the iMessage pattern but
  // keeps web property-scoped chats unaffected because they always carry
  // their URL-bound id).
  const scopedQuery =
    args.channel === 'imessage'
      ? baseQuery
      : args.propertyId === null
        ? baseQuery.is('property_id', null)
        : baseQuery.eq('property_id', args.propertyId);

  const { data: existing, error: lookupError } = await scopedQuery
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1);

  if (lookupError) {
    throw new OperatorPersistError(
      `failed to lookup existing operator_chat: ${lookupError.message}`,
      lookupError,
    );
  }

  if (existing && existing.length > 0) {
    return existing[0]!;
  }

  const insertRow: Database['public']['Tables']['operator_chats']['Insert'] = {
    organization_id: args.organizationId,
    user_id: args.userId,
    property_id: args.propertyId,
    channel: args.channel,
    status: 'open',
  };

  const { data: created, error: insertError } = await admin
    .from('operator_chats')
    .insert(insertRow)
    .select()
    .single();

  if (insertError || !created) {
    throw new OperatorPersistError(
      `failed to insert operator_chat: ${insertError?.message ?? 'no row returned'}`,
      insertError ?? null,
    );
  }

  return created;
}

// ---------------------------------------------------------------------------
// loadHistory
// ---------------------------------------------------------------------------
//
// Returns the most recent N turns for a chat in CHRONOLOGICAL order
// (oldest first), suitable for direct injection into a Claude SDK
// prompt history.
//
// Implementation: we sort DESC + limit on the way in (so we can cap
// the load to the trailing window without scanning the whole chat),
// then reverse in-memory. The chat_id partial index makes the DESC
// scan equally cheap.

const DEFAULT_HISTORY_LIMIT = 20;

export async function loadHistory(
  admin: SupabaseClient<Database>,
  chatId: string,
  limit: number = DEFAULT_HISTORY_LIMIT,
): Promise<OperatorChatTurnRow[]> {
  const { data, error } = await admin
    .from('operator_chat_turns')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new OperatorPersistError(
      `failed to load operator_chat_turns for chat ${chatId}: ${error.message}`,
      error,
    );
  }

  // Chronological for the prompt. Use slice().reverse() to avoid
  // mutating the supabase result array.
  return (data ?? []).slice().reverse();
}

// ---------------------------------------------------------------------------
// appendTurn
// ---------------------------------------------------------------------------
//
// One row per DispatcherEvent's audit-worthy unit. Every row in a
// single operator turn shares the same `turnId` so the audit log can
// group them when rendering Recent Activity / debugging.
//
// Optional fields are explicitly typed `null` (not undefined) when
// absent because Supabase's Insert type forbids `undefined` on
// nullable columns. Callers pass the discriminator-relevant fields
// (e.g. tool_use needs toolName + toolInput + toolUseId; assistant_text
// needs body) and we coerce the rest to null.

export interface AppendTurnArgs {
  chatId: string;
  organizationId: string;
  /** Unique identifier shared across all rows in a single operator turn. */
  turnId: string;
  role: OperatorChatTurnRole;
  body?: string | null;
  toolName?: string | null;
  toolInput?: unknown;
  toolUseId?: string | null;
  toolResult?: unknown;
  proposalId?: string | null;
}

export async function appendTurn(
  admin: SupabaseClient<Database>,
  args: AppendTurnArgs,
): Promise<OperatorChatTurnRow> {
  const insertRow: Database['public']['Tables']['operator_chat_turns']['Insert'] =
    {
      chat_id: args.chatId,
      organization_id: args.organizationId,
      turn_id: args.turnId,
      role: args.role,
      body: args.body ?? null,
      tool_name: args.toolName ?? null,
      // `unknown` → Json bridge is intentional. Tool inputs and
      // results have already been zod-validated by the tool handler
      // upstream; this layer just persists. Without the cast, TS won't
      // accept arbitrary recursive shapes against the Json union.
      tool_input:
        args.toolInput === undefined ? null : (args.toolInput as Json),
      tool_use_id: args.toolUseId ?? null,
      tool_result:
        args.toolResult === undefined ? null : (args.toolResult as Json),
      proposal_id: args.proposalId ?? null,
    };

  const { data, error } = await admin
    .from('operator_chat_turns')
    .insert(insertRow)
    .select()
    .single();

  if (error || !data) {
    throw new OperatorPersistError(
      `failed to insert operator_chat_turn: ${error?.message ?? 'no row returned'}`,
      error ?? null,
    );
  }

  return data;
}

// ---------------------------------------------------------------------------
// bumpChatLastMessageAt
// ---------------------------------------------------------------------------
//
// Update the chat's `last_message_at` so the next loadOrCreateChat
// returns this row first. The dispatcher calls this once per turn
// after the final assistant message is written.
//
// Accepts a timestamp arg (vs. defaulting to NOW()) so multiple
// concurrent updates don't race — the dispatcher passes the same
// value it stamped on its `created_at` insert for the final turn row.

export async function bumpChatLastMessageAt(
  admin: SupabaseClient<Database>,
  chatId: string,
  at: string,
): Promise<void> {
  const { error } = await admin
    .from('operator_chats')
    .update({ last_message_at: at })
    .eq('id', chatId);

  if (error) {
    throw new OperatorPersistError(
      `failed to bump last_message_at on operator_chat ${chatId}: ${error.message}`,
      error,
    );
  }
}
