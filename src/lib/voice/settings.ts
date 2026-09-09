/**
 * Voice settings queries — org-scoped configuration for the Voice Operator.
 *
 * Read/write helpers for the voice_settings table. Settings control:
 * - Retell connection details (phone number, agent ID)
 * - Feature enablement (voice, live calls, HMAC verification)
 * - Operator behavior configuration (scripts, topics, guidance)
 *
 * Single row per org with safe defaults when missing. Every helper runs on
 * whatever server client the caller passes; the dashboard passes the
 * RLS-scoped client for both reads and writes.
 */

import type { createServerClient } from '@/lib/supabase/server';
import type { Json } from '@/types/database';
import { parseScriptOverrides, type ScriptOverrides } from './scripts';

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

export interface VoiceSettings {
  id?: string;
  organizationId: string;

  // Retell connection
  retellPhoneNumberE164: string | null;
  retellAgentId: string | null;

  // Feature flags
  voiceEnabled: boolean;
  liveCallsEnabled: boolean;
  hmacVerificationEnabled: boolean;

  // Operator configuration
  operatorSummary: {
    role: string;
    tone: string;
  };
  propertyContextPolicy: {
    includeLeaseDetails: boolean;
    includeMaintenanceHistory: boolean;
  };
  informationToCollect: string[];
  topicsToAvoid: string[];
  closingGuidance: string;
  scriptOverrides: ScriptOverrides;
}

/**
 * Default voice settings for orgs without a row.
 * Safe, minimal configuration that shows the setup state clearly.
 */
export function defaultSettings(organizationId: string): VoiceSettings {
  return {
    organizationId,
    retellPhoneNumberE164: null,
    retellAgentId: null,
    voiceEnabled: false,
    liveCallsEnabled: false,
    hmacVerificationEnabled: false,
    operatorSummary: {
      role: 'Professional property management assistant',
      tone: 'helpful and efficient',
    },
    propertyContextPolicy: {
      includeLeaseDetails: true,
      includeMaintenanceHistory: true,
    },
    informationToCollect: [
      'Caller identity and callback number',
      'Property/unit involved',
      'Maintenance symptoms, urgency, access constraints',
      'Payment proof or dispute details',
    ],
    topicsToAvoid: [
      'Eviction threats, lease amendments, or legal advice',
      'Fee waivers or payment terms without owner approval',
      'Private rent/lease data for unknown callers',
      'Vendor dispatch promises without authorization',
    ],
    closingGuidance:
      'Thank the caller and summarize only actions confirmed during the call; do not promise a follow-up time.',
    scriptOverrides: {},
  };
}

/**
 * Parse JSONB fields safely with fallback to defaults.
 */
function parseJsonField<T>(value: Json | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  return value as T;
}

/**
 * Get voice settings for an organization.
 * Returns defaults if no row exists yet.
 */
export async function getVoiceSettings(
  db: SupabaseServerClient,
  organizationId?: string,
): Promise<VoiceSettings> {
  // For service-role callers, require explicit orgId
  // For RLS clients, it comes from the session
  const query = organizationId
    ? db.from('voice_settings').select('*').eq('organization_id', organizationId)
    : db.from('voice_settings').select('*');

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('[voice settings] fetch error:', error);
  }

  // No row = return defaults
  if (!data) {
    // Need to determine org ID for defaults
    if (organizationId) {
      return defaultSettings(organizationId);
    }

    // For RLS client without explicit orgId, fetch from user's org
    const { data: user } = await db.auth.getUser();
    if (user?.user) {
      const { data: orgUser } = await db
        .from('users')
        .select('organization_id')
        .eq('id', user.user.id)
        .single();

      if (orgUser?.organization_id) {
        return defaultSettings(orgUser.organization_id);
      }
    }

    // Fallback with empty ID (shouldn't happen in practice)
    return defaultSettings('');
  }

  const defaults = defaultSettings(data.organization_id);

  return {
    id: data.id,
    organizationId: data.organization_id,
    retellPhoneNumberE164: data.retell_phone_number_e164,
    retellAgentId: data.retell_agent_id,
    voiceEnabled: data.voice_enabled,
    liveCallsEnabled: data.live_calls_enabled,
    hmacVerificationEnabled: data.hmac_verification_enabled,
    operatorSummary: parseJsonField(data.operator_summary, defaults.operatorSummary),
    propertyContextPolicy: parseJsonField(data.property_context_policy, defaults.propertyContextPolicy),
    informationToCollect: parseJsonField(data.information_to_collect, defaults.informationToCollect),
    topicsToAvoid: parseJsonField(data.topics_to_avoid, defaults.topicsToAvoid),
    closingGuidance: data.closing_guidance ?? defaults.closingGuidance,
    scriptOverrides: parseScriptOverrides(data.script_overrides),
  };
}

/**
 * Upsert voice settings for an organization.
 * Creates or updates the single settings row.
 *
 * Runs on whatever server client is passed. Dashboard server actions pass the
 * RLS-scoped client, so org-scoped RLS policies enforce the write boundary —
 * this does not require or use a service-role client.
 */
export async function upsertVoiceSettings(
  db: SupabaseServerClient,
  settings: Partial<VoiceSettings> & { organizationId: string },
): Promise<{ ok: boolean; error?: string }> {
  const { organizationId, ...updates } = settings;

  const row = {
    organization_id: organizationId,
    ...(updates.retellPhoneNumberE164 !== undefined && {
      retell_phone_number_e164: updates.retellPhoneNumberE164,
    }),
    ...(updates.retellAgentId !== undefined && {
      retell_agent_id: updates.retellAgentId,
    }),
    ...(updates.voiceEnabled !== undefined && {
      voice_enabled: updates.voiceEnabled,
    }),
    ...(updates.liveCallsEnabled !== undefined && {
      live_calls_enabled: updates.liveCallsEnabled,
    }),
    ...(updates.hmacVerificationEnabled !== undefined && {
      hmac_verification_enabled: updates.hmacVerificationEnabled,
    }),
    ...(updates.operatorSummary !== undefined && {
      operator_summary: updates.operatorSummary as Json,
    }),
    ...(updates.propertyContextPolicy !== undefined && {
      property_context_policy: updates.propertyContextPolicy as Json,
    }),
    ...(updates.informationToCollect !== undefined && {
      information_to_collect: updates.informationToCollect as Json,
    }),
    ...(updates.topicsToAvoid !== undefined && {
      topics_to_avoid: updates.topicsToAvoid as Json,
    }),
    ...(updates.closingGuidance !== undefined && {
      closing_guidance: updates.closingGuidance,
    }),
    ...(updates.scriptOverrides !== undefined && {
      script_overrides: updates.scriptOverrides as Json,
    }),
  };

  const { error } = await db
    .from('voice_settings')
    .upsert(row, {
      onConflict: 'organization_id',
      ignoreDuplicates: false,
    });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
