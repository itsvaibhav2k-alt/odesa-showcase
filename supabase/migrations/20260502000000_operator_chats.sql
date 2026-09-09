-- Odesa v1.6 — operator chat surfaces (Operator Property Agent)
-- Authored 2026-05-02 (foundation-eng)
--
-- Adds three new tables to back the operator-side chat surface that the
-- dispatcher (src/lib/agent/operator/dispatcher.ts) writes to from all
-- three transports: direct iMessage (Linq), Poke MCP, and the in-app
-- /properties/[id]/chat web UI:
--
--   operator_chats        — one row per (user, property|null, channel)
--                            open conversation; nullable property_id
--                            because direct-iMessage starts pre-
--                            disambiguation and the dispatcher resolves
--                            the property mid-thread.
--   operator_chat_turns   — every model turn (user msg, assistant text,
--                            ack, tool_use, tool_result) keyed to a
--                            shared `turn_id` so multi-tool turns stay
--                            grouped in the audit log.
--   mcp_api_keys          — sha256-hashed API keys for the Poke custom-
--                            MCP integration. Plaintext is shown once
--                            at mint time; lookups go through key_hash.
--
-- Plus an ALTER TABLE on `users` adding `phone_e164` + `phone_verified_at`
-- so the inbound Linq router can branch operator vs. tenant by from-number
-- before any tenant logic runs.
--
-- Conventions inherited from 20260421000000_odesa_initial.sql and
-- 20260428000000_property_workers.sql:
--   - gen_random_uuid() for primary keys
--   - organization_id denormalized on every table for fast RLS
--   - timestamptz for all times
--   - inline CHECK constraints for fixed-set enums (no new ENUM types
--     so the v1.6 surfaces can keep evolving cheaply)
--
-- RLS policies live at the bottom of this file (vs. a sibling RLS
-- migration) because the table set is small and the policies are
-- uniform org-scoped CRUD identical to the loop in
-- 20260428000001_property_workers_rls.sql.

-- =========================================================================
-- operator_chats — one open thread per (user, property|null, channel)
-- =========================================================================
--
-- channel values:
--   imessage — operator texts the org's Linq number from their verified phone
--   web      — operator opens /properties/[id]/chat in the dashboard
--   mcp      — Poke (or another MCP client) calls ask_property via /api/mcp/sse
--
-- status values:
--   open     — dispatcher will reuse this row for the next inbound turn
--   closed   — user explicitly ended; new inbound starts a fresh row
--
-- property_id is nullable because direct-iMessage threads start before
-- the dispatcher knows which property the operator wants to talk about.
-- The dispatcher writes the property_id back via markChatDisambiguated()
-- once `list_properties`/operator response narrows it down.

CREATE TABLE public.operator_chats (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.users(id)         ON DELETE CASCADE,
  property_id      uuid          REFERENCES public.properties(id)    ON DELETE CASCADE,
  channel          text NOT NULL CHECK (channel IN ('imessage', 'web', 'mcp')),
  status           text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'closed')),
  last_message_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_operator_chats_organization_id
  ON public.operator_chats(organization_id);

-- Hot-path lookup for loadOrCreateChat: find the most recent open chat
-- for a (org, user, channel) tuple. Property is matched at the app
-- layer (it can be NULL pre-disambiguation), so it is intentionally not
-- in the index column list.
CREATE INDEX idx_operator_chats_user_open
  ON public.operator_chats(organization_id, user_id, channel, last_message_at DESC)
  WHERE status = 'open';

-- =========================================================================
-- operator_chat_turns — every model + tool turn in chronological order
-- =========================================================================
--
-- turn_id groups the message-fan-out for a single user inbound:
--   user message (role='user')
--   → optional ack         (role='assistant_ack')
--   → 0..n tool_use rows   (role='tool_use')
--   → 0..n tool_result rows(role='tool_result')
--   → final assistant text (role='assistant_text')
--
-- This mirrors the per-turn DispatcherEvent fan-out so the audit log
-- can be replayed without re-spawning the dispatcher. Free-form text
-- (unique-per-turn opaque id) rather than uuid because dispatcher.ts
-- mints it locally as a logical group key, not a row id.
--
-- proposal_id is nullable; only set on tool_result rows whose tool_use
-- (spawn_property_worker, commit_proposal, reject_proposal) produced or
-- referenced a proposal. ON DELETE SET NULL so deleting a proposal
-- doesn't blow up its audit history.

