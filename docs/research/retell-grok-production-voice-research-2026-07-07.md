# Retell + Grok Production Voice Research

- **Date:** 2026-07-07
- **Author:** Phase 0 research (voice operator production hardening)
- **Scope:** Verified Retell webhook / tool / inbound contracts, the exact signature algorithm the adapter must implement, the chosen in-enum model ID, and the honest Retell-now / Grok-as-R&D recommendation.
- **Status of every claim below:** CONFIRMED by verify agents against verbatim SDK source and official docs, or fetched read-only from `docs.retellai.com` on 2026-07-07. Nothing here is a fake "live/ready" claim. Anything not confirmed is flagged UNVERIFIED and must be treated fail-closed (see §8).

> **Canonical contract.** This file is the single source of truth for the Retell adapter work on `feat/authenticated-trust-sprint`. Read it before touching `src/app/api/retell/**`.

---

## 1. Source table

| Provider | Doc / source URL | Accessed | Claim | Implication for Odesa |
|---|---|---|---|---|
| Retell (Python SDK) | `raw.githubusercontent.com/RetellAI/retell-python-sdk/main/src/retell/lib/webhook_auth.py` | 2026-07-07 | Signature = HMAC-SHA256 over `raw_body + str(poststamp)`; header `v={ms},d={hex}`; secret = API key; 5-min replay window; `==` compare | Webhook adapter must sign **body+timestamp** with the **API key**, parse the `v=,d=` header, and enforce the 5-min window. Current code signs body-only → always rejects real Retell traffic. |
| Retell (Node SDK v4.0.0) | `unpkg.com/retell-sdk@4.0.0/lib/webhook_auth.js` | 2026-07-07 | Byte-identical algorithm to Python; `createHmac('sha256',secret).update(input+poststamp).digest('hex')===digest` | Confirms the algorithm cross-language. Reference impl for the Node adapter. |
| Retell (Node SDK v5.43.0, latest) | `registry.npmjs.org/retell-sdk/-/retell-sdk-5.43.0.tgz` | 2026-07-07 | `verify()` helper **removed** in latest; present through v5.20.0 / v4.x | Do NOT depend on `Retell.verify(...)` on latest — implement HMAC manually (we already `import crypto`), or pin `retell-sdk@5.20.0`. |
| Retell docs | `docs.retellai.com/features/secure-webhook` | 2026-07-07 | Header `x-retell-signature`; secret = the API key bearing the "webhook badge"; HMAC-SHA256 hex over raw body + timestamp; recommends constant-time compare | No separate webhook secret exists. `RETELL_WEBHOOK_SECRET` is a fiction; use the API key. |
| Retell docs | `docs.retellai.com/features/webhook-overview` | 2026-07-07 | Envelope `{event, call}`; verify with API key over the **raw** body (not `JSON.stringify(req.body)`); `call_ended` = all call fields except `call_analysis`; `call_analyzed` adds `call_analysis` | Our envelope + `call_analyzed→call_ended` mapping is correct. Must read the raw body for HMAC (we already `request.clone().text()`). |
| Retell docs | `docs.retellai.com/features/inbound-call-webhook` | 2026-07-07 | `call_inbound` request + response `{call_inbound:{dynamic_variables, metadata, override_agent_*}}`; POST; 10s timeout; retried up to 3× | **Dynamic variables must be returned from the `call_inbound` webhook**, not from the `call_started` event response. Current code puts them in the wrong place. |
| Retell docs | `docs.retellai.com/build/single-multi-prompt/custom-function` + `.../conversation-flow/custom-function` | 2026-07-07 | Tool body = `{name, args, call}`; `call.call_id`/`from_number`/`to_number` nested; args-only mode drops wrapper; no top-level tool-call id; `X-Retell-Signature`; 15000-char cap; 2-min timeout; up to 2 retries | Our 12 tool routes expect a **flat** `{call_id, from_number, to_number, args}` with `Authorization: Bearer` — matches neither Retell mode. Needs an adapter + custom auth header + idempotency. |
| Retell docs | `docs.retellai.com/api-references/get-call` | 2026-07-07 | `from_number`/`to_number` only on `V2PhoneCallResponse` (phone_call); `tool_call_id` only inside `transcript_with_tool_calls[]`, available after call ends | Guard for missing numbers on `web_call`. Cannot use `tool_call_id` as a real-time idempotency key. |
| Retell docs | `docs.retellai.com/api-references/create-retell-llm` | 2026-07-07 | `model` enum is a fixed OpenAI/Anthropic/Google list + `null`; **no xAI/Grok** | Pick an in-enum model. Chosen: `gpt-4.1` (see §4). Grok cannot be a Retell `model` value. |
| Retell docs | `docs.retellai.com/integrate-llm/overview` + `/changelog` | 2026-07-07 | BYO LLM only via a **WebSocket** server (`llm_websocket_url` → `response_engine` custom-llm); no OpenAI-compatible base_url override | To run Grok as the brain you must run a WebSocket relay to xAI. There is no "point Retell at api.x.ai" option. |
| xAI docs | `docs.x.ai/docs/overview` + `/docs/models` | 2026-07-07 | Base URL `https://api.x.ai/v1`, OpenAI-SDK compatible; native Grok Voice API (realtime + TTS/STT, ~$0.05/min) | Justifies keeping Grok as R&D behind an abstraction: two viable future paths (custom-LLM bridge, or xAI-native realtime voice). |

