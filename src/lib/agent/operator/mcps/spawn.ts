/**
 * Spawn MCP — `spawn_property_worker`.
 *
 * The model passes NAMES (propertyName, tenantName, vendorName), never UUIDs.
 * The handler resolves propertyName → PropertySummary via `resolvePropertyName`,
 * loads `PropertyContext` for the resolved property (using the per-run cache),
 * then resolves tenantName/vendorName against THAT property's context before
 * invoking spawnPropertyWorker. This preserves the privacy invariant: tenant/
 * vendor/property UUIDs never round-trip through model output.
 *
 * Two flavors of action_type live behind a single tool:
 *
 *   - "draft" actions (draft_sms_reply, classify_intent, confirm_emergency,
 *     polish_briefing, dispatch_vendor, update_rulebook): the per-property
 *     worker LLM (Haiku 4.5) actually drafts a payload. The model passes a
 *     `prompt` framing; spawn loads PropertyContext, calls
 *     `spawnPropertyWorker`, then records + gates the resulting proposal.
 *
 *   - "write" actions (Wave 6: create_property, add_unit, add_tenant,
 *     set_lease_terms, update_rent, send_tenant_message,
 *     log_maintenance_ticket, update_property_rules, archive_lease): the
 *     dispatcher itself supplies the structured `payload` directly. There
 *     is no per-property worker LLM call — the spawn MCP validates the
 *     payload against `WORKER_PAYLOAD_SCHEMAS[action_type]`, synthesizes an
 *     in-memory ActionProposal, then records + gates it through the same
 *     proposals pipeline. Provider-free internal record captures may commit;
 *     consequential actions always wait for explicit human review.
 *
 * Flow per call (draft actions):
 *   0. Resolve propertyName → propertyId via resolvePropertyName.
 *   1. Load PropertyContext for that property (cached per dispatcher run).
 *   2. Resolve tenantName / vendorName → ids; ambiguous match → tool
 *      error listing candidates.
 *   3. Build the per-action `WorkerActionInput.data` shape using the
 *      operator's `prompt` as the stand-in for inboundBody / utterance.
 *   4. Call `spawnPropertyWorker({ propertyId, action_type, data, deps })`.
 *   5. Call `recordProposal({ ...routing })` with the resolved IDs.
 *   6. Apply explicit safety disposition + gate: safe 'auto' → commit,
 *      consequential/review → emit review_required,
 *      'block' → emit tool.error.
 *   7. Emit `proposal.recorded` (always) + a terminal event per outcome.
 *   8. Return a one-line summary text to the model.
 *
 * Flow per call (write actions):
 *   0. Validate `payload` against WORKER_PAYLOAD_SCHEMAS[action_type].
 *   1. Pick a property_id to attach the proposal to: if propertyName was
 *      supplied AND resolves uniquely, use that; otherwise use the first
 *      property in orgContext as a generic anchor (action_proposals.property_id
 *      is NOT NULL — write actions like create_property attach to whatever
 *      anchor is available; the handler does not consult this field).
 *   2. Synthesize an in-memory ActionProposal with the dispatcher-supplied
 *      payload, record + gate it.
 *   3. Same emit/commit semantics as the draft flow.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { Database } from '@/types/database';
import { spawnPropertyWorker } from '@/lib/agent/worker/spawn';
import {
  recordProposal,
  type RecordProposalInput,
} from '@/lib/agent/proposals/record';
import { commitProposal } from '@/lib/agent/proposals/commit';
import { commitActorForbidden, type CommitActor } from '@/lib/authz/policy';
import { requiresHumanReview } from '@/lib/agent/worker/commit-gate';
import { reviewActionLabel } from '@/lib/agent/worker/action-labels';
import { selectProvider } from '@/lib/agent/worker/providers/select';
import {
  WORKER_ACTION_TYPES,
  WORKER_PAYLOAD_SCHEMAS,
  validateNumericGrounding,
  type ActionProposal,
  type ContextTenantSummary,
  type ContextVendorSummary,
  type DraftSmsReplyInput,
  type DraftSmsReplyPayload,
  type ClassifyIntentInput,
  type ConfirmEmergencyInput,
  type DispatchVendorInput,
  type DispatchVendorPayload,
  type PolishBriefingInput,
  type PropertyContext,
  type ProposalRouting,
  type UpdateRulebookInput,
  type WorkerActionPayload,
  type WorkerActionType,
  type WorkerModelProvider,
} from '@/lib/agent/worker/types';
import { isHandlerAction } from '@/lib/agent/worker/handlers';
import {
  loadPropertyContext,
  type SupabaseLike,
} from '@/lib/agent/worker/context-loader';
import type { DispatcherEvent } from '../types';
import type { OrganizationContext } from '../org-context';
import { resolvePropertyName } from '../property-resolver';

/** External or lifecycle commitments that bounded human roles may prepare only. */
const OWNER_HANDOFF_ACTIONS = new Set<WorkerActionType>([
  'add_tenant',
  'archive_lease',
  'update_property_rules',
  'set_property_vendor',
  'schedule_calendar_event',
  'cancel_calendar_event',
]);

