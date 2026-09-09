/**
 * Manual briefing trigger — computes + persists a briefing for the
 * caller's organization on demand. Used by the Today "refresh" button
 * (Phase 8) and by the Playwright test suite.
 *
 * Auth: Supabase session cookie — the caller's organization is derived
 * from their users row, so a VA in org A cannot trigger briefings for
 * org B.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { computeBriefingMetrics } from '@/lib/briefing/metrics';
import { generateBriefingText } from '@/lib/briefing/generate';
import { mondayOfWeek, persistBriefing } from '@/lib/briefing/persist';

export async function POST(_request: NextRequest) {
  const db = await createServerClient();

  const { data: authUser } = await db.auth.getUser();
  if (!authUser.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: userRow } = await db
    .from('users')
    .select('organization_id')
    .eq('id', authUser.user.id)
    .single();
  if (!userRow?.organization_id) {
    return NextResponse.json({ error: 'no organization on user' }, { status: 400 });
  }

  const weekStart = mondayOfWeek();

  // Metrics + persist use service-role so we can read the full org in
  // one pass without juggling RLS policies; the auth gate above scoped
  // the organization_id.
  const { createClient } = await import('@supabase/supabase-js');
  type DatabaseType = import('@/types/database').Database;
  const adminDb = createClient<DatabaseType>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const metrics = await computeBriefingMetrics({
    db: adminDb,
    organizationId: userRow.organization_id,
    weekStartDate: weekStart,
  });

  // Anchor property: provides per-property worker context for prose
  // polish; metrics remain org-scoped. v1 picks first by name asc.
  const { data: anchorProperty } = await adminDb
    .from('properties')
    .select('id')
    .eq('organization_id', userRow.organization_id)
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!anchorProperty?.id) {
    return NextResponse.json({ error: 'no properties in organization' }, { status: 400 });
  }

  const briefing = await generateBriefingText(metrics, anchorProperty.id, {
    admin: adminDb,
  });
  const saved = await persistBriefing({
    db: adminDb,
    organizationId: userRow.organization_id,
    briefing,
  });
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    report_id: saved.id,
    week_start_date: weekStart,
    briefing_text: briefing.briefingText,
    recommendation: briefing.recommendation,
  });
}
