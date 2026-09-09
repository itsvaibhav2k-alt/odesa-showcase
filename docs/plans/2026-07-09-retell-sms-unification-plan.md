# Retell SMS Unification Implementation Plan

> **For Claude:** Execute this plan task-by-task. Preserve the existing Odesa Retell voice work, do not add Sendblue/Linq/BlueBubbles, and do not fake provider behavior. Use Retell as the call + green-bubble SMS backbone for now.

**Goal:** Make Odesa’s production messaging direction Retell-first: one Retell standard US number per organization can handle inbound/outbound voice plus two-way SMS, with Odesa storing SMS messages/drafts in the existing conversations/messages/inbox system.

**Architecture:** Keep the existing `conversations`/`messages` tables and the existing voice provider (`provider='retell'`) but add a proper Retell SMS adapter + inbound route. Retell inbound SMS should normalize into the same `InboundMessage` pipeline used by Twilio/Linq today. Outbound tenant follow-up drafts should remain owner-review-safe by default; approved Retell SMS sends should call Retell’s `/create-sms-chat` or chat APIs only from a small provider module. UI copy should stop implying iMessage/blue bubbles and present Retell SMS as the stable default.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase, Retell REST/webhooks, Vitest, Playwright.

---

## Current repo facts to preserve

- Repo: `/Users/vaibhav/odesa`.
- Existing migrations already support:
  - `conversation_channel`: `voice`, `sms`, `imessage`
  - `message_provider`: `linq`, `twilio`, `retell`
  - `inbound_webhook_dedup(provider, provider_message_id)`
- Existing Retell voice routes:
  - `src/app/api/retell/webhook/route.ts`
  - `src/app/api/retell/inbound/route.ts`
  - `src/app/api/retell/tools/*`
- Existing generic messaging inbound routes:
  - `src/app/api/messaging/inbound/twilio/route.ts`
  - `src/app/api/messaging/inbound/linq/route.ts`
- Existing inbound pipeline:
  - `src/lib/messaging/handle-inbound.ts`
  - `src/lib/messaging/handle-operator-inbound.ts`
  - `src/lib/messaging/route-inbound.ts`
- Existing voice SMS draft tool:
  - `src/app/api/retell/tools/create_followup_sms_draft/route.ts`
  - It intentionally creates drafts and does not send for sensitive follow-ups.
- Existing `organizations.odesa_phone_number` is the lookup key for routed numbers.
- Existing schema has `organizations.messaging_primary messaging_provider_choice DEFAULT 'linq'`. Do not blindly flip historical data; add an explicit migration/default update only if tests confirm no type mismatch and app semantics are clear.

## Retell product facts to verify before coding

Retell docs checked on 2026-07-09 indicate:

- Retell supports two-way SMS conversations once SMS capability is enabled for a number.
- SMS capability is for Retell Twilio numbers and custom telephony numbers that passed A2P; Telnyx SMS is not supported yet.
- Current SMS capability is limited to standard US numbers, not toll-free numbers.
- A2P approval is required for two-way SMS on the organization’s own number.
- Retell’s SMS-approved pool bypasses A2P only for in-call preset-template SMS; it cannot customize text and does not support two-way conversations. Do not use that as the main Odesa SMS path.
- Retell Create Outbound SMS endpoint: `POST https://api.retellai.com/create-sms-chat`; body includes `from_number`, `to_number`, optional `override_agent_id`, `override_agent_version`, `metadata`, `retell_llm_dynamic_variables`; `from_number` must be a Retell-purchased/imported number with SMS capability.
- Phone number update API exposes `inbound_sms_agents`, `outbound_sms_agents`, and `inbound_sms_webhook_url`.

Before implementation, re-open current Retell docs and confirm payload shape for inbound SMS webhooks. Treat this as a hypothesis until verified.

---

## Acceptance criteria

1. Odesa has a Retell SMS inbound webhook route that:
   - authenticates with the same Retell webhook auth policy as voice where applicable,
   - handles Retell dashboard verification/empty pings if Retell sends them,
   - normalizes inbound SMS into the existing `InboundMessage` shape,
   - routes to operator vs tenant exactly like Twilio/Linq inbound,
   - dedupes provider retries,
   - returns 200 for duplicate and unknown permanent routing cases where provider retries would be harmful.

