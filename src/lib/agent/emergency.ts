/**
 * Emergency pattern matcher — lexical first-pass for the 6 categories
 * that MUST trigger immediate landlord escalation (spec §8 whitelist #3).
 *
 * A positive match here short-circuits normal intent routing: the voice
 * agent confirms briefly ("I understand this is an emergency — I'm
 * calling [landlord] right now"), calls `escalate_to_landlord`, and the
 * tool endpoint fires both an SMS and a parallel call.
 *
 * Claude Haiku wraps this with a confirmation step at call time to catch
 * false positives (e.g., "I was worried about a water leak but it
 * stopped"). That confirmation happens in the tool endpoint, not here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { recordProposal } from '@/lib/agent/proposals/record';
import { selectProvider } from '@/lib/agent/worker/providers/select';
import { spawnPropertyWorker } from '@/lib/agent/worker/spawn';
import type {
  ConfirmEmergencyInput,
  ConfirmEmergencyPayload,
  WorkerModelProvider,
} from '@/lib/agent/worker/types';

import type { EmergencyCategory, EmergencyMatch } from './types';

interface Pattern {
  category: EmergencyCategory;
  phrases: readonly string[];
}

const PATTERNS: readonly Pattern[] = [
  {
    category: 'water_leak',
    phrases: [
      'water leak',
      'burst pipe',
      'pipe burst',
      'pipe just burst',
      'pipes burst',
      'flooding',
      'water everywhere',
      'water pouring',
      'ceiling leaking',
      'leak in',
    ],
  },
  {
    category: 'no_heat_winter',
    phrases: [
      'no heat',
      'heat is out',
      'heater broken',
      'freezing',
      'furnace dead',
      'furnace out',
      'furnace is out',
    ],
  },
  {
    category: 'fire_smoke',
    phrases: ['fire', 'smoke alarm', 'burning smell', 'smoke coming', 'smell smoke', 'smoke in'],
  },
  {
    category: 'gas_smell',
    phrases: ['gas smell', 'smell gas', 'gas leak', 'rotten eggs smell'],
  },
  {
    category: 'lockout',
    phrases: ['locked out', 'lost my keys', "can't get in"],
  },
  {
    category: 'sewage_backup',
    phrases: ['sewage', 'toilet backing up', 'sewer backup', 'raw sewage'],
  },
] as const;

export function detectEmergency(utterance: string): EmergencyMatch {
  const normalized = utterance.toLowerCase().trim();
  if (!normalized) {
    return { emergency: false, category: null, matchedPhrase: null };
  }

  for (const pat of PATTERNS) {
    for (const phrase of pat.phrases) {
      if (normalized.includes(phrase)) {
        return { emergency: true, category: pat.category, matchedPhrase: phrase };
      }
    }
  }

  return { emergency: false, category: null, matchedPhrase: null };
}

export const EMERGENCY_PATTERNS = PATTERNS;

// ---------------------------------------------------------------------------
// Worker-augmented confirmation (v1.5)
// ---------------------------------------------------------------------------

export type ConfirmedSeverity = 'emergency' | 'review';

export interface ConfirmedEmergencyMatch extends EmergencyMatch {
  /** True when worker confirmed; false on downgrade; null when not consulted. */
  workerConfirmed: boolean | null;
  /**
   * - 'emergency': lexical hit + worker confirmed (or worker bypassed
   *   when env var off / on worker error). Caller fires the immediate
   *   landlord escalation.
   * - 'review': worker said `isEmergency: false`. Caller queues for
   *   human review instead of silently dropping the match.
   * - null: no lexical match; nothing to do.
   */
  severity: ConfirmedSeverity | null;
  recommendedAction: ConfirmEmergencyPayload['recommendedAction'] | null;
}

export interface DetectAndConfirmEmergencyDeps {
  admin: SupabaseClient<Database>;
  provider?: WorkerModelProvider;
}

export interface DetectAndConfirmEmergencyArgs {
  utterance: string;
  propertyId: string;
  deps: DetectAndConfirmEmergencyDeps;
  retellArtifactKey?: string | null;
  /**
   * Optional cancellation signal forwarded to `spawnPropertyWorker`.
   * Latency-sensitive callers (Retell tool routes with a budget) wire
   * an AbortController + setTimeout here. On abort, this function
   * surfaces the rejection to the caller — it does NOT silently swap
   * to a default 'emergency' severity, because that would mask budget
   * exhaustion as a model-error fallback. The route handler is
   * responsible for catching the abort and deciding the safe default.
   */
  signal?: AbortSignal;
}

