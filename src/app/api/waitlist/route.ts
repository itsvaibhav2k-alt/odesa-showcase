/**
 * Public waitlist submission endpoint.
 *
 * Accepts: { email, fullName?, unitCount?, currentStack?, source? }
 * Returns: { ok: true } on insert OR upsert-match, { ok: false, error }
 * otherwise. Duplicates by (case-insensitive) email are treated as
 * idempotent successes — the landing page shouldn't scare repeat
 * visitors with a 409.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { z } from 'zod';

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { validateBody } from '@/lib/api-validation';

const schema = z.object({
  email: z.string().email().max(320),
  fullName: z.string().min(1).max(200).optional(),
  unitCount: z.number().int().min(1).max(5000).optional(),
  currentStack: z.string().max(500).optional(),
  source: z.string().max(100).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, schema);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const db = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null;
  const ipHash = ip ? createHash('sha256').update(ip).digest('hex') : null;

  const { data, error } = await db
    .from('waitlist')
    .upsert(
      {
        email: parsed.data.email.toLowerCase(),
        full_name: parsed.data.fullName ?? null,
        unit_count: parsed.data.unitCount ?? null,
        current_stack: parsed.data.currentStack ?? null,
        source: parsed.data.source ?? 'landing',
        referer: request.headers.get('referer'),
        ip_hash: ipHash,
      },
      { onConflict: 'email', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle();

  if (error) {
    // Keep provider/database details out of a public response. The internal
    // log retains enough evidence to diagnose without echoing visitor data.
    console.error('[waitlist] submission failed', {
      code: error.code,
      message: error.message,
    });
    return NextResponse.json(
      { ok: false, error: 'Unable to save your request right now.' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    id: data?.id ?? null,
    duplicate: data === null,
  });
}