2. Retell inbound SMS creates/updates normal Odesa inbox artifacts:
   - `conversations.channel = 'sms'`
   - `messages.provider = 'retell'`
   - message body, provider message id, sender/receiver preserved.

3. Retell outbound SMS is explicit and safe:
   - draft creation remains separate from send,
   - owner-approved draft sending supports Retell as a provider only after tests,
   - no live SMS is sent in tests unless an explicit env flag is set.

4. Retell provisioning docs/scripts know how to bind SMS:
   - inbound voice agent
   - outbound voice agent if used
   - inbound SMS chat agent
   - outbound SMS chat agent
   - `inbound_sms_webhook_url`
   - A2P/readiness requirements surfaced honestly.

5. UI/copy no longer sells blue bubbles for V1:
   - say “SMS” / “text message” / “green-bubble fallback accepted”
   - no Sendblue, Linq, iMessage, or BlueBubbles dependency in V1 readiness copy.

6. Verification gates pass:
   - focused Vitest for Retell SMS adapter/route
   - existing messaging inbound tests still pass
   - existing Retell voice tests still pass
   - typecheck passes
   - one browser/inbox smoke if UI copy changes.

---

## Non-goals / forbidden scope

- Do not implement Sendblue.
- Do not implement Linq as the primary provider.
- Do not implement BlueBubbles.
- Do not promise iMessage/blue bubbles.
- Do not auto-send sensitive tenant SMS from Retell voice calls.
- Do not send real SMS during tests unless the user explicitly opts into a live-provider test.
- Do not weaken Retell webhook signature/auth checks.
- Do not remove existing Twilio/Linq routes; they may remain as legacy/fallback code unless separately cleaned up.

---

## Task 1: Re-verify Retell SMS docs and capture exact provider contract

**Objective:** Confirm current Retell inbound/outbound SMS payloads before writing code.

**Files:**
- Create: `docs/research/retell-sms-unification-research-2026-07-09.md`

**Steps:**
1. Read current Retell docs for:
   - Send & receive SMS
   - Create Outbound SMS / create-sms-chat
   - Update Phone Number
   - inbound SMS webhook docs
   - chat webhook / chat events if inbound SMS uses chat events rather than a dedicated SMS payload.
2. Capture exact facts with links:
   - inbound SMS webhook request shape
   - signature/auth behavior
   - event names
   - message id field to use for dedup
   - from/to fields
   - text/media field shapes
   - whether inbound SMS webhook can override chat agent/dynamic variables
   - outbound send endpoint and response ids
   - whether follow-up messages to an existing SMS chat need a separate endpoint.
3. Add a “Known Unknowns / Dashboard Only” section if docs omit anything.

**Verification:** The research note must include exact endpoint names and sample JSON payloads, or explicitly say the docs do not expose them.

---

## Task 2: Add a pure Retell SMS provider adapter

**Objective:** Keep Retell wire-format parsing out of route handlers.

**Files:**
- Create: `src/lib/messaging/retell.ts`
- Create: `src/lib/messaging/__tests__/retell.test.ts`

**Implementation requirements:**
- Export a `RetellSmsProvider` or equivalent helper with:
  - `verifyInbound(...)` if Retell SMS uses the same signed webhook convention, or delegate to `verifyRetellWebhookAuth` in the route if raw-body auth must happen there.
  - `normaliseRetellSmsInbound(body): InboundMessage | null`
  - `buildRetellOutboundSmsRequest(...)` or `sendRetellSms(...)` only if needed by later tasks.
- Normalize provider to `retell`.
- Normalize channel to `sms`.
- Preserve provider message id for dedup.
- Preserve media URLs/metadata if Retell supplies MMS, but do not invent a schema if Odesa currently only stores text. If attachment storage needs new schema, document it as deferred rather than hacking it into `body`.

**Test cases:**
- Valid inbound SMS payload -> `InboundMessage`.
- Missing from/to/text -> null or validation error, matching existing provider style.
- Duplicate provider message id field is stable.
- MMS/media payload does not crash; text still lands if present.
- Unknown/unhandled Retell chat event returns ignored/verification result if applicable.

