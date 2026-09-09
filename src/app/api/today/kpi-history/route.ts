import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

export interface WeekSnapshot {
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  occupancyPct: number;
  rentCollectedCents: number;
}

export interface KpiHistoryResponse {
  weeks: WeekSnapshot[];
}

async function fetchWeeks(
  db: SupabaseClient<Database>,
  orgId: string,
): Promise<WeekSnapshot[]> {
  // Read the org's creation date so we can trim history to weeks the
  // org actually existed. Without this, brand-new orgs render a misleading
  // flat-line-at-zero across pre-existence weeks.
  const { data: orgRow } = await db
    .from('organizations')
    .select('created_at')
    .eq('id', orgId)
    .single();
  const orgCreatedAt = orgRow?.created_at
    ? new Date(orgRow.created_at)
    : null;

  const { count: totalUnits } = await db
    .from('units')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId);

  const unitCount = totalUnits ?? 0;
  const now = new Date();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  const allWeeks = await Promise.all(
    [3, 2, 1, 0].map(async (weeksAgo) => {
      const weekEnd = new Date(now.getTime() - weeksAgo * 7 * MS_PER_DAY);
      const weekStart = new Date(weekEnd.getTime() - 7 * MS_PER_DAY);
      const weekEndISO = weekEnd.toISOString();
      const weekStartISO = weekStart.toISOString();

      const weekLabel = weekEnd.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });

      const [leaseResult, rentResult] = await Promise.all([
        db
          .from('leases')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .lte('start_date', weekEndISO)
          .or(`end_date.is.null,end_date.gte.${weekStartISO}`),
        db
          .from('rent_events')
          .select('amount_paid')
          .eq('organization_id', orgId)
          .eq('status', 'paid')
          .gte('updated_at', weekStartISO)
          .lt('updated_at', weekEndISO),
      ]);

      const activeLeases = leaseResult.count ?? 0;
      const occupancyPct = unitCount > 0 ? (activeLeases / unitCount) * 100 : 0;
      const rentCollectedCents = (rentResult.data ?? []).reduce(
        (sum, r) => sum + Math.round(Number(r.amount_paid ?? 0) * 100),
        0,
      );

      return {
        weekLabel,
        weekStart: weekStartISO,
        weekEnd: weekEndISO,
        occupancyPct: Math.round(occupancyPct * 10) / 10,
        rentCollectedCents,
      } satisfies WeekSnapshot;
    }),
  );

  // Drop weeks that ended before the org was created — those are noise
  // for new accounts and produce the flat-line-at-zero artifact.
  if (orgCreatedAt) {
    return allWeeks.filter((w) => new Date(w.weekEnd) >= orgCreatedAt);
  }
  return allWeeks;
}

export async function GET(_request: NextRequest) {
  const db = await createServerClient();
  const { data: authUser } = await db.auth.getUser();

  if (authUser.user) {
    const { data: userRow } = await db
      .from('users')
      .select('organization_id')
      .eq('id', authUser.user.id)
      .single();
    if (!userRow?.organization_id) {
      return NextResponse.json({ error: 'no organization' }, { status: 400 });
    }
    const weeks = await fetchWeeks(db, userRow.organization_id);
    return NextResponse.json({ weeks } satisfies KpiHistoryResponse);
  }

  if (process.env.NODE_ENV === 'development') {
    // Dev bypass: use service-role to read past RLS, mirroring the middleware.
    const adminDb = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: firstOrg } = await adminDb
      .from('organizations')
      .select('id')
      .limit(1)
      .single();
    if (!firstOrg?.id) {
      return NextResponse.json({ weeks: [] } satisfies KpiHistoryResponse);
    }
    const weeks = await fetchWeeks(adminDb, firstOrg.id);
    return NextResponse.json({ weeks } satisfies KpiHistoryResponse);
  }

  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
