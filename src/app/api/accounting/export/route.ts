import type { NextRequest } from 'next/server';

import { handleAccountantExportHttp } from '@/lib/accounting/export-http';
import type { AccountantProjectionClient } from '@/lib/accounting/repository';
import { requireAccessContext } from '@/lib/authz/context';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function accessError(error: string, status: 401 | 403): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      'cache-control': 'private, no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const supabase = await createServerClient();
  const access = await requireAccessContext({ auth: supabase, db: supabase });
  if (!access.ok) return accessError(access.error, access.status);

  return handleAccountantExportHttp({
    request,
    principal: {
      role: access.context.role,
      capabilities: access.context.capabilities,
    },
    client: supabase as unknown as AccountantProjectionClient,
  });
}
