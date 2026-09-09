# Retell SMS Unification Research

- **Date:** 2026-07-09
- **Scope:** Verified Retell SMS provider contract for the calls+texts unification (branch `feat/retell-sms-unification`): webhook families, payload shapes, signature scheme, outbound API, dedup keys, and the explicit list of things Retell's docs do NOT confirm.
- **Status of every claim below:** Verified against `docs.retellai.com` on 2026-07-09 unless flagged in §7 (Known Unknowns / Dashboard Only). Anything in §7 must be treated fail-closed until live-verified.

> **Canonical contract.** Read this before touching `src/lib/messaging/retell.ts` or `src/app/api/messaging/inbound/retell/route.ts`. The voice-side contract lives in `docs/research/retell-grok-production-voice-research-2026-07-07.md` and is unchanged by this work.

---

## 1. Source table

| Doc URL | Claim | Implication for Odesa |
|---|---|---|
| `docs.retellai.com/deploy/enable-sms` | SMS works only on Retell-Twilio numbers or A2P-approved custom-telephony **standard US** numbers. No toll-free, no Telnyx. Two-way SMS requires A2P campaign approval. Retell's pre-approved SMS pool supports **in-call preset templates only**. | Operator number must be a standard US Twilio-backed number with our own A2P campaign. The pooled/preset path is unusable for free-form tenant conversations. |
| `docs.retellai.com/features/inbound-call-webhook` | `inbound_sms_webhook_url` (a phone-number field) fires `event:"chat_inbound"` carrying ONLY `{agent_id, agent_version, from_number, to_number}`. Response may set `override_agent_id`, `dynamic_variables`, `metadata`. POST, 10s timeout, retried up to 3x on non-2xx. | This hook is for **routing/override only** — no message text, no chat_id, no message id. We use it to echo correlation data (from/to/org) back into the chat via `metadata`/`dynamic_variables`. |
| `docs.retellai.com/features/webhook` | Agent-level `webhook_url` + `webhook_events` deliver chat lifecycle events: `chat_started` / `chat_ended` / `chat_analyzed`, envelope `{event, chat}`. Same signature scheme as call webhooks. | Message **content** arrives here, not on `chat_inbound`. There is no per-message realtime webhook for chats — transcripts land at chat end. |
| `docs.retellai.com/api-references/create-sms-chat` | `POST https://api.retellai.com/create-sms-chat` (Bearer auth). Required: `from_number`, `to_number`. Optional: `override_agent_id`, `override_agent_version`, `metadata`, `retell_llm_dynamic_variables`. Returns a chat object (`chat_id`, …). **No custom message-body field.** | The opening outbound message is agent-generated. Exact-body sends require a dedicated "dispatch" agent prompted to send `{{message_body}}` verbatim — see §6 and Known Unknown (e). |
| `docs.retellai.com/api-references/get-chat` | Chat object: `{chat_id, agent_id, chat_status, chat_type: 'sms_chat', transcript, message_with_tool_calls[], metadata, retell_llm_dynamic_variables, start_timestamp, end_timestamp, chat_analysis}`. Messages: `{message_id, role: 'agent'|'user', content, created_timestamp}`. **The chat object has no from_number/to_number fields.** | Numbers must be recovered from the `metadata`/`dynamic_variables` we echoed at `chat_inbound` time. A chat that arrives without that echo is uncorrelatable — skip it, never guess org/tenant. |
| `docs.retellai.com/api-references/update-phone-number` | `PATCH /update-phone-number/{phone}` accepts `inbound_sms_agents[]` / `outbound_sms_agents[]` (`{agent_id, weight, agent_version?}`) and `inbound_sms_webhook_url`. | These are the binding fields `scripts/retell-provision.ts` sets for SMS (gated on SMS env vars so voice-only provisioning keeps working). |

---

## 2. The two webhook families (do not conflate them)

The repo plan originally treated "the SMS webhook" as one thing. It is two:

1. **`chat_inbound`** (phone-number-level `inbound_sms_webhook_url`) — fired when a tenant texts the number, BEFORE any agent replies. Routing/override hook only.
2. **Chat lifecycle events** (agent-level `webhook_url` on the SMS chat agent) — `chat_started` / `chat_ended` / `chat_analyzed`. This is where transcript content lands.

Correlation flow:

```
tenant SMS → chat_inbound {from_number, to_number}          (no text)
           ← 200 {chat_inbound: {metadata: {odesa: {from_number, to_number, organization_id}}, dynamic_variables: {...}}}
agent replies (Retell-side, LLM)
chat ends  → chat_ended/chat_analyzed {event, chat}          (full transcript)
             chat.metadata carries our echo → resolveChatNumbers → routeInbound
```

## 3. Sample payloads

### 3.1 `chat_inbound` request (Retell → Odesa)

