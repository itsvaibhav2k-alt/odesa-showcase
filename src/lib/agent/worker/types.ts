/**
 * Per-property worker types — v1.5 (Phase 4.5 addendum).
 *
 * Shared shapes consumed by:
 *   - this directory's context-loader / system-prompt / spawn
 *   - src/lib/agent/worker/providers/* (HostedHaiku, Ollama, select)
 *   - src/lib/agent/worker/commit-gate.ts + trust.ts
 *   - src/lib/agent/proposals/* (record, commit, outcome)
 *   - src/lib/agent/memory/* (record, query, types)
 *   - src/lib/agent/meta/*   (reflection, synthesis, cross-property)
 *   - src/lib/messaging/claude-draft.ts (replaced stub)
 *   - src/lib/agent/whitelist.ts + emergency.ts (ambiguity wraps)
 *
 * Source of truth for the structure: addendum at
 * /Users/vaibhav/.claude/plans/reactive-launching-parrot.md (lines
 * 619-1037). Schema-bound shapes mirror the migrations at
 * supabase/migrations/20260428000000_property_workers.sql.
 *
 * The Zod schemas at the bottom are the runtime validation contract
 * for worker output and any provider implementation. They are the
 * *only* source-of-truth for the JSON envelope we expect; the
 * handcrafted TypeScript types above are for editor ergonomics and
 * derive from the schemas via z.infer where possible.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// action_type — every distinct verb a property worker can propose
// ---------------------------------------------------------------------------
//
// These names align 1:1 with the integration table in the addendum
// (Section "Integration with existing v1 phases"). Keep this union
// closed so the gate matrix and the provider tool surface stay in
// sync. Adding a new verb requires touching:
//   - this union
//   - WORKER_ACTION_TYPES below (z.enum mirror)
//   - commit-gate.ts decision matrix
//   - proposals/commit.ts dispatch switch
//   - the corresponding skill or prompt fragment

export const WORKER_ACTION_TYPES = [
  'draft_sms_reply',
  'classify_intent',
  'confirm_emergency',
  'polish_briefing',
  'dispatch_vendor',
  'update_rulebook',
  // Wave 6 — dispatcher portfolio + messaging tools. The explicit safety
  // disposition in commit-gate.ts decides whether an internal record may be
  // captured automatically or the proposal must wait for human review.
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
  // Wave 7 — property data depth + integrations.
  // Each entry below is a write verb the dispatcher can spawn through
  // `spawn_property_worker`. External/provider/money commitments are
  // review-only; provider-free internal records may be gated for auto.
  // Handlers live in src/lib/agent/worker/handlers/* and are wired
  // through WORKER_HANDLERS in handlers/index.ts. Stream A ships
  // payload schemas + registry stubs; Streams P/G/S replace the stubs.
  'add_appliance',
  'update_appliance',
  'set_property_vendor',
  'update_tenant_preference',
  'request_rent_payment',
  'schedule_calendar_event',
  'cancel_calendar_event',
  // Feature 5 — proactive health-check proposals. NOT a model verb:
  // the deterministic daily-health-check cron (src/lib/health) is the
  // only producer (worker_model sentinel 'system-health-check'). Pure
  // acknowledge: gate policy is review_only (commit-gate.ts) and
  // proposals/commit.ts dispatches it as an explicit no-op — owner
  // approve = acknowledge, decline = dismiss. Side effect of being
  // registered here: 'health_flag' also joins the dispatcher tool enum
  // z.enum(WORKER_ACTION_TYPES) in operator/mcps/spawn.ts; it is not a
  // HandlerActionType, so a model attempt falls to the existing
  // 'Unsupported action_type' branch — harmless.
  'health_flag',
  // Voice Operator V1 — system-generated call-outcome review. NOT a
  // model verb: the Retell webhook's call_ended compiler (src/lib/voice)
  // is the only producer. Pure acknowledge, same shape as health_flag:
  // gate policy is review_only (commit-gate.ts) and proposals/commit.ts
  // dispatches it as an explicit no-op — owner approve = acknowledge.
  'voice_call_review',
] as const;

export type WorkerActionType = (typeof WORKER_ACTION_TYPES)[number];

// ---------------------------------------------------------------------------
// Per-action payload shapes
// ---------------------------------------------------------------------------
//
// Inputs and outputs are kept structurally shallow on purpose: the
// worker should not be reaching into nested DB rows; the context
// loader is responsible for flattening anything the prompt needs. Any
// nested object on the request side should be JSON-serializable so
// caching / replay is trivial.

export interface DraftSmsReplyInput {
  tenantId: string | null;
  tenantName: string | null;
  phoneE164: string | null;
  conversationId: string;
  inboundBody: string;
  /** Last N exchanges, oldest first; assistant + tenant turns. */
  history: ReadonlyArray<{ role: 'tenant' | 'assistant'; body: string }>;
}

export interface DraftSmsReplyPayload {
  body: string;
  /** Optional rationale fragment surfaced inline in the drafts queue. */
  tone: 'neutral' | 'firm' | 'warm' | 'apologetic';
}

export interface ClassifyIntentInput {
  utterance: string;
  history: ReadonlyArray<{ role: 'tenant' | 'assistant'; body: string }>;
  /** Hints from the lexical whitelist (whitelist.ts) when ambiguous. */
  candidateIntents: ReadonlyArray<string>;
}

export interface ClassifyIntentPayload {
  intent: string;
  reasoning: string;
}

export interface ConfirmEmergencyInput {
  utterance: string;
  category: string;
  matchedPhrase: string | null;
}

export interface ConfirmEmergencyPayload {
  isEmergency: boolean;
  category: string;
  recommendedAction: 'escalate_now' | 'route_to_drafts' | 'callback';
}

export interface PolishBriefingInput {
  metrics: Record<string, number | string | boolean | null>;
  template: string;
  /** Owner voice cues lifted from rulebook + recent owner edits. */
  voiceNotes: string;
}

export interface PolishBriefingPayload {
  prose: string;
}

export interface DispatchVendorInput {
  workOrderId: string;
  category: string;
  urgency: 'emergency' | 'urgent' | 'routine';
  description: string;
  candidateVendorIds: ReadonlyArray<string>;
}

