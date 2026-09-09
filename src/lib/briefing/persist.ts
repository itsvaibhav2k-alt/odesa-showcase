/**
 * Upserts a generated briefing into `weekly_reports`.
 *
 * Keyed on (organization_id, week_start_date) so re-running the cron or
 * triggering manually doesn't duplicate rows.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
import type { GeneratedBriefing } from './types';

export async function persistBriefing({
  db,
  organizationId,
  briefing,
}: {
  db: SupabaseClient<Database>;
  organizationId: string;
  briefing: GeneratedBriefing;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await db
    .from('weekly_reports')
    .upsert(
      {
        organization_id: organizationId,
        week_start_date: briefing.metrics.weekStartDate,
        briefing_text: briefing.briefingText,
        metrics: briefing.metrics as unknown as Json,
        generated_at: briefing.generatedAt,
      },
      { onConflict: 'organization_id,week_start_date' },
    )
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'upsert failed' };
  return { ok: true, id: data.id };
}

export function mondayOfWeek(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0..6 (Sun..Sat)
  const offset = (day + 6) % 7; // days since last Monday
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}
