/**
 * Scheduling MCP — `schedule_action`, `list_scheduled`, `cancel_scheduled`.
 *
 * The dispatcher exposes these to the operator so it can defer actions
 * ("if rent is unpaid by Friday, send Y") and revoke them. The fire path
 * is owned by a separate Inngest function (other team); this MCP only
 * deals with the schedule lifecycle (create, list, cancel) and emits the
 * Inngest event that wakes that function at `triggerAt`.
 *
 * Privacy invariant (per v19 brief):
 *   - tool inputs / outputs use NAMES (`propertyName`, `tenantName`,
 *     `scheduleDescription`); UUIDs stay server-side.
 *   - `propertyName` is resolved against the loaded `OrganizationContext`
 *     via `resolvePropertyName`.
 *   - `tenantName` is resolved against the per-property `PropertyContext`
 *     via the existing `resolveTenant` helper from `mcps/spawn.ts`. We
 *     load the context lazily through the dispatcher's per-run cache.
 *   - `scheduleDescription` is matched as a case-insensitive substring
 *     against the rendered list_scheduled lines.
 *
 * `actionPayload` is intentionally a stub shape — the fire-path team
 * re-drafts at `trigger_at` so this only needs to round-trip the action's
 * intent. For `draft_sms_reply` we persist `{ tenantId, actionPrompt }`;
 * other actions get `{ actionPrompt }` plus any resolved targets.
 *
 * Cancel is DB-status-based (status = 'cancelled'); the sleeping Inngest
 * job re-checks the row when it wakes. This keeps the cancel path off
 * the Inngest control API and works even if Inngest is briefly down.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { Inngest } from 'inngest';
import { z } from 'zod';

import type { Database, Json } from '@/types/database';
import type { CommitActor } from '@/lib/authz/policy';
import { inngest as defaultInngest } from '@/lib/inngest/client';
import {
  loadPropertyContext,
  type SupabaseLike,
} from '@/lib/agent/worker/context-loader';
import {
  WORKER_ACTION_TYPES,
  type PropertyContext,
  type WorkerActionType,
} from '@/lib/agent/worker/types';
import type { OrganizationContext } from '../org-context';
import { resolvePropertyName } from '../property-resolver';
import { resolveTenant } from './spawn';
import type {
  ScheduledAction,
  ScheduledActionStatus,
  ScheduledCondition,
} from '@/lib/agent/scheduling/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ms-of-slack we tolerate when validating triggerAt is in the future. */
const TRIGGER_AT_SLACK_MS = 60_000;
const LIST_LIMIT = 20;

const SCHEDULED_ACTION_STATUSES = [
  'scheduled',
  'fired',
  'condition_failed',
  'cancelled',
  'expired',
] as const satisfies readonly ScheduledActionStatus[];

