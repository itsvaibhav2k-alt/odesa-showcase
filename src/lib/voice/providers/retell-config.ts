/**
 * retell-config — the code-derived Retell dashboard config, in the VERIFIED
 * real Retell provider shape (NOT the flat internal e2e shape).
 *
 * WHY this exists: the Retell dashboard (agent prompt, model, tool
 * custom-functions, webhook URLs, per-number inbound URL) is configured by
 * hand — there is no live sync (see agent-prompt.ts). This module derives that
 * config from code so the manual copy-paste has a single, drift-checked source:
 *   - tools come straight from VOICE_ACTION_TOOL_MAP (adding a mapped verb
 *     without a spec here is a hard error), each tool's `parameters` mirrors
 *     its route's zod `args` schema, and each url points at its live route;
 *   - the agent prompt comes from buildVoiceAgentPrompt(settings);
 *   - the model is the single verified in-enum id (gpt-4.1), never invented.
 *
 * Pure data + builders. NO network, NO Supabase, NO secrets baked in. Retell
 * signs custom-tool requests; the receiving route verifies that signature
 * against the raw body before parsing it. Fully vitest-safe.
 *
 * Contract source of truth: docs/research/retell-grok-production-voice-research-2026-07-07.md
 */

import { buildVoiceAgentPrompt } from '../agent-prompt';
import { defaultSettings, type VoiceSettings } from '../settings';
import { VOICE_ACTION_TOOL_MAP } from '../tool-map';
import { INTENT_IDS } from '../types';

/**
 * Retell agent model — MUST be a value in Retell's current create-retell-llm
 * `model` enum (research §4). 'gpt-5.5' and 'claude-5-sonnet' are the current
 * flagships in that enum; swap between them here (one line). Never invent one.
 */
export const RETELL_MODEL = 'gpt-5.5' as const;

/** Verified custom-function timeout: configured value or 2 min (research §3d). */
export const RETELL_TOOL_TIMEOUT_MS = 120_000;

/** The three call-event webhooks the /api/retell/webhook handler accepts. */
export const RETELL_WEBHOOK_EVENTS = ['call_started', 'call_ended', 'call_analyzed'] as const;

/**
 * Dynamic variables the inbound handler may return and the agent may template
 * ({{caller_name}} etc). Privacy-gated: unknown/ambiguous callers get none.
 * Mirrors dynamicVariables() in webhook/route.ts — kept in sync by hand.
 */
export const RETELL_DYNAMIC_VARIABLE_NAMES = [
  'caller_name',
  'briefing_hint',
  'unit_label',
  'ledger_status_line',
  'vendor_name',
  'open_job_count',
] as const;

