-- Odesa v1.5 — property workers schema (Phase 4.5 addendum)
-- Authored 2026-04-28 (migrations-eng)
--
-- Adds three new tables (memory_facts, action_proposals, meta_insights)
-- plus column additions to properties and conversations to support the
-- per-property worker, typed memory, and self-improvement loops.
--
-- Conventions inherited from 20260421000000_odesa_initial.sql:
--   - gen_random_uuid() for primary keys
--   - organization_id denormalized on every table for fast RLS
--   - timestamptz for all times; numeric for confidence/percentages
--   - Inline CHECK constraints for fixed-set enums (avoiding new ENUM types
--     here so the v1.5 surfaces stay easy to evolve before they harden)
--
-- RLS policies live in the next migration (20260428000001_property_workers_rls.sql).

-- =========================================================================
-- properties — owner-facing rules + autonomy + privacy mode
-- =========================================================================
--
-- rules_text       : owner's free-form rulebook (4k char limit enforced in UI).
-- autonomy_level   : 0..1 graduated trust; gate decides auto vs review.
-- privacy_mode     : hosted = Anthropic API; on_prem = customer Ollama host.
-- ollama_host      : URL of the customer's Ollama server. Plain text for now;
--                    will be migrated to a pgsodium-encrypted column in a
--                    later migration once Privacy Mode ships to paying tier.

ALTER TABLE public.properties
  ADD COLUMN rules_text     text   NOT NULL DEFAULT '',
  ADD COLUMN autonomy_level numeric(3,2) NOT NULL DEFAULT 0.0
    CHECK (autonomy_level BETWEEN 0 AND 1),
  ADD COLUMN privacy_mode   text   NOT NULL DEFAULT 'hosted'
    CHECK (privacy_mode IN ('hosted', 'on_prem')),
  ADD COLUMN ollama_host    text;

-- =========================================================================
-- conversations — link to property for property-scoped worker context
-- =========================================================================
--
-- A conversation belongs to (at most) one property. Nullable for legacy
-- rows seeded before v1.5 and for conversations that route to org-level
-- (e.g. cold inbound caller whose number doesn't match a unit yet).

ALTER TABLE public.conversations
  ADD COLUMN property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL;

CREATE INDEX idx_conversations_property
  ON public.conversations(property_id, last_message_at DESC);

-- =========================================================================
-- memory_facts — typed knowledge the property worker accumulates
-- =========================================================================
--
-- fact_type values (CHECK below):
--   vendor_relationship — preferences/acceptance trends per vendor
--   tenant_pattern      — payment timing, communication tone, etc
--   building_quirk      — physical/system idiosyncrasies of the property
--   derived_rule        — synthesized rule (Sonnet weekly loop) pending
--                         owner approval before promotion to rules_text
--   owner_rule          — explicit owner-stated rule extracted from
--                         rules_text or owner edits. Added beyond the
--                         original spec because the rulebook IS a derived
--                         collection of owner_stated rules — surfacing
--                         them as facts lets the worker reason over them
--                         alongside observed/derived facts uniformly.
--
-- subject_id is intentionally untyped (uuid only): it points at a vendor,
-- tenant, or unit depending on fact_type. The body in `content` carries
-- the discriminator-specific shape the worker layer encodes.
--
-- superseded_at + superseded_by implement a soft-replace lineage so the
-- compaction job can mark stale facts without losing audit trail.

CREATE TABLE public.memory_facts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id           uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  -- owner_rule is included here (in addition to the four spec-listed types)
  -- because the rulebook is itself a derived collection of owner-stated
  -- rules; making them first-class facts lets the worker reason over them
  -- through the same query path as observed/derived facts.
  fact_type             text NOT NULL CHECK (fact_type IN (
    'vendor_relationship',
    'tenant_pattern',
    'building_quirk',
    'derived_rule',
    'owner_rule'
  )),
  subject_id            uuid,
  content               jsonb NOT NULL,
  confidence            numeric(3,2) NOT NULL DEFAULT 0.5
                        CHECK (confidence BETWEEN 0 AND 1),
  source                text NOT NULL CHECK (source IN (
    'observed', 'owner_stated', 'derived', 'meta_learned'
  )),
  evidence_proposal_ids uuid[],
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  superseded_at         timestamptz,
  superseded_by         uuid REFERENCES public.memory_facts(id) ON DELETE SET NULL
);

CREATE INDEX idx_memory_facts_organization_id ON public.memory_facts(organization_id);
CREATE INDEX idx_memory_facts_property        ON public.memory_facts(property_id);

-- Hot-path index used by getActiveFacts(propertyId, type?) — only active
-- (non-superseded) rows. Partial index is fine here because it is NOT
-- unique and is not used for ON CONFLICT upserts (lesson from
-- 20260423000000_source_aero_indexes_nonpartial.sql applies only to
-- partial UNIQUE indexes).
CREATE INDEX idx_memory_facts_active
  ON public.memory_facts(property_id, fact_type)
  WHERE superseded_at IS NULL;

-- =========================================================================
-- action_proposals — every worker output, before and after gate decision
-- =========================================================================
--
-- worker_model is free-form text (e.g. 'haiku-4-5', 'ollama-llama3.3:70b')
-- so we can swap providers without a migration.
--
-- gate_decision values:
--   auto    — autonomy + confidence cleared the threshold; commit immediately
--   review  — queued for owner review (default for low-trust action classes)
--   block   — refused outright (policy or confidence floor)
--
-- status state machine:
--   proposed  → committed | rejected | edited | expired
--   edited    means the owner changed payload before committing; edit_diff
--             carries the JSON delta for the reflection loop to learn from.
--   expired   is set by a TTL sweeper for stale review-gated proposals.

CREATE TABLE public.action_proposals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id       uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  worker_model      text NOT NULL,
  action_type       text NOT NULL,
  payload           jsonb NOT NULL,
  reasoning         text NOT NULL,
  confidence        numeric(3,2) NOT NULL
                    CHECK (confidence BETWEEN 0 AND 1),
  context_fact_ids  uuid[],
  gate_decision     text NOT NULL CHECK (gate_decision IN ('auto', 'review', 'block')),
  status            text NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed', 'committed', 'rejected', 'edited', 'expired'
  )),
  committed_at      timestamptz,
  rejected_at       timestamptz,
  edit_diff         jsonb,
  outcome           jsonb,
  created_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_action_proposals_organization_id ON public.action_proposals(organization_id);
CREATE INDEX idx_action_proposals_property
  ON public.action_proposals(property_id, created_at DESC);
CREATE INDEX idx_action_proposals_status
  ON public.action_proposals(status)
  WHERE status = 'proposed';

-- =========================================================================
-- meta_insights — cross-property patterns from the monthly Opus loop
-- =========================================================================
--
-- pattern_type is free-form (e.g. 'seasonal_complaint_spike',
-- 'vendor_portfolio_winner', 'payment_segment_drift'). The briefing card
-- groups by this column.

CREATE TABLE public.meta_insights (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pattern_type          text NOT NULL,
  affected_property_ids uuid[],
  insight               text NOT NULL,
  recommended_action    jsonb,
  acknowledged_at       timestamptz,
  acted_on_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_meta_insights_organization_id ON public.meta_insights(organization_id);
CREATE INDEX idx_meta_insights_unack
  ON public.meta_insights(organization_id, created_at DESC)
  WHERE acknowledged_at IS NULL;
