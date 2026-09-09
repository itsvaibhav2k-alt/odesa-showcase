'use server';

/**
 * Server action for the voice/Retell opt-in step.
 *
 * Reads and writes `organizations.voice_enabled`.
 *
 * PREREQUISITE — column landing notice:
 *   `organizations.voice_enabled` is a FORWARD DECLARATION in the
 *   TypeScript types (`src/types/database.ts`). The actual Postgres
 *   column is pending migration `add_organizations_voice_enabled` from
 *   T2b. Until that migration lands, writing this column will return a
 *   Supabase `column not found` error that the action surfaces as a
 *   typed `ApiResponse` error — the caller renders it inline and does
 *   NOT redirect on failure, so the UX degrades gracefully.
 */

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import type { ApiResponse } from '@/types';
import type { UserRole } from '@/types/database';

// ---------------------------------------------------------------------------
// Auth helper (same pattern as messaging/actions.ts)
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

// ---------------------------------------------------------------------------
// Set voice enabled
// ---------------------------------------------------------------------------

export interface SetVoiceEnabledSuccess {
  voiceEnabled: boolean;
}

/**
 * Persist the operator's voice/Retell opt-in choice.
 *
 * Writing `voice_enabled = false` is also valid (explicit opt-out).
 * The action is idempotent — calling it multiple times with the same
 * value is safe.
 *
 * Returns a typed error when the column doesn't exist yet (pending T2b
 * migration). The caller renders the error inline and allows the
 * operator to skip this step.
 */
export async function setVoiceEnabledAction(
  voiceEnabled: boolean,
): Promise<ApiResponse<SetVoiceEnabledSuccess>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role === 'va') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from('organizations')
    .update({ voice_enabled: voiceEnabled })
    .eq('id', auth.data.organizationId);

  if (error) {
    // Surface the DB error inline — most likely the column doesn't exist yet.
    return {
      success: false,
      error: error.message,
    };
  }

  revalidatePath('/settings');
  revalidatePath('/onboarding/voice');

  return { success: true, data: { voiceEnabled } };
}