export interface CreateSpawnMcpDeps {
  admin: SupabaseClient<Database>;
  organizationId: string;
  orgContext: OrganizationContext;
  /**
   * Per-dispatcher-run cache keyed by propertyId. Tools populate it on
   * first load and await the cached promise on subsequent calls to avoid
   * duplicate round trips within a single turn.
   */
  propertyContextCache: Map<string, Promise<PropertyContext>>;
  emit: (event: DispatcherEvent) => void;
  /** Caller identity for the shared commit primitive. Human roles fail closed. */
  commitActor: CommitActor;
  /**
   * Optional URL builder for the "review required" event. Defaults to the
   * real owner queue for owner/system actors and the VA escalation context
   * on Today for bounded human roles; integration tests can override.
   */
  buildReviewUrl?: (propertyId: string, proposalId: string) => string;
  /** Provider override for tests; production picks via privacy mode. */
  provider?: WorkerModelProvider;
}

export function createSpawnMcp(deps: CreateSpawnMcpDeps) {
  return createSdkMcpServer({
    name: 'odesa-operator-spawn',
    version: '0.1.0',
    // 16 tools total — always in the prompt; deferral behind ToolSearch
    // costs a full model round trip per fresh conversation.
    alwaysLoad: true,
    tools: [
      tool(
        'spawn_property_worker',
        'Spawn a per-property worker to capture a safe internal record or prepare an Owner Queue proposal. Pass the property, tenant, or vendor by NAME (substring match); the handler resolves to the right IDs. Use this for drafting SMS replies, read-only inference, briefing polish, proposed vendor/rulebook changes, and structured portfolio actions. Tenant, money, lease, vendor, calendar, archival, and policy commitments never complete automatically. For structured actions pass `payload` shaped to the matching WORKER_PAYLOAD_SCHEMAS entry; for draft actions pass `prompt` and (when applicable) tenantName/vendorName.',
        {
          propertyName: z
            .string()
            .optional()
            .describe(
              'Name (or substring) of the property to act on. Required for draft actions; optional for portfolio writes (create_property has no anchor; other writes resolve via payload refs).',
            ),
          action_type: z.enum(WORKER_ACTION_TYPES),
          prompt: z
            .string()
            .optional()
            .describe(
              'Natural-language framing the per-property worker should act on (e.g. "remind Jane she is two days late on rent"). Required for draft actions; ignored for portfolio writes (use `payload` instead).',
            ),
          tenantName: z
            .string()
            .optional()
            .describe(
              'Case-insensitive substring match on a tenant on this property. Required for draft_sms_reply.',
            ),
          vendorName: z
            .string()
            .optional()
            .describe(
              'Case-insensitive substring match on a vendor available to this property. Required for dispatch_vendor.',
            ),
          workOrderRef: z
            .string()
            .optional()
            .describe(
              'Existing work_order id when this dispatch is tied to one.',
            ),
          payload: z
            .unknown()
            .optional()
            .describe(
              'Structured payload for portfolio write actions. Validated against WORKER_PAYLOAD_SCHEMAS[action_type]. Shape per action_type: create_property={name,addressStreet,addressCity,addressState,addressZip,timezone?}; add_unit={propertyRef,label,bedrooms,bathrooms,squareFeet?}; add_tenant={fullName,phoneE164,email?,dateOfBirth?,unitRef?}; set_lease_terms={leaseRef,rentAmount,rentDueDay,startDate,endDate?,status?}; update_rent={leaseRef,rentAmount}; waive_rent={leaseRef,cycleMonth?,reason?} (forgives the remaining balance of the cycle — collected totals never inflate; cycleMonth YYYY-MM defaults to the current month; reason becomes the audit note); send_tenant_message={tenantRef,body}; log_maintenance_ticket={unitRef,summary,severity?,reportedBy?}; update_property_rules={propertyRef,rulesText}; archive_lease={leaseRef,reason?}. Use grounded name-based refs; never copy UUIDs into model output.',
            ),
        },
        async (args) => {
          // ---- Branch: portfolio write actions (Wave 6) ----
          // For these, the dispatcher has already produced a structured
          // `payload`; we don't run the per-property worker LLM. Validate
          // the payload, attach the proposal to a property anchor, then
          // record + gate it through the same pipeline.
          if (isHandlerAction(args.action_type)) {
            return handleWriteAction(deps, args);
          }

          // ---- Branch: legacy draft actions (per-property worker LLM) ----
          if (!args.propertyName) {
              return text('A property name is required for this operation.');
          }
          if (!args.prompt) {
              return text('More detail is required before this can be prepared.');
          }
          const draftPrompt = args.prompt;

          // 0. Resolve propertyName.
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
          const resolvedPropertyId = propResolved.property.id;

          // 1. Load PropertyContext (cached per dispatcher run).
          const ctx = await getOrLoadContext(deps, resolvedPropertyId);

          // 2. Name resolution for tenant and vendor.
          let resolvedTenant: ContextTenantSummary | null = null;
          if (args.tenantName) {
            const r = resolveTenant(ctx, args.tenantName);
            if (r.kind === 'ambiguous') {
              return text(
                `Multiple tenants match '${args.tenantName}': ${r.candidates
                  .map((t) => `${t.fullName} (${t.unitLabel ?? 'unit ?'})`)
                  .join(', ')} — please be more specific.`,
              );
            }
            if (r.kind === 'miss') {
              return text(
                `No tenant named '${args.tenantName}' on this property.`,
              );
            }
            resolvedTenant = r.match;
          }

          let resolvedVendor: ContextVendorSummary | null = null;
          if (args.vendorName) {
            const r = resolveVendor(ctx, args.vendorName);
            if (r.kind === 'ambiguous') {
              return text(
                `Multiple vendors match '${args.vendorName}': ${r.candidates
                  .map((v) => `${v.name} (${v.category ?? 'uncategorised'})`)
                  .join(', ')} — please be more specific.`,
              );
            }
            if (r.kind === 'miss') {
              return text(
                `No vendor named '${args.vendorName}' on this property.`,
              );
            }
            resolvedVendor = r.match;
          }

          // 3. Per-action input shape.
          let data: unknown;
          let routing: ProposalRouting | null = null;
          switch (args.action_type) {
            case 'draft_sms_reply': {
              if (!resolvedTenant) {
                return text(
                  'A tenant name is required to prepare the reply. No action was completed.',
                );
              }
              const draftData: DraftSmsReplyInput = {
                tenantId: resolvedTenant.id,
                tenantName: resolvedTenant.fullName,
                phoneE164: null,
                conversationId: 'operator-initiated',
                inboundBody: draftPrompt,
                history: [],
              };
              data = draftData;
              routing = { tenantId: resolvedTenant.id };
              break;
            }
            case 'classify_intent': {
              const classifyData: ClassifyIntentInput = {
                utterance: draftPrompt,
                history: [],
                candidateIntents: [],
              };
              data = classifyData;
              break;
            }
            case 'confirm_emergency': {
              const emergencyData: ConfirmEmergencyInput = {
                utterance: draftPrompt,
                category: 'unknown',
                matchedPhrase: null,
              };
              data = emergencyData;
              break;
            }
            case 'polish_briefing': {
              const briefingData: PolishBriefingInput = {
                metrics: {},
                template: draftPrompt,
                voiceNotes: ctx.property.rulesText.slice(0, 500),
              };
              data = briefingData;
              break;
            }
            case 'dispatch_vendor': {
              if (!resolvedVendor) {
                return text(
                  'A vendor name is required to prepare the dispatch for review. No action was completed.',
                );
              }
              if (!args.workOrderRef) {
                return text(
                  'An existing work order is required to prepare the vendor dispatch. No action was completed.',
                );
              }
              const dispatchData: DispatchVendorInput = {
                workOrderId: args.workOrderRef,
                category: resolvedVendor.category ?? 'general',
                urgency: 'routine',
                description: draftPrompt,
                candidateVendorIds: [resolvedVendor.id],
              };
              data = dispatchData;
              routing = {
                workOrderId: args.workOrderRef,
                vendorId: resolvedVendor.id,
              };
              break;
            }
            case 'update_rulebook': {
              const rulebookData: UpdateRulebookInput = {
                proposedAdditions: [draftPrompt],
                currentRulebook: ctx.property.rulesText,
              };
              data = rulebookData;
              break;
            }
            default: {
              // Wave-6 write action_types are intercepted by the
              // `isHandlerAction` branch above, so this default is purely
              // defensive — it would only trigger if a new draft-style
              // action_type is added without wiring a case.
              return text('That operation is not supported here.');
            }
          }

          // 4. Spawn the worker. On-prem hosts are configuration, not model
          // context, so resolve the scoped value only at the provider boundary.
          let inMemory: ActionProposal;
          try {
            const ollamaHost =
              !deps.provider && ctx.property.privacyMode === 'on_prem'
                ? await loadOllamaHost(
                    deps.admin,
                    deps.organizationId,
                    resolvedPropertyId,
                  )
                : null;
            const provider =
              deps.provider ??
              selectProvider(
                {
                  privacyMode: ctx.property.privacyMode,
                  ollamaHost,
                },
                { actionType: args.action_type },
              );
            inMemory = await spawnPropertyWorker({
              propertyId: resolvedPropertyId,
              action_type: args.action_type,
              data,
              deps: {
                client: deps.admin as unknown as SupabaseLike,
                provider,
              },
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            deps.emit({
              type: 'tool.error',
              name: 'spawn_property_worker',
              message,
            });
            return text(
              `The ${reviewActionLabel(args.action_type).toLowerCase()} could not be prepared. No action was completed.`,
            );
          }

          // 4.5. Phase A4 — deterministic currency grounding on
          // tenant-facing draft bodies. Allowed set mirrors the
          // claude-draft path: operator prompt (the inbound here),
          // recent conversation turns, context rent amounts, rulebook.
          // Ungrounded amounts demote 'auto' to 'review' (never block).
          const draftBody = extractDraftBody(
            args.action_type,
            inMemory.payload,
          );
          let forceReview: { reason: string } | undefined;
          if (draftBody !== null) {
            const grounding = validateNumericGrounding(
              draftBody,
              buildGroundingAllowedTexts(draftPrompt, ctx),
            );
            if (!grounding.ok) {
              forceReview = {
                reason: `ungrounded currency amounts in draft: ${grounding.ungrounded.join(', ')}`,
              };
            }
          }

          // 5. Persist.
          const recordInput: RecordProposalInput = {
            organizationId: deps.organizationId,
            propertyId: resolvedPropertyId,
            workerModel: inMemory.workerModel,
            actionType: args.action_type,
            payload: inMemory.payload,
            reasoning: inMemory.reasoning,
            confidence: inMemory.confidence,
            contextFactIds: inMemory.context_fact_ids,
            // Pass the loaded fact set so gateProposal can run the citation
            // validator. The validator gates on ODESA_CITATION_ENFORCEMENT
            // (default OFF = warn-only). Without ctx.facts here, the
            // validator silently skips and the feature flag has no teeth
            // even when flipped on.
            contextFacts: ctx.facts,
            autonomyLevel: ctx.property.autonomyLevel,
            privacyMode: ctx.property.privacyMode,
            ...(forceReview ? { forceReview } : {}),
            routing,
          };

          let recorded: { proposal: ActionProposal; decisionOutcome: string };
          try {
            const result = await recordProposal(deps.admin, recordInput);
            recorded = {
              proposal: result.proposal,
              decisionOutcome: result.decision.outcome,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            deps.emit({
              type: 'tool.error',
              name: 'spawn_property_worker',
              message,
            });
            return text('The draft could not be recorded. No action was completed.');
          }

          deps.emit({ type: 'proposal.recorded', proposal: recorded.proposal });

          // 6. Gate dispatch.
          const proposalId = recorded.proposal.id;
          const actorNeedsReview =
            recorded.decisionOutcome === 'auto' &&
            actorRequiresOwnerReview(
              deps.commitActor,
              recorded.proposal.action_type,
            );
          if (
            recorded.decisionOutcome === 'auto' &&
            !actorNeedsReview &&
            proposalId
          ) {
            let commitResult;
            try {
              commitResult = await commitProposal(
                deps.admin,
                proposalId,
                deps.commitActor,
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              deps.emit({
                type: 'tool.error',
                name: 'spawn_property_worker',
                message: `commit failed for ${proposalId}: ${message}`,
              });
              return text(
                'The operation was recorded but could not be completed. It needs reconciliation.',
              );
            }
            if (
              !commitResult.changed ||
              commitResult.proposal.status !== 'committed'
            ) {
              const message = `side effect ${commitResult.proposal.status}`;
              deps.emit({
                type: 'tool.error',
                name: 'spawn_property_worker',
                message,
              });
              return text(
                'The operation was recorded but could not be completed. It needs reconciliation.',
              );
            }
            deps.emit({
              type: 'proposal.committed',
              proposal: recorded.proposal,
            });
            return text(
              describeDraft(
                args,
                resolvedTenant,
                'completed automatically',
              ),
            );
          }

          if (
            (recorded.decisionOutcome === 'review' || actorNeedsReview) &&
            proposalId
          ) {
            const buildUrl =
              deps.buildReviewUrl ??
              ((propertyId: string, reviewProposalId: string) =>
                defaultReviewUrl(
                  deps.commitActor,
                  propertyId,
                  reviewProposalId,
                ));
            const reviewUrl = buildUrl(resolvedPropertyId, proposalId);
            deps.emit({
              type: 'proposal.review_required',
              proposal: recorded.proposal,
              reviewUrl,
            });
            return text(
              describeDraft(args, resolvedTenant, 'needs review in Owner Queue'),
            );
          }

          // 'block' or any other terminal — surface as error.
          deps.emit({
            type: 'tool.error',
            name: 'spawn_property_worker',
            message: `Action blocked by policy (gate=${recorded.decisionOutcome}).`,
          });
          return text('This operation cannot proceed under the current safety policy.');
        },
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Resolution helpers — exported for unit testing
// ---------------------------------------------------------------------------

export type ResolveResult<T> =
  | { kind: 'unique'; match: T }
  | { kind: 'ambiguous'; candidates: T[] }
  | { kind: 'miss' };

export function resolveTenant(
  ctx: PropertyContext,
  query: string,
): ResolveResult<ContextTenantSummary> {
  const needle = query.toLowerCase().trim();
  const matches = ctx.tenants.filter((t) =>
    t.fullName.toLowerCase().includes(needle),
  );
  if (matches.length === 0) return { kind: 'miss' };
  if (matches.length > 1) return { kind: 'ambiguous', candidates: matches };
  return { kind: 'unique', match: matches[0]! };
}

export function resolveVendor(
  ctx: PropertyContext,
  query: string,
): ResolveResult<ContextVendorSummary> {
  const needle = query.toLowerCase().trim();
  const matches = ctx.vendors.filter((v) =>
    v.name.toLowerCase().includes(needle),
  );
  if (matches.length === 0) return { kind: 'miss' };
  if (matches.length > 1) return { kind: 'ambiguous', candidates: matches };
  return { kind: 'unique', match: matches[0]! };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function getOrLoadContext(
  deps: CreateSpawnMcpDeps,
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

async function loadOllamaHost(
  admin: SupabaseClient<Database>,
  organizationId: string,
  propertyId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('properties')
    .select('ollama_host')
    .eq('organization_id', organizationId)
    .eq('id', propertyId)
    .maybeSingle();

  if (error) {
    throw new Error(`Ollama host lookup failed: ${error.message}`);
  }
  return data?.ollama_host?.trim() || null;
}

/** Tenant-facing draft body per action_type — the surface the numeric
 *  grounding guard runs against. Null for non-draft payloads. */
function extractDraftBody(
  actionType: WorkerActionType,
  payload: WorkerActionPayload,
): string | null {
  if (actionType === 'draft_sms_reply') {
    return (payload as DraftSmsReplyPayload).body;
  }
  if (actionType === 'dispatch_vendor') {
    return (payload as DispatchVendorPayload).smsBody;
  }
  return null;
}

/** Allowed grounding sources for an operator-initiated draft: the
 *  operator's prompt, recent conversation turns, every tenant's lease
 *  rent (raw and formatted), and the rulebook. */
function buildGroundingAllowedTexts(
  prompt: string,
  ctx: PropertyContext,
): string[] {
  const rentTexts = ctx.tenants.flatMap((t) =>
    t.rentAmount !== null
      ? [String(t.rentAmount), `$${t.rentAmount.toLocaleString('en-US')}`]
      : [],
  );
  return [
    prompt,
    ...ctx.recentTurns.map((t) => t.body ?? ''),
    ...rentTexts,
    ctx.property.rulesText,
  ];
}

function describeDraft(
  args: { action_type: WorkerActionType; prompt?: string | undefined },
  tenant: ContextTenantSummary | null,
  status: string,
): string {
  if (args.action_type === 'draft_sms_reply' && tenant) {
    return `Drafted SMS to ${tenant.fullName}; ${status}.`;
  }
  return `${humanActionLabel(args.action_type)}; ${status}.`;
}

function humanActionLabel(actionType: WorkerActionType): string {
  const labels: Partial<Record<WorkerActionType, string>> = {
    draft_sms_reply: 'Tenant reply drafted',
    dispatch_vendor: 'Vendor dispatch prepared',
    update_rulebook: 'Property guidance update prepared',
    create_property: 'Property record created',
    add_unit: 'Unit record created',
    add_tenant: 'Tenant record prepared',
    set_lease_terms: 'Lease terms prepared',
    update_rent: 'Rent change prepared',
    waive_rent: 'Rent waiver prepared',
    send_tenant_message: 'Tenant message prepared',
    log_maintenance_ticket: 'Maintenance ticket logged',
    update_property_rules: 'Property rules update prepared',
    archive_lease: 'Lease archival prepared',
    add_appliance: 'Appliance record created',
    update_appliance: 'Appliance record updated',
    set_property_vendor: 'Preferred vendor change prepared',
    update_tenant_preference: 'Tenant preference update prepared',
    request_rent_payment: 'Rent payment request prepared',
    schedule_calendar_event: 'Calendar event prepared',
    cancel_calendar_event: 'Calendar cancellation prepared',
  };
  return labels[actionType] ?? 'Property operation prepared';
}

// ---------------------------------------------------------------------------
// Wave 6 — write action handler
// ---------------------------------------------------------------------------
//
// Portfolio-write action_types (create_property, add_unit, add_tenant,
// set_lease_terms, update_rent, send_tenant_message,
// log_maintenance_ticket, update_property_rules, archive_lease) come in
// with a structured `payload` produced by the dispatcher itself — no
// per-property worker LLM is involved. We validate the payload, attach
// the proposal to a property anchor (action_proposals.property_id is
// NOT NULL), and ride the same record + gate + commit pipeline as
// draft actions. Only provider-free, low-blast-radius internal records may
// auto-route through WORKER_HANDLERS; commitments remain in Owner Queue.

interface WriteActionArgs {
  action_type: WorkerActionType;
  payload?: unknown;
  propertyName?: string | undefined;
  prompt?: string | undefined;
}

async function handleWriteAction(
  deps: CreateSpawnMcpDeps,
  args: WriteActionArgs,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  // 0. Validate payload via WORKER_PAYLOAD_SCHEMAS[action_type].
  const schema = WORKER_PAYLOAD_SCHEMAS[args.action_type];
  const parsed = schema.safeParse(args.payload);
  if (!parsed.success) {
    const summary = parsed.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    deps.emit({
      type: 'tool.error',
      name: 'spawn_property_worker',
      message: `Invalid ${args.action_type} payload: ${summary}`,
    });
    return text(
      `The ${reviewActionLabel(args.action_type).toLowerCase()} request was malformed. No action was completed.`,
    );
  }
  const validatedPayload = parsed.data as WorkerActionPayload;

  // 1. Pick a property anchor.
  //    - If the model supplied propertyName and it resolves uniquely,
  //      use that. (Useful for add_unit / update_property_rules / etc.
  //      where the operator named the property.)
  //    - Otherwise fall back to orgContext.properties[0]. The handler
  //      registry never reads action_proposals.property_id; this is
  //      purely a NOT NULL anchor for the audit row.
  let anchorProperty: OrganizationContext['properties'][number] | null = null;
  if (args.propertyName) {
    const resolved = resolvePropertyName(
      deps.orgContext.properties,
      args.propertyName,
    );
    if (resolved.kind === 'unique') {
      anchorProperty = resolved.property;
    }
  }
  if (anchorProperty === null) {
    anchorProperty = deps.orgContext.properties[0] ?? null;
  }
  if (anchorProperty === null) {
    deps.emit({
      type: 'tool.error',
      name: 'spawn_property_worker',
      message: `No property exists to anchor ${args.action_type}`,
    });
    return text(
      `The ${reviewActionLabel(args.action_type).toLowerCase()} could not be prepared because no property record is available. Add a property first.`,
    );
  }
  const anchorPropertyId = anchorProperty.id;

  // 2. Synthesize an in-memory ActionProposal. No worker LLM call.
  //    Confidence describes parse/reference quality only. It is never consent:
  //    explicit safety disposition still keeps consequential writes in review.
  const reasoning =
    typeof args.prompt === 'string' && args.prompt.length > 0
      ? args.prompt
      : `Prepared from the current Ask Odesa request: ${reviewActionLabel(args.action_type)}.`;

  const recordInput: RecordProposalInput = {
    organizationId: deps.organizationId,
    propertyId: anchorPropertyId,
    workerModel: 'dispatcher-direct',
    actionType: args.action_type,
    payload: validatedPayload,
    reasoning,
    confidence: 0.9,
    contextFactIds: [],
    autonomyLevel: anchorProperty.autonomyLevel,
    privacyMode: (anchorProperty.privacyMode === 'on_prem'
      ? 'on_prem'
      : 'hosted') as 'hosted' | 'on_prem',
    routing: null,
  };

  let recorded: { proposal: ActionProposal; decisionOutcome: string };
  try {
    const result = await recordProposal(deps.admin, recordInput);
    recorded = {
      proposal: result.proposal,
      decisionOutcome: result.decision.outcome,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.emit({
      type: 'tool.error',
      name: 'spawn_property_worker',
      message,
    });
    return text('The operation could not be recorded. No action was completed.');
  }

  deps.emit({ type: 'proposal.recorded', proposal: recorded.proposal });

  // 3. Gate dispatch — same semantics as draft actions.
  const proposalId = recorded.proposal.id;
  const actorNeedsReview =
    recorded.decisionOutcome === 'auto' &&
    actorRequiresOwnerReview(deps.commitActor, recorded.proposal.action_type);
  if (recorded.decisionOutcome === 'auto' && !actorNeedsReview && proposalId) {
    let commitResult;
    try {
      commitResult = await commitProposal(
        deps.admin,
        proposalId,
        deps.commitActor,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.emit({
        type: 'tool.error',
        name: 'spawn_property_worker',
        message: `commit failed for ${proposalId}: ${message}`,
      });
      return text(
        'The operation was recorded but could not be completed. It needs reconciliation.',
      );
    }

    // Forward handler outcome evidence on the committed event. Failed handler
    // work remains failed/reconciliation evidence and never emits committed.
    const dispatch = commitResult?.dispatch;
    const handlerOutcome =
      dispatch && dispatch.kind === 'handler'
        ? {
            ok: dispatch.result.ok,
            ...(!dispatch.result.ok ? { error: dispatch.result.error } : {}),
            confidence: dispatch.result.confidence,
            ...(dispatch.result.ok && dispatch.result.idempotent
              ? { idempotent: true }
              : {}),
          }
        : undefined;

    if (
      !commitResult.changed ||
      commitResult.proposal.status !== 'committed' ||
      (handlerOutcome && !handlerOutcome.ok)
    ) {
      const error =
        handlerOutcome?.error ?? `side effect ${commitResult.proposal.status}`;
      deps.emit({
        type: 'tool.error',
        name: 'spawn_property_worker',
        message: `proposal ${proposalId} not committed: ${error}`,
      });
      return text(
        'The operation was recorded but could not be completed. It needs reconciliation.',
      );
    }

    deps.emit({
      type: 'proposal.committed',
      proposal: commitResult.proposal,
      ...(handlerOutcome ? { handlerOutcome } : {}),
    });

    return text(`${humanActionLabel(args.action_type)} automatically.`);
  }

  if (
    (recorded.decisionOutcome === 'review' || actorNeedsReview) &&
    proposalId
  ) {
    const buildUrl =
      deps.buildReviewUrl ??
      ((propertyId: string, reviewProposalId: string) =>
        defaultReviewUrl(
          deps.commitActor,
          propertyId,
          reviewProposalId,
        ));
    const reviewUrl = buildUrl(anchorPropertyId, proposalId);
    deps.emit({
      type: 'proposal.review_required',
      proposal: recorded.proposal,
      reviewUrl,
    });
    return text(
      `${reviewActionLabel(args.action_type)}; needs review in Owner Queue.`,
    );
  }

  // 'block' or any other terminal — surface as error.
  deps.emit({
    type: 'tool.error',
    name: 'spawn_property_worker',
    message: `Action blocked by policy (gate=${recorded.decisionOutcome}).`,
  });
  return text('This operation cannot proceed under the current safety policy.');
}

function actorRequiresOwnerReview(
  actor: CommitActor,
  actionType: WorkerActionType,
): boolean {
  // Safety disposition is load-bearing and actor-independent. Even an owner
  // chat turn creates a proposal first; the consequential commitment happens
  // only after an explicit human review action in Owner Queue.
  if (requiresHumanReview(actionType)) return true;
  if (commitActorForbidden(actor, actionType)) return true;
  if (
    actor.kind === 'user' &&
    (actor.role === 'va' || actor.role === null) &&
    (isHandlerAction(actionType) || actionType === 'update_rulebook')
  ) {
    return true;
  }
  return (
    actor.kind === 'user' &&
    actor.role !== 'owner' &&
    OWNER_HANDOFF_ACTIONS.has(actionType)
  );
}

function defaultReviewUrl(
  actor: CommitActor,
  _propertyId: string,
  proposalId: string,
): string {
  return actor.kind === 'user' &&
    (actor.role === 'va' || actor.role === null)
    ? `/escalations?proposal=${encodeURIComponent(proposalId)}`
    : '/owner-queue';
}

function text(s: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: s }] };
}
