/**
 * Tool handlers for the Poke MCP server (Phase 4 step 2).
 *
 * Each handler takes a `HandlerDeps` object (resolved scope from
 * requireMcpAuth + the admin client) plus its tool input, and returns
 * an MCP-shaped `{ content: [{ type: 'text', text: '...' }] }` payload.
 * Tool inputs are pre-validated by the SDK against zod schemas at the
 * /api/mcp/sse route layer; handlers can trust the shape.
 *
 * Three tools today:
 *
 *   list_properties — quick disambiguation list. The most common Poke
 *     opening turn ("ask Odesa about Maple") needs to resolve to one
 *     property without spinning up the full dispatcher.
 *
 *   get_property    — snapshot for one property. Names + KPIs + recent
 *     activity counts. Reuses loadPropertyContext so the shape is
 *     identical to what the per-property worker sees, minimizing
 *     drift surface.
 *
 *   ask_property    — STUB. The full dispatcher integration lives in
 *     task #5 (runOperatorDispatcher). This stub returns a clear
 *     "not yet wired" message so Poke + the smoke test exercise the
 *     full transport end-to-end while the dispatcher is in flight.
 *
 * Privacy: every handler scopes to `deps.organizationId`. The admin
 * client bypasses RLS — the explicit `.eq('organization_id', ...)`
 * is the org boundary. NEVER omit it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { accessAllows } from '@/lib/authz/enforce';
import type { AccessContext } from '@/lib/authz/context';
import { loadPropertyContext } from '@/lib/agent/worker/context-loader';
import { loadOrCreateChat } from '@/lib/agent/operator/persist';
import type {
  ActionProposal,
  DispatchVendorPayload,
  DraftSmsReplyPayload,
} from '@/lib/agent/worker/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AdminClient = SupabaseClient<Database>;

export interface HandlerDeps {
  admin: AdminClient;
  access: AccessContext;
}

/**
 * MCP tool result shape. The SDK enforces this on the wire; handlers
 * return it as-is so the route handler can pass it through without
 * re-shaping.
 *
 * The `[x: string]: unknown` index signature mirrors the SDK's
 * `CallToolResult` type — the registerTool() callback signature checks
 * for it structurally so the SDK can later attach `_meta`, `isError`,
 * etc. without forcing handlers to predeclare them.
 */