/**
 * Lexical-first emergency detection with a worker false-positive guard.
 *
 *   1. Lexical match runs first. No match → return null severity, no
 *      model call.
 *   2. On a hit, spawn `confirm_emergency` to filter false positives
 *      ("I was worried about a leak but it stopped"). Bypassed when
 *      `ODESA_USE_REAL_AI` is not 'true' — lexical hit is taken.
 *   3. If the worker returns `isEmergency: false`, severity downgrades
 *      to 'review'. Match is preserved so the caller still queues it
 *      for human review (do NOT silently drop).
 *   4. On a non-abort thrown error, default to 'emergency' so we never
 *      miss a real emergency due to model flakiness.
 *   5. On AbortError (caller's latency budget exceeded), the abort
 *      propagates to the caller — see the `signal` field comment.
 */
export async function detectAndConfirmEmergency(
  args: DetectAndConfirmEmergencyArgs,
): Promise<ConfirmedEmergencyMatch> {
  const lexical = detectEmergency(args.utterance);
  if (!lexical.emergency || !lexical.category) {
    return {
      ...lexical,
      workerConfirmed: null,
      severity: null,
      recommendedAction: null,
    };
  }

  if (process.env.ODESA_USE_REAL_AI !== 'true') {
    return {
      ...lexical,
      workerConfirmed: null,
      severity: 'emergency',
      recommendedAction: null,
    };
  }

  try {
    const property = await loadPropertyForGating(args.deps.admin, args.propertyId);
    if (!property) {
      return {
        ...lexical,
        workerConfirmed: null,
        severity: 'emergency',
        recommendedAction: null,
      };
    }

    if (args.retellArtifactKey) {
      const { data: prior } = await args.deps.admin.from('action_proposals')
        .select('payload').eq('retell_artifact_key', args.retellArtifactKey).maybeSingle();
      if (prior) {
        const payload = prior.payload as unknown as ConfirmEmergencyPayload;
        return { ...lexical, workerConfirmed: payload.isEmergency,
          severity: payload.isEmergency ? 'emergency' : 'review',
          recommendedAction: payload.recommendedAction };
      }
    }

    const provider = args.deps.provider ?? selectProvider(
      {
        privacyMode: property.privacyMode,
        ollamaHost: property.ollamaHost,
      },
      { actionType: 'confirm_emergency' },
    );

    const data: ConfirmEmergencyInput = {
      utterance: args.utterance,
      category: lexical.category,
      matchedPhrase: lexical.matchedPhrase,
    };

    const inMemory = await spawnPropertyWorker({
      propertyId: args.propertyId,
      action_type: 'confirm_emergency',
      data,
      deps: { client: args.deps.admin, provider },
      signal: args.signal,
    });

    const payload = inMemory.payload as ConfirmEmergencyPayload;

    // Persist for audit. confirm_emergency commits as a no-op (commit.ts
    // dispatch case), so no commitProposal call is needed — escalation
    // SMS is fired by the caller via the existing escalate_to_landlord
    // path or the new confirm_emergency Retell tool route.
    await recordProposal(args.deps.admin, {
      organizationId: inMemory.organizationId,
      propertyId: args.propertyId,
      workerModel: inMemory.workerModel,
      actionType: 'confirm_emergency',
      payload,
      // routing is null per worker/types.ts — pure inference, no
      // orchestrator-side IDs to carry.
      routing: null,
      reasoning: inMemory.reasoning,
      confidence: inMemory.confidence,
      contextFactIds: inMemory.context_fact_ids,
      autonomyLevel: property.autonomyLevel,
      privacyMode: property.privacyMode,
      retellArtifactKey: args.retellArtifactKey ?? null,
    });

    return {
      ...lexical,
      workerConfirmed: payload.isEmergency,
      severity: payload.isEmergency ? 'emergency' : 'review',
      recommendedAction: payload.recommendedAction,
    };
  } catch (err) {
    // Caller-driven cancellation (latency budget exceeded) must
    // propagate. The route handler catches it and chooses the safe
    // default for the voice agent.
    if (isAbortError(err, args.signal)) throw err;
    return {
      ...lexical,
      workerConfirmed: null,
      severity: 'emergency',
      recommendedAction: null,
    };
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

/**
 * Detect whether `err` is the cancellation surfaced by `signal`. Covers
 * the standard DOMException 'AbortError' shape, the "aborted" name used
 * by some SDK implementations, and the explicit signal.aborted check
 * for cases where providers swallow the abort and surface a generic
 * error after the fact.
 */
function isAbortError(err: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'aborted')) {
    return true;
  }
  return false;
}
