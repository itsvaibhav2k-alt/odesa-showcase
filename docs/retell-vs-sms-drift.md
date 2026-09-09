# Retell Voice vs SMS Agent — Capability Drift (v1 baseline, 2026-05-17)

## Architecture summary

SMS operator uses `WORKER_HANDLERS` (`src/lib/agent/worker/handlers/index.ts`), an in-process
registry of 16 action handlers driven by Claude via MCP tools. Retell voice uses 8 standalone
HTTP route handlers under `src/app/api/retell/tools/**` that are called directly by the Retell
platform mid-call. The two systems share no code.

This document lists what the SMS agent can do that voice cannot (post-launch backlog), and
confirms which high-value tenant intents are covered by the 8 existing voice tools.

---

## The 8 Retell voice tools (v1 baseline)

| Tool | File | What it does |
|------|------|-------------|
| `lookup_tenant_by_phone` | `…/lookup_tenant_by_phone/route.ts` | Resolves caller's phone to tenant + active lease + unit context |
| `create_work_order` | `…/create_work_order/route.ts` | Creates a work order (maintenance request) with category + urgency |
| `get_lease_details` | `…/get_lease_details/route.ts` | Returns rent amount, due day, start/end dates, late-fee policy |
| `get_rent_status` | `…/get_rent_status/route.ts` | Returns balance due, last payment, current payment status |
| `schedule_callback` | `…/schedule_callback/route.ts` | Logs a callback request with preferred time + topic into `conversations` |
| `escalate_to_landlord` | `…/escalate_to_landlord/route.ts` | Marks conversation escalated + fires SMS alert to landlord |
| `confirm_emergency` | `…/confirm_emergency/route.ts` | Lexical + AI emergency detection with 800ms latency budget + fallback |
| `send_sms_followup` | `…/send_sms_followup/route.ts` | Sends an SMS to the tenant mid/post-call via `notifyTenant` |

Auth: all 8 verify `Authorization: Bearer $RETELL_API_KEY`. Context resolution is via
`resolveCallContext` which maps `to_number` → organization and `from_number` → tenant.

---

## Tenant intent coverage matrix

| Tenant intent | Voice tool | Covered? |
|---------------|-----------|---------|
| Maintenance request | `create_work_order` | YES |
| Callback request | `schedule_callback` | YES |
| Lease question | `get_lease_details` | YES |
| Payment info / rent status | `get_rent_status` | YES |
| Emergency | `confirm_emergency` + `escalate_to_landlord` | YES |
| Escalate to landlord | `escalate_to_landlord` | YES |
| SMS follow-up during/after call | `send_sms_followup` | YES |
| Identify caller (sign-off / context) | `lookup_tenant_by_phone` | YES |
| Vendor coordination | — | **NOT covered** (post-launch) |
| Status check on existing work order | — | **NOT covered** (post-launch) |
| Lease renewal inquiry | — | **NOT covered** (post-launch) |
| Payment link request | — | **NOT covered** (post-launch — SMS has `request_rent_payment` |

---

## SMS capabilities NOT in voice (post-launch backlog)

These are `WORKER_HANDLERS` actions available on SMS that have no voice analogue:

| SMS capability | Handler | Post-launch voice equivalent |
|---------------|---------|------------------------------|
| Send rent payment link (Stripe) | `request_rent_payment` | Add `request_rent_payment` Retell tool |
| Draft + send tenant messages | `send_tenant_message` | `send_sms_followup` covers simple sends; multi-step drafts not available |
| Log maintenance ticket (richer) | `log_maintenance_ticket` | `create_work_order` covers basics; category/vendor assignment missing |
| Work order status lookup | _(no dedicated handler — via context MCP)_ | Add `get_work_order_status` Retell tool |
| Vendor dispatch / coordination | `spawn_property_worker` → vendor handlers | Not available in voice |
| Lease mutations (set terms, archive) | `set_lease_terms`, `archive_lease` | Not available in voice (voice is read-only for lease data) |
| Tenant preference capture | `update_tenant_preference` | Not available in voice |
| Portfolio writes (units, tenants) | `create_property`, `add_unit`, `add_tenant` | Not relevant to tenant-facing voice |
| Scheduled conditional actions | `schedule_action` MCP | Not available in voice |
| Memory (recall/record facts) | `recall_facts`, `record_fact` MCPs | Not available in voice |
| Calendar integration | `schedule_calendar_event` | Not available in voice |

---

## Voice-enabled org routing

Voice is effectively enabled for an organization when `organizations.odesa_phone_number` is set
(non-null). All 8 Retell tools call `resolveCallContext`, which uses `odesa_phone_number` as the
routing key. No separate `voice_enabled` boolean column exists — presence of the phone number
acts as the flag.

**Implication:** any org with a seeded `odesa_phone_number` is voice-capable on v1. No migration
needed to flip a toggle. T2a's UI work in `phone-card.tsx` is the operator-facing surface for
managing this field.

---

## Launch blockers from this audit

None. All 8 tenant intents considered high-value for v1 launch are covered. The uncovered intents
(vendor coordination, work-order status check, rent payment link, lease renewal) are post-launch
backlog items — tenants can be directed to SMS for those flows during the call.