```json
{
  "event": "chat_inbound",
  "chat_inbound": {
    "agent_id": "agent_sms_xxxx",
    "agent_version": 3,
    "from_number": "+15551230001",
    "to_number": "+12025550100"
  }
}
```

### 3.2 `chat_inbound` response (Odesa → Retell) — the correlation echo

```json
{
  "chat_inbound": {
    "metadata": {
      "odesa": {
        "from_number": "+15551230001",
        "to_number": "+12025550100",
        "organization_id": "1c2f..."
      }
    },
    "dynamic_variables": {
      "odesa_from_number": "+15551230001",
      "odesa_to_number": "+12025550100",
      "odesa_organization_id": "1c2f..."
    }
  }
}
```

### 3.3 Chat lifecycle event (Retell → Odesa)

```json
{
  "event": "chat_ended",
  "chat": {
    "chat_id": "chat_abc123",
    "agent_id": "agent_sms_xxxx",
    "chat_status": "ended",
    "chat_type": "sms_chat",
    "start_timestamp": 1783000000000,
    "end_timestamp": 1783000180000,
    "transcript": "User: My sink is leaking\nAgent: I'm sorry to hear that...",
    "message_with_tool_calls": [
      {
        "message_id": "msg_001",
        "role": "user",
        "content": "My sink is leaking",
        "created_timestamp": 1783000000000
      },
      {
        "message_id": "msg_002",
        "role": "agent",
        "content": "I'm sorry to hear that. I've logged a maintenance request...",
        "created_timestamp": 1783000015000
      }
    ],
    "metadata": {
      "odesa": {
        "from_number": "+15551230001",
        "to_number": "+12025550100",
        "organization_id": "1c2f..."
      }
    },
    "retell_llm_dynamic_variables": { "odesa_from_number": "+15551230001" },
    "chat_analysis": { "chat_summary": "...", "user_sentiment": "Neutral", "chat_successful": true }
  }
}
```

`chat_analyzed` replays the same `chat` with `chat_analysis` populated — the transcript is **delivered twice** (or once, if `chat_analyzed` is skipped; see §7d). Ingestion must be idempotent per `message_id`.

### 3.4 `create-sms-chat` request/response (Odesa → Retell, approved-draft dispatch)

Request:

```json
POST https://api.retellai.com/create-sms-chat
Authorization: Bearer <RETELL_API_KEY>

{
  "from_number": "+12025550100",
  "to_number": "+15551230001",
  "override_agent_id": "agent_dispatch_xxxx",
  "retell_llm_dynamic_variables": {
    "message_body": "Hi Sam — the plumber is confirmed for Thursday 2-4pm."
  },
  "metadata": {
    "organization_id": "1c2f...",
    "conversation_id": "9a7e...",
    "message_id": "d41f..."
  }
}
```

Response (chat object):

```json
{
  "chat_id": "chat_out_789",
  "agent_id": "agent_dispatch_xxxx",
  "chat_status": "ongoing",
  "chat_type": "sms_chat",
  "metadata": { "organization_id": "1c2f...", "conversation_id": "9a7e...", "message_id": "d41f..." },
  "retell_llm_dynamic_variables": { "message_body": "Hi Sam — the plumber is confirmed for Thursday 2-4pm." },
  "start_timestamp": 1783000300000
}
```

We store `provider_message_id = chat_id` at send time; the dispatch chat's own lifecycle webhook later reconciles the actual agent-sent text onto the draft row (matched via `metadata.message_id`).

---

## 4. Signature scheme (identical to voice — reuse, do not reimplement)

- Header: `x-retell-signature`, format `v={epochMillis},d={hexDigest}`.
- Algorithm: `HMAC-SHA256(key = RETELL_API_KEY, message = rawBody + String(poststamp))`, lowercase hex, 5-minute replay window. This is what `Retell.verify(rawBody, apiKey, signature)` did in SDK ≤ v5.20.0 (helper removed in latest SDK).
- Full verified derivation (SDK source, byte-level): see `docs/research/retell-grok-production-voice-research-2026-07-07.md` §2.
- Odesa implementation: `verifyRetellSignature` (`src/lib/voice/providers/retell-adapter.ts`) wrapped by `verifyRetellWebhookAuth(request, rawBody)` (`src/lib/agent/retell-auth.ts`), with `RETELL_REQUIRE_SIGNATURE` fail-closed policy. **The SMS route reuses these unchanged.** Chat webhooks are signed with the same key/scheme as call webhooks.

## 5. Dedup keys