---

## 2. The verified webhook SIGNATURE algorithm (this is what the adapter MUST implement)

**Source (verbatim, byte-identical across languages):** `retell-sdk` Node **v4.0.0** `lib/webhook_auth.js` and Python SDK **main** `src/retell/lib/webhook_auth.py`. Present through Node v5.20.0; **removed** in v5.43.0.

**Header:** `x-retell-signature` (case-insensitive), format `v={poststampMillis},d={hexDigest}`, parsed by regex `/v=(\d+),d=(.*)/`.

**Algorithm (exact):**

1. Parse the header. If it does not match `/v=(\d+),d=(.*)/` → reject.
   - `poststamp` = `Number(match[1])` — an **epoch-milliseconds** timestamp taken **from the signature itself**, not the current clock.
   - `postDigest` = `match[2]`.
2. **Replay window:** reject if `Math.abs(Date.now() - poststamp) > 300000` (`FIVE_MINUTES = 5*60*1000` ms).
3. **Signed message = raw request body string CONCATENATED WITH the poststamp, body first:** `input + String(poststamp)`.
4. `expected = HMAC_SHA256(key = RETELL_API_KEY, message = rawBody + String(poststamp))` encoded as **lowercase hex**.
   - The key is the **Retell API key that carries the "webhook badge"** in the dashboard. There is **no separate webhook secret**.
5. Accept iff `expected === postDigest`. **Use a constant-time compare** (`crypto.timingSafeEqual`) — the SDK itself uses plain `===`, which is a minor timing side-channel we should not copy.

**Reference Node source (verbatim):**

```js
const FIVE_MINUTES = 5 * 60 * 1000;
verify(input, secret, signature, opts = {}) {
  const match = /v=(\d+),d=(.*)/.exec(signature);
  if (!match) return false;
  const poststamp = Number(match[1]);
  const postDigest = match[2];
  const timestamp = opts?.timestamp ?? Date.now();
  const timeout = opts?.timeout ?? FIVE_MINUTES;
  if (Math.abs(timestamp - poststamp) > timeout) return false;
  const verifier = getVerifier(secret);          // symmetric HMAC
  return verifier(input + poststamp, postDigest);
}
// symmetric verifier:
(secret) => (input, digest) =>
  createHmac('sha256', secret).update(input).digest('hex') === digest;
// public: verify(body, apiKey, signature) => symmetric.verify(body, apiKey, signature)
```

