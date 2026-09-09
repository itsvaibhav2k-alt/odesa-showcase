# Retell + Grok Production Voice Backend Plan

> For Fable, not Claude. Vaibhav explicitly does not want Hermes/Claude to execute this. This is a research + implementation handoff for Fable to investigate current Retell/xAI docs, then implement against the real Odesa repo.

Goal: Make Odesa’s actual production voice backend work end-to-end with Retell telephony and a Grok/xAI-backed voice agent, while preserving Odesa’s deterministic safety engine, privacy gates, owner-review boundaries, and no-fake-data posture.

Architecture: Keep Retell as the managed telephony/call orchestration provider for V1. Treat Grok/xAI as the model/voice intelligence layer only if Retell supports using it directly or through a custom LLM/webhook path; otherwise build the Odesa backend so Retell can use the existing prompt + HTTP tools safely now, and create a provider abstraction for a future Grok realtime POC. Odesa backend remains the source of truth for routing, caller resolution, tool permissions, action logging, outcomes, owner queue, and transcripts.

Tech stack: Next.js 16 App Router, TypeScript, Supabase service-role backend routes, Retell API/webhooks/tools, xAI/Grok API research, Vitest, Playwright, Sentry.

Hard instruction: Do not use Claude for this work. Do not commit, push, deploy, buy numbers, start live outbound calling, or contact real tenants/vendors/owners without explicit approval.

---

## Current repo state Fable should assume

The Calls/Voice Operator UI and local backend simulation are already in place and verified locally. Relevant paths:

- Retell webhook: `src/app/api/retell/webhook/route.ts`
- Retell auth/helper utilities: `src/lib/agent/retell-auth.ts`
- Agent prompt builder: `src/lib/voice/agent-prompt.ts`
- Tool permission map: `src/lib/voice/tool-map.ts`
- Deterministic policy/planning engine: `src/lib/voice/policy.ts`, `src/lib/voice/plan.ts`, `src/lib/voice/call-state.ts`, `src/lib/voice/outcomes.ts`, `src/lib/voice/types.ts`
- Call persistence: `src/lib/voice/session-store.ts`
- Caller resolution: `src/lib/voice/resolve-caller.ts`
- Dashboard settings/actions: `src/app/(dashboard)/calls/actions.ts`, `src/lib/voice/settings.ts`
- Local dashboard test-call endpoint: `src/app/api/retell/test-call/route.ts`
- Retell tool endpoints:
  - `src/app/api/retell/tools/report_intents/route.ts`
  - `src/app/api/retell/tools/lookup_tenant_by_phone/route.ts`
  - `src/app/api/retell/tools/get_rent_status/route.ts`
  - `src/app/api/retell/tools/get_lease_details/route.ts`
  - `src/app/api/retell/tools/create_work_order/route.ts`
  - `src/app/api/retell/tools/confirm_emergency/route.ts`
  - `src/app/api/retell/tools/escalate_to_landlord/route.ts`
  - `src/app/api/retell/tools/schedule_callback/route.ts`
  - `src/app/api/retell/tools/send_sms_followup/route.ts`
  - `src/app/api/retell/tools/create_followup_sms_draft/route.ts`
  - `src/app/api/retell/tools/get_owner_briefing/route.ts`
  - `src/app/api/retell/tools/get_vendor_jobs/route.ts`
- Voice DB migrations:
  - `supabase/migrations/20260705120000_voice_calls.sql`
  - `supabase/migrations/20260706004500_service_role_grants.sql`
  - `supabase/migrations/20260707120000_voice_settings.sql`
- Existing e2e:
  - `e2e/retell/calls-page.spec.ts`
  - `e2e/retell/voice-operator.spec.ts`
  - `e2e/retell/tool-endpoints.spec.ts`
- Screenshot harness: `scripts/calls-ia-screenshots.mjs`

Existing safety model:

- The model/voice agent proposes. Odesa disposes.
- `report_intents` is the policy brain. It receives intents/facts, updates the call session, returns `next_question`, `missing_facts`, `allowed_tools`, `blocked_or_draft`, and `honesty_hints`.
- The prompt tells the agent to call `report_intents` before acting on new topics and only call tools returned in `allowed_tools`.
- Tool routes enforce scoping and policy again server-side.
- Risky SMS becomes an owner-review draft instead of a send.
- `call_started` creates/updates the `voice_calls` row and returns Retell dynamic variables gated by caller kind.
- `call_analyzed` currently adapts to internal `call_ended` and compiles the final `outcome` artifact.

