/**
 * System-prompt builder for the per-property worker.
 *
 * Outputs an Anthropic-Messages-style block array so the cache_control
 * marker on the static foundation can be reused across calls. Cache
 * key is implicit: same property_id + same `loadedAt` snapshot →
 * identical static block → cache hit.
 *
 * Structure (each is one input block):
 *   1. STATIC base persona + safety rules            ← cache_control
 *   2. Property identity + rulebook (verbatim)
 *   3. Active memory_facts rendered with confidence + source
 *   4. Recent conversation turns
 *   5. Vendors, tenants
 *   6. Per-call task instructions (action_type specific)
 *
 * Provider implementations consume this array (HostedHaiku passes it
 * through to Anthropic; Ollama flattens to a single system string
 * because Ollama's chat API does not support per-block caching).
 *
 * Provenance: structure modeled after Boop's `EXECUTION_SYSTEM` (see
 * /Users/vaibhav/Downloads/boop-agent-main/server/execution-agent.ts:45-77)
 * but specialized for property operations: no web tools, structured
 * proposal output instead of free-form text, hard rule that we
 * NEVER commit external actions — we ALWAYS return an
 * ActionProposal envelope.
 */

import type {
  ContextFact,
  PropertyContext,
  WorkerActionType,
  WorkerBranding,
} from './types';

// ---------------------------------------------------------------------------
// Block shape — minimal Anthropic Messages content block
// ---------------------------------------------------------------------------

export interface CacheControl {
  type: 'ephemeral';
}

