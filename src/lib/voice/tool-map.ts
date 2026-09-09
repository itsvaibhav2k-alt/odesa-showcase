/**
 * VoiceActionId → Retell tool-name map — shared by report_intents and the
 * webhook so "which tools may the agent call" is answered in exactly one
 * place.
 *
 * WHY a standalone module instead of a constant inside the route:
 *   - The engine's action vocabulary (26 verbs, types.ts) is deliberately
 *     finer-grained than the HTTP tool surface: several verbs funnel into
 *     one tool (three SMS verbs → send_sms_followup), and some verbs are
 *     engine-internal or tier-4 forbidden and have NO tool at all. If each
 *     boundary hand-rolled that funnel, the agent's allowed_tools would
 *     drift from what policy actually gated.
 *   - Record<VoiceActionId, …> keeps the map exhaustive by construction:
 *     adding a verb to types.ts without deciding its tool is a compile error.
 *
 * NO side effects, NO Supabase. Pure data + one helper.
 */

import type { VoiceActionId } from './types';

/**
 * Tool name per action verb; null = no HTTP tool (engine-internal records,
 * tier-4 forbidden verbs, and V1-deferred verbs never surface to the agent).
 */
export const VOICE_ACTION_TOOL_MAP: Record<VoiceActionId, string | null> = {
  // tier 0 — answer-only
  answer_rent_status: 'get_rent_status',
  answer_lease_question: 'get_lease_details',
  provide_owner_briefing: 'get_owner_briefing',
  collect_vendor_status: 'get_vendor_jobs',
  // tier 1 — record
  record_call_note: null, // engine-internal: lands in the session log, no tool
  record_callback_request: 'schedule_callback',
  // tier 2 — act, reversible
  create_work_order: 'create_work_order',
  send_safe_confirmation_sms: 'send_sms_followup',
  request_payment_proof_sms: 'send_sms_followup',
  request_photo_sms: 'send_sms_followup',
  notify_owner: 'escalate_to_landlord',
  create_owner_queue_item: null, // engine-internal: queued by the webhook compiler
  schedule_callback: 'schedule_callback',
  escalate_to_landlord: 'escalate_to_landlord',
  // tier 3 — draft for approval
  create_followup_sms_draft: 'create_followup_sms_draft',
  send_rent_reminder: 'create_followup_sms_draft',
  coordinate_vendor: 'create_followup_sms_draft',
  schedule_access_entry: null, // ponytail: no dedicated tool in V1; access entry routes through drafts
  // tier 4 — never; forbidden verbs have no tool by definition
  process_payment: null,
  waive_fee: null,
  threaten_legal_action: null,
  amend_lease: null,
  dispatch_vendor_with_cost: null,
  promise_appointment: null,
  promise_emergency_dispatch: null,
  disclose_private_data: null,
};

/**
 * Map policy-allowed action verbs to the deduplicated list of Retell tool
 * names the agent may call this turn. Engine-internal verbs (null) drop out.
 *
 * @param actions - Allowed VoiceActionIds, e.g. planTurn().allowedActions.
 * @returns Unique tool names, in first-seen order.
 */
export function allowedToolsFor(actions: readonly VoiceActionId[]): string[] {
  const tools: string[] = [];
  for (const action of actions) {
    const tool = VOICE_ACTION_TOOL_MAP[action];
    if (tool !== null && !tools.includes(tool)) tools.push(tool);
  }
  return tools;
}