/** Minimal recursive JSON-Schema node — what the tool arg schemas actually use. */
export interface JsonSchemaNode {
  type: 'string' | 'object' | 'array' | 'boolean' | 'number';
  description?: string;
  enum?: readonly string[];
  minLength?: number;
  maxLength?: number;
  default?: string;
  // array
  items?: JsonSchemaNode;
  minItems?: number;
  maxItems?: number;
  // nested object
  properties?: Record<string, JsonSchemaNode>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

export interface RetellToolParameters {
  type: 'object';
  properties: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties: false;
}

export interface RetellHeader {
  name: string;
  value: string;
}

/** A Retell custom-function definition in the real provider shape. */
export interface RetellToolDefinition {
  name: string;
  description: string;
  url: string;
  method: 'POST';
  timeout_ms: number;
  headers: RetellHeader[];
  parameters: RetellToolParameters;
}

export interface RetellAgentConfig {
  model: typeof RETELL_MODEL;
  general_prompt: string;
  webhook_url: string;
  webhook_events: readonly string[];
  inbound_webhook_url: string;
  dynamic_variable_names: readonly string[];
  privacy: RetellPrivacyConfig;
}

export type RetellDataStorageSetting =
  | 'everything'
  | 'everything_except_pii'
  | 'basic_attributes_only';

/** Explicit provider-side storage choices. No implicit Retell defaults. */
export interface RetellPrivacyConfig {
  data_storage_setting: RetellDataStorageSetting;
  data_storage_retention_days: number;
  opt_in_signed_url: boolean;
  signed_url_expiration_ms: number | null;
}

/**
 * Conservative, explicit provider retention for the initial voice candidate.
 * Basic attributes avoid retaining transcripts/audio, and any generated media
 * URL is short-lived and signed instead of public.
 */
export const RETELL_PRIVACY: Readonly<RetellPrivacyConfig> = {
  data_storage_setting: 'basic_attributes_only',
  data_storage_retention_days: 30,
  opt_in_signed_url: true,
  signed_url_expiration_ms: 86_400_000,
};

export interface RetellConfig {
  base_url: string;
  agent: RetellAgentConfig;
  tools: RetellToolDefinition[];
}

const EMPTY_PARAMS: RetellToolParameters = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

/**
 * Per-tool description + `parameters` schema, mirroring each route's zod `args`
 * object (the LLM-generated args only — call_id/from_number/to_number are call
 * metadata, injected by the adapter, never LLM args). Read-only tools take no
 * args. Keyed by Retell tool name; every non-null VOICE_ACTION_TOOL_MAP value
 * MUST have an entry here (enforced by buildRetellToolDefinitions).
 */
const TOOL_SPECS: Record<string, { description: string; parameters: RetellToolParameters }> = {
  report_intents: {
    description:
      'THE POLICY BRAIN — call this FIRST on every new topic, before any other ' +
      'tool. Report the caller intents and any facts gathered this turn; Odesa ' +
      'returns the next question, which tools are allowed, and what must be ' +
      'drafted vs sent. Never act on a new topic without calling this first.',
    parameters: {
      type: 'object',
      properties: {
        intents: {
          type: 'array',
          description: 'The 1–6 caller intents recognized this turn.',
          items: { type: 'string', enum: INTENT_IDS },
          minItems: 1,
          maxItems: 6,
        },
        facts: {
          type: 'object',
          description: 'Structured facts gathered this turn (all optional).',
          properties: {
            emergencyScreen: {
              type: 'object',
              description: 'Emergency screening answers.',
              properties: {
                activeFlooding: { type: 'boolean' },
                electricalDanger: { type: 'boolean' },
                contained: { type: 'boolean' },
              },
              additionalProperties: false,
            },
            accessPermission: { type: 'boolean', description: 'Tenant granted entry permission.' },
            availability: { type: 'string', description: 'Stated availability window.' },
            paymentClaim: {
              type: 'object',
              description: 'A caller claim about a payment (never treated as cleared).',
              properties: { method: { type: 'string' }, claimed: { type: 'boolean' } },
              required: ['claimed'],
              additionalProperties: false,
            },
            callbackAfter: { type: 'string' },
            callerName: { type: 'string' },
            callerStatedProperty: { type: 'string' },
            callerStatedUnit: { type: 'string' },
            callerStatedReason: { type: 'string' },
            upset: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      required: ['intents'],
      additionalProperties: false,
    },
  },
  lookup_tenant_by_phone: {
    description:
      'Confirm whether this caller\'s number matches a tenant on the routed org. ' +
      'Returns match/no-match only and discloses nothing to unverified callers.',
    parameters: EMPTY_PARAMS,
  },
  confirm_emergency: {
    description:
      'Run the deterministic emergency screen against the caller\'s own words. ' +
      'Provide their verbatim utterance; returns whether it screens as a genuine ' +
      'emergency. Screening only — never promises dispatch.',
    parameters: {
      type: 'object',
      properties: {
        utterance: {
          type: 'string',
          description: 'The caller\'s verbatim words describing the situation.',
          minLength: 1,
          maxLength: 2000,
        },
        property_id: {
          type: 'string',
          description: 'Optional property UUID override; usually omitted.',
        },
      },
      required: ['utterance'],
      additionalProperties: false,
    },
  },
  get_rent_status: {
    description:
      'Read the current rent ledger for the verified tenant on this call. ' +
      'Returns ledger status only ("the ledger currently shows...") and never a ' +
      'payment date or a claim that money cleared. Verified tenants only.',
    parameters: EMPTY_PARAMS,
  },
  get_lease_details: {
    description:
      'Read factual lease fields (rent amount, due day, start/end dates, late-fee ' +
      'policy) for the verified tenant on this call. Read the fields aloud; never ' +
      'interpret or extend the lease. Verified tenants only.',
    parameters: EMPTY_PARAMS,
  },
  get_owner_briefing: {
    description:
      'Portfolio counts (late rent, open work orders, pending approvals) for the ' +
      'verified owner calling their own line. Counts only, never tenant names. ' +
      'Refused for anyone not resolved as the owner.',
    parameters: EMPTY_PARAMS,
  },
  get_vendor_jobs: {
    description:
      'Open assigned jobs (category, urgency, status, property label) for a known ' +
      'vendor on this call. No tenant names, rent, or costs. Refused for anyone ' +
      'not resolved as a known vendor.',
    parameters: EMPTY_PARAMS,
  },
  schedule_callback: {
    description:
      'Record that the caller wants the owner to follow up. This REQUESTS a ' +
      'callback window — it never books or confirms an appointment.',
    parameters: {
      type: 'object',
      properties: {
        preferred_time: {
          type: 'string',
          description: 'Caller-stated preferred time window, e.g. "tomorrow afternoon".',
          minLength: 1,
          maxLength: 100,
        },
        topic: {
          type: 'string',
          description: 'What the callback is about.',
          minLength: 1,
          maxLength: 1000,
        },
      },
      required: ['preferred_time', 'topic'],
      additionalProperties: false,
    },
  },
  create_work_order: {
    description:
      'Open a maintenance work order for the verified tenant once unit, issue, and ' +
      'access are known. Does not dispatch anyone or commit to any cost or timing.',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'What is wrong, in the tenant\'s words plus access details.',
          minLength: 3,
          maxLength: 2000,
        },
        category: {
          type: 'string',
          description: 'Maintenance category; defaults to general if unclear.',
          enum: [
            'plumbing',
            'electrical',
            'hvac',
            'appliances',
            'flooring',
            'painting',
            'landscaping',
            'security',
            'cleaning',
            'general',
            'other',
          ],
        },
        urgency: {
          type: 'string',
          description: 'How urgent the issue is; defaults to routine.',
          enum: ['emergency', 'urgent', 'routine'],
        },
      },
      required: ['description'],
      additionalProperties: false,
    },
  },
  send_sms_followup: {
    description:
      'Send a short factual confirmation text of what was recorded on this call. ' +
      'Policy classifies the body first: sensitive text is demoted to an ' +
      'owner-review draft instead of sending. Never claim a payment posted.',
    parameters: {
      type: 'object',
      properties: {
        body: {
          type: 'string',
          description: 'The SMS text. Factual confirmation only.',
          minLength: 1,
          maxLength: 1600,
        },
      },
      required: ['body'],
      additionalProperties: false,
    },
  },
  escalate_to_landlord: {
    description:
      'Send the situation to the owner now with your notes. Use for screened ' +
      'emergencies and anything needing the owner. Never promise a responder is ' +
      'on the way — escalation is not dispatch.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'What is happening and why it needs the owner now.',
          minLength: 3,
          maxLength: 2000,
        },
        urgency: {
          type: 'string',
          description: 'Severity of the escalation.',
          enum: ['emergency', 'urgent', 'routine'],
        },
        category: {
          type: 'string',
          description: 'Emergency category, when applicable.',
          enum: [
            'water_leak',
            'no_heat_winter',
            'fire_smoke',
            'gas_smell',
            'lockout',
            'sewage_backup',
            'other',
          ],
        },
      },
      required: ['reason', 'urgency'],
      additionalProperties: false,
    },
  },
  create_followup_sms_draft: {
    description:
      'Draft a text for the owner to approve (rent reminders, disputes, vendor ' +
      'coordination, anything sensitive). ALWAYS a draft — this tool never sends.',
    parameters: {
      type: 'object',
      properties: {
        body: {
          type: 'string',
          description: 'The proposed SMS text for owner approval.',
          minLength: 1,
          maxLength: 1600,
        },
        reason: {
          type: 'string',
          description: 'Why this draft is being created.',
          minLength: 3,
          maxLength: 500,
        },
      },
      required: ['body'],
      additionalProperties: false,
    },
  },
};

