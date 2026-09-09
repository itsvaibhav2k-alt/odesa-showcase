'use server';

/**
 * Server action for the /calls Voice configuration surface.
 *
 * One write path: `updateVoiceSettings(payload)` — a partial, RLS-scoped
 * upsert of the org's `voice_settings` row. Every field is optional so each
 * card (connection, org knowledge, per-script notes) can save independently
 * without clobbering the others.
 *
 * Auth + shape follow the house pattern from
 * `src/app/(dashboard)/settings/integrations/actions.ts`
 * (`requireAuthContext()`, zod `safeParse`, `firstZodError`, `ApiResponse<T>`).
 * Writes use the SSR Supabase client so RLS auto-scopes to the caller's org —
 * never a service-role client.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createServerClient } from '@/lib/supabase/server';
import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import { getVoiceSettings, upsertVoiceSettings } from '@/lib/voice/settings';
import { scriptOverridesSchema } from '@/lib/voice/scripts';
import type { ApiResponse } from '@/types';
import type { UserRole } from '@/types/database';

// ---------------------------------------------------------------------------
// Shared auth helper (house pattern — settings/integrations/actions.ts)
// ---------------------------------------------------------------------------

interface AuthContext {
  userId: string;
  organizationId: string;
  role: UserRole | null;
}

async function requireAuthContext(): Promise<ApiResponse<AuthContext>> {
  const supabase = await createServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Not authenticated' };
  }

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (userErr || !userRow) {
    return { success: false, error: 'User profile not found' };
  }

  return {
    success: true,
    data: {
      userId: user.id,
      organizationId: userRow.organization_id,
      role: userRow.role ?? null,
    },
  };
}

function firstZodError(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string {
  const first = issues[0];
  if (!first) return 'Validation failed';
  const path = first.path.map(String).join('.');
  return path ? `${path}: ${first.message}` : first.message;
}

// ---------------------------------------------------------------------------
// Voice settings — partial update
// ---------------------------------------------------------------------------

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

const trimmedLine = z.string().trim().min(1).max(200);

/**
 * Partial write schema — every field optional so a single card saves only
 * what it owns. `null` on the Retell connection fields clears them.
 *
 * `hmacVerificationEnabled` is DELIBERATELY absent.
 * ponytail: HMAC enforcement is env-derived (RETELL_WEBHOOK_SECRET in the
 * webhook route); the DB column is display-only. Accepting it here would let
 * the UI claim control it does not have, so it stays read-only/derived.
 */
const updateVoiceSettingsSchema = z.object({
  retellPhoneNumberE164: z
    .string()
    .trim()
    .regex(E164_REGEX, 'Phone number must be in E.164 format')
    .nullable()
    .optional(),
  retellAgentId: z.string().trim().min(1).max(120).nullable().optional(),
  voiceEnabled: z.boolean().optional(),
  liveCallsEnabled: z.boolean().optional(),
  operatorSummary: z
    .object({
      role: trimmedLine,
      tone: trimmedLine,
    })
    .optional(),
  propertyContextPolicy: z
    .object({
      includeLeaseDetails: z.boolean(),
      includeMaintenanceHistory: z.boolean(),
    })
    .optional(),
  informationToCollect: z.array(trimmedLine).max(20).optional(),
  topicsToAvoid: z.array(trimmedLine).max(20).optional(),
  closingGuidance: z.string().trim().min(1).max(500).optional(),
  // Whole-column replace: the client sends the FULL merged overrides map.
  // Removing a customization = sending the map without that key (not a patch).
  scriptOverrides: scriptOverridesSchema.optional(),
});

export type UpdateVoiceSettingsPayload = z.infer<typeof updateVoiceSettingsSchema>;

export async function updateVoiceSettings(
  payload: UpdateVoiceSettingsPayload,
): Promise<ApiResponse<{ saved: true }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role !== 'owner') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const parsed = updateVoiceSettingsSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  try {
    const supabase = await createServerClient();
    const { organizationId } = auth.data;

    // Honest guard: live calls require a real Retell number + agent. Merge the
    // incoming partial over current settings so enabling from either card works.
    if (parsed.data.liveCallsEnabled === true) {
      const current = await getVoiceSettings(supabase, organizationId);
      const mergedPhone =
        parsed.data.retellPhoneNumberE164 !== undefined
          ? parsed.data.retellPhoneNumberE164
          : current.retellPhoneNumberE164;
      const mergedAgent =
        parsed.data.retellAgentId !== undefined
          ? parsed.data.retellAgentId
          : current.retellAgentId;

      if (!mergedPhone || !mergedAgent) {
        return {
          success: false,
          error:
            'Connect a Retell phone number and agent ID before enabling live calls.',
        };
      }
    }

    const result = await upsertVoiceSettings(supabase, {
      organizationId,
      ...parsed.data,
    });

    if (!result.ok) {
      return { success: false, error: result.error ?? 'Failed to save voice settings' };
    }

    // Settings + scripts each save from their own route now; the overview reads
    // the same row. All three are force-dynamic, so this is belt-and-suspenders.
    revalidatePath('/calls');
    revalidatePath('/calls/settings');
    revalidatePath('/calls/scripts');

    return { success: true, data: { saved: true } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to save voice settings',
    };
  }
}
