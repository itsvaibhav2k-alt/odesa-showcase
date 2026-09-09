/**
 * spawnPropertyWorker — the public entry point of the worker layer.
 *
 *   spawnPropertyWorker(propertyId, action_type, data, deps?) → ActionProposal
 *
 * Pipeline:
 *   1. Load context via context-loader.loadPropertyContext(propertyId).
 *   2. Build the prompt-block array via system-prompt.buildWorkerSystemPrompt.
 *   3. Pick a provider via providers/select.ts (or use the injected one).
 *   4. Invoke provider.call(input).
 *   5. Validate output against propertyWorkerOutputSchema + the per-action
 *      payload schema in WORKER_PAYLOAD_SCHEMAS.
 *   6. Return an ActionProposal with `gate_decision = null` and
 *      `status = 'proposed'` — the gate layer fills those in.
 *
 * Dependency injection:
 *   - `client`: a Supabase-shaped client. Defaults to `createAdminClient()`.
 *   - `provider`: a WorkerModelProvider. Defaults to `selectProvider(context)`
 *     once the providers package lands. Until then, callers MUST pass one
 *     in (production code is gated behind that landing per task #4).
 *   - `now`: clock function for deterministic context.loadedAt in tests.
 *
 * Note: this module does NOT persist the proposal. Persistence happens
 * in `src/lib/agent/proposals/record.ts` (task #5). Keeping spawn pure
 * means the Inbox-pane drafts surface can choose to defer DB writes.
 */

import {
  loadOrganizationBranding,
  loadPropertyContext,
  type SupabaseLike,
} from './context-loader';
import {
  ActionProposal,
  PropertyContext,
  PropertyWorkerInput,
  WorkerActionType,
  WorkerModelProvider,
  WorkerOutputValidationError,
  WORKER_PAYLOAD_SCHEMAS,
  propertyWorkerOutputSchema,
} from './types';

export interface SpawnDeps {
  client: SupabaseLike;
  provider: WorkerModelProvider;
  now?: () => Date;
}

export interface SpawnPropertyWorkerArgs {
  propertyId: string;
  action_type: WorkerActionType;
  /** Action-specific input payload; shape depends on action_type. */
  data: unknown;
  deps: SpawnDeps;
  /**
   * Cancellation signal forwarded to the provider's call(). When the
   * signal aborts, the provider should reject and spawn will surface
   * the abort to the caller (no proposal is returned).
   */
  signal?: AbortSignal;
}

/**
 * Run a property worker against the given action_type + input. Returns
 * an in-memory ActionProposal (id=null, gate_decision=null) that the
 * caller hands to the gate layer.
 */
export async function spawnPropertyWorker(
  args: SpawnPropertyWorkerArgs,
): Promise<ActionProposal> {
  const { propertyId, action_type, data, deps, signal } = args;
  const now = deps.now ?? (() => new Date());

  const context = await loadPropertyContext(deps.client, propertyId, {
    now,
  });

  // Load org branding alongside the property context. Failure here is
  // non-fatal — providers fall back to DEFAULT_BRANDING when branding is
  // absent, so the worker still runs (with the default "Odesa" persona)
  // rather than crashing the whole spawn for a cosmetic field.
  const branding = await loadOrganizationBranding(
    deps.client,
    context.property.organizationId,
  )
    .then((b) => ({ orgName: b.name, assistantName: b.assistantName }))
    .catch(() => undefined);

  const input: PropertyWorkerInput = {
    propertyId,
    organizationId: context.property.organizationId,
    action_type,
    data,
    context,
    ...(branding ? { branding } : {}),
  };

  const raw = await deps.provider.call(input, signal ? { signal } : undefined);

  // Validate envelope shape first.
  const envelopeParse = propertyWorkerOutputSchema.safeParse(raw);
  if (!envelopeParse.success) {
    throw new WorkerOutputValidationError(
      `worker output failed envelope validation`,
      envelopeParse.error,
      action_type,
    );
  }

  // Cross-check: model must echo the action_type the caller asked for.
  // This runs before payload validation so a mismatched verb produces a
  // clear error rather than a confusing payload-shape error against the
  // wrong schema.
  if (envelopeParse.data.action_type !== action_type) {
    throw new WorkerOutputValidationError(
      `worker returned action_type=${envelopeParse.data.action_type} but caller requested ${action_type}`,
      buildSyntheticZodError('action_type mismatch'),
      action_type,
    );
  }

  // Validate payload against the per-action_type schema.
  const payloadSchema = WORKER_PAYLOAD_SCHEMAS[action_type];
  const payloadParse = payloadSchema.safeParse(envelopeParse.data.payload);
  if (!payloadParse.success) {
    throw new WorkerOutputValidationError(
      `worker output failed payload validation for action_type=${action_type}`,
      payloadParse.error,
      action_type,
    );
  }

  return buildProposal({
    context,
    workerModel: deps.provider.name,
    action_type,
    payload: payloadParse.data,
    reasoning: envelopeParse.data.reasoning,
    confidence: envelopeParse.data.confidence,
    contextFactIds: envelopeParse.data.context_fact_ids,
    now,
  });
}

interface BuildProposalArgs {
  context: PropertyContext;
  workerModel: string;
  action_type: WorkerActionType;
  payload: unknown;
  reasoning: string;
  confidence: number;
  contextFactIds: ReadonlyArray<string>;
  now: () => Date;
}

function buildProposal(args: BuildProposalArgs): ActionProposal {
  return {
    id: null,
    organizationId: args.context.property.organizationId,
    propertyId: args.context.property.id,
    workerModel: args.workerModel,
    action_type: args.action_type,
    // Casting because the schema has already validated the payload
    // shape against WORKER_PAYLOAD_SCHEMAS[action_type]; the union
    // narrowing requires a discriminator we don't carry.
    payload: args.payload as ActionProposal['payload'],
    // routing is set by the orchestrator at recordProposal-time, not
    // by spawn — spawn deliberately doesn't see tenant/conversation
    // ids so the worker can't be tricked into echoing them.
    routing: null,
    reasoning: args.reasoning,
    confidence: args.confidence,
    context_fact_ids: args.contextFactIds,
    gate_decision: null,
    status: 'proposed',
    createdAt: args.now().toISOString(),
  };
}

// We need a Zod-error-shaped object for the action_type-mismatch path
// without producing a real zod ZodError instance. Importing ZodError
// directly would couple us tighter than necessary for what is purely
// an internal envelope of our own. Inline a minimal stand-in.
import { z } from 'zod';

function buildSyntheticZodError(message: string): z.ZodError {
  // Zod 4's safeParse uses ZodError with an `issues` array; the
  // single-line constructor is the documented public API.
  return new z.ZodError([
    {
      code: 'custom',
      path: ['action_type'],
      message,
      input: undefined,
    },
  ]);
}