export interface SystemPromptBlock {
  type: 'text';
  text: string;
  cache_control?: CacheControl;
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------
//
// Per-org assistant identity. The dispatcher loads `organizations.name`
// and `organizations.assistant_name` once per turn (Wave 0 migration
// 20260506000000_org_assistant_name.sql) and passes them through here.
// The worker is spawned per-property but the assistant identity is
// org-level — same name across all properties an org owns.
//
// When omitted, the builder renders a generic Odesa-default header.
// Providers that don't yet thread branding through (hosted-haiku.ts,
// ollama.ts) keep working unchanged; the dispatcher prompt + messaging
// prompt are the path that's wired end-to-end in this wave.

// WorkerBranding is now defined in ./types so PropertyWorkerInput can carry
// it without an import cycle (types.ts is not allowed to depend on
// system-prompt.ts because system-prompt.ts already imports from types.ts).
// Re-exported here for backward compatibility with existing callers that
// imported it from this module.
export type { WorkerBranding };

export const DEFAULT_ASSISTANT_NAME = 'Odesa';

const DEFAULT_BRANDING: WorkerBranding = {
  orgName: 'the operator',
  assistantName: DEFAULT_ASSISTANT_NAME,
};

// ---------------------------------------------------------------------------
// Static base prompt (cached)
// ---------------------------------------------------------------------------
//
// Rendered as a template so the assistant identity ({assistantName}) and
// org identity ({orgName}) interpolate per call. The body is otherwise
// identical across calls within an org → still a clean prompt-cache hit
// because the static block carries the same rendered text every time.

export function renderWorkerBasePrompt(branding: WorkerBranding): string {
  const { assistantName, orgName } = branding;
  return `You are ${assistantName}, the AI property manager for ${orgName}, acting as a per-property worker.

Identity:
- You are scoped to ONE property. You do not see other properties in the portfolio.
- Your output is ALWAYS an ActionProposal envelope. You never send messages, dispatch vendors, or alter records yourself. A separate gate decides whether to commit your proposal.
- You are not a chatbot. Your "user" is the orchestrator that consumes your structured output.

Grounding rule:
- Your sources are the loaded context (rulebook, recent turns, memory_facts, vendors, tenants, leases) and any tool results. Your training data is NOT a source.
- If the answer is not grounded in the loaded context or a tool result, say so. Do not invent context, prices, names, or rules.

Reasoning rules:
- Treat the property's rulebook as authoritative. If a rule conflicts with a memory fact, the rulebook wins.
- Memory facts are weighted by confidence and tagged with a source (observed, owner_stated, derived, meta_learned). Owner-stated > observed > derived > meta_learned when sources disagree.
- Cite specific memory_facts in your reasoning when they shape the proposal. Use their UUIDs in context_fact_ids.

Confidence calibration (hard rule):
- If you cannot ground your decision in the loaded context or tool results, set confidence: 0.0 AND requires_review: true in your reasoning. Do not bluff.
- Saying "I don't have that info" is a valid output. Prefer review over fabrication.
- 0.9+ confidence only when the rulebook + facts give an unambiguous answer.

Output discipline:
- Return JSON matching the schema: { action_type, payload, reasoning, confidence, context_fact_ids }.
- reasoning is 1-3 sentences explaining the choice; do not restate the input.
- confidence is in [0,1]. Calibrate honestly per the rule above.
- payload's shape depends on action_type — follow the per-action contract you receive in the task block.

Privacy:
- Do not echo tenant phone numbers, full names, or unit numbers back into the proposal payload unless required by the action_type contract.
- Do not include URLs or external sources. You have no internet access.

Safety:
- For confirm_emergency: false negatives kill people; false positives wake the landlord. Prefer escalate_now whenever the utterance plausibly describes water/gas/fire/sewage/no-heat.
- For draft_sms_reply: never commit to anything outside the rulebook. Never quote a price the rulebook does not state.
- For dispatch_vendor: pick by INDEX into candidateVendorIds; never invent or echo a UUID.
- For update_rulebook: never silently delete owner-stated content; preserve the existing rulebook verbatim and append/edit only the relevant section.`;
}

/**
 * Default-branded base prompt. Kept as a named export for tests and
 * legacy call sites that built the prompt without org branding; the
 * runtime hot path is `renderWorkerBasePrompt(branding)` from
 * `buildWorkerSystemPrompt`.
 */
export const WORKER_BASE_SYSTEM_PROMPT = renderWorkerBasePrompt(DEFAULT_BRANDING);

// ---------------------------------------------------------------------------
// Per-action_type instruction fragments
// ---------------------------------------------------------------------------

export const ACTION_CONTRACTS: Record<WorkerActionType, string> = {
  draft_sms_reply: `TASK: draft_sms_reply
Return a payload of shape: { body: string, tone: 'neutral'|'firm'|'warm'|'apologetic' }
- body: <=320 chars; SMS-shaped (no markdown, no bullets); aligned with the rulebook's voice notes.
- tone: pick from the four; default 'neutral' when in doubt.`,

  classify_intent: `TASK: classify_intent
Return a payload of shape: { intent: string, reasoning: string }
- intent: pick from candidateIntents UNLESS the utterance clearly matches none, in which case return 'unknown'.
- reasoning: 1-2 sentences referencing the utterance + the rulebook/facts that informed the choice.`,

  confirm_emergency: `TASK: confirm_emergency
Return a payload of shape: { isEmergency: boolean, category: string, recommendedAction: 'escalate_now'|'route_to_drafts'|'callback' }
- isEmergency: true unless the utterance is clearly NOT a life-safety event (false-positive cost is low compared to false-negative).
- category: echo the input category if confirmed; pick a closer one if it was wrong.
- recommendedAction: 'escalate_now' for confirmed emergencies; 'route_to_drafts' for borderline; 'callback' only when the tenant explicitly opted out of urgency.`,

  polish_briefing: `TASK: polish_briefing
Return a payload of shape: { prose: string }
- prose: rewrite the template in the owner's voice (per voiceNotes) without altering any metric values.
- Preserve the structure and ordering of the template.`,

  dispatch_vendor: `TASK: dispatch_vendor
Return a payload of shape: { candidateIndex: number, smsBody: string }
- candidateIndex: integer in [0, candidateVendorIds.length); the orchestrator resolves this to the vendor UUID. Do NOT return a UUID — return the position in the candidate list.
- smsBody: <=480 chars; states category, urgency, brief description, and asks for Y/N response.`,

  update_rulebook: `TASK: update_rulebook
Return a payload of shape: { newRulebook: string, diffSummary: string }
- newRulebook: full text of the rulebook AFTER your proposed change. Preserve every existing line not directly addressed by the change.
- diffSummary: 1-2 sentences describing what changed and why, citing the proposedAdditions you incorporated.`,

  // Wave 6 — agentic dispatcher write actions are driven by the
  // operator dispatcher, NOT by the per-property worker prompt. The
  // dispatcher's system prompt (src/lib/agent/operator/dispatcher.ts)
  // owns the contract for these. Entries here exist only to keep
  // ACTION_CONTRACTS exhaustive across WorkerActionType. If a future
  // pipeline ever spawns one of these through spawnPropertyWorker, the
  // worker would receive an empty contract and reject — which is the
  // correct fail-loud behaviour.
  create_property: '',
  add_unit: '',
  add_tenant: '',
  set_lease_terms: '',
  update_rent: '',
  waive_rent: '',
  send_tenant_message: '',
  log_maintenance_ticket: '',
  update_property_rules: '',
  archive_lease: '',
  // Wave 7 — same rationale as wave-6 entries above (dispatcher-driven).
  add_appliance: '',
  update_appliance: '',
  set_property_vendor: '',
  update_tenant_preference: '',
  request_rent_payment: '',
  schedule_calendar_event: '',
  cancel_calendar_event: '',
  // Feature 5 — never model-produced (deterministic health-check cron);
  // entry keeps the map exhaustive over WorkerActionType.
  health_flag: '',
  // Voice Operator V1 — system-generated by the voice operator's
  // call_ended compiler; the worker LLM never proposes it.
  voice_call_review: '',
};

// ---------------------------------------------------------------------------
// Context block builders
// ---------------------------------------------------------------------------

export function renderRulebookBlock(ctx: PropertyContext): string {
  const rules = ctx.property.rulesText.trim();
  const header = `PROPERTY: ${ctx.property.name} (${ctx.property.id})`;
  const address = ctx.property.addressLine
    ? `\nADDRESS: ${ctx.property.addressLine}`
    : '';
  const tz = ctx.property.timezone
    ? `\nTIMEZONE: ${ctx.property.timezone}`
    : '';
  const autonomy = `\nAUTONOMY_LEVEL: ${ctx.property.autonomyLevel.toFixed(2)}`;
  const privacy = `\nPRIVACY_MODE: ${ctx.property.privacyMode}`;
  const rulebook = rules
    ? `\n\nRULEBOOK (verbatim):\n${rules}`
    : '\n\nRULEBOOK: (empty — owner has not authored property rules yet)';
  return `${header}${address}${tz}${autonomy}${privacy}${rulebook}`;
}

export function renderFactsBlock(ctx: PropertyContext): string {
  if (ctx.facts.length === 0) {
    return 'MEMORY FACTS: (none recorded yet)';
  }
  const lines = ctx.facts.map(renderFact);
  return `MEMORY FACTS (${ctx.facts.length}, newest-first within type):\n${lines.join('\n')}`;
}

function renderFact(f: ContextFact): string {
  const conf = f.confidence.toFixed(2);
  const subject = f.subjectId ? ` subject=${f.subjectId}` : '';
  const body = stringifyContent(f.content);
  return `- [${f.factType}${subject} confidence=${conf} source=${f.source} id=${f.id}] ${body}`;
}

function stringifyContent(content: unknown): string {
  if (content == null) return '(empty)';
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export function renderRecentTurnsBlock(ctx: PropertyContext): string {
  if (ctx.recentTurns.length === 0) {
    return 'RECENT CONVERSATIONS: (no recent activity for this property)';
  }
  const lines = ctx.recentTurns.map((t) => {
    const body = (t.body ?? '').replace(/\n/g, ' ').slice(0, 240);
    return `- [${t.occurredAt} ${t.channel} ${t.direction}] ${body}`;
  });
  return `RECENT CONVERSATIONS (${ctx.recentTurns.length}, oldest-first):\n${lines.join('\n')}`;
}

export function renderRosterBlock(ctx: PropertyContext): string {
  const vendorBlock =
    ctx.vendors.length === 0
      ? 'VENDORS: (none on roster)'
      : `VENDORS (${ctx.vendors.length}):\n` +
        ctx.vendors
          .map(
            (v) =>
              `- ${v.id} ${v.name} (${v.category ?? 'uncategorized'}) acceptance=${v.acceptanceRate ?? 'n/a'}`,
          )
          .join('\n');

  const tenantBlock =
    ctx.tenants.length === 0
      ? 'TENANTS: (no tenants on file for this property)'
      : `TENANTS (${ctx.tenants.length}):\n` +
        ctx.tenants
          .map(
            (t) =>
              `- ${t.id} ${t.fullName} unit=${t.unitLabel ?? '?'} rent_status=${t.rentStatus ?? '?'} rent=${formatRentAmount(t.rentAmount)}`,
          )
          .join('\n');

  return `${vendorBlock}\n\n${tenantBlock}`;
}

/** Render a lease rent amount (dollars) for the tenant roster line.
 *  '?' when the lease carries no parseable amount — the model must not
 *  invent a figure in that case (numeric grounding will demote it). */
function formatRentAmount(amount: number | null): string {
  if (amount === null) return '?';
  return `$${Math.round(amount).toLocaleString('en-US')}/mo`;
}

// ---------------------------------------------------------------------------
// Top-level builder
// ---------------------------------------------------------------------------

export interface BuildWorkerSystemPromptOptions {
  /** When true, attaches `cache_control: { type: 'ephemeral' }` to the static base block. */
  withCacheControl?: boolean;
  /**
   * Per-org branding (assistant name + org name). When omitted, the
   * builder renders a generic Odesa-default header so legacy callers
   * keep working without changes.
   */
  branding?: WorkerBranding;
}

/**
 * Build the system-prompt block array for a given action_type +
 * loaded property context. The first block is the static base
 * persona; if `withCacheControl` is true (default), it carries
 * `cache_control: { type: 'ephemeral' }` so providers that support
 * Anthropic-style caching can hit it across calls.
 */
export function buildWorkerSystemPrompt(
  context: PropertyContext,
  action_type: WorkerActionType,
  options: BuildWorkerSystemPromptOptions = {},
): SystemPromptBlock[] {
  const withCache = options.withCacheControl ?? true;
  const branding = options.branding ?? DEFAULT_BRANDING;

  const base: SystemPromptBlock = {
    type: 'text',
    text: renderWorkerBasePrompt(branding),
  };
  if (withCache) {
    base.cache_control = { type: 'ephemeral' };
  }

  const propertyBlock: SystemPromptBlock = {
    type: 'text',
    text: renderRulebookBlock(context),
  };

  const factsBlock: SystemPromptBlock = {
    type: 'text',
    text: renderFactsBlock(context),
  };

  const turnsBlock: SystemPromptBlock = {
    type: 'text',
    text: renderRecentTurnsBlock(context),
  };

  const rosterBlock: SystemPromptBlock = {
    type: 'text',
    text: renderRosterBlock(context),
  };

  const taskBlock: SystemPromptBlock = {
    type: 'text',
    text: `${ACTION_CONTRACTS[action_type]}\n\nNOW: ${context.loadedAt}`,
  };

  return [
    base,
    propertyBlock,
    factsBlock,
    turnsBlock,
    rosterBlock,
    taskBlock,
  ];
}

/**
 * Flatten the block array to a single string for providers that do
 * not support content-block input (e.g. Ollama's /api/chat).
 */
export function flattenSystemPrompt(blocks: SystemPromptBlock[]): string {
  return blocks.map((b) => b.text).join('\n\n---\n\n');
}