---

## Non-negotiable product/safety constraints

1. Retell/Grok must not bypass Odesa policy.
   - The agent must never decide independently whether it may create work orders, send SMS, escalate, disclose rent/lease data, schedule callbacks, or promise action.
   - Odesa server-side routes remain the enforcement layer.

2. Unknown/ambiguous callers receive zero private data.
   - No tenant names, balances, unit labels, owner/property facts, or indirect confirmations.

3. Payment/rent language must remain ledger-honest.
   - Never say a payment cleared/posted/was received or give a payment date unless the DB has actual payment movement evidence.

4. Retell production must fail closed.
   - Bad webhook signatures/auth: 401.
   - Bad body: 400.
   - No routed org: 404.
   - Internal failures: 500, allowing provider retry.
   - Never swallow provider failures with fake 200s.

5. No fake live audio, fake live sync, fake phone readiness, fake dashboard success.
   - If Retell only provides dashboard monitoring or post-call transcript, say that.
   - If xAI cannot be used inside Retell today, build abstraction/POC but do not pretend production uses it.

6. No real-world side effects during development without explicit approval.
   - No live outbound calls to tenants/owners/vendors.
   - No SMS to real numbers.
   - No paid vendor dispatch.
   - No deployment or public webhook reconfiguration without approval.

---

## Deliverable definition

Fable should deliver a backend that can prove one of these outcomes, in priority order:

A. Preferred V1 production path:
- Retell phone agent is configured with Odesa’s versioned prompt.
- Retell calls Odesa’s tool endpoints with correct auth and payload shape.
- Retell call lifecycle webhooks create/update/finalize `voice_calls` rows.
- A real Retell test call to an approved safe number flows through Odesa, executes only safe allowed actions, persists transcript/outcome, and shows in `/calls`.
- Grok/xAI is either correctly wired as the LLM behind Retell if Retell supports it, or explicitly deferred with documented proof.

B. If Retell cannot use Grok directly today:
- Retell production path still works using Retell’s supported model/provider setup.
- A provider abstraction + Grok research note exists, with a minimal no-side-effect xAI realtime/text/tool-calling POC only if feasible.
- The UI copy/readiness honestly says what is production-wired vs R&D.

C. If external provider access blocks execution:
- No code pretending it works.
- A precise blocker report with docs links, required credentials/settings, exact dashboard steps, payload examples, and next approval needed.

---

## Phase 0 — Research first, no code changes

Objective: Build a current, citation-backed map of Retell + xAI/Grok capabilities before touching code.

Fable must inspect current docs and record source URLs/dates for:

1. Retell agent/model configuration
   - Can Retell use a custom LLM endpoint?
   - Can Retell call OpenAI-compatible providers or xAI/Grok directly?
   - What model/provider settings are configurable from dashboard/API?
   - How are tools/functions defined? What schema format does Retell require?
   - How are dynamic variables provided to the agent on call start?

2. Retell phone/call lifecycle
   - Inbound phone number setup.
   - Outbound phone call setup.
   - Call webhooks/events and exact event names/payloads.
   - `call_started`, `call_ended`, `call_analyzed`, transcript/recording payload timing.
   - Retry behavior and expected response semantics.

3. Retell auth/security
   - Exact webhook signature algorithm/header format.
   - Tool endpoint auth options/headers.
   - Dashboard/API secrets and where they are configured.

4. Retell live call controls
   - Whether live context injection/update live call is available.
   - Whether transcript streaming/live events are available or only post-call analysis.
   - Whether embedded live audio monitoring is available. If not, do not fake it.

5. xAI/Grok voice/model path
   - Current Grok realtime/voice API endpoints.
   - Whether xAI exposes tool/function calling in the realtime voice path.
   - Whether browser/server ephemeral tokens are required.
   - Whether xAI is OpenAI-compatible enough for Retell custom LLM, if Retell supports it.
   - Latency, telephony examples, and production constraints.

Output file to create:
- `docs/research/retell-grok-production-voice-research-2026-07-07.md`