**Commands:**
- `npm run test -- src/lib/messaging/__tests__/retell.test.ts`

---

## Task 3: Add Retell SMS inbound route

**Objective:** Receive SMS from Retell and land it through the existing Odesa messaging pipeline.

**Files:**
- Create: `src/app/api/messaging/inbound/retell/route.ts`
- Create or update tests for the route, following Twilio/Linq patterns.

**Route behavior:**
1. Read raw body once.
2. Authenticate using the verified Retell SMS webhook signature scheme. Prefer sharing `verifyRetellWebhookAuth(request, rawBody)` if Retell uses the same `x-retell-signature` HMAC over rawBody+poststamp. If Retell SMS uses a different signature, add a separate documented verifier and tests.
3. Handle dashboard verification pings safely if Retell sends empty `{}`/`[]` pings.
4. Parse JSON, normalize via `normaliseRetellSmsInbound`.
5. Use `createAdminClient()` and `routeInbound(admin, msg)`.
6. If `unknown_org`, 200 with `{success:true,data:{skipped:'unknown_org'}}` so Retell does not retry a permanent setup error forever.
7. If operator, call `handleOperatorInbound(msg, route.user)`.
8. Else call `handleInbound(msg)`.
9. Return duplicate responses consistent with Twilio/Linq.

**Acceptance tests:**
- Bad auth -> 401.
- Bad JSON -> 400.
- Missing fields -> 400.
- Unknown org -> 200 skipped.
- Valid tenant inbound -> calls `handleInbound` or produces DB row in integration-style test.
- Duplicate provider id -> 200 duplicate, no second draft.

**Commands:**
- `npm run test -- src/lib/messaging/__tests__/retell.test.ts`
- Run any existing route tests near `messaging/inbound`.

---

## Task 4: Wire Retell outbound SMS for approved drafts only

**Objective:** Let approved Odesa drafts send through Retell without bypassing owner review.

**Files to inspect first:**
- `src/app/api/messaging/drafts/[id]/approve/route.ts`
- `src/lib/messaging/create-draft.ts`
- provider send modules under `src/lib/messaging/*`
- tests around draft approve/send.

**Implementation requirements:**
- Add a Retell outbound provider module only where the existing approve flow chooses a provider.
- Use organization routing to choose `from_number` from `organizations.odesa_phone_number` or a new explicit field only if already present.
- Do not send from an SMS-approved Retell pool because Odesa needs custom two-way SMS.
- Use `POST /create-sms-chat` only when starting a new outbound SMS chat. If Retell requires a different endpoint for existing chat replies, use the verified docs from Task 1.
- Include metadata linking back to Odesa:
  - `organization_id`
  - `tenant_id`
  - `conversation_id`
  - `message_id`
- Store returned Retell chat/message id as `provider_message_id` where appropriate.
- Never call live Retell in unit tests; mock fetch/client.

**Test cases:**
- Approved draft with provider Retell calls mocked Retell endpoint with correct `from_number`, `to_number`, metadata.
- Missing Retell API key -> clear 500/failed-send response, no message marked sent.
- Retell API error -> draft remains reviewable/retryable; no false sent state.
- Sensitive voice follow-up remains draft-only until approve route is hit.

---

## Task 5: Update Retell provisioning/readiness scripts and docs

**Objective:** Make setup obvious and prevent false “SMS ready” claims.

**Files:**
- Modify: `scripts/retell-provision.ts`
- Modify: `scripts/retell-preflight.ts`
- Modify: `src/lib/voice/providers/retell-config.ts` if readiness config lives there.
- Update tests:
  - `scripts/retell-provision.test.ts`
  - `src/lib/voice/providers/__tests__/retell-config.test.ts`

**Implementation requirements:**
- Add config fields/env examples for:
  - Retell voice agent id
  - Retell chat/SMS agent id
  - Retell phone number
  - inbound call webhook URL
  - inbound SMS webhook URL: `/api/messaging/inbound/retell`
- Provision/update phone number with `inbound_sms_agents`, `outbound_sms_agents`, `inbound_sms_webhook_url` only after verifying exact API fields from docs.
- Readiness should say one of:
  - `SMS not configured`
  - `SMS webhook configured, A2P status unknown`
  - `SMS ready: Retell/Twilio standard US number with A2P approved`