/** Distinct, non-null Retell tool names the policy map exposes, first-seen order. */
export function mappedToolNames(): string[] {
  const names: string[] = [];
  for (const tool of Object.values(VOICE_ACTION_TOOL_MAP)) {
    if (tool !== null && !names.includes(tool)) names.push(tool);
  }
  return names;
}

/**
 * Tools the agent prompt tells the model to call but that are NOT action-mapped:
 * report_intents (the policy brain — MUST be registered first), the identity
 * lookup, and the emergency screen. Without these registered as Retell custom
 * functions the agent cannot reach the deterministic policy engine at all, which
 * would silently bypass every safety gate. VOICE_ACTION_TOOL_MAP alone omits them.
 */
const ALWAYS_ON_TOOLS = ['report_intents', 'lookup_tenant_by_phone', 'confirm_emergency'] as const;

const DIRECT_MESSAGING_TOOLS = new Set(['send_sms_followup', 'escalate_to_landlord']);

/**
 * Every tool exposed to the Retell agent. Initial candidates are messaging-dark;
 * the two direct-send tools require a separate explicit approval capability.
 */
export function agentToolNames(options: { directMessagingApproved?: boolean } = {}): string[] {
  const names: string[] = [...ALWAYS_ON_TOOLS];
  for (const tool of mappedToolNames()) {
    if (options.directMessagingApproved !== true && DIRECT_MESSAGING_TOOLS.has(tool)) continue;
    if (!names.includes(tool)) names.push(tool);
  }
  return names;
}

