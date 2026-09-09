# Retell SMS Operator Number — V1 Ops Guide

- **Date:** 2026-07-09
- **Scope:** How to stand up "one Odesa operator number for calls and texts" on the Retell backbone: setup checklist, failure modes, and the tenant-facing SMS agent safety prompt.
- **Contract reference:** `docs/research/retell-sms-unification-research-2026-07-09.md` (read it before changing webhook or outbound code).

---

## 1. V1 decision

- **Retell is the backbone for both calls and texts.** The voice agent already runs on the Retell number; SMS unifies onto the same number via Retell SMS chat agents.
- **Green-bubble SMS is accepted.** Sendblue / Linq / BlueBubbles (iMessage) are **deferred**, not deleted — their code paths and the legacy pool remain but are marked legacy for V1. Owner/operator flows stay on the legacy Sendblue number for V1.
- **SMS model: agent answers, Odesa ingests.** The Retell SMS chat agent replies to tenants directly (voice parity); Odesa ingests full transcripts into `conversations`/`messages` for inbox visibility. No auto-draft is generated for Retell-ingested tenant messages.
- **Sensitive follow-ups stay approval-gated.** The SMS agent never commits on sensitive topics; it creates owner-review drafts via `create_followup_sms_draft`. Approved drafts go out through a dedicated Retell **dispatch agent**.

## 2. Setup checklist

Publication copy: agent/LLM IDs are placeholders, not deployable configuration. Obtain your own IDs from Retell and supply `RETELL_SMS_AGENT_ID` / `RETELL_SMS_DISPATCH_AGENT_ID` through the environment. Use your own HTTPS webhook origin; no operator tunnel or account routing IDs are published here.

Work through these in order; each step gates the next.

1. **Retell KYC** — complete account verification in the Retell dashboard. Required before number purchase and A2P.
2. **Number** — purchase or import a **standard US, Twilio-backed** number with SMS capability. Not toll-free. Not Telnyx-backed. (This is the operator number tenants call AND text.)
3. **A2P campaign** — register and get the A2P 10DLC campaign **approved** for this number. Two-way free-form SMS does not work without it. Retell's pre-approved pool is in-call preset templates only — unusable for Odesa.
4. **Voice agent binding** — unchanged from the voice setup; verify the existing voice agent is still bound after any number changes.
5. **SMS chat agent** — DONE 2026-07-09, API-created (`POST /create-chat-agent` verified live): `agent_CONFIGURE_FOR_YOUR_ENVIRONMENT` (`odesa-sms-tenant`, LLM `llm_CONFIGURE_FOR_YOUR_ENVIRONMENT`).
   - Prompt: tenant persona + the safety prompt in §4 (acknowledge + "the owner will review").
   - Tools: **none for V1** — deliberate deviation. `create_followup_sms_draft`'s route requires the from/to numbers Retell attaches to *voice* tool calls; chat tool-call context is unverified, so an attached tool would 4xx mid-chat. Wire tools after live-verifying the chat tool payload (follow-up).
   - `webhook_url` → tunnel `/api/messaging/inbound/retell`, chat events enabled. Note: created `is_published: false`, matching the working voice binding convention (version 0).
6. **Dispatch agent** — DONE 2026-07-09, API-created: `agent_CONFIGURE_FOR_YOUR_ENVIRONMENT` (`odesa-sms-dispatch`, LLM `llm_CONFIGURE_FOR_YOUR_ENVIRONMENT`).
   - Prompt: "Send exactly `{{message_body}}` as your first and only message. Do not add greetings, sign-offs, or any other text. Do not continue the conversation."
   - Same `webhook_url` as above (its lifecycle webhook is how Odesa reconciles what was actually sent).
7. **Number binding** — **A2P-GATED (live-verified 2026-07-09)**: `PATCH /update-phone-number` with any SMS field returns `404 "Item not found in a2p-application with phoneNumber=…"` until an A2P application exists for the number. After A2P: run `scripts/retell-provision.ts` with the SMS env vars set (`RETELL_SMS_AGENT_ID`, `RETELL_SMS_DISPATCH_AGENT_ID`) to PATCH `inbound_sms_agents`, `outbound_sms_agents`, and `inbound_sms_webhook_url` → `/api/messaging/inbound/retell`. Dry-run first. The phone object's `custom_sms_enabled` flag (currently `false` on all account numbers) reports SMS capability.
8. **Test numbers** — verify end-to-end on each environment before flipping anything:
   - Local: tunnel + test tenant number; confirm `chat_inbound` echo appears in the `chat_ended` payload (Known Unknown (a) in the research note).
   - Staging: full loop — tenant text → agent reply → transcript in inbox → sensitive topic → draft appears → approve → dispatch send → reconcile.
   - Prod: same loop with the real operator number, then run `scripts/retell-preflight.ts` (SMS gates included).
