-- Odesa v1.5 — add routing column to action_proposals
-- Authored 2026-04-28 (migrations-eng, request from gate-eng)
--
-- Worker-core-eng landed `ProposalRouting` as a sibling field on
-- ActionProposal at commit 9a74fec. The privacy-mode reasoning: routing
-- IDs (tenantId, conversationId, workOrderId, vendorId, weeklyReportId)
-- are ambient orchestrator context that should never round-trip through
-- the model output payload — particularly important in Ollama on-prem
-- mode where the model boundary doubles as a data-egress boundary.
--
-- This migration only adds the column; existing org_id-scoped RLS on
-- action_proposals already covers it. No new index — routing fields
-- are read alongside the row at commit/dispatch time, never filtered on.

ALTER TABLE public.action_proposals
  ADD COLUMN routing jsonb;

COMMENT ON COLUMN public.action_proposals.routing IS
  'Ambient orchestrator routing context (tenantId, conversationId, '
  'workOrderId, vendorId, weeklyReportId). Never seen by the worker '
  'model — populated by the call site at recordProposal() time. '
  'Null for action_types that do not need routing (classify_intent, '
  'confirm_emergency, update_rulebook).';