Required content:
- Source table: provider, doc URL, accessed date, claim, implication for Odesa.
- Clear recommendation: “Retell + Grok direct now” vs “Retell production now, Grok behind abstraction later”.
- Exact config fields/dashboard steps needed.
- Payload examples for Retell webhooks/tools from docs.

Verification:
- No repo code changed in Phase 0 except the research note.
- No credentials printed.
- No live calls made.

---

## Phase 1 — Audit current Odesa backend contracts against real Retell payloads

Objective: Identify exact mismatches between Odesa’s current assumptions and Retell’s real payload/auth/tool schema.

Files to inspect:
- `src/app/api/retell/webhook/route.ts`
- `src/lib/agent/retell-auth.ts`
- `src/app/api/retell/tools/*/route.ts`
- `src/lib/voice/agent-prompt.ts`
- Existing Retell e2e files under `e2e/retell/`

Tasks:

1. Compare webhook event schema.
   - Current schema accepts `event: call_started | call_ended | call_analyzed` and `call: { call_id, direction?, from_number, to_number, transcript?, call_analysis? }`.
   - Verify Retell’s actual event names and field names.
   - Check whether transcript is at `call.transcript`, nested under analysis, or retrieved separately.
   - Check whether `from_number` / `to_number` are always present and E.164.

2. Compare webhook signature.
   - Current code uses `x-retell-signature` as raw hex HMAC-SHA256 of body with `RETELL_WEBHOOK_SECRET`.
   - Verify if Retell actually uses this algorithm/header or a timestamped signature format.
   - If different, plan exact replacement and tests.

3. Compare tool/function calling payload shape.
   - Current tools expect body shape like:
     `{ call_id, from_number, to_number, args: { ... } }`
   - Verify Retell sends tool args under `args`, `arguments`, `tool_call`, or another shape.
   - Verify whether Retell passes call id and phone numbers to every tool automatically or via dynamic variables.

4. Compare tool auth.
   - Current tools require `Authorization: Bearer ${RETELL_API_KEY}`.
   - Verify whether Retell supports custom Authorization header for tool webhooks, static secret header, or only URL/token patterns.

5. Identify configuration gaps.
   - Environment variables needed locally and in Vercel.
   - Dashboard fields not represented in UI.
   - Retell agent ID / phone number / webhook URL / tool URLs / secrets.

Output:
- Add a “Contract audit” section to the research note.
- Create implementation checklist with exact code changes.

Verification:
- If mismatch found, add failing tests before implementation in Phase 2.
- Do not change production route behavior yet without tests.

---

## Phase 2 — Normalize Retell webhook/tool adapters with tests

Objective: Make Odesa robust to real Retell payloads while preserving the internal stable `VoiceWebhookEvent` and tool schemas.

Recommended architecture:
- Keep internal schemas pure and stable in `src/lib/voice/types.ts`.
- Add provider adapter helpers instead of spreading Retell quirks across routes.

Potential files:
- Create: `src/lib/voice/providers/retell-adapter.ts`
- Test: `src/lib/voice/providers/__tests__/retell-adapter.test.ts`
- Modify: `src/app/api/retell/webhook/route.ts`
- Modify: each `src/app/api/retell/tools/*/route.ts` only if real tool payload shape differs.

Tasks:

1. Create adapter module.
   - Functions:
     - `parseRetellWebhookPayload(raw): VoiceWebhookEvent`
     - `extractRetellCallId(raw): string`
     - `extractRetellTranscript(raw): string | undefined`
     - `normalizeRetellToolRequest(raw): { call_id, from_number, to_number, args }`
   - Keep it narrow and doc-backed. Do not guess fields.

2. Add fixture tests from real Retell docs/examples.
   - `call_started` fixture.
   - `call_analyzed` / ended fixture with transcript.
   - Duplicate delivery fixture.
   - Missing numbers fixture should fail with 400 or adapt only if doc says fields may be absent.

3. Replace inline webhook `externalEventSchema/adapt()` with adapter.
   - Preserve response statuses.
   - Preserve `call_analyzed -> call_ended` behavior if still correct.

4. Normalize tool request shape only if required by Retell.
   - Do not break existing e2e simulation shape.
   - Prefer accepting both existing internal shape and Retell external shape.

