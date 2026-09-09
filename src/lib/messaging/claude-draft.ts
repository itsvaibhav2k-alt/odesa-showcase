/**
 * Claude draft generator — Phase 4 + v1.5 worker integration.
 *
 * Given conversation history + the tenant's latest inbound line, return
 * a short text string the human can review, edit, and send.
 *
 * Implementation tiers (in order):
 *
 *   1. Worker path (v1.5): when `ODESA_USE_REAL_AI=true`, resolve the
 *      tenant's property via active lease, call
 *      `spawnPropertyWorker(propertyId, 'draft_sms_reply', ...)`, then
 *      record the proposal through `recordProposal`. Tenant-facing text is
 *      always returned as a review draft; model confidence is not consent.
 *   2. A test-hook table of `regex -> canned reply` installed via the
 *      Claude mock. First match wins.
 *   3. A default fallback reply so specs without custom scripts still
 *      get a deterministic draft.
 *
 * The pure helpers (`pickScript`, `buildDraftRequest`) and the
 * deterministic `generateDraft` stay so unit tests remain fast and the
 * v1 fallback keeps working with the env var off.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { recordProposal } from '@/lib/agent/proposals/record';
import { selectProvider } from '@/lib/agent/worker/providers/select';
import { spawnPropertyWorker } from '@/lib/agent/worker/spawn';
import {
  validateNumericGrounding,
  type ActionProposal,
  type DraftSmsReplyInput,
  type DraftSmsReplyPayload,
  type WorkerModelProvider,
} from '@/lib/agent/worker/types';

import { resolveTenantProperty } from './resolve-property';
import { SMS_TENANT_ASSISTANT_SYSTEM_PROMPT } from './system-prompt';

export interface ConversationHistoryTurn {
  role: 'tenant' | 'assistant';
  body: string;
}

export interface ClaudeDraftRequest {
  systemPrompt: string;
  history: ConversationHistoryTurn[];
  /** The just-arrived inbound line from the tenant. */
  latestInbound: string;
}

export interface ClaudeMockScript {
  /** JS regex source matched (case-insensitive) against `latestInbound`. */
  matchPattern: string;
  /** Text the assistant will return when the pattern fires. */
  reply: string;
}

export interface ClaudeMockState {
  scripts: ClaudeMockScript[];
  recorded: ClaudeDraftRequest[];
}

// ---------------------------------------------------------------------------
// Cross-route singleton state (pinned to globalThis so Next's dev-mode HMR
// doesn't reset it between route invocations). Null in prod; populated
// only when the /api/messaging/test-hooks endpoint installs the mock.
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__odesaClaudeMockState__';
type GlobalWithMock = typeof globalThis & {
  [GLOBAL_KEY]?: { state: ClaudeMockState | null };
};

function slot(): { state: ClaudeMockState | null } {
  const g = globalThis as GlobalWithMock;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { state: null };
  return g[GLOBAL_KEY]!;
}

function getState(): ClaudeMockState | null {
  return slot().state;
}

function setState(next: ClaudeMockState | null): void {
  slot().state = next;
}

export function installClaudeMock(scripts: ClaudeMockScript[]): ClaudeMockState {
  const fresh = { scripts: [...scripts], recorded: [] };
  setState(fresh);
  return fresh;
}

export function uninstallClaudeMock(): void {
  setState(null);
}

export function getClaudeMockState(): ClaudeMockState | null {
  return getState();
}

export function setClaudeMockScripts(scripts: ClaudeMockScript[]): void {
  const current = getState();
  if (!current) setState({ scripts: [...scripts], recorded: [] });
  else current.scripts = [...scripts];
}

