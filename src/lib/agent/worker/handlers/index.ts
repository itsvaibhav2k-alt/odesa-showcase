/**
 * Wave 6 — handler registry.
 *
 * Maps each new write-action_type to a handler function. The
 * dispatcher (Stream D) and `proposals/commit.ts` (Stream A.4) both
 * import from here so they share a single source of truth for which
 * action_type is wired and which is still TODO.
 *
 * Stream A (foundation) ships this as a stub registry: every handler
 * returns `{ ok: false, error: 'handler_not_implemented' }`. Streams
 * B + C land in parallel and replace each entry one-by-one with a
 * real implementation. Keeping the registry shape stable (no new
 * imports needed when a handler swaps in) lets the foundation pass
 * `tsc --noEmit` and the integration suite stay green during fan-out.
 *
 * Handler contract (mirrored across every implementation):
 *
 *   handle*({
 *     admin,            // SupabaseClient<Database> with service-role key
 *     organizationId,   // dispatcher-provided org scope
 *     payload,          // already validated against the Zod schema
 *     proposalId,       // optional — set when called from commit.ts
 *   }) → Promise<HandlerResult>
 *
 * On success the handler returns the inserted/updated row (`data`),
 * a confidence score, a one-line `reasoning`, and an optional
 * `idempotent` flag set when the natural key already existed.
 *
 * On failure the handler returns `{ ok: false, error, confidence }`
 * with a stable error string the dispatcher can surface to the
 * operator. Throwing is reserved for genuinely unexpected errors —
 * known failure modes like `ambiguous_tenant` ride the `error` field.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import type {
  AddAppliancePayload,
  AddTenantPayload,
  AddUnitPayload,
  ArchiveLeasePayload,
  CancelCalendarEventPayload,
  CreatePropertyPayload,
  LogMaintenanceTicketPayload,
  RequestRentPaymentPayload,
  ScheduleCalendarEventPayload,
  SendTenantMessagePayload,
  SetLeaseTermsPayload,
  SetPropertyVendorPayload,
  UpdateAppliancePayload,
  UpdatePropertyRulesPayload,
  UpdateRentPayload,
  WaiveRentPayload,
  UpdateTenantPreferencePayload,
  WorkerActionType,
} from '../types';

import { handleAddAppliance } from './add-appliance';
import { handleAddTenant } from './add-tenant';
import { handleAddUnit } from './add-unit';
import { handleArchiveLease } from './archive-lease';
import { handleCancelCalendarEvent } from './cancel-calendar-event';
import { handleCreateProperty } from './create-property';
import { handleLogMaintenanceTicket } from './log-maintenance-ticket';
import { handleRequestRentPayment } from './request-rent-payment';
import { handleScheduleCalendarEvent } from './schedule-calendar-event';
import { handleSendTenantMessage } from './send-tenant-message';
import { handleSetLeaseTerms } from './set-lease-terms';
import { handleSetPropertyVendor } from './set-property-vendor';
import { handleUpdateAppliance } from './update-appliance';
import { handleUpdatePropertyRules } from './update-property-rules';
import { handleUpdateRent } from './update-rent';
import { handleWaiveRent } from './waive-rent';
import { handleUpdateTenantPreference } from './update-tenant-preference';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface HandlerOk<TData = Record<string, unknown>> {
  ok: true;
  data: TData;
  confidence: number;
  reasoning: string;
  idempotent?: boolean;
}

export interface HandlerErr {
  ok: false;
  error: string;
  confidence: number;
}

export type HandlerResult<TData = Record<string, unknown>> =
  | HandlerOk<TData>
  | HandlerErr;

export interface HandlerArgs<TPayload> {
  admin: SupabaseClient<Database>;
  organizationId: string;
  payload: TPayload;
  proposalId?: string;
}

export type Handler<TPayload> = (
  args: HandlerArgs<TPayload>,
) => Promise<HandlerResult>;

// ---------------------------------------------------------------------------
// Public registry — every wave-6 action_type has an entry
// ---------------------------------------------------------------------------

/**
 * Subset of `WorkerActionType` that requires a handler: every new
 * write-action introduced in wave 6 + wave 7. The original 5 action_types
 * (draft_sms_reply, classify_intent, etc.) commit through dedicated
 * branches in `proposals/commit.ts` and are not in this registry.
 */