5. Add auth/signature tests.
   - Valid signature passes.
   - Missing signature fails when `RETELL_WEBHOOK_SECRET` is set.
   - Invalid signature fails.
   - Local bearer fallback works only when no webhook secret is set.

Verification commands:
- `npm run test -- src/lib/voice/providers src/lib/voice/__tests__ --run`
- `npm run test -- e2e/retell --run` if these are Vitest-compatible; otherwise use Playwright command below.
- `BASE_URL=http://localhost:3100 npx playwright test e2e/retell/tool-endpoints.spec.ts --project=chromium`

Expected:
- Adapter unit tests pass.
- Existing Retell e2e still passes.
- No policy regression.

---

## Phase 3 — Create a real Retell configuration export/sync artifact

Objective: Give operators an exact, copy-pasteable or API-createable Retell agent config derived from code, so the dashboard does not drift from Odesa’s safety prompt and tools.

Important: Do not silently auto-sync live Retell production settings in V1 unless Vaibhav approves. Produce a config artifact and optional dry-run validator first.

Potential files:
- Create: `src/lib/voice/providers/retell-config.ts`
- Create: `scripts/retell-export-config.mjs` or `scripts/retell-validate-config.mjs`
- Test: `src/lib/voice/providers/__tests__/retell-config.test.ts`
- Modify: `/calls/settings` UI only if exposing copy/export buttons.

Config must include:
- Agent prompt from `buildVoiceAgentPrompt(settings)`.
- Disclosure opening lines.
- Dynamic variables expected from `call_started`.
- Tool definitions for all actual HTTP tools.
- Tool descriptions that match Odesa policy.
- JSON schemas for each tool’s `args`.
- Required auth header or secret config.
- Webhook URL.
- Tool URLs.

Tool URLs should be environment-aware:
- Local: ngrok/cloudflared URL during manual testing.
- Preview/prod: Vercel deployment URL.

Tasks:

1. Define a typed `RetellToolDefinition` structure matching docs.
2. Export all tool definitions from a single module.
3. Add test that every non-null tool in `VOICE_ACTION_TOOL_MAP` has a Retell tool definition.
4. Add test that every Retell tool definition maps to an existing route file.
5. Add test that prompt contains all tool names and safety phrases.
6. Add script that prints config JSON and redacts secrets.
7. Optional: add dashboard button to copy effective prompt/config, clearly labeled “manual Retell setup”.

Verification:
- `npm run test -- src/lib/voice/providers/__tests__/retell-config.test.ts src/lib/voice/__tests__/agent-prompt.test.ts src/lib/voice/__tests__/build-prompt.test.ts --run`
- Manually inspect generated JSON; no secrets printed.

---

## Phase 4 — Environment/readiness hardening

Objective: Make it obvious whether production Retell is actually ready, and prevent false green states.

Potential files:
- Modify: `src/lib/env.ts`
- Create: `src/lib/voice/readiness.ts`
- Test: `src/lib/voice/__tests__/readiness.test.ts`
- Modify UI: `src/components/calls/voice-readiness-strip.tsx`, `src/components/calls/voice-settings-page-body.tsx`, maybe `src/app/(dashboard)/calls/settings/page.tsx`

Required env/readiness checks:
- `RETELL_API_KEY` present for tool bearer auth or alternate Retell tool secret present.
- `RETELL_WEBHOOK_SECRET` present in production if docs require HMAC.
- Public app URL configured for Retell callbacks.
- Supabase service-role key present server-side.
- Odesa phone number configured on organization (`organizations.odesa_phone_number`).
- Retell agent ID configured if needed.
- Retell phone number ID configured if needed.
- Grok/xAI API key/config present only if Grok path is actually wired.

Tasks:

1. Add pure readiness helper.
   - Return typed statuses, not booleans.
   - Example statuses: `ready`, `missing_secret`, `needs_dashboard_config`, `manual_sync_required`, `research_deferred`.

2. Add tests for local/simulated/prod environments.

3. Update UI copy.
   - “Simulated locally” when only local test-call path is ready.
   - “Retell webhook configured” only when required env + URLs exist.
   - “Grok model research deferred” if not wired.
   - Never say “live” just because local tests pass.

4. Ensure `src/lib/env.ts` does not force production-only variables during local dev unless appropriate.