export function getClaudeMockRecorded(): readonly ClaudeDraftRequest[] {
  return getState()?.recorded ?? [];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export const DEFAULT_FALLBACK_REPLY =
  'Thanks for reaching out — I am checking with the landlord and will follow up shortly.';

/**
 * Pick the first script whose `matchPattern` matches `body` (case-
 * insensitive). Returns null when nothing matches.
 */
export function pickScript(
  scripts: ClaudeMockScript[],
  body: string,
): ClaudeMockScript | null {
  for (const s of scripts) {
    let re: RegExp;
    try {
      re = new RegExp(s.matchPattern, 'i');
    } catch {
      continue;
    }
    if (re.test(body)) return s;
  }
  return null;
}

/**
 * Build the draft request payload passed to `generateDraft` (and the
 * mock recorder). Exposed so spec harnesses can assert the system
 * prompt + history shape without reaching into the handler internals.
 */
export function buildDraftRequest(
  history: ConversationHistoryTurn[],
  latestInbound: string,
): ClaudeDraftRequest {
  return {
    systemPrompt: SMS_TENANT_ASSISTANT_SYSTEM_PROMPT,
    history: [...history],
    latestInbound,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Given the request, pick the scripted reply if a mock is installed and
 * the latest inbound matches a pattern. Else fall back to the default
 * reply. Used by `generateDraftForTenant` as the v1 fallback path.
 *
 * v1.5: real worker; v1 fallback for tests.
 */
export async function generateDraft(
  req: ClaudeDraftRequest,
): Promise<string> {
  const current = getState();
  if (current) {
    current.recorded.push(req);
    const matched = pickScript(current.scripts, req.latestInbound);
    if (matched) return matched.reply;
  }
  return DEFAULT_FALLBACK_REPLY;
}

// ---------------------------------------------------------------------------
// Worker-augmented entry point (v1.5)
// ---------------------------------------------------------------------------

type AdminClient = SupabaseClient<Database>;

export interface GenerateDraftForTenantArgs {
  admin: AdminClient;
  tenantId: string;
  conversationId: string;
  history: ConversationHistoryTurn[];
  latestInbound: string;
  /**
   * Optional provider override. When omitted, `selectProvider` picks
   * one based on the property's privacy_mode. Tests inject mocks here
   * to avoid touching the SDK.
   */
  provider?: WorkerModelProvider;
}

export interface DraftWithProvenance {
  body: string;
  /** True when the body came from the worker; false on fallback. */
  fromWorker: boolean;
  /** Populated when fromWorker = true; null on fallback path. */
  proposal: ActionProposal | null;
  /**
   * Legacy compatibility flag. Worker-generated tenant drafts are review-first
   * and therefore always return false.
   */
  autoCommitted: boolean;
}

/**
 * Worker-augmented draft entry point. Used by `handle-inbound.ts` after
 * inserting the inbound row.
 *
 * Flow:
 *   - When `ODESA_USE_REAL_AI` is not 'true', short-circuit to the
 *     deterministic `generateDraft` path. v1 default for tests/CI.
 *   - Otherwise, resolve the tenant's property via active lease. If
 *     resolution fails (tenant has no active lease yet), fall back —
 *     the inbox feed still shows a draft.
 *   - Spawn `draft_sms_reply` with the model picked by `selectProvider`.
 *   - Persist via `recordProposal` (which gates). Pass `tenantId` and
 *     `conversationId` via the `routing` field, NOT inside payload.
 *     payload is audit-pure model output; routing is Odesa-side
 *     orchestrator metadata. This is the on-prem privacy boundary —
 *     tenant UUIDs must never round-trip through the model.
 *   - Return the body plus its persisted proposal. handle-inbound keeps that
 *     proposal as the single review artifact and does not create a parallel
 *     pending message draft. Tenant-facing sends always require explicit
 *     human review, irrespective of autonomy or confidence.
 *   - On any thrown error from spawn/record, fall back rather than
 *     stalling the inbox feed.
 */
export async function generateDraftForTenant(
  args: GenerateDraftForTenantArgs,
): Promise<DraftWithProvenance> {
  const fallback = async (): Promise<DraftWithProvenance> => ({
    body: await generateDraft(buildDraftRequest(args.history, args.latestInbound)),
    fromWorker: false,
    proposal: null,
    autoCommitted: false,
  });

  if (process.env.ODESA_USE_REAL_AI !== 'true') return fallback();

  const resolved = await resolveTenantProperty(args.admin, args.tenantId);
  if (!resolved) return fallback();

  try {
    const property = await loadPropertyForGating(args.admin, resolved.propertyId);
    if (!property) return fallback();

    const provider =
      args.provider ??
      selectProvider(
        {
          privacyMode: property.privacyMode,
          ollamaHost: property.ollamaHost,
        },
        { actionType: 'draft_sms_reply' },
      );

    const tenantSummary = await loadTenantSummary(args.admin, args.tenantId);

    const data: DraftSmsReplyInput = {
      tenantId: args.tenantId,
      tenantName: tenantSummary?.full_name ?? null,
      phoneE164: tenantSummary?.phone_e164 ?? null,
      conversationId: args.conversationId,
      inboundBody: args.latestInbound,
      history: args.history,
    };

    const inMemory = await spawnPropertyWorker({
      propertyId: resolved.propertyId,
      action_type: 'draft_sms_reply',
      data,
      deps: { client: args.admin, provider },
    });

    const draftPayload = inMemory.payload as DraftSmsReplyPayload;

    // Phase A4 — deterministic currency grounding. Every dollar amount
    // in the draft must appear in the inbound body, history, the
    // property's lease rent amounts, or the rulebook. Ungrounded
    // amounts demote an 'auto' gate outcome to 'review' (never block).
    const rentTexts = await loadPropertyRentTexts(args.admin, resolved.propertyId);
    const allowedTexts: string[] = [
      args.latestInbound,
      ...args.history.map((h) => h.body),
      ...rentTexts,
      property.rulesText,
    ];
    const grounding = validateNumericGrounding(draftPayload.body, allowedTexts);

    const { proposal } = await recordProposal(args.admin, {
      organizationId: resolved.organizationId,
      propertyId: resolved.propertyId,
      workerModel: inMemory.workerModel,
      actionType: 'draft_sms_reply',
      payload: draftPayload,
      routing: {
        tenantId: args.tenantId,
        conversationId: args.conversationId,
      },
      reasoning: inMemory.reasoning,
      confidence: inMemory.confidence,
      contextFactIds: inMemory.context_fact_ids,
      autonomyLevel: property.autonomyLevel,
      privacyMode: property.privacyMode,
      ...(grounding.ok
        ? {}
        : {
            forceReview: {
              reason: `ungrounded currency amounts in draft: ${grounding.ungrounded.join(', ')}`,
            },
          }),
    });

    return {
      body: draftPayload.body,
      fromWorker: true,
      proposal,
      autoCommitted: false,
    };
  } catch {
    return fallback();
  }
}

interface PropertyGatingInfo {
  privacyMode: 'hosted' | 'on_prem';
  ollamaHost: string | null;
  autonomyLevel: number;
  /** Rulebook text — part of the numeric-grounding allowed set. */
  rulesText: string;
}

async function loadPropertyForGating(
  admin: AdminClient,
  propertyId: string,
): Promise<PropertyGatingInfo | null> {
  const { data } = await admin
    .from('properties')
    .select('privacy_mode, ollama_host, autonomy_level, rules_text')
    .eq('id', propertyId)
    .maybeSingle();
  if (!data) return null;
  return {
    privacyMode: data.privacy_mode === 'on_prem' ? 'on_prem' : 'hosted',
    ollamaHost: data.ollama_host ?? null,
    autonomyLevel: data.autonomy_level,
    rulesText: data.rules_text ?? '',
  };
}

/**
 * Load the property's active/pending lease rent amounts rendered as
 * grounding texts — both the raw stored value and a formatted dollar
 * string — so `validateNumericGrounding` accepts a draft that states
 * the real rent even when the tenant never typed the number.
 */
async function loadPropertyRentTexts(
  admin: AdminClient,
  propertyId: string,
): Promise<string[]> {
  const { data } = await admin
    .from('leases')
    .select('rent_amount, units!inner(property_id)')
    .eq('units.property_id', propertyId)
    .in('status', ['active', 'pending']);
  if (!data) return [];

  const texts: string[] = [];
  for (const row of data) {
    const raw = (row as { rent_amount: number | string | null }).rent_amount;
    const amount = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof amount !== 'number' || !Number.isFinite(amount)) continue;
    texts.push(String(amount));
    texts.push(`$${amount.toLocaleString('en-US')}`);
  }
  return texts;
}

async function loadTenantSummary(
  admin: AdminClient,
  tenantId: string,
): Promise<{ full_name: string | null; phone_e164: string | null } | null> {
  const { data } = await admin
    .from('tenants')
    .select('full_name, phone_e164')
    .eq('id', tenantId)
    .maybeSingle();
  return data ?? null;
}
