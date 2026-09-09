/**
 * POST /api/import/commit
 *
 * Multipart form (same as `/api/import/csv` — the client re-uploads the
 * file rather than trusting JSON-roundtripped state, so the server always
 * re-parses before writing. The Idempotency-Key is durably bound to the
 * source bytes and the database RPC atomically stores/replays one result.
 *
 * Returns:
 *   { success: true, summary: {
 *       inserted: { properties, units, tenants, leases },
 *       skipped:  { properties, units, tenants, leases },
 *       errors: string[]
 *     }
 *   }
 */

import { NextResponse, type NextRequest } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireImportAuthContext } from '@/lib/import/auth';
import {
  IMPORT_SOURCES,
  parseCsvText,
  runMapper,
  type ImportSource,
} from '@/lib/import';
import { commitPlan } from '@/lib/import/commit';
import { importValidationIssues } from '@/lib/import/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function isImportSource(value: unknown): value is ImportSource {
  return typeof value === 'string'
    && (IMPORT_SOURCES as readonly string[]).includes(value);
}

export async function POST(req: NextRequest) {
  const auth = await requireImportAuthContext();
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  const idempotencyKey = req.headers.get('idempotency-key')?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return NextResponse.json(
      { success: false, error: 'A valid Idempotency-Key header is required' },
      { status: 400 },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid multipart body' },
      { status: 400 },
    );
  }

  const source = formData.get('source');
  if (!isImportSource(source)) {
    return NextResponse.json(
      {
        success: false,
        error: `source must be one of: ${IMPORT_SOURCES.join(', ')}`,
      },
      { status: 400 },
    );
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { success: false, error: 'file is required' },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      {
        success: false,
        error: `file exceeds max size of ${MAX_FILE_BYTES} bytes`,
      },
      { status: 400 },
    );
  }

  let sourceBytes: Uint8Array;
  let text: string;
  try {
    sourceBytes = new Uint8Array(await file.arrayBuffer());
    text = new TextDecoder().decode(sourceBytes);
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to read file',
      },
      { status: 400 },
    );
  }

  let rows: Record<string, string>[];
  try {
    rows = parseCsvText(text);
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: `CSV parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    );
  }

  const result = runMapper(source, rows);
  const validationIssues = importValidationIssues(result);
  if (!result.ok || !result.plan || validationIssues.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: result.error ?? 'Import contains invalid required rows',
        validation: { issues: validationIssues },
        warnings: result.warnings ?? [],
      },
      { status: 422 },
    );
  }

  const admin = createAdminClient();
  const outcome = await commitPlan(
    admin,
    auth.context.organizationId,
    source,
    idempotencyKey,
    sourceBytes,
    result.plan,
  );

  if (!outcome.ok) {
    return NextResponse.json(
      { success: false, error: outcome.error },
      { status: outcome.conflict ? 409 : 500 },
    );
  }

  return NextResponse.json({
    success: true,
    source,
    summary: outcome.summary,
    replay: outcome.replay,
    warnings: result.warnings ?? [],
    validation: { issues: [] },
  });
}