Verification:
- `npm run test -- src/lib/voice/__tests__/readiness.test.ts --run`
- Browser smoke `/calls/settings` shows honest readiness.

---

## Phase 5 — Retell sandbox integration, no real tenants

Objective: Prove Retell can hit Odesa endpoints from outside the local machine using approved sandbox/test numbers only.

Preconditions requiring Vaibhav approval:
- Which Retell account/workspace to use.
- Safe test phone number(s) to call.
- Whether to expose local server via ngrok/cloudflared or deploy preview.
- Whether any paid Retell minutes/calls are acceptable.

Setup options:

Option A — Vercel preview:
- Deploy preview with env vars configured.
- Configure Retell webhook/tools to preview URL.
- Safer for stable HTTPS.

Option B — local tunnel:
- Run local Next server.
- Expose with ngrok/cloudflared.
- Configure Retell to tunnel URL.
- More fragile but faster iteration.

Sandbox test matrix:

1. Inbound verified tenant maintenance call.
   - Caller: approved test number mapped to Galaxy seed/test tenant only.
   - Expected: `call_started` row active, `report_intents` allows `create_work_order` after required facts, work order created, safe SMS either simulated/drafted depending messaging config, `call_analyzed` finalizes outcome.

2. Payment dispute call.
   - Expected: no accusation, rent ledger wording only, risky SMS becomes draft/owner queue, no payment promise.

3. Unknown caller.
   - Expected: no private data in dynamic variables or tool responses, owner review/privacy-safe outcome.

4. Emergency screening.
   - Expected: asks danger/water/gas/electrical screening; escalates owner; does not promise dispatch/vendor.

5. Owner briefing.
   - Expected: only verified owner can receive portfolio summary.

Evidence to collect:
- Retell call IDs.
- Odesa `voice_calls.retell_call_id` rows.
- Screenshots of `/calls`, call dossier, owner queue if applicable.
- Server logs for webhook/tool requests with secrets redacted.
- Retell dashboard transcript/recording screenshots if permitted.

Verification commands:
- Query Supabase rows with service role locally/preview-safe script, redacting private phone numbers.
- `BASE_URL=<preview-or-local> npx playwright test e2e/retell/calls-page.spec.ts --project=chromium` if test env points to sandbox DB.

Stop condition:
- Stop after approved sandbox numbers. Do not expand to real tenants.

---

## Phase 6 — Grok/xAI integration decision and POC

Objective: Decide whether Grok can be part of the production Retell stack now, and if not, create a bounded provider abstraction without destabilizing Retell.

Decision branch A — Retell can use Grok directly/custom LLM:

Tasks:
1. Configure Retell agent/model to use Grok/xAI according to docs.
2. Confirm tool calling still works and tool payloads are unchanged or adapted.
3. Run the Phase 5 sandbox test matrix.
4. Measure latency and transcript quality.
5. Document exact Retell/Grok config.

Acceptance:
- Retell calls Odesa tools correctly.
- Odesa policy gates are obeyed.
- Call quality is acceptable.
- No tool bypass or prompt drift.

Decision branch B — Retell cannot use Grok directly:

Tasks:
1. Keep Retell production path with supported provider/model.
2. Create provider interface only if useful:
   - `src/lib/voice/providers/types.ts`
   - `RetellVoiceProvider` for telephony config/status.
   - Future `XaiRealtimeProvider` behind feature flag.
3. Optional no-side-effect xAI POC script:
   - Text/realtime connection only.
   - No tenant data.
   - No live phone call.
   - No tool side effects; mock tools only.
4. Document why Grok is R&D, not production voice telephony yet.

Acceptance:
- Product copy says Retell production, Grok R&D/deferred.
- No fake Grok “live” claim.
- Future integration seam is clear.

---

## Phase 7 — Observability, audit logs, and operator safety

Objective: Make production voice failures diagnosable and interventions auditable.

Potential files:
- Existing routes under `src/app/api/retell/`
- Create: `src/lib/voice/audit.ts`
- Possibly add migration for `voice_provider_events` if current `voice_calls.session` is insufficient.

Tasks:

1. Add structured logs for provider events.
   - event type
   - retell call id
   - organization id when resolved
   - status code
   - elapsed ms
   - redacted phone numbers
   - no secrets

