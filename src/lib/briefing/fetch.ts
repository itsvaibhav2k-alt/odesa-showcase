/**
 * Reads the latest weekly_reports row for the caller's organization.
 * Returns null (no briefing yet) so the Today page can render its
 * empty-state copy pointing at next Monday.
 */

import { createServerClient } from '@/lib/supabase/server';
import type { GeneratedBriefing } from './types';

export async function fetchLatestBriefingForCurrentUser(): Promise<GeneratedBriefing | null> {
  const db = await createServerClient();
  const { data: authUser } = await db.auth.getUser();
  if (!authUser.user) return null;

  const { data: userRow } = await db
    .from('users')
    .select('organization_id')
    .eq('id', authUser.user.id)
    .single();
  if (!userRow?.organization_id) return null;

  const { data: latest } = await db
    .from('weekly_reports')
    .select('briefing_text, metrics, generated_at, week_start_date')
    .eq('organization_id', userRow.organization_id)
    .order('week_start_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return null;

  return {
    metrics: latest.metrics as unknown as GeneratedBriefing['metrics'],
    briefingText: latest.briefing_text ?? '',
    recommendation: null,
    generatedAt: latest.generated_at,
  };
}
