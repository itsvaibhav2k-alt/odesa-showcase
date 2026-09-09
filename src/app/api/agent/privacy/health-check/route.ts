/**
 * Privacy mode health-check route.
 *
 * Mirrors the Server Action `testOllamaConnection` exposed for the
 * privacy-mode card UI, but operates on the *persisted* property
 * config rather than a draft host string. Use cases:
 *
 *   - playwright-eng's `e2e/privacy/ollama-mode.spec.ts` — exercises
 *     the round-trip from saved config → live probe.
 *   - any future health dashboard that needs to ping a property's
 *     configured provider without hydrating the card.
 *
 * Contract:
 *   POST /api/agent/privacy/health-check
 *   body  : { propertyId: string }
 *   200   : { success: true, data: { ok, latencyMs, error? } }
 *   400   : { success: false, error: string }       — bad input
 *   401   : { success: false, error: string }       — not authed
 *   404   : { success: false, error: string }       — property not visible
 *
 * RLS auto-scopes the property lookup to the caller's organization, so
 * a user can only probe properties they own. We deliberately do NOT
 * use the admin client here — leaking arbitrary fan-out HTTP calls to
 * unauthenticated callers would be a SSRF foot-gun.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import {
  PrivacyModeMisconfiguredError,
  selectProvider,
} from '@/lib/agent/worker/providers/select';

interface HealthCheckBody {
  propertyId?: unknown;
}

function badRequest(error: string): NextResponse {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

export async function POST(req: NextRequest) {
  let body: HealthCheckBody;
  try {
    body = (await req.json()) as HealthCheckBody;
  } catch {
    return badRequest('Invalid JSON');
  }

  const { propertyId } = body;
  if (typeof propertyId !== 'string' || propertyId.length === 0) {
    return badRequest('propertyId required (string)');
  }

  const supabase = await createServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { success: false, error: 'Not authenticated' },
      { status: 401 },
    );
  }

  // RLS scopes this read to the caller's org; an out-of-org propertyId
  // returns null rather than 403 leaking row existence.
  const { data: property, error: propErr } = await supabase
    .from('properties')
    .select('id, privacy_mode, ollama_host')
    .eq('id', propertyId)
    .maybeSingle();

  if (propErr) {
    return NextResponse.json(
      { success: false, error: `property load failed: ${propErr.message}` },
      { status: 500 },
    );
  }
  if (!property) {
    return NextResponse.json(
      { success: false, error: 'property not found' },
      { status: 404 },
    );
  }

  try {
    const provider = selectProvider({
      privacyMode: property.privacy_mode as 'hosted' | 'on_prem',
      ollamaHost: property.ollama_host,
    });
    const health = await provider.healthCheck();
    return NextResponse.json({ success: true, data: health });
  } catch (err) {
    if (err instanceof PrivacyModeMisconfiguredError) {
      // Misconfiguration is the user's fault, not a 500 — bubble it as
      // a structured success=false so the UI can show the message.
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