export interface DispatchVendorPayload {
  /**
   * Index into the input's `candidateVendorIds` array — NOT a UUID.
   * The model picks from the finite candidate set; the orchestrator
   * resolves the index to a vendor UUID and persists it on
   * ProposalRouting.vendorId before commitProposal dispatches.
   *
   * Why an index instead of a UUID: UUIDs are orchestrator-side
   * identifiers (Privacy Mode invariant — see ProposalRouting).
   * Picking by index keeps the model's output free of FK identifiers
   * while still letting the model express a vendor choice. The
   * choice is also trivially validatable (must be in
   * `[0, candidateVendorIds.length)`).
   *
   * Bounds-check responsibility: the zod schema only enforces
   * `>= 0`. The upper bound (`< candidateVendorIds.length`) is the
   * dispatch-vendor handler's job at resolution time — it has the
   * candidate list in scope; spawn.ts and recordProposal don't.
   */
  candidateIndex: number;
  smsBody: string;
}

export interface UpdateRulebookInput {
  proposedAdditions: ReadonlyArray<string>;
  currentRulebook: string;
}

export interface UpdateRulebookPayload {
  newRulebook: string;
  diffSummary: string;
}

// Narrow input/output discriminator for compile-time safety on callers.

export type WorkerActionInput =
  | { action_type: 'draft_sms_reply'; data: DraftSmsReplyInput }
  | { action_type: 'classify_intent'; data: ClassifyIntentInput }
  | { action_type: 'confirm_emergency'; data: ConfirmEmergencyInput }
  | { action_type: 'polish_briefing'; data: PolishBriefingInput }
  | { action_type: 'dispatch_vendor'; data: DispatchVendorInput }
  | { action_type: 'update_rulebook'; data: UpdateRulebookInput };

export type WorkerActionPayload =
  | DraftSmsReplyPayload
  | ClassifyIntentPayload
  | ConfirmEmergencyPayload
  | PolishBriefingPayload
  | DispatchVendorPayload
  | UpdateRulebookPayload
  | CreatePropertyPayload
  | AddUnitPayload
  | AddTenantPayload
  | SetLeaseTermsPayload
  | UpdateRentPayload
  | SendTenantMessagePayload
  | LogMaintenanceTicketPayload
  | UpdatePropertyRulesPayload
  | ArchiveLeasePayload
  | AddAppliancePayload
  | UpdateAppliancePayload
  | SetPropertyVendorPayload
  | UpdateTenantPreferencePayload
  | RequestRentPaymentPayload
  | ScheduleCalendarEventPayload
  | CancelCalendarEventPayload
  | HealthFlagPayload
  | VoiceCallReviewPayload;

// ---------------------------------------------------------------------------
// PropertyContext — what the system prompt is built from
// ---------------------------------------------------------------------------
//
// The shape mirrors the columns/tables it is loaded from, but
// flattened to strings/primitives where the prompt only needs
// presentation. Keep this lean — Haiku 4.5 input is cheap, but the
// cache hit rate depends on this block being deterministic.

export interface ContextPropertySummary {
  id: string;
  organizationId: string;
  name: string;
  addressLine: string | null;
  timezone: string | null;
  rulesText: string;
  autonomyLevel: number;
  privacyMode: 'hosted' | 'on_prem';
}

export interface ContextFact {
  id: string;
  factType:
    | 'vendor_relationship'
    | 'tenant_pattern'
    | 'building_quirk'
    | 'derived_rule'
    | 'owner_rule';
  subjectId: string | null;
  /** JSON-encoded body — the prompt renders this inline. */
  content: unknown;
  confidence: number;
  source: 'observed' | 'owner_stated' | 'derived' | 'meta_learned';
  createdAt: string;
}

export interface ContextConversationTurn {
  conversationId: string;
  channel: 'voice' | 'sms' | 'imessage';
  direction: 'inbound' | 'outbound';
  body: string | null;
  occurredAt: string;
}

export interface ContextVendorSummary {
  id: string;
  name: string;
  category: string | null;
  acceptanceRate: number | null;
}

export interface ContextTenantSummary {
  id: string;
  fullName: string;
  unitLabel: string | null;
  rentStatus: string | null;
  /**
   * Monthly rent from the tenant's active/pending lease (dollars, as
   * stored on `leases.rent_amount`). Null when the lease carries no
   * parseable amount. Rendered into the worker system prompt so the
   * model can state the correct figure instead of inventing one, and
   * fed into `validateNumericGrounding`'s allowed set.
   */
  rentAmount: number | null;
}

export interface PropertyContext {
  property: ContextPropertySummary;
  facts: ReadonlyArray<ContextFact>;
  recentTurns: ReadonlyArray<ContextConversationTurn>;
  vendors: ReadonlyArray<ContextVendorSummary>;
  tenants: ReadonlyArray<ContextTenantSummary>;
  /** Wall-clock at load — lets the system prompt show "now" deterministically. */
  loadedAt: string;
}

// ---------------------------------------------------------------------------
// Worker IO envelopes
// ---------------------------------------------------------------------------

/**
 * Per-org assistant identity threaded through to the worker system prompt
 * so it introduces itself as the operator's chosen brand. Optional on the
 * input to keep providers and tests that don't need it concise — when
 * absent, providers fall back to the static DEFAULT_BRANDING in
 * system-prompt.ts.
 *
 * Lives here (not in system-prompt.ts) to avoid a types ↔ system-prompt
 * import cycle: system-prompt.ts already depends on types.ts.
 */
export interface WorkerBranding {
  /** Display name of the organization (e.g. "Galaxy Estates"). */
  orgName: string;
  /** Per-org assistant name; defaults to "Odesa" when not customised. */
  assistantName: string;
}

export interface PropertyWorkerInput {
  propertyId: string;
  organizationId: string;
  action_type: WorkerActionType;
  /**
   * Untyped at this layer because the discriminator binding belongs
   * to call sites. Validated against the per-action zod schemas in
   * spawn.ts before being handed to the model.
   */
  data: unknown;
  /** Loaded by spawn.ts; passed through to providers verbatim. */
  context: PropertyContext;
  /**
   * Per-org assistant identity. Loaded once per spawn via
   * loadOrganizationBranding; threaded into buildWorkerSystemPrompt so
   * the worker's persona reflects the operator's brand. Optional —
   * absent means use DEFAULT_BRANDING ("the operator" / "Odesa").
   */
  branding?: WorkerBranding;
}

export interface PropertyWorkerOutput {
  action_type: WorkerActionType;
  payload: WorkerActionPayload;
  reasoning: string;
  confidence: number;
  /** memory_facts.id values that informed the proposal. */
  context_fact_ids: ReadonlyArray<string>;
}

// ActionProposal = the persistence shape consumed by the gate +
// proposals layer. PropertyWorkerOutput is the model-side; this is
// the storage-side. Keep them separate so we can evolve worker
// output without churning the DB schema.

