/**
 * Test-only manual trigger for the full briefing pipeline including the
 * worker-driven prose polish.
 *
 * Distinct from `/api/briefing/trigger` which gates on the user session;
 * this route is gated by `NODE_ENV !== 'production'` (returns 404 in
 * real deploys) and accepts an explicit propertyId + weekStartDate so
 * Playwright specs can drive the pipeline without provisioning a
 * session. Production owners use `/api/briefing/trigger` instead — that
 * route is session-gated and only writes to the caller's own org.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { computeBriefingMetrics } from '@/lib/briefing/metrics';
import { generateBriefingText } from '@/lib/briefing/generate';
import { mondayOfWeek, persistBriefing } from '@/lib/briefing/persist';

function notAvailable(): NextResponse {
  return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
}

function guard(): boolean {
  return process.env.NODE_ENV !== 'production';
}

interface TriggerBody {
  propertyId: string;
  organizationId?: string;
  /** ISO date "YYYY-MM-DD"; defaults to current week's Monday. */
  weekStartDate?: string;
}

export async function POST(req: NextRequest) {
  if (!guard()) return notAvailable();

  let body: TriggerBody;
  try {
    body = (await req.json()) as TriggerBody;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON' },
      { status: 400 },
    );
  }

  if (!body.propertyId || typeof body.propertyId !== 'string') {
    return NextResponse.json(
      { success: false, error: 'propertyId required' },
      { status: 400 },
    );
  }

  const db = createAdminClient();

  // Resolve organization_id from the property (single source of truth) —
  // if the caller supplied one, prefer the DB value to avoid mismatches.
  const { data: propertyRow, error: propErr } = await db
    .from('properties')
    .select('id, organization_id')
    .eq('id', body.propertyId)
    .maybeSingle();

  if (propErr || !propertyRow) {
    return NextResponse.json(
      { success: false, error: 'property not found' },
      { status: 404 },
    );
  }

  const organizationId = propertyRow.organization_id;
  const weekStart = body.weekStartDate ?? mondayOfWeek();

  try {
    const metrics = await computeBriefingMetrics({
      db,
      organizationId,
      weekStartDate: weekStart,
    });
    const briefing = await generateBriefingText(metrics, body.propertyId, {
      admin: db,
    });
    const saved = await persistBriefing({
      db,
      organizationId,
      briefing,
    });
    if (!saved.ok) {
      return NextResponse.json(
        { success: false, error: saved.error },
        { status: 500 },
      );
    }
    return NextResponse.json({
      success: true,
      data: {
        reportId: saved.id,
        weekStartDate: weekStart,
        briefingText: briefing.briefingText,
        recommendation: briefing.recommendation,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'briefing run failed',
      },
      { status: 500 },
    );
  }
}
