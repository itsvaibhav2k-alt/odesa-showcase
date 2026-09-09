// Smoke-test the Poke MCP server end-to-end against a running dev server.
// Usage: npm run dev  (in another terminal)
//        npx tsx scripts/smoke-mcp-server.ts
//
// What it does:
//   1. Mints a fresh `mcp_api_keys` row directly via the admin client
//      (you need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//      in .env.local — the same vars the route uses). The script picks
//      the FIRST organization + the FIRST user in that org as the
//      key owner; override with TEST_ORG_ID / TEST_USER_ID env vars.
//   2. Sends `initialize` to /api/mcp/sse so the server negotiates the
//      protocol version (required before tools/list works).
//   3. Sends `tools/list` and asserts the 3 expected tools come back.
//   4. Sends `tools/call` for `list_properties` and prints the result.
//   5. Cleans up: revokes the key it minted (sets revoked_at).
//
// Override the target host with MCP_BASE_URL (defaults to localhost:3000).
// Don't run this against production — it touches mcp_api_keys.

import * as crypto from 'node:crypto';

import { createAdminClient } from '../src/lib/supabase/admin';

const BASE_URL = process.env.MCP_BASE_URL ?? 'http://localhost:3000';
const ENDPOINT = `${BASE_URL}/api/mcp/sse`;
const PROTOCOL_VERSION = '2025-06-18';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function mintKey(): { plaintext: string; prefix: string; hash: string } {
  const random = crypto.randomBytes(24).toString('base64url');
  const plaintext = `odesa_mcp_${random}`;
  return {
    plaintext,
    prefix: `odesa_mcp_${random.slice(0, 8)}`,
    hash: sha256Hex(plaintext),
  };
}

async function pickOwner(): Promise<{ orgId: string; userId: string }> {
  const orgId = process.env.TEST_ORG_ID;
  const userId = process.env.TEST_USER_ID;
  if (orgId && userId) return { orgId, userId };

  const admin = createAdminClient();
  const { data: orgs, error: orgErr } = await admin
    .from('organizations')
    .select('id')
    .limit(1);
  if (orgErr || !orgs?.length) {
    throw new Error(`No organization found: ${orgErr?.message ?? 'empty'}`);
  }
  const pickedOrg = orgs[0]!.id;

  const { data: users, error: userErr } = await admin
    .from('users')
    .select('id')
    .eq('organization_id', pickedOrg)
    .limit(1);
  if (userErr || !users?.length) {
    throw new Error(`No user found in org ${pickedOrg}: ${userErr?.message ?? 'empty'}`);
  }
  return { orgId: pickedOrg, userId: users[0]!.id };
}

async function mintTestKey(): Promise<{
  plaintext: string;
  rowId: string;
  cleanup: () => Promise<void>;
}> {
  const owner = await pickOwner();
  const minted = mintKey();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('mcp_api_keys')
    .insert({
      organization_id: owner.orgId,
      user_id: owner.userId,
      key_hash: minted.hash,
      key_prefix: minted.prefix,
      label: 'smoke-test',
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to mint test key: ${error?.message ?? 'no row'}`);
  }

  const rowId = data.id;
  const cleanup = async () => {
    await admin
      .from('mcp_api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', rowId);
  };

  return { plaintext: minted.plaintext, rowId, cleanup };
}

interface RpcOptions {
  token: string;
  sessionId?: string;
  protocolVersion?: string;
}

async function rpc<T = unknown>(
  req: JsonRpcRequest,
  opts: RpcOptions,
): Promise<{ body: JsonRpcResponse<T>; sessionId: string | undefined }> {
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    authorization: `Bearer ${opts.token}`,
  };
  if (opts.sessionId) headers['mcp-session-id'] = opts.sessionId;
  if (opts.protocolVersion)
    headers['mcp-protocol-version'] = opts.protocolVersion;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
  });

  const sessionId = res.headers.get('mcp-session-id') ?? undefined;
  const contentType = res.headers.get('content-type') ?? '';

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `HTTP ${res.status} from ${ENDPOINT} for method=${req.method}: ${text}`,
    );
  }

  let body: JsonRpcResponse<T>;
  if (contentType.includes('text/event-stream')) {
    // SSE: parse out the first `data:` event.
    const text = await res.text();
    const match = text.match(/^data:\s*(.+)$/m);
    if (!match) throw new Error(`No data: line in SSE response: ${text}`);
    body = JSON.parse(match[1]!) as JsonRpcResponse<T>;
  } else {
    body = (await res.json()) as JsonRpcResponse<T>;
  }

  if (body.error) {
    throw new Error(
      `JSON-RPC error from ${req.method}: ${body.error.code} ${body.error.message}`,
    );
  }

  return { body, sessionId };
}

interface ToolListItem {
  name: string;
  description?: string;
}

async function main(): Promise<void> {
  console.log(`[smoke] minting test key against ${BASE_URL}…`);
  const minted = await mintTestKey();
  console.log(`[smoke] key minted (row id ${minted.rowId})`);

  try {
    // -- 1. initialize ---------------------------------------------------
    console.log('[smoke] initialize…');
    const init = await rpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'odesa-smoke', version: '0.1.0' },
        },
      },
      { token: minted.plaintext, protocolVersion: PROTOCOL_VERSION },
    );
    const sessionId = init.sessionId;
    console.log(`[smoke] initialize ok (session=${sessionId ?? '<stateless>'})`);

    // -- 2. tools/list ---------------------------------------------------
    console.log('[smoke] tools/list…');
    const toolsRes = await rpc<{ tools: ToolListItem[] }>(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      {
        token: minted.plaintext,
        sessionId,
        protocolVersion: PROTOCOL_VERSION,
      },
    );
    const toolNames = (toolsRes.body.result?.tools ?? []).map((t) => t.name);
    console.log(`[smoke] tools returned: ${toolNames.join(', ')}`);

    const expected = ['list_properties', 'get_property', 'ask_property'];
    for (const name of expected) {
      if (!toolNames.includes(name)) {
        throw new Error(`Missing tool: ${name}`);
      }
    }

    // -- 3. tools/call list_properties -----------------------------------
    console.log('[smoke] tools/call list_properties…');
    const callRes = await rpc<{
      content: Array<{ type: string; text: string }>;
    }>(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'list_properties', arguments: {} },
      },
      {
        token: minted.plaintext,
        sessionId,
        protocolVersion: PROTOCOL_VERSION,
      },
    );
    const text = callRes.body.result?.content?.[0]?.text;
    if (!text) {
      throw new Error('list_properties returned no text content');
    }
    console.log(`[smoke] list_properties text length=${text.length}`);
    console.log(`[smoke] sample: ${text.slice(0, 200)}…`);

    console.log('[smoke] PASS');
  } finally {
    await minted.cleanup();
    console.log('[smoke] test key revoked');
  }
}

main().catch((err) => {
  console.error('[smoke] FAIL:', err);
  process.exit(1);
});