const CONDITION_TYPES = ['rent_unpaid', 'tenant_no_response', 'always'] as const;

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface CreateSchedulingMcpDeps {
  admin: SupabaseClient<Database>;
  organizationId: string;
  /** Operator user id; persisted on the row + on cancel audit. */
  userId: string;
  orgContext: OrganizationContext;
  /**
   * Per-dispatcher-run context cache shared with the spawn MCP. Used to
   * resolve `tenantName` (the org context only carries properties; tenants
   * live on `PropertyContext`).
   */
  propertyContextCache: Map<string, Promise<PropertyContext>>;
  /** Human actor for schedule lifecycle decisions; non-owners are read-only. */
  commitActor: CommitActor;
  /** Inngest client override for tests. Defaults to the production singleton. */
  inngest?: Pick<Inngest, 'send'>;
  /** Override `Date.now()` in tests for deterministic future-validation. */
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSchedulingMcp(deps: CreateSchedulingMcpDeps) {
  const inngest = deps.inngest ?? defaultInngest;
  const now = deps.now ?? (() => new Date());

  return createSdkMcpServer({
    name: 'odesa-operator-scheduling',
    version: '0.1.0',
    // 16 tools total — always in the prompt; deferral behind ToolSearch
    // costs a full model round trip per fresh conversation.
    alwaysLoad: true,
    tools: [
      tool(
        'schedule_action',
        'Schedule an action to fire at a future time, optionally conditional. Use for "if X by Friday, send Y" requests. NEVER fabricate scheduling — if the condition does not fit one of the 3 supported types (rent_unpaid, tenant_no_response, always), return text asking the operator to ping you back manually.',
        {
          propertyName: z.string().min(1),
          triggerAt: z
            .string()
            .describe(
              'ISO 8601 timestamp; convert "friday 9am" using the org timezone before passing.',
            ),
          actionType: z.enum(WORKER_ACTION_TYPES),
          actionPrompt: z
            .string()
            .min(3)
            .max(500)
            .describe(
              'Human-readable summary of what to do, e.g. "send eviction notice to Jessica Kim".',
            ),
          tenantName: z
            .string()
            .optional()
            .describe(
              'Required when conditionType references a tenant (rent_unpaid or tenant_no_response).',
            ),
          conditionType: z.enum(CONDITION_TYPES),
          sinceReminderDescription: z
            .string()
            .optional()
            .describe(
              'For tenant_no_response: paraphrase of the reminder this is gated on.',
            ),
        },
        async (args) => {
          if (!canManageSchedules(deps.commitActor)) {
            return text(
              'Owner approval is required to schedule an action. I can prepare the timing, condition, and handoff for owner review.',
            );
          }

          // health_flag / voice_call_review are produced ONLY by system
          // pipelines (daily-health-check cron; Retell voice webhook) — a
          // scheduled one would spawn a model worker for a verb whose
          // contract is empty (same idiom as spawn.ts's unsupported branch).
          if (args.actionType === 'health_flag') {
            return text(
              'Unsupported action_type: health_flag is generated by the daily health-check cron and cannot be scheduled.',
            );
          }
          if (args.actionType === 'voice_call_review') {
            return text(
              'Unsupported action_type: voice_call_review is generated by the voice operator webhook and cannot be scheduled.',
            );
          }

          // 1. Resolve propertyName → PropertySummary.
          const propResolved = resolvePropertyName(
            deps.orgContext.properties,
            args.propertyName,
          );
          if (propResolved.kind !== 'unique') {
            const allNames = deps.orgContext.properties
              .map((p) => p.name)
              .join(', ');
            if (propResolved.kind === 'none') {
              return text(
                `No property matches '${args.propertyName}'. Org has: ${allNames}.`,
              );
            }
            const matchNames = propResolved.matches
              .map((m) => m.name)
              .join(', ');
            return text(
              `Multiple properties match '${args.propertyName}': ${matchNames}. Be more specific.`,
            );
          }
          const property = propResolved.property;

          // 2. Validate triggerAt parses + is in the future.
          const triggerDate = new Date(args.triggerAt);
          if (Number.isNaN(triggerDate.getTime())) {
            return text(
              `triggerAt '${args.triggerAt}' is not a valid ISO 8601 timestamp.`,
            );
          }
          if (triggerDate.getTime() <= now().getTime() - TRIGGER_AT_SLACK_MS) {
            return text(
              `triggerAt '${args.triggerAt}' is in the past. Pick a future time (the dispatcher cannot retro-schedule).`,
            );
          }

          // 3. Resolve tenantName for tenant-scoped conditions.
          let resolvedTenantId: string | null = null;
          let resolvedTenantName: string | null = null;
          const conditionNeedsTenant =
            args.conditionType === 'rent_unpaid' ||
            args.conditionType === 'tenant_no_response';
          if (conditionNeedsTenant) {
            if (!args.tenantName) {
              return text(
                `conditionType '${args.conditionType}' requires tenantName so the gating subject can be resolved.`,
              );
            }
            let ctx: PropertyContext;
            try {
              ctx = await getOrLoadContext(deps, property.id);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              return text(`schedule_action failed loading context: ${message}`);
            }
            const tResolved = resolveTenant(ctx, args.tenantName);
            if (tResolved.kind === 'ambiguous') {
              return text(
                `Multiple tenants match '${args.tenantName}': ${tResolved.candidates
                  .map((t) => `${t.fullName} (${t.unitLabel ?? 'unit ?'})`)
                  .join(', ')} — please be more specific.`,
              );
            }
            if (tResolved.kind === 'miss') {
              return text(
                `No tenant named '${args.tenantName}' on ${property.name}.`,
              );
            }
            resolvedTenantId = tResolved.match.id;
            resolvedTenantName = tResolved.match.fullName;
          }

          // 4. Build ScheduledCondition.
          let condition: ScheduledCondition;
          let conditionText: string;
          if (args.conditionType === 'rent_unpaid') {
            condition = {
              type: 'rent_unpaid',
              tenantId: resolvedTenantId!,
              asOf: 'trigger_at',
            };
            conditionText = `if ${resolvedTenantName} has unpaid rent at trigger_at`;
          } else if (args.conditionType === 'tenant_no_response') {
            // Resolve sinceReminderDescription → most recent matching proposal.
            if (!args.sinceReminderDescription) {
              return text(
                `conditionType 'tenant_no_response' requires sinceReminderDescription so the response window can be anchored to a prior reminder.`,
              );
            }
            const matchResult = await findReminderProposal(
              deps,
              property.id,
              resolvedTenantId!,
              args.sinceReminderDescription,
            );
            if (matchResult.kind === 'error') {
              return text(
                `schedule_action failed looking up the reminder: ${matchResult.message}`,
              );
            }
            if (matchResult.kind === 'none') {
              return text(
                `No recent reminder for ${resolvedTenantName} matches '${args.sinceReminderDescription}'. Send the reminder first, then schedule the follow-up.`,
              );
            }
            if (matchResult.kind === 'ambiguous') {
              return text(
                `Multiple recent reminders for ${resolvedTenantName} match '${args.sinceReminderDescription}': ${matchResult.summaries.join(
                  '; ',
                )}. Be more specific.`,
              );
            }
            condition = {
              type: 'tenant_no_response',
              tenantId: resolvedTenantId!,
              sinceProposalId: matchResult.proposalId,
            };
            conditionText = `if ${resolvedTenantName} has not replied since the reminder "${args.sinceReminderDescription}"`;
          } else {
            condition = { type: 'always' };
            conditionText = 'unconditional';
          }

          // 5. Build a stub actionPayload. The fire-path re-drafts at
          // trigger time so this only needs to round-trip intent + targets.
          const actionPayload = buildStubPayload({
            actionType: args.actionType,
            actionPrompt: args.actionPrompt,
            tenantId: resolvedTenantId,
          });

          const insertRow: Database['public']['Tables']['scheduled_actions']['Insert'] = {
            organization_id: deps.organizationId,
            property_id: property.id,
            user_id: deps.userId,
            trigger_at: triggerDate.toISOString(),
            condition: condition as unknown as Json,
            condition_text: conditionText,
            action_type: args.actionType,
            action_payload: actionPayload as unknown as Json,
            action_text: args.actionPrompt,
            status: 'scheduled',
          };

          // 6. INSERT scheduled_actions.
          const { data: inserted, error: insertError } = await deps.admin
            .from('scheduled_actions')
            .insert(insertRow)
            .select('id, trigger_at, action_text, condition_text')
            .single();
          if (insertError || !inserted) {
            return text(
              `schedule_action failed: ${insertError?.message ?? 'no row returned'}`,
            );
          }

          // 7. Send the Inngest fire event.
          let eventIds: readonly string[] = [];
          try {
            const sendResult = await inngest.send({
              name: 'odesa/scheduled-action.fire',
              data: { scheduleId: inserted.id },
              ts: triggerDate.getTime(),
            });
            eventIds = (sendResult?.ids ?? []) as readonly string[];
          } catch (err) {
            // The row is already persisted; mark it expired+log so the
            // operator sees the failure rather than silently losing the
            // schedule. The Inngest team's daily safety-net cron can
            // retry by clearing the row and rescheduling, but for v1.9
            // we surface the failure explicitly.
            const message = err instanceof Error ? err.message : String(err);
            await deps.admin
              .from('scheduled_actions')
              .update({
                status: 'expired',
                condition_failure_reason: `inngest.send failed at schedule time: ${message}`,
              })
              .eq('id', inserted.id);
            return text(`schedule_action failed (inngest.send): ${message}`);
          }

          // 8. Stamp the inngest_event_id for audit (non-fatal if it fails).
          if (eventIds.length > 0) {
            const { error: updateError } = await deps.admin
              .from('scheduled_actions')
              .update({ inngest_event_id: eventIds[0]! })
              .eq('id', inserted.id);
            if (updateError) {
              console.error(
                `[schedule_action] failed to stamp inngest_event_id for ${inserted.id}: ${updateError.message}`,
              );
            }
          }

          return text(
            `Scheduled: ${args.actionPrompt}. Fires ${formatTriggerAt(
              triggerDate,
            )} (${conditionText}). Cancel by saying "cancel ${truncateForCancelHint(
              args.actionPrompt,
            )}".`,
          );
        },
      ),
      tool(
        'list_scheduled',
        'List scheduled actions for the org. Use when the operator asks "what is scheduled?" or before cancelling. Returns a numbered, human-readable summary; no UUIDs surface.',
        {
          propertyName: z
            .string()
            .optional()
            .describe(
              'Filter to one property (substring match). Omit for org-wide.',
            ),
          status: z
            .enum(SCHEDULED_ACTION_STATUSES)
            .optional()
            .describe('Filter by status. Default "scheduled".'),
        },
        async (args) => {
          const status = args.status ?? 'scheduled';

          let propertyId: string | null = null;
          if (args.propertyName !== undefined) {
            const resolved = resolvePropertyName(
              deps.orgContext.properties,
              args.propertyName,
            );
            if (resolved.kind !== 'unique') {
              const allNames = deps.orgContext.properties
                .map((p) => p.name)
                .join(', ');
              if (resolved.kind === 'none') {
                return text(
                  `No property matches '${args.propertyName}'. Org has: ${allNames}.`,
                );
              }
              const matchNames = resolved.matches
                .map((m) => m.name)
                .join(', ');
              return text(
                `Multiple properties match '${args.propertyName}': ${matchNames}. Be more specific.`,
              );
            }
            propertyId = resolved.property.id;
          }

          const rows = await fetchScheduledRows(deps, {
            status,
            propertyId,
          });
          if (rows.kind === 'error') {
            return text(`list_scheduled failed: ${rows.message}`);
          }
          if (rows.rows.length === 0) {
            return text(
              propertyId
                ? `No ${status} actions for that property.`
                : `No ${status} actions in the org.`,
            );
          }

          const lines = rows.rows.map(
            (row, i) => `${i + 1}. ${describeRow(row, deps.orgContext)}`,
          );
          return text(lines.join('\n'));
        },
      ),
      tool(
        'cancel_scheduled',
        'Cancel a previously-scheduled action. Operator says "cancel that" or "scrap the eviction schedule". Match against the description from list_scheduled.',
        {
          scheduleDescription: z
            .string()
            .min(3)
            .describe(
              'Substring of what list_scheduled returned, e.g. "eviction" or "Jessica".',
            ),
          reason: z
            .string()
            .optional()
            .describe(
              'Why the operator is cancelling (steers trust graduation).',
            ),
        },
        async (args) => {
          if (!canManageSchedules(deps.commitActor)) {
            return text(
              'Owner approval is required to cancel a scheduled action. I can summarize the schedule for an owner handoff.',
            );
          }

          // Always cancel against the scheduled queue (cancelling a
          // fired/cancelled row is meaningless).
          const rows = await fetchScheduledRows(deps, {
            status: 'scheduled',
            propertyId: null,
          });
          if (rows.kind === 'error') {
            return text(`cancel_scheduled failed: ${rows.message}`);
          }

          const needle = args.scheduleDescription.toLowerCase().trim();
          const matches = rows.rows.filter((row) => {
            const desc = describeRow(row, deps.orgContext).toLowerCase();
            return desc.includes(needle);
          });

          if (matches.length === 0) {
            return text(
              `No scheduled action matching '${args.scheduleDescription}'.`,
            );
          }
          if (matches.length > 1) {
            const summary = matches
              .map((row, i) => `${i + 1}. ${describeRow(row, deps.orgContext)}`)
              .join('\n');
            return text(
              `Found ${matches.length} matching scheduled actions — which one?\n${summary}`,
            );
          }

          const target = matches[0]!;
          const { error: updateError } = await deps.admin
            .from('scheduled_actions')
            .update({
              status: 'cancelled',
              cancelled_at: now().toISOString(),
              cancelled_by: deps.userId,
              cancellation_reason: args.reason ?? null,
            })
            .eq('id', target.id)
            .eq('status', 'scheduled');
          if (updateError) {
            return text(`cancel_scheduled failed: ${updateError.message}`);
          }

          return text(
            `Cancelled: ${describeRow(target, deps.orgContext)}.`,
          );
        },
      ),
    ],
  });
}

function canManageSchedules(actor: CommitActor): boolean {
  return actor.kind === 'system' || actor.role === 'owner';
}

// ---------------------------------------------------------------------------
// Internal — context cache (shared with spawn MCP semantics)
// ---------------------------------------------------------------------------

function getOrLoadContext(
  deps: CreateSchedulingMcpDeps,
  propertyId: string,
): Promise<PropertyContext> {
  const cached = deps.propertyContextCache.get(propertyId);
  if (cached) return cached;
  const promise = loadPropertyContext(
    deps.admin as unknown as SupabaseLike,
    propertyId,
  );
  deps.propertyContextCache.set(propertyId, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Internal — fetch + describe scheduled rows
// ---------------------------------------------------------------------------

interface ScheduledRow {
  id: string;
  property_id: string | null;
  trigger_at: string;
  action_text: string;
  action_type: string;
  condition_text: string;
  status: string;
}

type FetchResult =
  | { kind: 'ok'; rows: ScheduledRow[] }
  | { kind: 'error'; message: string };

async function fetchScheduledRows(
  deps: CreateSchedulingMcpDeps,
  opts: { status: string; propertyId: string | null },
): Promise<FetchResult> {
  let q = deps.admin
    .from('scheduled_actions')
    .select(
      'id, property_id, trigger_at, action_text, action_type, condition_text, status',
    )
    .eq('organization_id', deps.organizationId)
    .eq('status', opts.status);
  if (opts.propertyId) {
    q = q.eq('property_id', opts.propertyId);
  }
  const { data, error } = await q
    .order('trigger_at', { ascending: true })
    .limit(LIST_LIMIT);
  if (error) return { kind: 'error', message: error.message };
  return { kind: 'ok', rows: (data ?? []) as ScheduledRow[] };
}

function describeRow(
  row: ScheduledRow,
  orgContext: OrganizationContext,
): string {
  const property = row.property_id
    ? orgContext.properties.find((p) => p.id === row.property_id)
    : null;
  const propertyLabel = property ? ` at ${property.name}` : '';
  const trigger = formatTriggerAt(new Date(row.trigger_at));
  return `${row.action_text}${propertyLabel}, fires ${trigger} (${row.condition_text})`;
}

// ---------------------------------------------------------------------------
// Internal — sinceReminderDescription resolution
// ---------------------------------------------------------------------------

interface ProposalCandidateRow {
  id: string;
  action_type: string;
  payload: Json | null;
  reasoning: string | null;
  created_at: string;
}

type ReminderMatch =
  | { kind: 'unique'; proposalId: string }
  | { kind: 'ambiguous'; summaries: string[] }
  | { kind: 'none' }
  | { kind: 'error'; message: string };

/**
 * Find the most recent reminder proposal for `tenantId` whose summary
 * contains `description` (case-insensitive). Scoped to the same property
 * + last 30 committed proposals; the model is expected to schedule
 * follow-ups within hours, not weeks.
 */
async function findReminderProposal(
  deps: CreateSchedulingMcpDeps,
  propertyId: string,
  tenantId: string,
  description: string,
): Promise<ReminderMatch> {
  const { data, error } = await deps.admin
    .from('action_proposals')
    .select('id, action_type, payload, reasoning, created_at, routing')
    .eq('organization_id', deps.organizationId)
    .eq('property_id', propertyId)
    .eq('status', 'committed')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return { kind: 'error', message: error.message };

  const needle = description.toLowerCase().trim();
  const candidates: ProposalCandidateRow[] = [];
  for (const raw of (data ?? []) as Array<
    ProposalCandidateRow & { routing: Json | null }
  >) {
    // Filter to this tenant via routing.tenantId (server-side; never in I/O).
    const routing = raw.routing as { tenantId?: string } | null;
    if (routing?.tenantId !== tenantId) continue;
    candidates.push(raw);
  }

  const matches = candidates.filter((c) => {
    const haystack = [c.reasoning ?? '', JSON.stringify(c.payload ?? {})]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
  if (matches.length === 0) return { kind: 'none' };
  if (matches.length === 1) return { kind: 'unique', proposalId: matches[0]!.id };
  const summaries = matches
    .slice(0, 3)
    .map((c) => `${c.action_type} (${c.reasoning ?? 'no reasoning'})`);
  return { kind: 'ambiguous', summaries };
}

// ---------------------------------------------------------------------------
// Internal — payload + formatting helpers
// ---------------------------------------------------------------------------

interface BuildStubPayloadOpts {
  actionType: WorkerActionType;
  actionPrompt: string;
  tenantId: string | null;
}

function buildStubPayload(
  opts: BuildStubPayloadOpts,
): Record<string, unknown> {
  // Stub shape — the fire-path team's spawnForSchedule re-drafts; this
  // only carries enough intent + targets to round-trip the action.
  if (opts.actionType === 'draft_sms_reply' && opts.tenantId) {
    return { tenantId: opts.tenantId, actionPrompt: opts.actionPrompt };
  }
  if (opts.tenantId) {
    return { tenantId: opts.tenantId, actionPrompt: opts.actionPrompt };
  }
  return { actionPrompt: opts.actionPrompt };
}

function formatTriggerAt(date: Date): string {
  // Locale-free ISO day + 24h time keeps the output stable for tests
  // and avoids leaking the server's locale into model output.
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function truncateForCancelHint(prompt: string): string {
  const trimmed = prompt.trim().split(/\s+/).slice(0, 4).join(' ');
  return trimmed.length > 0 ? trimmed : 'that';
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export { describeRow, formatTriggerAt };
export type { ScheduledRow };

// Re-export so tests can build the same shape we read into.
export type { ScheduledAction };

// ---------------------------------------------------------------------------
// MCP text helper
// ---------------------------------------------------------------------------

function text(s: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: s }] };
}
