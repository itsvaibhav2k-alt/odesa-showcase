/**
 * GET /api/import/template?source=appfolio|buildium|rentredi|generic
 *
 * Returns a small sample CSV (3 rows) for the chosen source, with
 * `Content-Disposition: attachment` so the browser downloads it.
 *
 * Auth-gated: only signed-in operators can pull templates.  Bytes are
 * sourced from `src/lib/import/templates/index.ts` so the route is
 * fully self-contained at build time (no `fs` reads from a route
 * handler).
 */

import { NextResponse, type NextRequest } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { IMPORT_SOURCES, getTemplateCsv, type ImportSource } from '@/lib/import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isImportSource(value: string | null): value is ImportSource {
  return value !== null && (IMPORT_SOURCES as readonly string[]).includes(value);
}

export async function GET(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Not authenticated' },
      { status: 401 },
    );
  }

  // Prefer NextRequest.nextUrl (zero-allocation); fall back to URL parsing
  // so the handler stays testable with a plain Request.
  const url = (req as { nextUrl?: URL }).nextUrl ?? new URL(req.url);
  const source = url.searchParams.get('source');
  if (!isImportSource(source)) {
    return NextResponse.json(
      {
        success: false,
        error: `source must be one of: ${IMPORT_SOURCES.join(', ')}`,
      },
      { status: 400 },
    );
  }

  const csv = getTemplateCsv(source);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="odesa-import-${source}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
