import { AccountantExportAccessError, createAccountantExport } from './export-service';
import { parseAccountantExportRequest } from './export-request';
import { resolveAccountantCapabilities } from './capabilities';
import { AccountantExportLimitError } from './exports';
import { AccountantProjectionError } from './projection';
import type { AccountantProjectionClient } from './repository';

export interface AccountantExportPrincipal {
  role: string;
  capabilities: ReadonlySet<string>;
}

interface AccountantExportHttpInput {
  request: Request;
  principal: AccountantExportPrincipal | null;
  client: AccountantProjectionClient;
}

function json(
  error: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      'cache-control': 'private, no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function attachmentFilename(filename: string): string {
  return /^[A-Za-z0-9._-]+\.csv$/.test(filename)
    ? filename
    : 'odesa-accounting-export.csv';
}

export async function handleAccountantExportHttp({
  request,
  principal,
  client,
}: AccountantExportHttpInput): Promise<Response> {
  if (request.method !== 'GET') {
    return json('Method not allowed', 405, { allow: 'GET' });
  }
  if (!principal) return json('Not authenticated', 401);
  if (principal.role !== 'accountant') return json('Forbidden', 403);
  let capabilities: ReadonlySet<string>;
  try {
    capabilities = resolveAccountantCapabilities(
      principal.capabilities,
      [],
    );
  } catch {
    return json('Forbidden', 403);
  }

  const parsed = parseAccountantExportRequest(
    new URL(request.url).searchParams,
  );
  if (!parsed.ok) return json('Invalid export request', 400);

  try {
    const artifact = await createAccountantExport(
      client,
      capabilities,
      parsed.value,
    );
    const filename = attachmentFilename(artifact.filename);
    return new Response(artifact.csv, {
      status: 200,
      headers: {
        'cache-control': 'private, no-store',
        'content-disposition': `attachment; filename="${filename}"`,
        'content-type': 'text/csv; charset=utf-8',
        'x-accounting-row-count': String(artifact.rowCount),
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof AccountantExportAccessError) {
      return json('Forbidden', 403);
    }
    if (error instanceof AccountantProjectionError) {
      return json('Accounting export is temporarily unavailable', 503);
    }
    if (error instanceof AccountantExportLimitError) {
      return json('Accounting export is too large', 413);
    }
    return json('Accounting export failed', 500);
  }
}