/** Env-aware public base URL; placeholder fallback so config always builds. */
export function resolveBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return (raw ? raw : 'https://your-app.example.com').replace(/\/$/, '');
}

export interface BuildConfigOptions {
  baseUrl?: string;
  settings?: VoiceSettings;
  directMessagingApproved?: boolean;
  privacy?: RetellPrivacyConfig;
}

/**
 * Build a Retell tool definition for every agent-callable tool (the always-on
 * policy/identity/emergency tools plus every non-null VOICE_ACTION_TOOL_MAP
 * value). Throws if any lacks a spec — silent drift (e.g. dropping the policy
 * brain from the provisioned agent) is worse than a crash.
 */
export function buildRetellToolDefinitions(
  baseUrl: string,
  options: { directMessagingApproved?: boolean } = {},
): RetellToolDefinition[] {
  return agentToolNames(options).map((name) => {
    const spec = TOOL_SPECS[name];
    if (!spec) {
      throw new Error(`retell-config: no parameter spec for agent tool "${name}"`);
    }
    return {
      name,
      description: spec.description,
      url: `${baseUrl}/api/retell/tools/${name}`,
      method: 'POST',
      timeout_ms: RETELL_TOOL_TIMEOUT_MS,
      // Never duplicate the account API key (or any long-lived bearer) into
      // provider-held tool definitions. Retell's x-retell-signature covers the
      // raw request body and is verified by readToolRequest before parsing.
      headers: [],
      parameters: spec.parameters,
    };
  });
}

/** Build the agent config in the real Retell shape. */
export function buildRetellAgentConfig(
  baseUrl: string,
  settings: VoiceSettings,
  options: Pick<BuildConfigOptions, 'directMessagingApproved' | 'privacy'> = {},
): RetellAgentConfig {
  return {
    model: RETELL_MODEL,
    general_prompt: buildVoiceAgentPrompt(settings, {
      directMessagingApproved: options.directMessagingApproved,
    }),
    webhook_url: `${baseUrl}/api/retell/webhook`,
    webhook_events: RETELL_WEBHOOK_EVENTS,
    inbound_webhook_url: `${baseUrl}/api/retell/inbound`,
    dynamic_variable_names: RETELL_DYNAMIC_VARIABLE_NAMES,
    privacy: options.privacy ?? { ...RETELL_PRIVACY },
  };
}

/**
 * Assemble the full code-derived Retell config. Custom tools deliberately have
 * no static auth header; Retell signs each request instead.
 */
export function buildRetellConfig(options: BuildConfigOptions = {}): RetellConfig {
  const baseUrl = options.baseUrl ?? resolveBaseUrl();
  const settings = options.settings ?? defaultSettings('config-export');
  return {
    base_url: baseUrl,
    agent: buildRetellAgentConfig(baseUrl, settings, options),
    tools: buildRetellToolDefinitions(baseUrl, options),
  };
}