**Odesa adapter shape (implement, don't call the removed SDK helper):**

```ts
function verifyRetellSignature(rawBody: string, header: string | null, apiKey: string): boolean {
  if (!header) return false;
  const m = /v=(\d+),d=(.*)/.exec(header);
  if (!m) return false;
  const poststamp = Number(m[1]);
  if (Math.abs(Date.now() - poststamp) > 300_000) return false; // 5-min replay window
  const expected = crypto
    .createHmac('sha256', apiKey)
    .update(rawBody + String(poststamp)) // body THEN ms timestamp
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(m[2]);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

- **MUST pass the RAW body string** (`await request.clone().text()`), never `JSON.stringify(parsedBody)` — key ordering/whitespace would differ and every check would fail.
- An asymmetric variant (RSA-PSS + SHA256, base64) exists in the SDK source but the default public `verify()` uses the symmetric HMAC path only. We implement symmetric.

**UNVERIFIED sub-claim (fail-closed):** the signature docs are scoped to call-**event** webhooks. None of the fetched docs state that custom-function / tool-call requests carry `x-retell-signature`, and the custom-functions doc page 404'd. Do **not** assume tool requests are signed the same way. Tool auth is handled separately in §6/§7 via a configured custom header.

---

## 3. Verified payload examples (copied from docs, 2026-07-07)

### 3a. `call_started` (webhook event)
Envelope `{event, call}`. Docs describe it as "basic call information" and give no full sample; the `call` object carries the same base fields as `call_ended` minus the end-of-call data. Minimal verified shape:

```json
{
  "event": "call_started",
  "call": {
    "call_type": "phone_call",
    "call_id": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
    "agent_id": "agent_...",
    "call_status": "ongoing",
    "from_number": "+12137771234",
    "to_number": "+12137771235",
    "direction": "inbound",
    "start_timestamp": 1714608475945
  }
}
```

### 3b. `call_ended` (webhook event — includes transcript)
Per `webhook-overview`: contains **all fields from the Get Call object EXCEPT `call_analysis`** — notably `transcript`, `transcript_object`, `transcript_with_tool_calls`, `end_timestamp`, `disconnection_reason`.

```json
{
  "event": "call_ended",
  "call": {
    "call_type": "phone_call",
    "call_id": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
    "agent_id": "agent_...",
    "call_status": "ended",
    "from_number": "+12137771234",
    "to_number": "+12137771235",
    "direction": "inbound",
    "start_timestamp": 1714608475945,
    "end_timestamp": 1714608491234,
    "disconnection_reason": "user_hangup",
    "transcript": "Agent: Hello...\nUser: ...",
    "transcript_with_tool_calls": [
      { "role": "tool_call_invocation", "tool_call_id": "tool_call_abc123", "name": "get_rent_status", "arguments": "{}" }
    ],
    "retell_llm_dynamic_variables": { "caller_name": "..." }
  }
}
```

### 3c. `call_analyzed` (webhook event — adds `call_analysis`)
Same envelope; the only material difference from `call_ended` is the presence of the `call_analysis` object.

```json
{
  "event": "call_analyzed",
  "call": {
    "call_id": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
    "call_type": "phone_call",
    "from_number": "+12137771234",
    "to_number": "+12137771235",
    "transcript": "Agent: Hello...\nUser: ...",
    "call_analysis": {
      "call_summary": "...",
      "user_sentiment": "Neutral",
      "call_successful": true
    }
  }
}
```

Odesa maps `call_analyzed → call_ended` internally (both mean "the call is over, compile it").

### 3d. Custom-function (tool) request — STANDARD mode (`Payload: args only` OFF)
Exactly three top-level keys `name`, `args`, `call`. Call metadata is **nested under `call`**, not top-level.

```json
{
  "name": "get_rent_status",
  "args": { },
  "call": {
    "call_type": "phone_call",
    "call_id": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
    "agent_id": "agent_...",
    "call_status": "ongoing",
    "from_number": "+12137771234",
    "to_number": "+12137771235",
    "metadata": {},
    "retell_llm_dynamic_variables": { "customer_name": "..." },
    "transcript": "Agent: hello...\nUser: ..."
  }
}
```
- For a **web_call**, `call.from_number` / `call.to_number` are **absent**.
- **Args-only mode** (`Payload: args only` ON) drops the wrapper entirely — the body IS just the arg fields: `{ "some_arg": "value" }`.
- Response must be HTTP 200–299, body coerced to a string, capped at **15000 chars**; timeout is your configured value or **2 minutes**; retried **up to 2 times**.
- **No top-level per-invocation id.** `tool_call_id` only exists inside `call.transcript_with_tool_calls[]` and is populated **after the call ends** — unusable as a real-time idempotency key.

### 3e. Inbound webhook `call_inbound` — request + `dynamic_variables` response
This is the correct channel for injecting privacy-gated dynamic variables. **Verbatim from `docs.retellai.com/features/inbound-call-webhook`:**

Request Retell POSTs:
```json
{
  "event": "call_inbound",
  "event_timestamp": 1780012672105,
  "call_inbound": {
    "agent_id": "agent_12345",
    "agent_version": 1,
    "from_number": "+12137771234",
    "to_number": "+12137771235",
    "custom_sip_headers": {
      "x-my-header": "my-value",
      "user-to-user": "616263;encoding=hex"
    }
  }
}
```

Expected response (2xx) — all fields optional:
```json
{
  "call_inbound": {
    "override_agent_id": "agent_12345",
    "override_agent_version": 1,
    "agent_override": { "agent": {}, "retell_llm": {}, "conversation_flow": {} },
    "dynamic_variables": { "customer_name": "John Doe" },
    "metadata": { "random_id": "12345" }
  }
}
```
- POST; 10-second timeout; retried up to 3 times; verifiable with the Retell API key.
- **Privacy-gated `dynamic_variables` (unknown/ambiguous → `{}`) belong HERE**, inside `call_inbound.dynamic_variables`. The `call_started` event response does NOT set dynamic variables.

---

## 4. Chosen Retell model ID

**`gpt-5.5`** — the current GPT flagship in Retell's `model` enum, confirmed present on two independent fetches of `docs.retellai.com/api-references/create-retell-llm` (2026-07-07). (The initial draft chose `gpt-4.1` as a conservative default; that was needlessly old — `gpt-5.5` is in-enum and current. `claude-5-sonnet` is the equivalent in-enum Anthropic flagship, a one-line swap in `RETELL_MODEL`.) Server-side policy enforcement is model-independent, so this is a call-quality choice, not a safety one.

Full verified enum (do NOT invent a value outside this list):
`gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, gpt-5, gpt-5-mini, gpt-5-nano, gpt-5.1, gpt-5.2, gpt-5.4, gpt-5.4-mini, gpt-5.4-nano, gpt-5.5, claude-4.5-sonnet, claude-4.6-sonnet, claude-5-sonnet, claude-4.5-haiku, gemini-3.0-flash, gemini-3.1-flash-lite, gemini-3.5-flash, null`.

In-enum Anthropic alternative if preferred: **`claude-4.5-sonnet`**. **No xAI/Grok value exists** — Grok cannot be a Retell `model`.

---

## 5. Recommendation: Retell in production now (branch B); Grok as honest R&D

**Ship Retell for production voice now.** It has phone numbers, SIP, a verified webhook/tool contract, and an in-enum brain (`gpt-4.1`). This is branch B: production on Retell, no Grok in the live path.

**Keep Grok strictly as R&D behind an abstraction.** Retell exposes **no** way to use Grok as the agent brain today — it is not in the `model` enum and there is no OpenAI-compatible `base_url` override. Do not make any "Grok is live" claim. Two documented future paths, both behind our own voice-provider abstraction so nothing in the live path assumes Grok:

- **Path 1 — Retell custom-LLM WebSocket bridge to xAI.** Retell BYO-LLM is a WebSocket server registered via `llm_websocket_url` (migrating to `response_engine` type `custom-llm`; `docs.retellai.com/integrate-llm/overview`, `/changelog`). We would run a relay that speaks Retell's WS protocol and internally calls xAI at `https://api.x.ai/v1` (OpenAI-SDK compatible; `docs.x.ai/docs/overview`). Retell keeps telephony/turn-taking; Grok is the brain.
- **Path 2 — xAI-native realtime voice + SIP.** xAI ships a native Grok Voice API (realtime + TTS/STT, ~$0.05/min; `docs.x.ai/docs/models`). This would replace Retell wholesale and require its own SIP/telephony wiring. Larger lift; park until Path 1 is exhausted.

Neither path is wired now. The deterministic policy engine (`src/lib/voice/policy.ts`) and ledger-honest phrasing stay identical regardless of provider, so the brain is swappable without touching the privacy gate.

---

## 6. Contract audit — confirmed mismatches mapped to current code

Backward-compat guardrail: existing `e2e/retell/*.spec.ts` speak a **flat internal** payload `{call_id, from_number, to_number, args}` with bearer auth and **must keep passing**. Every fix below must be **additive** (an adapter in front of the internal shape), not a breaking rewrite.

| # | Confirmed mismatch | Current code (file:line) | Verified requirement | Fix direction |
|---|---|---|---|---|
| M1 | Signature signs **body only** | `src/app/api/retell/webhook/route.ts:92-95` (`createHmac('sha256', webhookSecret).update(bodyText)`) | Message = `rawBody + String(poststamp)` | Concatenate the poststamp parsed from the header before HMAC. |
| M2 | Header compared **raw**, not parsed | `src/app/api/retell/webhook/route.ts:85, 97` (`signature !== expectedSignature`) | Header is `v={ms},d={hex}`; parse via `/v=(\d+),d=(.*)/` and compare only the digest | Parse header; compare `d` to computed hex. Current code can never match. |
| M3 | Wrong secret (`RETELL_WEBHOOK_SECRET`) | `src/app/api/retell/webhook/route.ts:83, 93` | Secret = the **API key** with the webhook badge; no separate webhook secret exists | Sign with `RETELL_API_KEY`. Retire `RETELL_WEBHOOK_SECRET`. |
| M4 | No **5-minute replay window** | `src/app/api/retell/webhook/route.ts` (absent) | Reject if `abs(now_ms - poststamp) > 300000` | Add the window check before HMAC compare. |
| M5 | **Non-constant-time** compare | `src/app/api/retell/webhook/route.ts:97` (`!==`) | Docs recommend constant-time compare | Use `crypto.timingSafeEqual`. |
| M6 | Dynamic variables built in the **`call_started` response** | `src/app/api/retell/webhook/route.ts:150-154` (`retell_llm_dynamic_variables` in the `call_started` JSON response) | Retell reads `dynamic_variables` only from the **`call_inbound`** webhook response `{call_inbound:{dynamic_variables}}` | Add a `call_inbound` handler that returns the privacy-gated vars there. `call_started` response vars are ignored by Retell. |
| M7 | Tool body expected **flat** | `src/app/api/retell/tools/*/route.ts` schema, e.g. `get_rent_status/route.ts:14-18` (top-level `from_number`/`to_number`/`call_id`) | Standard Retell tool body nests them under `call` and wraps args under `args`, with top-level `name`; matches neither Retell mode | Add an adapter that reads `call.from_number` etc. (or configure args-only + pass numbers as args). Keep the flat internal shape for e2e. |
| M8 | Tool auth requires `Authorization: Bearer` | `src/lib/agent/retell-auth.ts:18-28`; each tool `route.ts:21-22` (`verifyRetellAuth`) | Retell sends **`X-Retell-Signature`** (or configured **custom** headers), **not** `Authorization: Bearer` by default | Configure a static custom header `Authorization: Bearer <RETELL_API_KEY>` per tool in the dashboard (keeps existing check), or verify `X-Retell-Signature`. |
| M9 | **No cross-retry idempotency** on tools | `src/app/api/retell/tools/*/route.ts` (absent) | Up to 2 retries; **no** body tool-call id; `tool_call_id` only in post-call transcript | Derive a dedup key from `call_id + serialized args`; make write tools (`create_work_order`, `send_sms_followup`, `schedule_callback`, `confirm_emergency`, `create_followup_sms_draft`) idempotent. Read tools (`get_rent_status` etc.) are naturally safe. |
| M10 | `from_number`/`to_number` assumed always present | tool schemas require them (`get_rent_status/route.ts:16-17`) | Present only for `call.call_type=="phone_call"`; absent on `web_call` | Guard for absence when a web_call reaches a tool. Low priority if inbound is phone-only. |

Correctly aligned already (no change): the event enum `{call_started, call_ended, call_analyzed}` (`webhook/route.ts:56`) and the `call_analyzed → call_ended` mapping (`webhook/route.ts:68-79`) match Retell; reading the raw body via `request.clone().text()` (`webhook/route.ts:91`) is the correct HMAC input.

---

## 7. Retell dashboard / env setup (manual — DESCRIBE ONLY, do not perform)

Perform these by hand in the Retell dashboard once the adapter is merged. No API calls are made from this task.

1. **API key + webhook badge.** In dashboard → API Keys, use (or enable) the key that carries the **webhook badge**. Set it as `RETELL_API_KEY`. This same key is the HMAC secret for webhook verification — do **not** create a separate `RETELL_WEBHOOK_SECRET`.
2. **Call-event webhook URL.** Agent/global webhook → `https://<prod-host>/api/retell/webhook`. This receives `call_started`, `call_ended`, `call_analyzed`, signed with `x-retell-signature`.
3. **Inbound (per-number) webhook URL.** For each purchased phone number → inbound webhook → `https://<prod-host>/api/retell/inbound` (the implemented handler per M6 — `src/app/api/retell/inbound/route.ts`; matches the `inbound_webhook_url` emitted by `retell-config.ts`). This returns the privacy-gated `dynamic_variables`. 10s timeout — keep the caller resolution fast.
4. **Tool (custom-function) URLs.** For each of the 12 tools, set the function URL to `https://<prod-host>/api/retell/tools/<tool_name>`. Method POST. Leave `Payload: args only` **OFF** (standard mode) so the adapter can read `call.from_number`/`call.to_number`; or turn it ON and pass the numbers as explicit args — pick one and match the adapter.
5. **Custom auth header on every tool.** Add a static custom header `Authorization: Bearer <RETELL_API_KEY>` so the existing `verifyRetellAuth` check keeps working (Retell does not send this by default). Optionally also verify `X-Retell-Signature`. Optional IP allowlist: `100.20.5.228`.
6. **Model.** Agent's Retell-LLM `model` = **`gpt-4.1`** (§4). Do not select any Grok/xAI option — none exists.
7. **Agent + phone number.** Create/point the agent, attach the phone number, and record the resulting `agent_id` and the E.164 number. The number's `to_number` must match `organizations.odesa_phone_number` so `resolveCallContext` routes it (`retell-auth.ts:58-64`). An unrouted number returns 404 by design.

Env vars to set in prod (Vercel): `RETELL_API_KEY` (webhook-badged key). Remove reliance on `RETELL_WEBHOOK_SECRET`.

---

## 8. Evidence discipline

- Every claim above is CONFIRMED against verbatim SDK source or official docs (fetched 2026-07-07), except where explicitly flagged.
- **UNVERIFIED (treat fail-closed):** whether custom-function/tool requests carry `x-retell-signature`. The signature docs are scoped to call-event webhooks and the custom-functions doc page 404'd. Do **not** guard tool endpoints on a signature header that may not be present — that would either break tool calls or silently leave them unauthenticated. Authenticate tools via the configured custom `Authorization` header (§7.5) instead.
- Verify-agent `unverified_flags`: **[]** (none). No additional unverified items were surfaced by the verify pass; the only fail-closed item is the tool-signature caveat above, which the note carries explicitly.
- Fail-closed defaults remain: bad signature/auth → 401, bad body → 400, unrouted org → 404, internal error → 500 (let Retell retry). Never a fake 200. Unknown/ambiguous callers → empty `dynamic_variables`. Rent/payment language stays ledger-honest.

---

## 9. Retell WRITE API (provisioning) — verified

The read-only §1–§8 contract configures the dashboard by hand. This section adds
the **write** side: the exact bodies `scripts/retell-provision.ts` POSTs/PATCHes
(pure mapper `configToRetellPayloads`, applied only under `--commit`). Shapes
verified against the Retell API reference (accessed 2026-07-08); citations below.

### 9a. `POST https://api.retellai.com/create-retell-llm`

Auth: `Authorization: Bearer <RETELL_API_KEY>`, `Content-Type: application/json`.
Only `model` is strictly required; we send the drift-checked config.

```jsonc
{
  "model": "gpt-4.1",                 // the single in-enum id (§4); never invent another
  "general_prompt": "…buildVoiceAgentPrompt(settings)…",
  "general_tools": [                  // one per mapped tool (VOICE_ACTION_TOOL_MAP)
    {
      "type": "custom",              // the HTTP-tool type identifier
      "name": "get_rent_status",
      "description": "…",
      "url": "https://<tunnel>/api/retell/tools/get_rent_status",
      "method": "POST",
      "headers": { "Authorization": "Bearer <RETELL_API_KEY>" },  // OBJECT<string,string>, NOT an array
      "parameters": { "type": "object", "properties": {}, "required": [], "additionalProperties": false },
      "timeout_ms": 120000           // 1000–600000
    }
    // …remaining mapped tools…
  ]
}
// Response 201 echoes the request plus llm_id, version, is_published, …
// Read back: GET /get-retell-llm/{llm_id}
```

CRITICAL SHAPE CORRECTION vs the internal `retell-config.ts`: that module models
tool headers as `{ name, value }[]`; the real API wants a plain
`object<string,string>`. `configToRetellPayloads` performs that array→object
conversion. `parameters` is JSON-Schema (only honored for POST/PUT/PATCH bodies).

### 9b. `POST https://api.retellai.com/create-agent`

REQUIRED: `response_engine` + `voice_id`. The model lives on the LLM (9a), not
here. `webhook_url`/`webhook_events` carry the call-event webhook.

```jsonc
{
  "response_engine": { "type": "retell-llm", "llm_id": "llm_xxx" },  // llm_id from 9a's response
  "voice_id": "<RETELL_VOICE_ID>",
  "webhook_url": "https://<tunnel>/api/retell/webhook",
  "webhook_events": ["call_started", "call_ended", "call_analyzed"]
}
// Response echoes agent_id, response_engine, voice_id, webhook_url, webhook_events, …
// Read back: GET /get-agent/{agent_id}
```

### 9c. `PATCH https://api.retellai.com/update-phone-number/{phone_number}`

Rebinds the purchased E.164 number's inbound agent + inbound webhook. Verified against `docs.retellai.com/api-references/update-phone-number` and `/get-phone-number` (accessed 2026-07-08): the inbound agent binding is **`inbound_agents`, a weighted ARRAY of `AgentWeight` `{agent_id, agent_version?, weight}`** — NOT a flat `inbound_agent_id`. Body:

```jsonc
{
  "inbound_agents": [
    { "agent_id": "agent_xxx", "weight": 1 }                   // agent_id from 9b
  ],
  "inbound_webhook_url": "https://<tunnel>/api/retell/inbound"  // privacy-gated dynamic_variables (§ M6)
}
// Read back: GET /get-phone-number/{phone_number} → { inbound_agents: [{agent_id, agent_version, weight}], inbound_webhook_url, … }
```

### 9d. Provisioner modes & hygiene

`--dry-run` (DEFAULT) builds + prints all three bodies with the Authorization
header redacted to `<redacted>` and sends nothing. `snapshot` GETs the current
phone binding + agent into `.retell-sandbox-snapshot.json`. `--commit` runs
9a→9b→9c, updating the snapshot after each write (llm_id, agent_id, prior+new
inbound webhook, tunnel, timestamp, `phone_rebound`). `verify` GET-reads back and
asserts the tool set/urls, model, webhook_url, `response_engine.llm_id`, and the
phone binding match. The `RETELL_API_KEY` / Authorization value is never printed;
phone numbers print last-4 only. Refuses (exit 1) if `RETELL_VOICE_ID` is unset.

### 9e. Citations (accessed 2026-07-08)

- `https://docs.retellai.com/api-references/create-retell-llm`
- `https://docs.retellai.com/api-references/get-retell-llm`
- `https://docs.retellai.com/api-references/create-agent`
- `https://docs.retellai.com/api-references/get-agent`
- `https://docs.retellai.com/api-references/update-agent`
- `https://docs.retellai.com/build/conversation-flow/custom-function`

**UNVERIFIED (fail-closed):** field ordering is illustrative only; the full
`model` enum beyond `gpt-4.1` was not exhaustively enumerated; the custom-tool
`enable_typing_sound` flag appears in the create-llm schema but is undocumented.
None affect the three bodies above, which use only verified fields.
