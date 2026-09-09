/**
 * Shared types for the scheduled-actions subsystem (v1.9).
 *
 * The dispatcher's three new MCP tools (schedule_action, list_scheduled,
 * cancel_scheduled) write/read this shape; the Inngest function
 * (fire-scheduled-action.ts) consumes it at trigger_at and the condition
 * evaluator (conditions.ts) checks ScheduledCondition against live DB.
 *
 * The structured ScheduledCondition DSL is intentionally narrow — three
 * variants cover the common operator asks ("if rent unpaid by Friday",
 * "if tenant doesn't reply", unconditional reminders). Anything outside
 * those three is the dispatcher's job to refuse at schedule time.
 *
 * Privacy invariant: tool I/O takes names (propertyName, tenantName,
 * scheduleDescription); these tenantId / sinceProposalId / id fields
 * exist for SERVER-SIDE storage only and never round-trip back to the
 * model.
 */

import type { WorkerActionType } from '@/lib/agent/worker/types';

// ---------------------------------------------------------------------------
// Condition DSL
// ---------------------------------------------------------------------------

export type ScheduledCondition =
  | {
      type: 'rent_unpaid';
      /** Tenant whose rent we're gating on. Server resolves from tenantName at schedule time. */
      tenantId: string;
      /** Always 'trigger_at' in v1.9; reserved for future "as of an explicit cutoff" variants. */
      asOf: 'trigger_at';
    }
  | {
      type: 'tenant_no_response';
      /** Tenant whose silence we're gating on. */
      tenantId: string;
      /** The reminder/proposal that started the response window. We check for inbound messages after this proposal's commit time. */
      sinceProposalId: string;
    }
  | {
      type: 'always';
    };

export interface ConditionEvalResult {
  /** Whether the condition holds — i.e. whether the action should fire. */
  holds: boolean;
  /** Human-readable reason; persisted on the schedule row for audit. */
  reason: string;
}

// ---------------------------------------------------------------------------
// ScheduledAction (TS view of the row)
// ---------------------------------------------------------------------------
//
// The DB row is camel-cased here for in-process use; mappers in MCP and
// fire-path code translate to/from snake_case Postgres columns. We keep
// the row alias on src/types/database.ts (ScheduledActionRow) for direct
// Supabase client typing; this richer ScheduledAction type narrows
// `condition` to the discriminated union above and `status` to the enum
// the CHECK constraint enforces.

export type ScheduledActionStatus =
  | 'scheduled'
  | 'fired'
  | 'condition_failed'
  | 'cancelled'
  | 'expired';

export interface ScheduledAction {
  id: string;
  organizationId: string;
  /** Null for org-wide actions; in v1.9 every schedule has a property. */
  propertyId: string | null;
  /** Operator who scheduled the action. */
  userId: string;

  /** ISO 8601 timestamptz. */
  triggerAt: string;

  /** Null = unconditional fire (synonym for { type: 'always' }). */
  condition: ScheduledCondition | null;
  /** Human-readable summary of the condition; surfaced in list_scheduled output. */
  conditionText: string;

  actionType: WorkerActionType;
  /** Per-action input shape. spawn-for-schedule re-drafts at fire time, so this is intent + targets, not a finalised draft. */
  actionPayload: Record<string, unknown>;
  /** Human-readable summary of the action; surfaced in list_scheduled output and the schedule confirmation reply. */
  actionText: string;

  status: ScheduledActionStatus;
  firedAt: string | null;
  firedProposalId: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  conditionFailureReason: string | null;

  /** Inngest event id captured at schedule time for audit. Cancellation is DB-status-based, not via the Inngest API. */
  inngestEventId: string | null;

  createdAt: string;
  updatedAt: string;
}