- Retry behavior: 10s timeout, up to 3 retries on non-2xx, plus the `chat_ended`→`chat_analyzed` transcript replay. Every ingest path must be replay-safe.
- **Inbound (tenant `role:'user'`) messages:** key `(provider='retell', provider_message_id=message_id)` — enforced by the existing partial unique index `uq_messages_inbound_provider_msg (provider, provider_message_id) WHERE direction='inbound'`, with a 23505 catch in the pipeline.
- **Agent (`role:'agent'`) outbound rows:** the unique index is inbound-only, so dedupe via a per-message claim in `inbound_webhook_dedup(provider, provider_message_id)` (text columns; accepts `'retell'`) before insert.
- **Dispatch reconcile:** if `chat.metadata.message_id` matches an approved-draft row, update that row instead of inserting a new outbound row.
- Always return 200 for permanent skips (unknown org, uncorrelatable chat, duplicates, unrecognized events) — non-2xx triggers retry storms.

## 6. Outbound model (honest semantics)

There is **no API to send a custom-body SMS** and no endpoint to push a follow-up message into an existing `sms_chat`. The only outbound primitive is `create-sms-chat`, whose opener is generated by the bound agent's LLM. Odesa's workaround: a dedicated **dispatch agent** whose entire prompt is "send exactly `{{message_body}}`, nothing else." This is LLM-mediated, **not byte-guaranteed** — the approved draft body is the *requested* body; ground truth is the agent's actual outbound message, reconciled onto the draft row when the dispatch chat's webhook arrives. State this honestly everywhere (UI, ops doc, prompts); never claim verbatim delivery.

---

## 6b. Live-verified against the production account (2026-07-09, this repo's API key)

- `GET /list-phone-numbers`: all 4 account numbers are `phone_number_type: "retell-twilio"`, `toll_free: false`, US — SMS-eligible type. Every number has `custom_sms_enabled: false` (the phone object's SMS-capability flag; not listed in the update docs).
- `POST /create-retell-llm` + `POST /create-chat-agent` work as documented. Chat agents return `channel: "chat"`, `is_published: false`, `version: 0`; `webhook_url`/`webhook_events` (`chat_started`/`chat_ended`/`chat_analyzed`) accepted verbatim. Created: `agent_CONFIGURE_FOR_YOUR_ENVIRONMENT` (tenant), `agent_CONFIGURE_FOR_YOUR_ENVIRONMENT` (dispatch).
- **SMS number binding is A2P-gated server-side**: `PATCH /update-phone-number/{num}` carrying `inbound_sms_agents`/`outbound_sms_agents`/`inbound_sms_webhook_url` returns `404 {"status":"error","message":"Item not found in a2p-application with phoneNumber=+1213…"}` when the number has no A2P application. The docs do not mention this precondition. Consequence: provisioning order is KYC → A2P application → THEN bind.
- The phone-number path segment must be URL-encoded (`+` → `%2B`); a raw `+` also 404s.

## 7. Known Unknowns / Dashboard Only

Treat each of these fail-closed until live-verified. None block code-complete; all block a GREEN verdict.

- **(a) `chat_inbound` metadata echo → chat attachment is unverified live for chats.** The response-echo mechanism (`metadata`/`dynamic_variables` returned from the inbound webhook attaching to the session) is documented for **calls** (`call_inbound`); the docs imply symmetry for `chat_inbound` but we have not observed a live chat lifecycle payload carrying our echoed metadata. Verification step: text the staging number, capture the `chat_ended` payload, confirm `chat.metadata.odesa.*` is present. Until then, the route's `uncorrelatable_chat` skip path is the safety net.
- **(b) Exact SMS-message variant shape inside `message_with_tool_calls` is unverified.** §3.3's message shape is inferred from the get-chat schema; SMS chats may include additional variants (tool-call entries, node-transition entries, MMS/media attachments). Parser must tolerate unknown entry shapes without crashing: extract `{message_id, role, content, created_timestamp}` where present, skip entries missing them, and land text even when media metadata is attached (attachment storage is explicitly deferred — do not invent schema).
- **(c) Chat-agent creation API fields are unverified — dashboard-first for V1.** We did not verify a create-chat-agent API contract (prompt fields, webhook_events enum values, SMS-specific settings). V1 creates the SMS chat agent and dispatch agent **in the Retell dashboard**, setting each agent's `webhook_url` to `/api/messaging/inbound/retell` with chat events enabled. Number binding (`inbound_sms_agents` / `outbound_sms_agents` / `inbound_sms_webhook_url`) IS verified and handled by `scripts/retell-provision.ts`.
- **(d) Auto-closed chats may skip `chat_analyzed`.** Community reports indicate inactivity-auto-closed chats sometimes never fire `chat_analyzed`. The route therefore ingests transcripts from **any** lifecycle event that carries messages (`chat_ended` included), relying on per-message idempotency (§5) to make the double-delivery harmless.
- **(e) No custom-body outbound API → the verbatim dispatch-agent workaround is LLM-mediated.** See §6. Paraphrase risk is real and must be surfaced in the ops doc, the dispatch agent's prompt, and the reconcile path — not hidden.