CREATE TABLE public.operator_chat_turns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id          uuid NOT NULL REFERENCES public.operator_chats(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  turn_id          text NOT NULL,
  role             text NOT NULL CHECK (role IN (
    'user',
    'assistant_text',
    'assistant_ack',
    'tool_use',
    'tool_result'
  )),
  body             text,
  tool_name        text,
  tool_input       jsonb,
  tool_use_id      text,
  tool_result      jsonb,
  proposal_id      uuid REFERENCES public.action_proposals(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_operator_chat_turns_organization_id
  ON public.operator_chat_turns(organization_id);

-- Primary scan path: loadHistory(chatId) renders chronological turns.
CREATE INDEX idx_operator_chat_turns_chat
  ON public.operator_chat_turns(chat_id, created_at);

-- =========================================================================
-- mcp_api_keys — Bearer keys for Poke's custom-MCP integration
-- =========================================================================
--
-- key_hash:    sha256 hex of the raw key. Lookups never touch plaintext.
-- key_prefix:  first 8 chars of the raw key, stored cleartext for UI
--              display (e.g. "odesa_mc..."). Safe because it does not
--              meaningfully shorten brute-force.
-- label:       human-readable name set when minting (default 'Poke').
-- last_used_at:bumped by /api/mcp/sse on every successful auth.
-- revoked_at:  soft-delete tombstone. Lookups exclude rows where this
--              is non-null via the partial index below.
--
-- UNIQUE on key_hash so duplicate-mint collisions fail fast.

CREATE TABLE public.mcp_api_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.users(id)         ON DELETE CASCADE,
  key_hash         text NOT NULL UNIQUE,
  key_prefix       text NOT NULL,
  label            text NOT NULL DEFAULT 'Poke',
  last_used_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  revoked_at       timestamptz
);

CREATE INDEX idx_mcp_api_keys_organization_id
  ON public.mcp_api_keys(organization_id);

-- Hot-path lookup keyed by key_hash, restricted to live (non-revoked)
-- keys. Per the lesson in 20260423000000_source_aero_indexes_nonpartial.sql,
-- partial UNIQUE indexes are problematic with ON CONFLICT — but this
-- one is intentionally non-UNIQUE (the table-level UNIQUE on key_hash
-- handles uniqueness; this index just makes the read fast).
CREATE INDEX idx_mcp_api_keys_lookup
  ON public.mcp_api_keys(key_hash) WHERE revoked_at IS NULL;

-- =========================================================================
-- users — phone fields for inbound operator routing
-- =========================================================================
--
-- phone_e164:        operator's verified personal cell, normalized E.164.
--                    The Linq inbound router compares msg.fromE164 to
--                    this column to decide operator vs. tenant flow.
-- phone_verified_at: set when the one-time-code flow succeeds. The
--                    router refuses to branch on operator if this is NULL
--                    (a typed-but-unverified number must not unlock
--                    operator-level tools).
--
-- Idempotent (IF NOT EXISTS) so the migration is safe to re-apply on
-- branches that already added the column locally.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone_e164        text,
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

-- Index supports the routing lookup users(organization_id, phone_e164).
-- Partial (WHERE phone_e164 IS NOT NULL) so the index stays small —
-- most users haven't verified a phone yet.
CREATE INDEX IF NOT EXISTS idx_users_phone_org
  ON public.users(organization_id, phone_e164)
  WHERE phone_e164 IS NOT NULL;

-- =========================================================================
-- RLS — enable + uniform org-scoped CRUD
-- =========================================================================
--
-- Mirrors the DO loop pattern from
-- 20260428000001_property_workers_rls.sql so all org-scoped tables stay
-- uniform. Each table gets four policies (select/insert/update/delete)
-- gated on organization_id = public.current_user_org_id().

ALTER TABLE public.operator_chats      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_chat_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_api_keys        ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  policy_tables text[] := ARRAY[
    'operator_chats',
    'operator_chat_turns',
    'mcp_api_keys'
  ];
BEGIN
  FOREACH t IN ARRAY policy_tables LOOP
    EXECUTE format($fmt$
      CREATE POLICY %I_select_own_org
        ON public.%I FOR SELECT
        TO authenticated
        USING (organization_id = public.current_user_org_id());

      CREATE POLICY %I_insert_own_org
        ON public.%I FOR INSERT
        TO authenticated
        WITH CHECK (organization_id = public.current_user_org_id());

      CREATE POLICY %I_update_own_org
        ON public.%I FOR UPDATE
        TO authenticated
        USING      (organization_id = public.current_user_org_id())
        WITH CHECK (organization_id = public.current_user_org_id());

      CREATE POLICY %I_delete_own_org
        ON public.%I FOR DELETE
        TO authenticated
        USING (organization_id = public.current_user_org_id());
    $fmt$, t, t, t, t, t, t, t, t);
  END LOOP;
END
$$;

-- Grants — RLS still gates rows, but authenticated needs the table-
-- level permissions to even attempt the query. Service role bypasses
-- RLS entirely so it does not need to be enumerated here.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.operator_chats,
  public.operator_chat_turns,
  public.mcp_api_keys
TO authenticated;