2. Ensure Sentry spans/errors exist for:
   - webhook auth failure
   - adapter parse failure
   - caller resolution failure
   - tool policy block/draft
   - finalize outcome failure

3. Add idempotency tests.
   - Duplicate `call_started` does not reset session.
   - Duplicate `call_analyzed` after completion returns duplicate/safe response.
   - Tool call before webhook bootstraps only where designed.

4. If adding live call update/context injection later, audit every injected operator note.

Verification:
- Unit tests for duplicate delivery.
- Manual logs from sandbox calls have enough info to debug without leaking private data.

---

## Phase 8 — Final production readiness review

Objective: Decide whether to enable the real Retell phone line for a controlled pilot.

Required evidence before greenlighting:

1. Research note complete with citations.
2. Contract adapter tests pass against doc fixtures.
3. Tool definitions/config export exists and matches code.
4. Readiness UI is honest.
5. Retell sandbox call matrix completed on approved test numbers.
6. No external action beyond approved sandbox calls.
7. Screenshots of `/calls`, `/calls/settings`, `/calls/scripts`, `/calls/test`, and at least one real Retell-sourced dossier.
8. Exact gate output included.
9. Known limitations documented.
10. Rollback/disable path documented.

Suggested gates:

```bash
npm run typecheck
npm run lint
npm run test -- src/lib/voice src/lib/agent src/lib/messaging --run
BASE_URL=http://localhost:3100 npx playwright test e2e/retell/calls-page.spec.ts e2e/retell/tool-endpoints.spec.ts --project=chromium
```

If using a preview deployment, replace `BASE_URL` with the preview URL and clearly label it.

Do not approve production pilot if:
- webhook signature is unverified/unknown;
- Retell tool payload shape is guessed rather than tested;
- unknown callers can receive private dynamic variables;
- risky SMS can send without owner review;
- payment/rent prompt or tool response claims payment receipt/date without evidence;
- Grok status is misrepresented;
- live call monitoring is faked;
- no rollback path exists.

---

## Fable execution style

Fable should work in this order:

1. Research current Retell/xAI docs.
2. Write the research note.
3. Audit code against docs.
4. Add failing tests for any mismatch.
5. Implement the smallest adapter/config/readiness changes.
6. Run local tests.
7. Ask for explicit approval before any external Retell call or dashboard change.
8. Run sandbox calls only to approved numbers.
9. Return final report with evidence, not claims.

Final report format:

- What docs were checked, with URLs/dates.
- Retell/Grok recommendation.
- Files changed.
- Exact config needed in Retell dashboard.
- Exact env vars needed, secret values redacted.
- Sandbox call IDs and outcomes, if approved/run.
- Gate commands and exact results.
- Screenshots/artifacts paths.
- Known limitations.
- What still requires Vaibhav approval.

---

## Compact `/goal` prompt for Fable

```text
/goal Read and execute the plan at /Users/vaibhav/odesa/docs/plans/2026-07-07-retell-grok-production-backend-plan.md.

This is for Fable research + execution, not Claude. First research the current Retell and xAI/Grok docs with citations. Do not assume payloads, auth, signatures, or Grok compatibility. Then audit Odesa’s existing voice backend against the docs and implement only the minimal tested changes needed to make the real Retell backend work safely.

Hard rules: Retell/Grok must never bypass Odesa’s deterministic policy engine. Unknown callers get zero private data. Rent/payment language stays ledger-honest. No fake live audio/readiness. No commit/push/deploy. No real tenant/vendor/owner contact. No live external Retell calls or dashboard changes until Vaibhav explicitly approves the safe sandbox number/account/tunnel/deploy target.

Key files: src/app/api/retell/webhook/route.ts, src/lib/agent/retell-auth.ts, src/lib/voice/agent-prompt.ts, src/lib/voice/tool-map.ts, src/lib/voice/session-store.ts, src/lib/voice/policy.ts, src/lib/voice/plan.ts, src/app/api/retell/tools/*/route.ts, e2e/retell/*.spec.ts.

Deliver: research note, contract audit, tests for any Retell payload/auth mismatch, config/export/readiness changes if needed, exact Retell dashboard/env setup, and evidence-backed final report with commands/results/screenshots. If Grok cannot be production-wired through Retell today, say so and keep Retell production + Grok R&D behind an honest abstraction.
```