/**
 * Intent whitelist — determines whether an inbound utterance can be
 * handled autonomously by Odesa (the Retell voice agent).
 *
 * Spec §8. Week-5 launch whitelist: rent_balance, office_hours_and_contact,
 * emergency_detection, general_callback. Everything else either runs in
 * shadow mode (drafts logged, not acted on) or escalates unconditionally.
 *
 * Classification here is lexical (keyword match) on purpose: cheap,
 * deterministic, unit-testable. A Claude Haiku classifier wraps this at
 * call time for ambiguous utterances (see spec §4.4), but the whitelist
 * itself must remain a pure function for audit + replay.
 */

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { recordProposal } from '@/lib/agent/proposals/record';
import { selectProvider } from '@/lib/agent/worker/providers/select';
import { spawnPropertyWorker } from '@/lib/agent/worker/spawn';
import type {
  ClassifyIntentInput,
  ClassifyIntentPayload,
  WorkerModelProvider,
} from '@/lib/agent/worker/types';

import type { IntentEntry, IntentId, IntentMatch } from './types';

const INTENTS: readonly IntentEntry[] = [
  {
    id: 'rent_balance',
    mode: 'autonomous',
    keywords: [
      'rent',
      'balance',
      'how much do i owe',
      'how much is due',
      'payment due',
      'when is rent due',
      'late fee',
      'outstanding',
    ],
  },
  {
    id: 'office_hours_and_contact',
    mode: 'autonomous',
    keywords: [
      'office hours',
      'when are you open',
      'contact',
      'phone number',
      'email address',
      'how do i reach',
      'address',
    ],
  },
  {
    id: 'emergency_detection',
    mode: 'autonomous',
    keywords: [
      'water leak',
      'flooding',
      'no heat',
      'fire',
      'smoke',
      'gas smell',
      'smell gas',
      'gas leak',
      'locked out',
      'sewage',
      'burst pipe',
    ],
  },
  {
    id: 'general_callback',
    mode: 'autonomous',
    keywords: ['call back', 'have someone call', 'speak to', 'talk to'],
  },
  {
    id: 'maintenance_request',
    mode: 'shadow',
    keywords: [
      'broken',
      'not working',
      'fix',
      'repair',
      'leaking',
      'clogged',
      'dishwasher',
      'refrigerator',
      'ac',
      'air conditioning',
      'heater',
      'stove',
      'oven',
    ],
  },
  {
    id: 'lease_question',
    mode: 'shadow',
    keywords: [
      'lease',
      'renewal',
      'renew',
      'end date',
      'move out date',
      'lease term',
    ],
  },
  {
    id: 'payment_plan',
    mode: 'shadow',
    keywords: [
      'payment plan',
      'installments',
      'split the rent',
      "can't pay",
      'short on rent',
    ],
  },
  {
    id: 'move_out_notice',
    mode: 'shadow',
    keywords: ['moving out', 'move out notice', 'giving notice', 'vacating'],
  },
  {
    id: 'general_property_info',
    mode: 'shadow',
    keywords: [
      'parking',
      'trash day',
      'garbage',
      'recycling',
      'amenities',
      'pool',
      'gym',
      'laundry room',
    ],
  },
  {
    id: 'eviction_discussion',
    mode: 'escalate_always',
    keywords: ['eviction', 'evict', 'kicked out', 'notice to quit'],
  },
  {
    id: 'legal_threat',
    mode: 'escalate_always',
    keywords: [
      'lawyer',
      'attorney',
      'sue',
      'lawsuit',
      'court',
      'legal action',
    ],
  },
  {
    id: 'aggression',
    mode: 'escalate_always',
    keywords: [
      'fuck',
      'shit',
      'pissed',
      'furious',
      'goddamn',
      'motherfucker',
      'bullshit',
    ],
  },
] as const;

export function classifyIntent(utterance: string): IntentMatch {
  const normalized = utterance.toLowerCase().trim();
  if (!normalized) {
    return { intent: 'unknown', confidence: 0, autonomous: false, matchedKeywords: [] };
  }

  // Score by total matched character length — a 13-char phrase
  // ("short on rent") beats a 4-char phrase ("rent") so the more
  // specific intent wins when keywords overlap.
  let best: { entry: IntentEntry; hits: string[]; score: number } | null = null;
  for (const entry of INTENTS) {
    const hits = entry.keywords.filter((k) => normalized.includes(k));
    if (hits.length === 0) continue;
    const score = hits.reduce((sum, k) => sum + k.length, 0);
    if (!best || score > best.score) {
      best = { entry, hits, score };
    }
  }

  if (!best) {
    return { intent: 'unknown', confidence: 0, autonomous: false, matchedKeywords: [] };
  }

  return {
    intent: best.entry.id,
    confidence: Math.min(1, best.hits.length / 2),
    autonomous: best.entry.mode === 'autonomous',
    matchedKeywords: best.hits,
  };
}

export function isAutonomousIntent(intent: IntentId): boolean {
  return INTENTS.find((e) => e.id === intent)?.mode === 'autonomous';
}

export function isHardEscalateIntent(intent: IntentId): boolean {
  return INTENTS.find((e) => e.id === intent)?.mode === 'escalate_always';
}

export const INTENT_REGISTRY = INTENTS;

// ---------------------------------------------------------------------------
// Worker-augmented classifier (v1.5)
// ---------------------------------------------------------------------------

