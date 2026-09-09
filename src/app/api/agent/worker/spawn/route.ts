/**
 * Test-only endpoint that wraps `spawnPropertyWorker()` so Playwright
 * specs can drive the worker pipeline without a Retell call. Returns
 * the in-memory ActionProposal as JSON.
 *
 * Auth pattern mirrors `messaging/test-hooks/route.ts`:
 *   - 404 in production (`NODE_ENV === 'production'`)
 *   - no other gate; the dev/test environment is the gate
 *
 * Body shape:
 *   {
 *     "propertyId": "uuid",
 *     "actionType": "draft_sms_reply" | "classify_intent" | ...,
 *     "input": { ... }   // action-specific
 *   }
 */
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createServiceClient } from '@/lib/agent/retell-auth';
import { selectProvider } from '@/lib/agent/worker/providers/select';
import { spawnPropertyWorker } from '@/lib/agent/worker/spawn';
import {
  WORKER_ACTION_TYPES,
  WorkerOutputValidationError,
} from '@/lib/agent/worker/types';

const schema = z.object({
  propertyId: z.string().uuid(),
  actionType: z.enum(WORKER_ACTION_TYPES),
  input: z.unknown(),
});

function notAvailable(): NextResponse {
  return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
}

function guard(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export async function POST(req: NextRequest) {
  if (!guard()) return notAvailable();

  let parsedJson: unknown;
  try {
    parsedJson = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const { propertyId, actionType, input } = parsed.data;
  const admin = createServiceClient();

  const { data: property } = await admin
    .from('properties')
    .select('privacy_mode, ollama_host')
    .eq('id', propertyId)
    .maybeSingle();
  if (!property) {
    return NextResponse.json({ success: false, error: 'property not found' }, { status: 404 });
  }

  const provider = selectProvider(
    {
      privacyMode: property.privacy_mode === 'on_prem' ? 'on_prem' : 'hosted',
      ollamaHost: property.ollama_host ?? null,
    },
    { actionType },
  );

  try {
    const proposal = await spawnPropertyWorker({
      propertyId,
      action_type: actionType,
      data: input,
      deps: { client: admin, provider },
    });
    return NextResponse.json({ success: true, proposal });
  } catch (err) {
    if (err instanceof WorkerOutputValidationError) {
      return NextResponse.json(
        { success: false, error: 'worker output validation failed', detail: err.message },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