export type HandlerActionType =
  | 'create_property'
  | 'add_unit'
  | 'add_tenant'
  | 'set_lease_terms'
  | 'update_rent'
  | 'waive_rent'
  | 'send_tenant_message'
  | 'log_maintenance_ticket'
  | 'update_property_rules'
  | 'archive_lease'
  // Wave 7 — Streams P/G/S replace these stubs with real handlers.
  | 'add_appliance'
  | 'update_appliance'
  | 'set_property_vendor'
  | 'update_tenant_preference'
  | 'request_rent_payment'
  | 'schedule_calendar_event'
  | 'cancel_calendar_event';

/**
 * Compile-time check that HandlerActionType ⊂ WorkerActionType. Adding
 * a new wave-6 / wave-7 action_type without a registry entry will fail
 * here.
 */
const _typeCheck: ReadonlyArray<HandlerActionType & WorkerActionType> = [
  'create_property',
  'add_unit',
  'add_tenant',
  'set_lease_terms',
  'update_rent',
  'waive_rent',
  'send_tenant_message',
  'log_maintenance_ticket',
  'update_property_rules',
  'archive_lease',
  'add_appliance',
  'update_appliance',
  'set_property_vendor',
  'update_tenant_preference',
  'request_rent_payment',
  'schedule_calendar_event',
  'cancel_calendar_event',
];
void _typeCheck;

/**
 * Discriminator that maps each action_type to the strict payload type
 * its handler accepts. Useful for code that wants per-action_type
 * type-narrowing — `commit.ts` casts via the runtime Zod parse, so
 * this is currently informational. Kept colocated with the registry.
 */
export interface HandlerPayloadByAction {
  create_property: CreatePropertyPayload;
  add_unit: AddUnitPayload;
  add_tenant: AddTenantPayload;
  set_lease_terms: SetLeaseTermsPayload;
  update_rent: UpdateRentPayload;
  waive_rent: WaiveRentPayload;
  send_tenant_message: SendTenantMessagePayload;
  log_maintenance_ticket: LogMaintenanceTicketPayload;
  update_property_rules: UpdatePropertyRulesPayload;
  archive_lease: ArchiveLeasePayload;
  add_appliance: AddAppliancePayload;
  update_appliance: UpdateAppliancePayload;
  set_property_vendor: SetPropertyVendorPayload;
  update_tenant_preference: UpdateTenantPreferencePayload;
  request_rent_payment: RequestRentPaymentPayload;
  schedule_calendar_event: ScheduleCalendarEventPayload;
  cancel_calendar_event: CancelCalendarEventPayload;
}

// ---------------------------------------------------------------------------
// Stream A stub — replaced one-by-one by Streams P/G/S
// ---------------------------------------------------------------------------
//
// Returns a stable `handler_not_implemented` error so any caller that
// reaches an unimplemented action_type sees a deterministic failure
// (instead of a generic crash). Streams P/G/S land their real handlers
// behind the same registry key, so swapping in a real implementation
// requires no changes elsewhere.

export async function handlerNotImplemented(): Promise<HandlerResult> {
  return {
    ok: false,
    error: 'handler_not_implemented',
    confidence: 0,
  };
}

/**
 * Registry mapping action_type → handler. Stream B/C replace the
 * stub entries with real implementations; commit.ts and the
 * dispatcher import this map and look up by action_type at runtime.
 *
 * The handler accepts a generic payload shape (the call site pre-
 * validates via the Zod schema in `WORKER_PAYLOAD_SCHEMAS`), so the
 * map is keyed on `unknown` for the payload position.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WORKER_HANDLERS: Record<HandlerActionType, Handler<any>> = {
  create_property: handleCreateProperty,
  add_unit: handleAddUnit,
  add_tenant: handleAddTenant,
  set_lease_terms: handleSetLeaseTerms,
  update_rent: handleUpdateRent,
  waive_rent: handleWaiveRent,
  send_tenant_message: handleSendTenantMessage,
  log_maintenance_ticket: handleLogMaintenanceTicket,
  update_property_rules: handleUpdatePropertyRules,
  archive_lease: handleArchiveLease,
  // Wave 7 — Stream P implementations.
  add_appliance: handleAddAppliance,
  update_appliance: handleUpdateAppliance,
  set_property_vendor: handleSetPropertyVendor,
  update_tenant_preference: handleUpdateTenantPreference,
  // Stream G implementations (calendar).
  schedule_calendar_event: handleScheduleCalendarEvent,
  cancel_calendar_event: handleCancelCalendarEvent,
  // Stream S implementation (Stripe rent collection).
  request_rent_payment: handleRequestRentPayment,
};

/** True iff the action_type is in the wave-6 handler registry. */
export function isHandlerAction(
  action: WorkerActionType,
): action is HandlerActionType {
  return action in WORKER_HANDLERS;
}