/** Below this lexical confidence we ask the worker to disambiguate. */
const LEXICAL_CONFIDENCE_THRESHOLD = 0.6;
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  match: IntentMatch;
  expiresAt: number;
}

/**
 * In-process cache, scoped to a single Next server instance. Goal is
 * to dampen repeat classifier spawns within the same Retell turn
 * pipeline (a single voice utterance can trip multiple tool calls in
 * quick succession). NOT a multi-region cache — for v1.6 multi-region
 * deploys this should move to Redis. Tracked separately; v1.5 is
 * single-region (US-East) so per-instance memory is sufficient.
 */
const intentCache = new Map<string, CacheEntry>();

function cacheKey(utterance: string): string {
  return createHash('sha256').update(utterance).digest('hex');
}

function readCache(utterance: string): IntentMatch | null {
  const key = cacheKey(utterance);
  const entry = intentCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    intentCache.delete(key);
    return null;
  }
  return entry.match;
}

function writeCache(utterance: string, match: IntentMatch): void {
  intentCache.set(cacheKey(utterance), {
    match,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export interface ClassifyIntentDeps {
  admin: SupabaseClient<Database>;
  /** Optional provider override for tests. */
  provider?: WorkerModelProvider;
}

export interface ClassifyIntentWithFallbackArgs {
  utterance: string;
  history: ReadonlyArray<{ role: 'tenant' | 'assistant'; body: string }>;
  propertyId: string;
  deps: ClassifyIntentDeps;
}

/**
 * Lexical-first intent classification with a worker fallback for
 * ambiguous utterances. Pure `classifyIntent` runs first. If best
 * lexical confidence is at or above the threshold (or `ODESA_USE_REAL_AI`
 * is off), the lexical match is returned verbatim. Otherwise spawns
 * `classify_intent`, persists via `recordProposal` so the audit trail
 * captures the disambiguation, and uses the model's verdict only when
 * the model's intent is in the known IntentId set; otherwise lexical
 * wins.
 *
 * Cached for 30s by sha256(utterance) to dampen repeat calls within
 * the same Retell turn pipeline.
 */
export async function classifyIntentWithFallback(
  args: ClassifyIntentWithFallbackArgs,
): Promise<IntentMatch> {
  const cached = readCache(args.utterance);
  if (cached) return cached;

  const lexical = classifyIntent(args.utterance);

  const skipWorker =
    process.env.ODESA_USE_REAL_AI !== 'true' ||
    lexical.confidence >= LEXICAL_CONFIDENCE_THRESHOLD;

  if (skipWorker) {
    writeCache(args.utterance, lexical);
    return lexical;
  }

  try {
    const property = await loadPropertyForGating(args.deps.admin, args.propertyId);
    if (!property) {
      writeCache(args.utterance, lexical);
      return lexical;
    }

    const provider = args.deps.provider ?? selectProvider(
      {
        privacyMode: property.privacyMode,
        ollamaHost: property.ollamaHost,
      },
      { actionType: 'classify_intent' },
    );

    const data: ClassifyIntentInput = {
      utterance: args.utterance,
      history: args.history,
      candidateIntents: [lexical.intent],
    };

    const inMemory = await spawnPropertyWorker({
      propertyId: args.propertyId,
      action_type: 'classify_intent',
      data,
      deps: { client: args.deps.admin, provider },
    });

    const payload = inMemory.payload as ClassifyIntentPayload;

    // Persist for audit; classify_intent commits as a no-op so we don't
    // need to call commitProposal. routing is null per worker/types.ts —
    // pure inferences carry no orchestrator-side IDs.
    await recordProposal(args.deps.admin, {
      organizationId: inMemory.organizationId,
      propertyId: args.propertyId,
      workerModel: inMemory.workerModel,
      actionType: 'classify_intent',
      payload,
      routing: null,
      reasoning: inMemory.reasoning,
      confidence: inMemory.confidence,
      contextFactIds: inMemory.context_fact_ids,
      autonomyLevel: property.autonomyLevel,
      privacyMode: property.privacyMode,
    });

    const known = INTENTS.find((e) => e.id === payload.intent);
    if (!known) {
      writeCache(args.utterance, lexical);
      return lexical;
    }

    const refined: IntentMatch = {
      intent: known.id,
      confidence: inMemory.confidence,
      autonomous: known.mode === 'autonomous',
      matchedKeywords: lexical.matchedKeywords,
    };
    writeCache(args.utterance, refined);
    return refined;
  } catch {
    writeCache(args.utterance, lexical);
    return lexical;
  }
}

interface PropertyGatingInfo {
  privacyMode: 'hosted' | 'on_prem';
  ollamaHost: string | null;
  autonomyLevel: number;
}

async function loadPropertyForGating(
  admin: SupabaseClient<Database>,
  propertyId: string,
): Promise<PropertyGatingInfo | null> {
  const { data } = await admin
    .from('properties')
    .select('privacy_mode, ollama_host, autonomy_level')
    .eq('id', propertyId)
    .maybeSingle();
  if (!data) return null;
  return {
    privacyMode: data.privacy_mode === 'on_prem' ? 'on_prem' : 'hosted',
    ollamaHost: data.ollama_host ?? null,
    autonomyLevel: data.autonomy_level,
  };
}

/** Test-only: clear the in-memory cache between specs. */
export function _clearIntentCacheForTests(): void {
  intentCache.clear();
}
