/**
 * POST /api/import/csv
 *
 * Multipart form:
 *   - file:   the CSV upload (max 5MB)
 *   - source: 'appfolio' | 'buildium' | 'rentredi' | 'generic'
 *
 * Returns a "dry run" preview JSON:
 *
 *   {
 *     success: true,
 *     plan: { properties: [...], units: [...], tenants: [...], leases: [...] },
 *     summary: {
 *       properties: { willInsert, willSkip, willUpdate },
 *       units: {...}, tenants: {...}, leases: {...},
 *     },
 *     warnings: [...soft-skip messages...]
 *   }
 *
 * The client retains the returned idempotency key and re-uploads the same file
 * to `/api/import/commit`. No DB writes happen here.
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
import { annotatePlan, summarize } from '@/lib/import/diff';
import { importValidationIssues } from '@/lib/import/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

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

  let text: string;
  try {
    const sourceBytes = new Uint8Array(await file.arrayBuffer());
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
  const annotated = await annotatePlan(
    admin,
    auth.context.organizationId,
    result.plan,
  );

  return NextResponse.json({
    success: true,
    idempotencyKey: crypto.randomUUID(),
    source,
    plan: {
      properties: annotated.properties,
      units: annotated.units,
      tenants: annotated.tenants,
      leases: annotated.leases,
    },
    summary: {
      properties: summarize(annotated.properties),
      units: summarize(annotated.units),
      tenants: summarize(annotated.tenants),
      leases: summarize(annotated.leases),
    },
    warnings: result.warnings ?? [],
    validation: { issues: [] },
  });
}