- Do not claim readiness merely because env vars exist.

---

## Task 6: Update product copy/UI from “blue bubbles” to Retell green-bubble SMS

**Objective:** Align the app with the product decision: ship reliable Retell texting now; iMessage is deferred.

**Files to search/modify:**
- Search for `Sendblue`, `Linq`, `iMessage`, `blue bubble`, `BlueBubbles`, `SMS`, `text` across `src/`, `docs/`, and `scripts/`.
- Likely UI areas:
  - `/calls` readiness/setup panels
  - inbox provider labels
  - billing/pricing copy (`src/lib/stripe/plans.ts` already says “Voice agent (Odesa) + SMS”)
  - voice operator setup copy.

**Copy direction:**
- Good: “Calls and texts land in the same Odesa operator console.”
- Good: “SMS follow-ups are green-bubble text messages for V1.”
- Good: “iMessage/blue bubbles are deferred; Retell SMS is the stable default.”
- Bad: “blue bubbles included”
- Bad: “iMessage-ready”
- Bad: “Sendblue required”

**Verification:** If UI changed, run a browser smoke on the affected route and attach/capture screenshot evidence in the final report.

---

## Task 7: Add docs for the final operator-number model

**Objective:** Leave a clear product/ops note for future implementation waves.

**Files:**
- Create: `docs/retell-sms-operator-number.md`

**Content requirements:**
- V1 decision:
  - Retell is the telephony/SMS backbone.
  - Green bubbles are accepted.
  - Sendblue/Linq/BlueBubbles deferred.
- Setup checklist:
  - Retell KYC
  - standard US Retell/Twilio-backed number
  - A2P campaign
  - voice agent binding
  - SMS chat agent binding
  - inbound SMS webhook URL
  - local/staging/prod test numbers
- Failure modes:
  - A2P not approved
  - number is toll-free
  - Telnyx-backed number
  - webhook signature mismatch
  - duplicate retry
  - Retell API error on outbound
- Product promise:
  - “one Odesa operator number for calls and texts” once Retell SMS is approved.

---

## Final verification commands

Run from `/Users/vaibhav/odesa`:

```bash
npm run test -- src/lib/messaging/__tests__/retell.test.ts
npm run test -- src/lib/voice/providers/__tests__/retell-adapter.test.ts src/lib/agent/__tests__/retell-tool-idempotency.test.ts
npm run typecheck
npm run lint
```

If route/UI tests exist or are added:

```bash
npm run test:e2e -- e2e/retell/retell-adapter.spec.ts
# plus any new messaging/retell inbound e2e spec
```

If UI copy changed, run the app and browser-smoke the relevant pages before reporting done.

---

## Final report format for Claude

Return:

1. Retell docs verified: links + exact inbound/outbound SMS contract summary.
2. Files changed.
3. Tests run with exact command output.
4. Whether live SMS was avoided or explicitly tested.
5. Setup steps remaining in Retell dashboard, especially A2P approval.
6. Blunt status:
   - `GREEN`: Retell SMS code path ready, no live credentials tested.
   - `YELLOW`: code path ready but blocked by Retell dashboard/A2P/API ambiguity.
   - `RED`: cannot safely implement because provider contract is missing or contradictory.

---

## Compact Claude `/goal` prompt

```text
/goal Implement the Retell SMS unification plan at @/Users/vaibhav/odesa/docs/plans/2026-07-09-retell-sms-unification-plan.md.

Context: We decided NOT to use Sendblue/Linq/BlueBubbles for V1. Odesa should accept green-bubble SMS and unify calls + texts through Retell where possible. Retell voice already exists; preserve it. Add Retell SMS inbound/outbound integration safely through the existing conversations/messages/drafts pipeline.

Hard rules: verify current Retell SMS docs before coding provider assumptions; do not send real SMS in tests; do not promise iMessage/blue bubbles; do not weaken webhook auth; keep sensitive follow-ups draft/approval-gated; preserve existing Twilio/Linq legacy routes unless explicitly replacing a call site.

Run focused tests, typecheck, lint, and browser-smoke any UI copy you change. Return exact commands/output, files changed, remaining Retell dashboard/A2P setup, and a GREEN/YELLOW/RED verdict.
```
