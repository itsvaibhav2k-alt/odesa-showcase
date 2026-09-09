/**
 * Test-only endpoint: drive autonomy graduation directly so the
 * Playwright autonomy-graduation spec can replay outcome histories
 * without spinning up the full proposal pipeline.
 *
 * Gated by `NODE_ENV !== 'production'` so the handler returns 404 in
 * a real deploy. Mirrors the auth + envelope pattern from
 * `src/app/api/messaging/test-hooks/route.ts`.
 *
 * Body shape:
 *   {
 *     propertyId: string,
 *     actionType: WorkerActionType,   // accepted but not used in v1
 *                                     // (single autonomy_level per
 *                                     // property; per-action graduation
 *                                     // is deferred to v1.6).
 *     outcome:    ProposalOutcomeKind  // 'committed' | 'committed_after_review' |
 *                                     // 'edited' | 'rejected' | 'expired'
 *   }
 *
 * Response on success:
 *   { success: true, data: { autonomy_level: number, delta: number, clamped: boolean } }
 *
 * The handler reads the property row, calls `graduateAutonomy()`, and
 * persists the new `autonomy_level` (skipping the UPDATE when delta=0,
 * so 'expired' is a no-op).
 */

import { type NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  graduateAutonomy,
  type ProposalOutcomeKind,
} from '@/lib/agent/worker/trust';
import {
  WORKER_ACTION_TYPES,
  type WorkerActionType,
} from '@/lib/agent/worker/types';

interface RecomputeBody {
  propertyId?: unknown;
  actionType?: unknown;
  outcome?: unknown;
}

const VALID_OUTCOMES: ReadonlySet<ProposalOutcomeKind> = new Set([
  'committed',
  'committed_after_review',
  'edited',
  'rejected',
  'expired',
]);

function notAvailable(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Not found' },
    { status: 404 },
  );
}

function guard(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function parse(body: RecomputeBody):
  | { ok: true; propertyId: string; actionType: WorkerActionType; outcome: ProposalOutcomeKind }
  | { ok: false; error: string } {
  const { propertyId, actionType, outcome } = body;
  if (typeof propertyId !== 'string' || propertyId.length === 0) {
    return { ok: false, error: 'propertyId required (string)' };
  }
  if (
    typeof actionType !== 'string' ||
    !WORKER_ACTION_TYPES.includes(actionType as WorkerActionType)
  ) {
    return { ok: false, error: `actionType must be one of ${WORKER_ACTION_TYPES.join(', ')}` };
  }
  if (typeof outcome !== 'string' || !VALID_OUTCOMES.has(outcome as ProposalOutcomeKind)) {
    return { ok: false, error: `outcome must be one of ${[...VALID_OUTCOMES].join(', ')}` };
  }
  return {
    ok: true,
    propertyId,
    actionType: actionType as WorkerActionType,
    outcome: outcome as ProposalOutcomeKind,
  };
}

export async function POST(req: NextRequest) {
  if (!guard()) return notAvailable();

  let body: RecomputeBody;
  try {
    body = (await req.json()) as RecomputeBody;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON' },
      { status: 400 },
    );
  }

  const parsed = parse(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { success: false, error: parsed.error },
      { status: 400 },
    );
  }

  const db = createAdminClient();
  const { data: prop, error: loadErr } = await db
    .from('properties')
    .select('autonomy_level')
    .eq('id', parsed.propertyId)
    .maybeSingle();

  if (loadErr) {
    return NextResponse.json(
      { success: false, error: `property load failed: ${loadErr.message}` },
      { status: 500 },
    );
  }
  if (!prop) {
    return NextResponse.json(
      { success: false, error: `property ${parsed.propertyId} not found` },
      { status: 404 },
    );
  }

  const result = graduateAutonomy(prop.autonomy_level, parsed.outcome);

  if (result.delta !== 0) {
    const { error: updErr } = await db
      .from('properties')
      .update({ autonomy_level: result.next })
      .eq('id', parsed.propertyId);
    if (updErr) {
      return NextResponse.json(
        { success: false, error: `autonomy persist failed: ${updErr.message}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      autonomy_level: result.next,
      delta: result.delta,
      clamped: result.clamped,
    },
  });
}
