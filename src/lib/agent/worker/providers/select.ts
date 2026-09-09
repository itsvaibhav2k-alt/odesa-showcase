/**
 * selectProvider — picks a WorkerModelProvider based on the org's
 * privacy mode setting AND the action_type the worker will run.
 *
 * Privacy routing:
 *   - privacy_mode='hosted'  → HostedHaikuProvider (Anthropic API)
 *   - privacy_mode='on_prem' → OllamaProvider, configured with the
 *                              org-specific OLLAMA_HOST
 *
 * Hosted-mode model routing is policy-driven — see ACTION_MODEL_POLICY.
 * Cheap inference / template-y actions get Haiku 4.5; high-stakes draft
 * + dispatch + emergency get Sonnet 4.6; rule synthesis gets Opus 4.7.
 * The dispatcher does not reason about model cost — it just calls
 * `spawn_property_worker(action_type, ...)` and the policy here picks
 * the right model. Predictable, debuggable, easy to A/B by changing one
 * map entry.
 *
 * On-prem mode currently runs a single Ollama model regardless of
 * action_type because the Ollama-backed setup is privacy-bound, not
 * capability-bound. If a customer wants per-action models on-prem they
 * can override `ollamaModel`, but in practice the same local model
 * services every action.
 *
 * The provider instances are constructed per call rather than cached
 * because the on-prem host is org-scoped — caching would leak hosts
 * across tenants. HostedHaiku is cheap to construct (just wraps the
 * SDK client), so the pattern stays uniform.
 */

import { HostedHaikuProvider } from './hosted-haiku';
import { OllamaProvider } from './ollama';
import type { WorkerModelProvider } from './types';
import type { WorkerActionType } from '../types';

export type PrivacyMode = 'hosted' | 'on_prem';

export interface OrgPrivacyConfig {
  privacyMode: PrivacyMode;
  /** Required when privacyMode === 'on_prem'. */
  ollamaHost?: string | null;
  /** Optional override; defaults to OLLAMA_DEFAULT_MODEL. */
  ollamaModel?: string | null;
}

export interface SelectProviderOptions {
  /**
   * Worker action verb the picked provider will run. When provided AND
   * privacyMode='hosted', the model is chosen from ACTION_MODEL_POLICY.
   * When omitted, falls back to the Haiku default — keeps health checks
   * + ad-hoc callers cheap and avoids accidental Sonnet/Opus spend on
   * non-action paths.
   */
  actionType?: WorkerActionType;
}

export interface SelectProviderOverrides {
  hostedFactory?: (cfg: { model: string }) => WorkerModelProvider;
  ollamaFactory?: (cfg: { host: string; model?: string }) => WorkerModelProvider;
}

export class PrivacyModeMisconfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivacyModeMisconfiguredError';
  }
}

/**
 * Per-action model policy for hosted-mode workers.
 *
 * - Haiku 4.5 (cheap, fast): inferential / template-y actions where
 *   tone is forgiving and the model just needs to read context + map
 *   to an action verb.
 * - Sonnet 4.6 (default for stakes): tenant-facing drafts (tone matters),
 *   vendor dispatch (multi-step + decision), emergency confirmation
 *   (high-stakes correctness).
 * - Opus 4.7 (deep reasoning): rulebook synthesis where the worker is
 *   reconciling multiple owner rules + observed patterns into a
 *   superseded ruleset. Rare; expensive but worth it.
 *
 * Override per env (e.g. `WORKER_MODEL_DRAFT_SMS_REPLY=claude-opus-4-7`)
 * to A/B without editing this file.
 */
