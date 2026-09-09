import type { WorkerActionType } from './types';

/**
 * Neutral, customer-safe nouns for proposal work that has not yet completed.
 * Exhaustive by design: adding a worker action must also add humane copy here,
 * so review surfaces can never fall back to a raw action enum.
 */
export const REVIEW_ACTION_LABELS = {
  draft_sms_reply: 'Tenant reply draft',
  classify_intent: 'Intent classification',
  confirm_emergency: 'Emergency assessment',
  polish_briefing: 'Briefing draft',
  dispatch_vendor: 'Vendor dispatch',
  update_rulebook: 'Property guidance update',
  create_property: 'Property record',
  add_unit: 'Unit record',
  add_tenant: 'Tenant record',
  set_lease_terms: 'Lease terms',
  update_rent: 'Rent change',
  waive_rent: 'Rent waiver',
  send_tenant_message: 'Tenant message',
  log_maintenance_ticket: 'Maintenance ticket',
  update_property_rules: 'Property rules update',
  archive_lease: 'Lease archival',
  add_appliance: 'Appliance record',
  update_appliance: 'Appliance record update',
  set_property_vendor: 'Preferred vendor change',
  update_tenant_preference: 'Tenant preference update',
  request_rent_payment: 'Rent payment request',
  schedule_calendar_event: 'Calendar event',
  cancel_calendar_event: 'Calendar cancellation',
  health_flag: 'Property health review',
  voice_call_review: 'Call follow-up review',
} satisfies Record<WorkerActionType, string>;

export function reviewActionLabel(actionType: WorkerActionType): string {
  return REVIEW_ACTION_LABELS[actionType];
}