export interface ToolTextResult {
  content: Array<{ type: 'text'; text: string }>;
  [x: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a plain string in the MCP `{ content: [{ type, text }] }` shape.
 * All three handlers return JSON-stringified payloads — Poke renders
 * the JSON verbatim, which is the right choice for a developer-facing
 * MCP integration (the dispatcher will eventually return prose).
 */
function textResult(payload: unknown): ToolTextResult {
  const text =
    typeof payload === 'string' ? payload : JSON.stringify(payload);
  return { content: [{ type: 'text', text }] };
}

interface PropertyRow {
  id: string;
  name: string;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}

/**
 * Mirror of the address-formatting helper in worker/context-loader.ts.
 * Inlined here to avoid leaking that file's `formatAddress` (private)
 * across module boundaries; the joined string is identical.
 */
function formatAddress(p: PropertyRow): string | null {
  const parts = [
    p.address_street,
    p.address_city,
    p.address_state,
    p.address_zip,
  ].filter((s): s is string => Boolean(s && s.trim()));
  if (parts.length === 0) return null;
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// list_properties
// ---------------------------------------------------------------------------

export interface ListPropertiesItem {
  id: string;
  name: string;
  addressLine: string | null;
  unitCount: number;
}

/**
 * Returns every property in the operator's org plus its unit count.
 *
 * The unit count comes from a separate `units` query keyed by
 * `property_id IN (...)` rather than a PostgREST embed, mirroring the
 * decomposition pattern from src/lib/properties/queries.ts:listProperties
 * (PostgREST aggregate selects under RLS are brittle and hard to test).
 */
export async function listProperties(
  deps: HandlerDeps,
): Promise<ToolTextResult> {
  if (!deps.access.capabilities.has('view_properties')) {
    throw new Error('Forbidden');
  }
  if (
    deps.access.propertyScope !== 'all' &&
    deps.access.propertyScope.length === 0
  ) {
    return textResult([] as ListPropertiesItem[]);
  }

  let propertyQuery = deps.admin
    .from('properties')
    .select('id, name, address_street, address_city, address_state, address_zip')
    .eq('organization_id', deps.access.organizationId);
  if (deps.access.propertyScope !== 'all') {
    propertyQuery = propertyQuery.in('id', [...deps.access.propertyScope]);
  }
  const { data: properties, error: propErr } = await propertyQuery.order(
    'name',
    { ascending: true },
  );

  if (propErr) {
    throw new Error(`Failed to list properties: ${propErr.message}`);
  }

  const rows = (properties ?? []) as PropertyRow[];
  if (rows.length === 0) {
    return textResult([] as ListPropertiesItem[]);
  }

  const ids = rows.map((p) => p.id);

  const { data: units, error: unitErr } = await deps.admin
    .from('units')
    .select('id, property_id')
    .in('property_id', ids);

  if (unitErr) {
    throw new Error(`Failed to count units: ${unitErr.message}`);
  }

  const unitsByProperty = new Map<string, number>();
  for (const u of units ?? []) {
    const pid = (u as { property_id: string }).property_id;
    unitsByProperty.set(pid, (unitsByProperty.get(pid) ?? 0) + 1);
  }

  const items: ListPropertiesItem[] = rows.map((p) => ({
    id: p.id,
    name: p.name,
    addressLine: formatAddress(p),
    unitCount: unitsByProperty.get(p.id) ?? 0,
  }));

  return textResult(items);
}

// ---------------------------------------------------------------------------
// get_property
// ---------------------------------------------------------------------------

export interface GetPropertyInput {
  propertyId: string;
}

export interface GetPropertySnapshot {
  id: string;
  name: string;
  addressLine: string | null;
  autonomyLevel: number;
  privacyMode: 'hosted' | 'on_prem';
  kpis: {
    tenantCount: number;
    activeLeaseCount: number;
    openWorkOrderCount: number;
  };
  recentActivityCount: number;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const ACTIVE_LEASE_STATUSES = ['active', 'pending'] as const;
const OPEN_WORK_ORDER_STATUSES: ReadonlyArray<
  Database['public']['Enums']['work_order_status']
> = ['open', 'assigned', 'in_progress'];

/**
 * Build a one-property snapshot suitable for Poke to render or hand to
 * the operator. Reuses `loadPropertyContext` so the property +
 * autonomy + privacyMode shape stays consistent with what the worker
 * sees mid-turn.
 *
 * KPIs come from extra targeted queries (counts only, no row payloads)
 * scoped to the org for defense-in-depth on top of the propertyId
 * filter.
 */
export async function getProperty(
  deps: HandlerDeps,
  input: GetPropertyInput,
): Promise<ToolTextResult> {
  if (!accessAllows(deps.access, 'view_properties', input.propertyId)) {
    throw new Error('Property not found');
  }
  const ctx = await loadPropertyContext(deps.admin, input.propertyId);

  // Defense-in-depth: even though loadPropertyContext loaded by id,
  // refuse to leak across orgs if RLS is somehow bypassed upstream.
  if (ctx.property.organizationId !== deps.access.organizationId) {
    throw new Error('Property not found');
  }

  const { tenantCount, activeLeaseCount } = await countLeasesAndTenants(
    deps.admin,
    input.propertyId,
  );

  const openWorkOrderCount = await countOpenWorkOrders(
    deps.admin,
    deps.access.organizationId,
    input.propertyId,
  );

  const recentActivityCount = await countRecentActivity(
    deps.admin,
    deps.access.organizationId,
    input.propertyId,
  );

  const snapshot: GetPropertySnapshot = {
    id: ctx.property.id,
    name: ctx.property.name,
    addressLine: ctx.property.addressLine,
    autonomyLevel: ctx.property.autonomyLevel,
    privacyMode: ctx.property.privacyMode,
    kpis: {
      tenantCount,
      activeLeaseCount,
      openWorkOrderCount,
    },
    recentActivityCount,
  };

  return textResult(snapshot);
}

async function countLeasesAndTenants(
  admin: AdminClient,
  propertyId: string,
): Promise<{ tenantCount: number; activeLeaseCount: number }> {
  // Two-step join via units → leases. Decomposed (vs PostgREST embed)
  // to mirror the worker context-loader's `loadTenants` pattern.
  const { data: units, error: unitErr } = await admin
    .from('units')
    .select('id')
    .eq('property_id', propertyId);

  if (unitErr) {
    throw new Error(`Failed to load units: ${unitErr.message}`);
  }

  const unitIds = (units ?? []).map((u) => (u as { id: string }).id);
  if (unitIds.length === 0) return { tenantCount: 0, activeLeaseCount: 0 };

  const { data: leases, error: leaseErr } = await admin
    .from('leases')
    .select('id, status, tenant_id')
    .in('unit_id', unitIds);

  if (leaseErr) {
    throw new Error(`Failed to load leases: ${leaseErr.message}`);
  }

  const leaseRows = (leases ?? []) as Array<{
    id: string;
    status: string;
    tenant_id: string | null;
  }>;

  const tenantIds = new Set<string>();
  let activeLeaseCount = 0;
  for (const l of leaseRows) {
    if ((ACTIVE_LEASE_STATUSES as readonly string[]).includes(l.status)) {
      activeLeaseCount += 1;
      if (l.tenant_id) tenantIds.add(l.tenant_id);
    }
  }

  return { tenantCount: tenantIds.size, activeLeaseCount };
}

async function countOpenWorkOrders(
  admin: AdminClient,
  organizationId: string,
  propertyId: string,
): Promise<number> {
  const { data: units, error: unitErr } = await admin
    .from('units')
    .select('id')
    .eq('property_id', propertyId);

  if (unitErr) return 0;

  const unitIds = (units ?? []).map((u) => (u as { id: string }).id);
  if (unitIds.length === 0) return 0;

  const { count, error } = await admin
    .from('work_orders')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .in('unit_id', unitIds)
    .in('status', OPEN_WORK_ORDER_STATUSES);

  if (error) return 0;
  return count ?? 0;
}

async function countRecentActivity(
  admin: AdminClient,
  organizationId: string,
  propertyId: string,
): Promise<number> {
  const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

  // action_proposals is the canonical "recent activity" signal — every
  // worker-spawned action lands a row here. Counting head-only keeps
  // this cheap.
  const { count, error } = await admin
    .from('action_proposals')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('property_id', propertyId)
    .gte('created_at', cutoff);

  if (error) return 0;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// ask_property
// ---------------------------------------------------------------------------

export interface AskPropertyInput {
  propertyId: string;
  message: string;
}

const DISPATCHER_FALLBACK_MESSAGE =
  "Sorry, I couldn't process that just now. Please try again in a moment.";

const DISPATCHER_THROW_MESSAGE =
  'Something went wrong while processing that request. Please try again.';

/**
 * Render a one-line proposal summary suitable for the MCP transport
 * (Poke renders these inline below the assistant prose). The proposal
 * carries no tenant/vendor *names* — only IDs on `routing` — because of
 * the v1.5 Privacy Mode invariant. So we lean on `action_type` and
 * the small payload-side hints (tone, smsBody preview) we have.
 *
 * Style: short label per action_type so Poke users get a glanceable
 * "what just happened" line. Unknown action_types fall back to the
 * raw enum value so a future action_type at least surfaces.
 */
function formatActionSummary(proposal: ActionProposal): string {
  switch (proposal.action_type) {
    case 'draft_sms_reply': {
      const tone = (proposal.payload as DraftSmsReplyPayload).tone;
      return `Texted tenant (${tone})`;
    }
    case 'dispatch_vendor': {
      // Vendor Dispatch Truth: committing a dispatch_vendor proposal is a
      // no-op (see src/lib/agent/proposals/commit.ts) — no vendor is
      // contacted. Say the approval was RECORDED, never past-tense
      // "Dispatched vendor" which would claim a contact that never happened.
      const idx = (proposal.payload as DispatchVendorPayload).candidateIndex;
      return `Dispatch approval recorded (candidate #${idx})`;
    }
    case 'classify_intent':
      return 'Classified intent';
    case 'confirm_emergency':
      return 'Confirmed emergency status';
    case 'polish_briefing':
      return 'Polished briefing';
    case 'update_rulebook':
      return 'Updated rulebook';
    default: {
      // Exhaustiveness guard — keep the raw enum so a new action_type
      // at least shows up rather than disappearing silently.
      const fallback: string = proposal.action_type;
      return fallback;
    }
  }
}

/**
 * Run the operator dispatcher synchronously and aggregate its event
 * stream into a single string.
 *
 * Per plan §Phase 4: "accumulates all say text + appends an action
 * summary line per proposal.committed / proposal.review_required
 * event". MCP has no live thread to interject into, so:
 *
 *   - `say.delta` text concatenated in order forms the prose body.
 *   - `proposal.committed`        → "✓ <summary>" appended.
 *   - `proposal.review_required`  → "⏳ <summary> — needs review: <url>".
 *   - `tool.error`                → "⚠ <name>: <message>" so Poke
 *      surfaces failures instead of swallowing them.
 *   - `ack` / `tool.use` / `tool.result` / `proposal.recorded` →
 *      dropped (audit-only, not user-visible in this transport).
 *
 * Failure modes:
 *   - Empty output (loop crashed pre-text)  → DISPATCHER_FALLBACK_MESSAGE
 *   - The dispatcher itself throws/rejects  → DISPATCHER_THROW_MESSAGE
 *      so we never bubble a raw stack into the MCP response.
 */
export async function askProperty(
  deps: HandlerDeps,
  input: AskPropertyInput,
): Promise<ToolTextResult> {
  if (!accessAllows(deps.access, 'view_assistant', input.propertyId)) {
    throw new Error('Property not found');
  }

  const { data: property, error: propertyError } = await deps.admin
    .from('properties')
    .select('id, name')
    .eq('id', input.propertyId)
    .eq('organization_id', deps.access.organizationId)
    .maybeSingle();
  if (propertyError || !property) throw new Error('Property not found');

  const chat = await loadOrCreateChat(deps.admin, {
    organizationId: deps.access.organizationId,
    userId: deps.access.userId,
    propertyId: input.propertyId,
    channel: 'mcp',
  });

  const propertyHint = { id: input.propertyId, name: property.name };

  const sayParts: string[] = [];
  const summaryLines: string[] = [];

  try {
    // Dynamic import keeps the Claude Agent SDK (behind dispatcher.ts)
    // out of the Vercel bundle for /api/mcp/sse; it only loads when an
    // ask_property call actually runs.
    const { runOperatorDispatcher } = await import(
      '@/lib/agent/operator/dispatcher'
    );
    for await (const evt of runOperatorDispatcher({
      admin: deps.admin,
      organizationId: deps.access.organizationId,
      userId: deps.access.userId,
      chatId: chat.id,
      propertyHint,
      message: input.message,
      channel: 'mcp',
    })) {
      switch (evt.type) {
        case 'say.delta':
          sayParts.push(evt.text);
          break;
        case 'proposal.committed':
          summaryLines.push(`✓ ${formatActionSummary(evt.proposal)}`);
          break;
        case 'proposal.review_required':
          summaryLines.push(
            `⏳ ${formatActionSummary(evt.proposal)} — needs review: ${evt.reviewUrl}`,
          );
          break;
        case 'tool.error':
          summaryLines.push(`⚠ ${evt.name}: ${evt.message}`);
          break;
        // ack / tool.use / tool.result / proposal.recorded / done — ignored.
      }
    }
  } catch {
    // The dispatcher should never throw (it surfaces all errors as
    // tool.error events), but defense-in-depth: a thrown rejection
    // here means the loop wedged before it could emit anything. Don't
    // leak the raw stack to Poke.
    return textResult(DISPATCHER_THROW_MESSAGE);
  }

  const sayText = sayParts.join('').trim();
  const summaryBlock = summaryLines.length
    ? (sayText ? '\n\n' : '') + summaryLines.join('\n')
    : '';
  const joined = `${sayText}${summaryBlock}`;

  return textResult(joined.length > 0 ? joined : DISPATCHER_FALLBACK_MESSAGE);
}

export const __testing = {
  DISPATCHER_FALLBACK_MESSAGE,
  DISPATCHER_THROW_MESSAGE,
  formatActionSummary,
};