export const ACTION_MODEL_POLICY: Record<WorkerActionType, string> = {
  classify_intent:   'claude-haiku-4-5-20251001',
  draft_sms_reply:   'claude-sonnet-4-6',
  confirm_emergency: 'claude-sonnet-4-6',
  dispatch_vendor:   'claude-sonnet-4-6',
  polish_briefing:   'claude-sonnet-4-6',
  update_rulebook:   'claude-opus-4-7',
  // Wave 6 — agentic dispatcher write actions. The operator
  // dispatcher (`runOperatorDispatcher`) drives these directly;
  // they don't go through `spawnPropertyWorker` / a per-property
  // worker model. Keeping the map exhaustive satisfies the
  // WorkerActionType contract — these entries are unreachable at
  // runtime today but document intent for any future provider that
  // re-routes a wave-6 action through the worker pipeline.
  create_property:        'claude-sonnet-4-6',
  add_unit:               'claude-sonnet-4-6',
  add_tenant:             'claude-sonnet-4-6',
  set_lease_terms:        'claude-sonnet-4-6',
  update_rent:            'claude-sonnet-4-6',
  waive_rent:             'claude-sonnet-4-6',
  send_tenant_message:    'claude-sonnet-4-6',
  log_maintenance_ticket: 'claude-sonnet-4-6',
  update_property_rules:  'claude-sonnet-4-6',
  archive_lease:          'claude-sonnet-4-6',
  // Wave 7 — same rationale as wave-6 entries above. Dispatcher-driven;
  // keeping the map exhaustive satisfies the WorkerActionType contract.
  add_appliance:           'claude-sonnet-4-6',
  update_appliance:        'claude-sonnet-4-6',
  set_property_vendor:     'claude-sonnet-4-6',
  update_tenant_preference:'claude-sonnet-4-6',
  request_rent_payment:    'claude-sonnet-4-6',
  schedule_calendar_event: 'claude-sonnet-4-6',
  cancel_calendar_event:   'claude-sonnet-4-6',
  // Feature 5 — health_flag is produced by the deterministic
  // daily-health-check cron (worker_model 'system-health-check'),
  // never by a model. Entry exists only to keep this map exhaustive
  // over WorkerActionType; unreachable through the worker pipeline.
  health_flag:             'claude-sonnet-4-6',
  // Voice Operator V1 — voice_call_review is produced by the Retell
  // webhook's call_ended compiler (src/lib/voice), never by a model.
  // Entry exists only to keep this map exhaustive over
  // WorkerActionType; unreachable through the worker pipeline.
  voice_call_review:       'claude-sonnet-4-6',
};

function resolveActionModel(actionType: WorkerActionType): string {
  const envKey = `WORKER_MODEL_${actionType.toUpperCase()}`;
  const override = process.env[envKey]?.trim();
  if (override) return override;
  return ACTION_MODEL_POLICY[actionType];
}

/**
 * Pick a provider for the given org configuration. Throws
 * PrivacyModeMisconfiguredError if on_prem is selected without a
 * configured host — callers should surface this as a settings-page
 * validation error rather than a runtime crash.
 */
export function selectProvider(
  org: OrgPrivacyConfig,
  options: SelectProviderOptions = {},
  overrides: SelectProviderOverrides = {},
): WorkerModelProvider {
  if (org.privacyMode === 'on_prem') {
    const host = org.ollamaHost?.trim();
    if (!host) {
      throw new PrivacyModeMisconfiguredError(
        'on_prem privacy mode requires ollamaHost to be set on the organization',
      );
    }
    if (overrides.ollamaFactory) {
      return overrides.ollamaFactory({
        host,
        model: org.ollamaModel ?? undefined,
      });
    }
    return new OllamaProvider({
      host,
      model: org.ollamaModel ?? undefined,
    });
  }

  // Hosted mode: pick the Anthropic model from the action policy when
  // we know the action_type. Otherwise default to Haiku (cheap; keeps
  // health checks and any unguarded caller from accidentally invoking
  // Opus).
  const model = options.actionType
    ? resolveActionModel(options.actionType)
    : undefined;

  if (overrides.hostedFactory) {
    return overrides.hostedFactory({ model: model ?? '' });
  }
  return new HostedHaikuProvider({ model });
}
