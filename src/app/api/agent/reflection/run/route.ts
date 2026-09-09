/**
 * Test-only manual trigger for the nightly reflection loop.
 *
 * Gated by `NODE_ENV !== 'production'` — returns 404 in real deploys.
 * Playwright specs hit this to exercise the loop end-to-end without
 * waiting for the cron schedule. The cron itself (`reflection-nightly`)
 * is the production trigger. A prod manual-trigger path would need
 * proper authn/authz + rate limiting + per-org scoping; that's a v1.6
 * conversation, not an env-var bypass.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { runReflection } from '@/lib/agent/meta/reflection';

function notAvailable(): NextResponse {
  return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
}

function guard(): boolean {
  return process.env.NODE_ENV !== 'production';
}

interface TriggerBody {
  propertyId: string;
  organizationId?: string;
  lookbackHours?: number;
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

  try {
    const db = createAdminClient();
    const result = await runReflection({
      db,
      propertyId: body.propertyId,
      lookbackHours: body.lookbackHours,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'reflection run failed',
      },
      { status: 500 },
    );
  }
}