/**
 * Ambient routing context that the orchestrator already knows when it
 * spawns a worker — tenant id, conversation id, work order id, etc.
 * Persisted on the proposal row so commit-time dispatch can fire
 * without re-resolving lookups (the inbound conversation may have
 * advanced or the tenant may have been deleted by the time a
 * review-gated proposal commits).
 *
 * Strict invariant: NEVER passed to the model and NEVER written to
 * `payload`. The model only ever sees prompt context; routing is
 * Odesa-side metadata. This is the privacy boundary for Privacy Mode
 * (Ollama on-prem) — without this split, FK UUIDs would have to ride
 * through an external prompt to come back out the other side.
 *
 * Each field is optional because the relevant key depends on
 * action_type:
 *   - draft_sms_reply  → tenantId, conversationId
 *   - dispatch_vendor  → workOrderId, vendorId
 *   - polish_briefing  → weeklyReportId
 *   - classify_intent / confirm_emergency / update_rulebook → routing is null
 *
 * v1.9: scheduled actions (`scheduled_actions` row) re-spawn a worker
 * at trigger_at. The proposal that comes out of that re-spawn carries
 * `scheduledActionId` so the audit trail links proposal → schedule.
 * Set by `spawn-for-schedule.ts`; never set by the model or by
 * inbound-message dispatchers.
 */
export interface ProposalRouting {
  tenantId?: string;
  conversationId?: string;
  workOrderId?: string;
  vendorId?: string;
  weeklyReportId?: string;
  scheduledActionId?: string;
}