9. **Flip** — set org `messaging_primary = 'retell'` **only after A2P approval and the staging loop passes**. Galaxy stays on `linq` until then. Set `RETELL_SMS_A2P_APPROVED=1` so readiness reports honestly.

## 3. Failure modes

| Failure | Symptom | Handling |
|---|---|---|
| A2P unapproved | Outbound/two-way SMS silently blocked or carrier-filtered | Don't flip `messaging_primary`; readiness strip shows "A2P status unknown" until `RETELL_SMS_A2P_APPROVED` is set |
| Toll-free number | SMS unsupported on Retell | Replace with standard US number; nothing to configure around |
| Telnyx-backed number | SMS unsupported on Retell | Must be Twilio-backed (Retell-Twilio or A2P-passed custom Twilio) |
| Signature mismatch | 401s on `/api/messaging/inbound/retell` | Same key/scheme as voice (`x-retell-signature`, HMAC over rawBody+poststamp, API key). Check the API key has the webhook badge and the right env key is deployed. Auth is fail-closed (`RETELL_REQUIRE_SIGNATURE`) — never weaken it to "fix" this |
| Duplicate retries / transcript replay | Same transcript arrives via `chat_ended` AND `chat_analyzed`, plus up-to-3x retries | Idempotent by design: inbound unique index on `(provider, provider_message_id)`, agent rows via `inbound_webhook_dedup` claims. Duplicates return 200. If dupes appear in the inbox, the dedup path regressed — fix that, don't 500 |
| Auto-closed chat skips `chat_analyzed` | Transcript never arrives if only `chat_analyzed` is handled | Route ingests from any lifecycle event carrying messages, including `chat_ended` |
| Uncorrelatable chat | Lifecycle payload lacks our echoed `metadata.odesa.*` numbers | 200 `{skipped:'uncorrelatable_chat'}` + log; never guess org/tenant. If frequent, the `chat_inbound` echo isn't attaching (Known Unknown (a)) — verify live |
| Outbound API errors | `create-sms-chat` non-2xx, or missing API key / dispatch agent id | Clean failed-send result; approve route reverts draft to `pending_review` (502). No fallback provider exists for retell — no silent Twilio/Linq retry |
| **Dispatch-agent paraphrasing** | Agent-sent text differs from the approved draft body | Known, accepted V1 risk: sends are LLM-mediated, not byte-guaranteed. The draft stores the *requested* body; the dispatch chat's webhook reconciles the *actual* sent text onto the row. Keep the dispatch prompt minimal (§2.6); spot-check reconciled rows after launch |

## 4. Tenant-facing SMS agent safety prompt (template)

The Retell SMS agent replies without owner review, so its prompt must enforce the approval gate. Append this to the base tenant persona (mirrors the voice additive-prompt pattern):

```
SAFETY RULES (non-negotiable):
- You must NOT make commitments or give answers about: legal matters, fees or
  fee waivers, payment plans or rent adjustments, dispatching vendors or
  scheduling repairs on a specific date, or any private information about
  other tenants, the owner, or the property's finances.
- When a tenant asks about any of those topics: acknowledge the request, use
  the create_followup_sms_draft tool to write a proposed reply for the owner,
  and tell the tenant: "The owner will review this and follow up with you."
- Never promise timelines you cannot verify. Never share phone numbers,
  emails, or account details of anyone else.
- For emergencies (fire, flood, gas, no heat in winter), tell the tenant to
  call 911 if life-threatening, and escalate immediately.
- Stay on the tenant's actual question. Do not speculate.
```

The dispatch agent's prompt is separate and minimal (§2.6) — it must never inherit these tools or the persona.

## 5. Product promise

Once A2P is approved and the staging loop passes: **"one Odesa operator number for calls and texts."** Tenants call or text the same number; the voice agent answers calls, the SMS agent answers texts, everything lands in the same Odesa console, and anything sensitive waits for the owner's approval. Until A2P approval, do not market SMS on the operator number — the readiness strip and this checklist are the source of truth.
