/**
 * Test-only manual trigger for the monthly cross-property meta-learning loop.
 *
 * Gated by `NODE_ENV !== 'production'` — returns 404 in real deploys.
 * Playwright specs hit this to exercise the Opus-driven portfolio loop
 * without waiting for the 1st-of-month cron. The cron
 * (`meta-learning-monthly`) is the production trigger; an Opus-per-org
 * call is expensive enough that we don't want a low-friction prod
 * trigger anyway.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { runCrossProperty } from '@/lib/agent/meta/cross-property';

function notAvailable(): NextResponse {
  return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
}

function guard(): boolean {
  return process.env.NODE_ENV !== 'production';
}

interface TriggerBody {
  organizationId: string;
  lookbackDays?: number;
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

  if (!body.organizationId || typeof body.organizationId !== 'string') {
    return NextResponse.json(
      { success: false, error: 'organizationId required' },
      { status: 400 },
    );
  }

  try {
    const db = createAdminClient();
    const result = await runCrossProperty({
      db,
      organizationId: body.organizationId,
      lookbackDays: body.lookbackDays,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'meta-learning run failed',
      },
      { status: 500 },
    );
  }
}