export interface ActionProposal {
  /** Filled by proposals/record.ts; null on the in-memory pre-persist value. */
  id: string | null;
  organizationId: string;
  propertyId: string;
  workerModel: string;
  action_type: WorkerActionType;
  /** Faithful snapshot of model output. Audit-pure; no orchestrator metadata. */
  payload: WorkerActionPayload;
  /**
   * Human edit overlay stored separately from immutable model output. A
   * non-null malformed overlay must fail closed at commit time.
   */
  editDiff?: unknown | null;
  /**
   * Ambient context the orchestrator persists alongside the model
   * output. Null for action_types that don't need any routing.
   */
  routing: ProposalRouting | null;
  reasoning: string;
  confidence: number;
  context_fact_ids: ReadonlyArray<string>;
  /** Decided by commit-gate.ts AFTER worker returns. */
  gate_decision: 'auto' | 'review' | 'block' | null;
  status:
    | 'proposed'
    | 'committing'
    | 'committed'
    | 'failed'
    | 'unsupported'
    | 'rejected'
    | 'edited'
    | 'expired';
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------
//
// HostedHaikuProvider + OllamaProvider implement this. select.ts
// picks one based on properties.privacy_mode. The interface is
// deliberately minimal so the rest of the worker stack does not care
// which model answered.

export interface ProviderHealth {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface WorkerCallOptions {
  /**
   * Cancellation signal forwarded to the underlying SDK / HTTP call.
   * Implementations should abort in-flight work and reject with the
   * abort reason. Optional; spawn.ts does not currently pass one.
   */
  signal?: AbortSignal;
}

export interface WorkerModelProvider {
  /** Stable identifier persisted to action_proposals.worker_model. */
  readonly name: string;
  /** Returns true iff the provider sets `cache_control` blocks on input. */
  supportsPromptCaching(): boolean;
  call(
    input: PropertyWorkerInput,
    options?: WorkerCallOptions,
  ): Promise<PropertyWorkerOutput>;
  healthCheck(): Promise<ProviderHealth>;
}

// ---------------------------------------------------------------------------
// Zod schemas — runtime validation
// ---------------------------------------------------------------------------
//
// These are consumed by spawn.ts (validate output before persisting),
// the providers (parse model JSON), and the test suite. Keep them
// loosely aligned with the TS types above; for the payload union we
// validate per action_type discriminator.

export const workerActionTypeSchema = z.enum(WORKER_ACTION_TYPES);

export const draftSmsReplyPayloadSchema = z.object({
  body: z.string().min(1).max(1600),
  tone: z.enum(['neutral', 'firm', 'warm', 'apologetic']),
});

export const classifyIntentPayloadSchema = z.object({
  intent: z.string().min(1),
  reasoning: z.string(),
});

export const confirmEmergencyPayloadSchema = z.object({
  isEmergency: z.boolean(),
  category: z.string(),
  recommendedAction: z.enum(['escalate_now', 'route_to_drafts', 'callback']),
});

export const polishBriefingPayloadSchema = z.object({
  prose: z.string().min(1),
});

export const dispatchVendorPayloadSchema = z.object({
  candidateIndex: z.number().int().nonnegative(),
  smsBody: z.string().min(1).max(1600),
});

export const updateRulebookPayloadSchema = z.object({
  newRulebook: z.string().max(4000),
  diffSummary: z.string(),
});

// ---------------------------------------------------------------------------
// Wave 6 — agentic dispatcher payload schemas
// ---------------------------------------------------------------------------
//
// These schemas validate the model-side payload for each new write
// action. Refs are union-typed so the model can pass a UUID when it
// knows one, or a name when the dispatcher resolved by intent. The
// handler (Stream B/C) calls into resolve-refs.ts to convert names
// to ids before mutating.
//
// Ref-shape forgiveness (Sonnet 4.6 stress-test fix, 2026-05-07):
// the LLM frequently emits ref payloads like
//   { propertyName: "Vaba House", propertyId: undefined }  (both keys, one undef)
//   { propertyName: "vaba house" }                          (lowercased, fine)
//   { propertyId: "vaba house" }                            (non-UUID under propertyId)
// or even hoists the name to the top level:
//   { propertyName: "Vaba House", label: "1", ... }         (no propertyRef wrapper)
// Strict zod unions reject all of these. We coerce them into the
// canonical nested-name shape with a preprocess step, so the handler's
// resolve-refs path takes over (substring-match against the org).

const isStringId = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;
const isUuidLike = (v: unknown): boolean =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Normalize a {propertyId,propertyName} ref. Drops UUID-shaped values
 *  from `propertyName` and non-UUID values from `propertyId` so the
 *  union picks the right branch. */
function coercePropertyRef(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (isStringId(v['propertyId']) && isUuidLike(v['propertyId'])) {
    return { propertyId: v['propertyId'] };
  }
  const name =
    (isStringId(v['propertyName']) ? v['propertyName'] : null) ??
    (isStringId(v['propertyId']) ? (v['propertyId'] as string) : null) ??
    (isStringId(v['name']) ? (v['name'] as string) : null);
  if (name !== null) return { propertyName: name };
  return value;
}

function coerceUnitRef(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (isStringId(v['unitId']) && isUuidLike(v['unitId'])) {
    return { unitId: v['unitId'] };
  }
  const label =
    (isStringId(v['unitLabel']) ? v['unitLabel'] : null) ??
    (isStringId(v['label']) ? v['label'] : null);
  const propertyName = isStringId(v['propertyName'])
    ? v['propertyName']
    : isStringId(v['property']) ? v['property'] : undefined;
  if (label !== null) {
    return propertyName !== undefined
      ? { unitLabel: label, propertyName }
      : { unitLabel: label };
  }
  return value;
}

function coerceTenantRef(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (isStringId(v['tenantId']) && isUuidLike(v['tenantId'])) {
    return { tenantId: v['tenantId'] };
  }
  const name =
    (isStringId(v['tenantName']) ? v['tenantName'] : null) ??
    (isStringId(v['fullName']) ? v['fullName'] : null) ??
    (isStringId(v['name']) ? v['name'] : null);
  if (name !== null) return { tenantName: name };
  return value;
}

function coerceLeaseRef(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (isStringId(v['leaseId']) && isUuidLike(v['leaseId'])) {
    return { leaseId: v['leaseId'] };
  }
  if (
    isStringId(v['tenantId']) &&
    isUuidLike(v['tenantId']) &&
    isStringId(v['unitId']) &&
    isUuidLike(v['unitId'])
  ) {
    return { tenantId: v['tenantId'], unitId: v['unitId'] };
  }
  const tenantName =
    (isStringId(v['tenantName']) ? v['tenantName'] : null) ??
    (isStringId(v['fullName']) ? v['fullName'] : null);
  if (tenantName !== null) {
    return isStringId(v['unitLabel'])
      ? { tenantName, unitLabel: v['unitLabel'] }
      : { tenantName };
  }
  return value;
}

/** Hoist a top-level propertyName into payload.propertyRef when the
 *  ref slot is missing — Sonnet 4.6 sometimes flattens. */
function hoistPropertyRef(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (v['propertyRef'] !== undefined) return v;
  if (isStringId(v['propertyName']) || isStringId(v['propertyId'])) {
    return {
      ...v,
      propertyRef: {
        ...(isStringId(v['propertyName']) ? { propertyName: v['propertyName'] } : {}),
        ...(isStringId(v['propertyId']) ? { propertyId: v['propertyId'] } : {}),
      },
    };
  }
  return v;
}

function hoistUnitRef(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (v['unitRef'] !== undefined) return v;
  if (isStringId(v['unitId']) || isStringId(v['unitLabel'])) {
    return {
      ...v,
      unitRef: {
        ...(isStringId(v['unitId']) ? { unitId: v['unitId'] } : {}),
        ...(isStringId(v['unitLabel']) ? { unitLabel: v['unitLabel'] } : {}),
        ...(isStringId(v['propertyName']) ? { propertyName: v['propertyName'] } : {}),
      },
    };
  }
  return v;
}

function hoistTenantRef(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (v['tenantRef'] !== undefined) return v;
  if (isStringId(v['tenantId']) || isStringId(v['tenantName'])) {
    return {
      ...v,
      tenantRef: {
        ...(isStringId(v['tenantId']) ? { tenantId: v['tenantId'] } : {}),
        ...(isStringId(v['tenantName']) ? { tenantName: v['tenantName'] } : {}),
      },
    };
  }
  return v;
}

function hoistLeaseRef(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (v['leaseRef'] !== undefined) return v;
  if (isStringId(v['leaseId']) || isStringId(v['tenantName'])) {
    return {
      ...v,
      leaseRef: {
        ...(isStringId(v['leaseId']) ? { leaseId: v['leaseId'] } : {}),
        ...(isStringId(v['tenantName']) ? { tenantName: v['tenantName'] } : {}),
      },
    };
  }
  return v;
}

const propertyRefSchema = z.preprocess(
  coercePropertyRef,
  z.union([
    z.object({ propertyId: z.string().uuid() }),
    z.object({ propertyName: z.string().min(1) }),
  ]),
);

const unitRefSchema = z.preprocess(
  coerceUnitRef,
  z.union([
    z.object({ unitId: z.string().uuid() }),
    z.object({ unitLabel: z.string().min(1), propertyName: z.string().min(1) }),
    z.object({ unitLabel: z.string().min(1) }),
  ]),
);

const tenantRefSchema = z.preprocess(
  coerceTenantRef,
  z.union([
    z.object({ tenantId: z.string().uuid() }),
    z.object({ tenantName: z.string().min(1) }),
  ]),
);

const leaseRefSchema = z.preprocess(
  coerceLeaseRef,
  z.union([
    z.object({ leaseId: z.string().uuid() }),
    z.object({ tenantId: z.string().uuid(), unitId: z.string().uuid() }),
    z.object({ tenantName: z.string().min(1), unitLabel: z.string().min(1).optional() }),
  ]),
);

export const createPropertyPayloadSchema = z.object({
  name: z.string().min(1).max(120),
  addressStreet: z.string().min(1).max(200),
  addressCity: z.string().min(1).max(80),
  addressState: z.string().length(2),
  addressZip: z.string().min(5).max(10),
  // Default applied at handler time when absent — keeping it optional
  // here so the model can omit it when the operator didn't say.
  timezone: z.string().optional(),
});

export const addUnitPayloadSchema = z.preprocess(
  hoistPropertyRef,
  z.object({
    propertyRef: propertyRefSchema,
    label: z.string().min(1).max(40),
    bedrooms: z.number().int().min(0).max(20),
    bathrooms: z.number().min(0).max(20),
    squareFeet: z.number().int().positive().optional(),
  }),
);

export const addTenantPayloadSchema = z.preprocess(
  hoistUnitRef,
  z.object({
    fullName: z.string().min(1).max(120),
    phoneE164: z.string().regex(/^\+\d{10,15}$/),
    email: z.string().email().optional(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // Optional: a tenant can exist without a unit (pre-lease intake).
    unitRef: unitRefSchema.optional(),
  }),
);

export const setLeaseTermsPayloadSchema = z.preprocess(
  hoistLeaseRef,
  z.object({
    leaseRef: leaseRefSchema,
    rentAmount: z.number().int().positive(),
    rentDueDay: z.number().int().min(1).max(28),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(['active', 'pending', 'ended']).optional(),
  }),
);

export const updateRentPayloadSchema = z.preprocess(
  hoistLeaseRef,
  z.object({
    leaseRef: z.preprocess(
      coerceLeaseRef,
      z.union([
        z.object({ leaseId: z.string().uuid() }),
        z.object({ tenantName: z.string().min(1) }),
      ]),
    ),
    rentAmount: z.number().int().positive(),
  }),
);

export const waiveRentPayloadSchema = z.preprocess(
  hoistLeaseRef,
  z.object({
    leaseRef: z.preprocess(
      coerceLeaseRef,
      z.union([
        z.object({ leaseId: z.string().uuid() }),
        z.object({ tenantName: z.string().min(1) }),
      ]),
    ),
    // Which cycle to waive — 'YYYY-MM' or 'YYYY-MM-01'. Omitted = current.
    cycleMonth: z
      .string()
      .regex(/^\d{4}-\d{2}(-01)?$/)
      .optional(),
    // Audit note persisted to rent_events.waived_reason.
    reason: z.string().min(1).max(500).optional(),
  }),
);

export const sendTenantMessagePayloadSchema = z.preprocess(
  hoistTenantRef,
  z.object({
    tenantRef: tenantRefSchema,
    body: z.string().min(1).max(2000),
  }),
);

export const logMaintenanceTicketPayloadSchema = z.preprocess(
  hoistUnitRef,
  z.object({
    unitRef: z.preprocess(
      coerceUnitRef,
      z.union([
        z.object({ unitId: z.string().uuid() }),
        z.object({
          unitLabel: z.string().min(1),
          propertyName: z.string().min(1).optional(),
        }),
      ]),
    ),
    summary: z.string().min(1).max(500),
    severity: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    reportedBy: z.string().optional(),
  }),
);

export const updatePropertyRulesPayloadSchema = z.preprocess(
  hoistPropertyRef,
  z.object({
    propertyRef: propertyRefSchema,
    rulesText: z.string().max(4000),
  }),
);

export const archiveLeasePayloadSchema = z.preprocess(
  hoistLeaseRef,
  z.object({
    leaseRef: z.preprocess(
      coerceLeaseRef,
      z.union([
        z.object({ leaseId: z.string().uuid() }),
        z.object({ tenantName: z.string().min(1) }),
      ]),
    ),
    reason: z.string().max(500).optional(),
  }),
);

// Inferred TS types — exported so handlers / dispatcher code can
// type their inputs after `safeParse`.
export type CreatePropertyPayload = z.infer<typeof createPropertyPayloadSchema>;
export type AddUnitPayload = z.infer<typeof addUnitPayloadSchema>;
export type AddTenantPayload = z.infer<typeof addTenantPayloadSchema>;
export type SetLeaseTermsPayload = z.infer<typeof setLeaseTermsPayloadSchema>;
export type UpdateRentPayload = z.infer<typeof updateRentPayloadSchema>;
export type WaiveRentPayload = z.infer<typeof waiveRentPayloadSchema>;
export type SendTenantMessagePayload = z.infer<
  typeof sendTenantMessagePayloadSchema
>;
export type LogMaintenanceTicketPayload = z.infer<
  typeof logMaintenanceTicketPayloadSchema
>;
export type UpdatePropertyRulesPayload = z.infer<
  typeof updatePropertyRulesPayloadSchema
>;
export type ArchiveLeasePayload = z.infer<typeof archiveLeasePayloadSchema>;

// ---------------------------------------------------------------------------
// Wave 7 — property data depth + integrations payload schemas
// ---------------------------------------------------------------------------
//
// Same ref-coercion strategy as wave 6 (see coerce* / hoist* above).
// Two new ref shapes are introduced for the appliance + vendor flows:
//   - applianceRef : { applianceId } | { propertyName, unitLabel?, type }
//   - vendorRef    : { vendorId } | { vendorName }
// Both run through z.preprocess so the handler's resolve-refs path
// takes over for fuzzy-name lookups.
//
// Confidence + source: every appliance / vendor / preference write
// carries optional confidence (0..1, default 0.7 in the handler) and
// source enum ('agent' | 'owner' | 'import'). The schema accepts
// defaults so the LLM can omit the values; the handler clamps to the
// expected enum.

const APPLIANCE_TYPES = [
  'fridge',
  'hvac',
  'washer',
  'dryer',
  'water_heater',
  'dishwasher',
  'oven',
  'microwave',
  'other',
] as const;

const VENDOR_CATEGORIES = [
  'plumbing',
  'electrical',
  'hvac',
  'landscaping',
  'general',
  'pest',
  'roof',
  'cleaning',
  'locksmith',
] as const;

const SOURCE_VALUES = ['agent', 'owner', 'import'] as const;

function coerceApplianceRef(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (isStringId(v['applianceId']) && isUuidLike(v['applianceId'])) {
    return { applianceId: v['applianceId'] };
  }
  const propertyName =
    (isStringId(v['propertyName']) ? v['propertyName'] : null) ??
    (isStringId(v['property']) ? v['property'] : null);
  const type = isStringId(v['type']) ? v['type'] : null;
  const unitLabel =
    (isStringId(v['unitLabel']) ? v['unitLabel'] : null) ??
    (isStringId(v['label']) ? v['label'] : null);
  if (propertyName !== null && type !== null) {
    return unitLabel !== null
      ? { propertyName, unitLabel, type }
      : { propertyName, type };
  }
  return value;
}

function coerceVendorRef(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (isStringId(v['vendorId']) && isUuidLike(v['vendorId'])) {
    return { vendorId: v['vendorId'] };
  }
  const name =
    (isStringId(v['vendorName']) ? v['vendorName'] : null) ??
    (isStringId(v['name']) ? v['name'] : null);
  if (name !== null) return { vendorName: name };
  return value;
}

function hoistApplianceRef(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (v['applianceRef'] !== undefined) return v;
  if (
    isStringId(v['applianceId']) ||
    (isStringId(v['propertyName']) && isStringId(v['type']))
  ) {
    return {
      ...v,
      applianceRef: {
        ...(isStringId(v['applianceId']) ? { applianceId: v['applianceId'] } : {}),
        ...(isStringId(v['propertyName'])
          ? { propertyName: v['propertyName'] }
          : {}),
        ...(isStringId(v['unitLabel']) ? { unitLabel: v['unitLabel'] } : {}),
        ...(isStringId(v['type']) ? { type: v['type'] } : {}),
      },
    };
  }
  return v;
}

function hoistVendorRef(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;
  if (v['vendorRef'] !== undefined) return v;
  if (isStringId(v['vendorId']) || isStringId(v['vendorName'])) {
    return {
      ...v,
      vendorRef: {
        ...(isStringId(v['vendorId']) ? { vendorId: v['vendorId'] } : {}),
        ...(isStringId(v['vendorName']) ? { vendorName: v['vendorName'] } : {}),
      },
    };
  }
  return v;
}

const applianceRefSchema = z.preprocess(
  coerceApplianceRef,
  z.union([
    z.object({ applianceId: z.string().uuid() }),
    z.object({
      propertyName: z.string().min(1),
      unitLabel: z.string().min(1).optional(),
      type: z.enum(APPLIANCE_TYPES),
    }),
  ]),
);

const vendorRefSchema = z.preprocess(
  coerceVendorRef,
  z.union([
    z.object({ vendorId: z.string().uuid() }),
    z.object({ vendorName: z.string().min(1) }),
  ]),
);

const sourceSchema = z.enum(SOURCE_VALUES);
const confidenceSchema = z.number().min(0).max(1);

// add_appliance — INSERT/UPDATE appliances row.
export const addAppliancePayloadSchema = z.preprocess(
  hoistPropertyRef,
  z.object({
    propertyRef: propertyRefSchema,
    unitRef: unitRefSchema.optional(),
    type: z.enum(APPLIANCE_TYPES),
    make: z.string().min(1).max(120).optional(),
    model: z.string().min(1).max(120).optional(),
    serialNumber: z.string().min(1).max(120).optional(),
    installDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    lastServiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    warrantyExpiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().max(2000).optional(),
    confidence: confidenceSchema.optional(),
    source: sourceSchema.optional(),
  }),
);

// update_appliance — same field shape as add, plus an applianceRef
// (id or fuzzy {propertyName, unitLabel?, type}). All non-ref fields
// are optional — the handler updates only what's provided.
export const updateAppliancePayloadSchema = z.preprocess(
  hoistApplianceRef,
  z.object({
    applianceRef: applianceRefSchema,
    type: z.enum(APPLIANCE_TYPES).optional(),
    make: z.string().min(1).max(120).optional(),
    model: z.string().min(1).max(120).optional(),
    serialNumber: z.string().min(1).max(120).optional(),
    installDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    lastServiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    warrantyExpiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().max(2000).optional(),
    confidence: confidenceSchema.optional(),
    source: sourceSchema.optional(),
  }),
);

// set_property_vendor — UPSERT property_vendors PK (org, property, category).
export const setPropertyVendorPayloadSchema = z.preprocess(
  (value) => hoistVendorRef(hoistPropertyRef(value)),
  z.object({
    propertyRef: propertyRefSchema,
    category: z.enum(VENDOR_CATEGORIES),
    vendorRef: vendorRefSchema,
    notes: z.string().max(2000).optional(),
    confidence: confidenceSchema.optional(),
    source: sourceSchema.optional(),
  }),
);

// update_tenant_preference — UPDATE only the columns provided.
// pets is an array of {type, name?, depositPaid?}; passing [] clears
// the list, omitting the key leaves it unchanged (handler decides).
export const updateTenantPreferencePayloadSchema = z.preprocess(
  hoistTenantRef,
  z.object({
    tenantRef: tenantRefSchema,
    preferredChannel: z.enum(['sms', 'email', 'voice', 'none']).optional(),
    language: z.string().min(2).max(10).optional(),
    emergencyContactName: z.string().min(1).max(120).optional(),
    emergencyContactPhone: z.string().min(1).max(40).optional(),
    parkingSpace: z.string().min(1).max(40).optional(),
    pets: z
      .array(
        z.object({
          type: z.string().min(1).max(40),
          name: z.string().min(1).max(80).optional(),
          depositPaid: z.boolean().optional(),
        }),
      )
      .optional(),
    confidence: confidenceSchema.optional(),
    source: sourceSchema.optional(),
  }),
);

// request_rent_payment — Stripe Checkout Session + SMS link to tenant.
// amountCents + dueDate optional: handler falls back to tenant's active
// lease values when omitted.
export const requestRentPaymentPayloadSchema = z.preprocess(
  hoistTenantRef,
  z.object({
    tenantRef: tenantRefSchema,
    amountCents: z.number().int().positive().optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
);

// schedule_calendar_event — Google Calendar events.insert.
// propertyRef + tenantRef are optional tags so the event can be linked
// back to the portfolio for narration.
export const scheduleCalendarEventPayloadSchema = z.object({
  summary: z.string().min(1).max(500),
  description: z.string().max(4000).optional(),
  attendees: z.array(z.string().email()).optional(),
  startIso: z.string().datetime({ offset: true }),
  endIso: z.string().datetime({ offset: true }),
  location: z.string().max(500).optional(),
  propertyRef: propertyRefSchema.optional(),
  tenantRef: tenantRefSchema.optional(),
});

// cancel_calendar_event — Google Calendar events.delete.
export const cancelCalendarEventPayloadSchema = z.object({
  eventId: z.string().min(1).max(1024),
});

// ---------------------------------------------------------------------------
// Feature 5 — proactive health-check proposals
// ---------------------------------------------------------------------------
//
// health_flag is a pure-acknowledge verb produced ONLY by the
// deterministic daily-health-check cron (src/lib/health) — never by a
// model. `(kind, subject)` is the stable dedupe key: at most one OPEN
// (status='proposed') flag per (org, kind, subject), enforced by the
// producer's pre-read plus the partial unique index
// uq_action_proposals_open_health_flag (migration 20260611014500).
//
// The payload deliberately carries NO keys named amount/cost/estimate
// (or any other money-shaped key) so the owner-queue's
// payloadDollarsCents() probe can never fabricate a money chip from a
// health flag.
//
// Ref ids use UUID_LIKE_REGEX rather than z.uuid(): zod 4's .uuid()
// enforces RFC 4122 version/variant bits and rejects seed UUIDs like
// '33333333-3333-3333-3333-333333333333' (same workaround as the
// server actions in properties/[id]/actions.ts).

const UUID_LIKE_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const healthFlagPayloadSchema = z.object({
  /** Check identifier, e.g. 'vacant_unit' — half of the dedupe key. */
  kind: z.string().min(1).max(64),
  /** Stable subject ref (entity uuid) — the other half of the dedupe key. */
  subject: z.string().min(1).max(200),
  /** Entity references backing the flag, e.g. [{ type: 'unit', id }]. */
  refs: z
    .array(z.object({ type: z.string(), id: z.string().regex(UUID_LIKE_REGEX) }))
    .max(20),
  /** Owner-facing one-to-three-sentence description of the finding. */
  summary: z.string().min(1).max(1000),
});

export type HealthFlagPayload = z.infer<typeof healthFlagPayloadSchema>;

// ---------------------------------------------------------------------------
// Voice Operator V1 — call-outcome review proposals
// ---------------------------------------------------------------------------
//
// voice_call_review is a pure-acknowledge verb produced ONLY by the
// Retell webhook's call_ended compiler (src/lib/voice) — never by a
// model. Like health_flag, the payload deliberately carries NO
// money-shaped keys so payloadDollarsCents() can never fabricate a
// money chip from a call review.

export const voiceCallReviewPayloadSchema = z.object({
  /** voice_calls.id of the call this review covers. */
  callId: z.string(),
  /** Owner-facing one-sentence call outcome summary. */
  summary: z.string(),
  /** Intent ids raised on the call (voice taxonomy strings). */
  intents: z.array(z.string()),
  /** Deterministic policy risk flags compiled at call end. */
  riskFlags: z.array(z.string()),
});

export type VoiceCallReviewPayload = z.infer<
  typeof voiceCallReviewPayloadSchema
>;

export type AddAppliancePayload = z.infer<typeof addAppliancePayloadSchema>;
export type UpdateAppliancePayload = z.infer<
  typeof updateAppliancePayloadSchema
>;
export type SetPropertyVendorPayload = z.infer<
  typeof setPropertyVendorPayloadSchema
>;
export type UpdateTenantPreferencePayload = z.infer<
  typeof updateTenantPreferencePayloadSchema
>;
export type RequestRentPaymentPayload = z.infer<
  typeof requestRentPaymentPayloadSchema
>;
export type ScheduleCalendarEventPayload = z.infer<
  typeof scheduleCalendarEventPayloadSchema
>;
export type CancelCalendarEventPayload = z.infer<
  typeof cancelCalendarEventPayloadSchema
>;

/**
 * Map every action_type to its payload schema. spawn.ts uses this to
 * validate the payload field of `PropertyWorkerOutput` against the
 * caller-provided action_type.
 */
export const WORKER_PAYLOAD_SCHEMAS: Record<WorkerActionType, z.ZodTypeAny> = {
  draft_sms_reply: draftSmsReplyPayloadSchema,
  classify_intent: classifyIntentPayloadSchema,
  confirm_emergency: confirmEmergencyPayloadSchema,
  polish_briefing: polishBriefingPayloadSchema,
  dispatch_vendor: dispatchVendorPayloadSchema,
  update_rulebook: updateRulebookPayloadSchema,
  create_property: createPropertyPayloadSchema,
  add_unit: addUnitPayloadSchema,
  add_tenant: addTenantPayloadSchema,
  set_lease_terms: setLeaseTermsPayloadSchema,
  update_rent: updateRentPayloadSchema,
  waive_rent: waiveRentPayloadSchema,
  send_tenant_message: sendTenantMessagePayloadSchema,
  log_maintenance_ticket: logMaintenanceTicketPayloadSchema,
  update_property_rules: updatePropertyRulesPayloadSchema,
  archive_lease: archiveLeasePayloadSchema,
  add_appliance: addAppliancePayloadSchema,
  update_appliance: updateAppliancePayloadSchema,
  set_property_vendor: setPropertyVendorPayloadSchema,
  update_tenant_preference: updateTenantPreferencePayloadSchema,
  request_rent_payment: requestRentPaymentPayloadSchema,
  schedule_calendar_event: scheduleCalendarEventPayloadSchema,
  cancel_calendar_event: cancelCalendarEventPayloadSchema,
  health_flag: healthFlagPayloadSchema,
  voice_call_review: voiceCallReviewPayloadSchema,
};

/**
 * Top-level worker output envelope. The payload field is validated as
 * a generic record here; per-action_type validation runs in spawn.ts
 * via WORKER_PAYLOAD_SCHEMAS so we can return a typed error pointing
 * at the failing action_type.
 */
export const propertyWorkerOutputSchema = z.object({
  action_type: workerActionTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
  context_fact_ids: z.array(z.string()),
});

// Explicit alias mirroring PropertyWorkerOutput for runtime parsing.
export type PropertyWorkerOutputValidated = z.infer<
  typeof propertyWorkerOutputSchema
>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Citation enforcement (v1.8 cohesion wave — Phase A item 2)
// ---------------------------------------------------------------------------
//
// Promotes `context_fact_ids` from prompt-nudge to runtime gate input.
// `validateCitations` inspects a proposal's `reasoning` for fact-shaped
// claims (tenant-pattern, building-history, vendor-performance, temporal
// anchor). When such a claim appears AND the proposal cites NO memory
// facts, the validator returns `{ ok: false }` so the gate matrix can
// route to human review.
//
// Heuristics are deliberately conservative — false positives over-route
// to review (no harm); false negatives miss fabrications (real harm).

export interface CitationValidationResult {
  readonly ok: boolean;
  /** Human-readable reason logged + surfaced on gate decision when !ok. */
  readonly reason?: string;
  /** The matched candidate text, if any — useful for debug logs. */
  readonly matchedClaim?: string;
}

/** Behavioural-pattern cue words that, combined with a tenant name,
 *  imply a memory_fact (tenant_pattern). Lowercase, whole-word matched. */
const TENANT_PATTERN_CUES: ReadonlyArray<string> = [
  'usually pays',
  'tends to',
  'always pays',
  'always late',
  'frequently',
  'often pays',
  'reliably',
  'typically',
  'has a habit',
  'never pays',
];

/** Historical condition cues for a building/system/appliance. */
const HISTORICAL_CONDITION_CUES: ReadonlyArray<string> = [
  'last winter',
  'last summer',
  'last year',
  'previously',
  'in the past',
  'historically',
  'has had issues',
  'broke down before',
  'was repaired',
  'has been failing',
];

/** Vendor performance descriptors that pair with a vendor name. */
const VENDOR_PERFORMANCE_CUES: ReadonlyArray<string> = [
  'reliable',
  'preferred vendor',
  'rejected our last',
  'declined our last',
  'no-shows',
  'always responsive',
  'usually responds',
  'recommended',
  'unreliable',
];

/** Temporal anchors: explicit dates or "since X" phrasing. */
const TEMPORAL_ANCHOR_REGEXES: ReadonlyArray<RegExp> = [
  // "since 2024", "since last March", "since the previous"
  /\bsince\s+(?:[a-z]+\s+)?\d{2,4}\b/i,
  /\bsince\s+(?:last|the)\s+\w+/i,
  // ISO / numeric dates: 2024-03-15, 03/15/2024
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
  // Month + year: "March 2024", "in March 2024"
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i,
];

/** Capitalised-word two-token pattern used as a proxy for "named entity"
 *  (tenant full name OR vendor business name). Single-token matches are
 *  rejected to keep the false-positive rate sane. */
const NAMED_ENTITY_REGEX = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/;

/**
 * Inspect a proposal's reasoning for fact-shaped claims and decide
 * whether `context_fact_ids` should be required.
 *
 * Pure function. Returns `{ ok: true }` when:
 *   - no fact-shaped claim appears, OR
 *   - claim appears AND `proposal.context_fact_ids` is non-empty.
 *
 * Returns `{ ok: false, reason }` when a claim appears but no fact ids
 * were cited. The caller (commit-gate) decides what to do with that
 * signal — under the feature flag it forces gate outcome to 'review'.
 *
 * `contextFacts` is accepted (and currently unused) so we can later
 * tighten the check to "the cited fact ids actually exist in the loaded
 * context" without churning callers. Keeping the signature stable today.
 */
export function validateCitations(
  proposal: Pick<ActionProposal, 'reasoning' | 'context_fact_ids'>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  contextFacts: ReadonlyArray<ContextFact>,
): CitationValidationResult {
  const reasoning = proposal.reasoning ?? '';
  const lower = reasoning.toLowerCase();
  const hasNamedEntity = NAMED_ENTITY_REGEX.test(reasoning);

  const matchedCue = (cues: ReadonlyArray<string>): string | null => {
    for (const cue of cues) {
      if (lower.includes(cue)) return cue;
    }
    return null;
  };

  const tenantCue = hasNamedEntity ? matchedCue(TENANT_PATTERN_CUES) : null;
  const vendorCue = hasNamedEntity ? matchedCue(VENDOR_PERFORMANCE_CUES) : null;
  const historicalCue = matchedCue(HISTORICAL_CONDITION_CUES);
  const temporalMatch = TEMPORAL_ANCHOR_REGEXES.some((re) => re.test(reasoning));

  const matched = tenantCue ?? vendorCue ?? historicalCue ?? (temporalMatch ? 'temporal anchor' : null);

  if (matched === null) {
    return { ok: true };
  }

  const cited = proposal.context_fact_ids ?? [];
  if (cited.length > 0) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: `reasoning references a fact-shaped claim ("${matched}") but context_fact_ids is empty`,
    matchedClaim: matched,
  };
}

// ---------------------------------------------------------------------------
// Numeric grounding (Phase A4 — currency guard before auto-send)
// ---------------------------------------------------------------------------
//
// Deterministic currency check that runs after the worker drafts a
// tenant-facing body and before `recordProposal`. Every dollar amount
// the draft states must appear (cents-normalized) somewhere in the
// allowed source texts: inbound body, conversation history, context
// rent amounts, rulebook. Ungrounded amounts demote an 'auto' gate
// outcome to 'review' via `RecordProposalInput.forceReview` — never to
// 'block'. Currency only; dates are deliberately out of scope (v1 —
// dates are how this gets noisy).

export interface NumericGroundingResult {
  readonly ok: boolean;
  /** Currency tokens from the draft with no numeric match in the allowed set. */
  readonly ungrounded: ReadonlyArray<string>;
}

/** Currency-shaped tokens: "$1,200", "$1200.00", "$ 450", "1200 dollars",
 *  "1,200.50 dollars". Plain numbers WITHOUT a $ or "dollars" cue are not
 *  treated as currency in the draft — that keeps unit labels, dates, and
 *  ticket numbers out of the guard. */
const CURRENCY_TOKEN_REGEXES: ReadonlyArray<RegExp> = [
  /\$\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g,
  /\b(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s+dollars?\b/gi,
];

/** Any number token — used on the ALLOWED side so "rent is 1200" in
 *  history grounds "$1,200" in the draft. */
const NUMBER_TOKEN_REGEX = /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g;

/**
 * Extract currency-shaped tokens from a draft body. Exported for unit
 * tests; production callers go through `validateNumericGrounding`.
 */
export function extractCurrencyTokens(text: string): string[] {
  const out: string[] = [];
  for (const re of CURRENCY_TOKEN_REGEXES) {
    const matches = text.match(re);
    if (matches) out.push(...matches);
  }
  return out;
}

/**
 * Normalize a currency token to integer cents: strip "$", commas,
 * whitespace, and a trailing "dollar(s)" word, then parse as a dollar
 * value. Returns null when the residue is not a plain decimal number.
 */
export function normalizeCurrencyToCents(token: string): number | null {
  const cleaned = token
    .toLowerCase()
    .replace(/dollars?\b/g, '')
    .replace(/[$,\s]/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/**
 * Validate that every currency amount in `draftBody` appears
 * (cents-normalized) somewhere in `allowedTexts`.
 *
 * Pure function. A draft with no currency tokens always passes. The
 * allowed side extracts ALL number tokens (with or without $) so an
 * amount echoed from history or a raw `rent_amount` rendering both
 * count as grounding.
 *
 * Returns `{ ok, ungrounded }` where `ungrounded` lists the distinct
 * draft tokens with no match — surfaced in the forced-review reason.
 */
export function validateNumericGrounding(
  draftBody: string,
  allowedTexts: ReadonlyArray<string>,
): NumericGroundingResult {
  const tokens = extractCurrencyTokens(draftBody);
  if (tokens.length === 0) return { ok: true, ungrounded: [] };

  const allowed = new Set<number>();
  for (const text of allowedTexts) {
    const matches = text.match(NUMBER_TOKEN_REGEX) ?? [];
    for (const m of matches) {
      const cents = normalizeCurrencyToCents(m);
      if (cents !== null) allowed.add(cents);
    }
  }

  const ungrounded: string[] = [];
  for (const token of tokens) {
    const cents = normalizeCurrencyToCents(token);
    if ((cents === null || !allowed.has(cents)) && !ungrounded.includes(token)) {
      ungrounded.push(token);
    }
  }

  return { ok: ungrounded.length === 0, ungrounded };
}

/**
 * Thrown when the model returned an envelope that fails
 * propertyWorkerOutputSchema or the per-action payload schema.
 * Carries the original ZodError for debugging.
 */
export class WorkerOutputValidationError extends Error {
  readonly zodError: z.ZodError;
  readonly action_type: WorkerActionType | null;

  constructor(
    message: string,
    zodError: z.ZodError,
    action_type: WorkerActionType | null,
  ) {
    super(message);
    this.name = 'WorkerOutputValidationError';
    this.zodError = zodError;
    this.action_type = action_type;
  }
}

/**
 * Thrown when the context loader cannot resolve a property (RLS
 * denial, deleted row, wrong organization scope).
 */
export class PropertyContextNotFoundError extends Error {
  readonly propertyId: string;

  constructor(propertyId: string) {
    super(`property context not found for id ${propertyId}`);
    this.name = 'PropertyContextNotFoundError';
    this.propertyId = propertyId;
  }
}
