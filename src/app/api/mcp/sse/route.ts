/**
 * Poke MCP server endpoint (Phase 4 step 3).
 *
 *   POST   /api/mcp/sse  — JSON-RPC `initialize`, `tools/list`, `tools/call`
 *   GET    /api/mcp/sse  — SSE stream for server→client notifications
 *   DELETE /api/mcp/sse  — session teardown
 *
 * Auth: every request MUST carry `Authorization: Bearer odesa_mcp_<...>`.
 * The token resolves to `{organizationId, userId, keyId}` via
 * `requireMcpAuth`. On miss/invalid/revoked we return a 401 with a
 * spec-compliant JSON-RPC error envelope so Poke surfaces the failure
 * clearly instead of swallowing it as an empty SSE stream.
 *
 * Transport: WebStandardStreamableHTTPServerTransport (the newer MCP
 * spec, supersedes legacy SSEServerTransport). It accepts a Web
 * Standard `Request` and returns a `Response`, which is exactly what
 * Next.js App Router route handlers consume + emit. We run in
 * STATELESS mode (no sessionIdGenerator) — Poke opens a fresh request
 * per ask, and our tools are idempotent server-side, so we don't need
 * sticky session state.
 *
 * Per-request lifecycle (this is hot-path for Poke; keep it tight):
 *   1. requireMcpAuth(headers) → resolved scope or 401
 *   2. new transport + new McpServer (stateless mode)
 *   3. registerTool() x3 with inputSchema validation
 *   4. server.connect(transport)
 *   5. transport.handleRequest(req)  → returns Response
 *
 * Runtime: nodejs (the @modelcontextprotocol/sdk dist uses node:crypto
 * + ESM dynamic imports that don't run on the Edge runtime).
 */

import { z } from 'zod/v4';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireMcpAuth, type McpAuthScope } from '@/lib/mcp/auth';
import {
  askProperty,
  getProperty,
  listProperties,
  type HandlerDeps,
} from '@/lib/mcp/handlers';

// Required for the SDK and for createAdminClient.
export const runtime = 'nodejs';

// Stateless mode — fresh server per request; Poke does not maintain a
// long-lived session today.
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// JSON-RPC error envelope for unauthenticated requests
// ---------------------------------------------------------------------------
//
// MCP rides on JSON-RPC 2.0; per spec a transport-layer auth failure
// SHOULD return a JSON-RPC error so the client can surface it instead
// of seeing an empty stream. Code -32001 is in the JSON-RPC server-
// reserved range; MCP doesn't standardise an "auth required" code, so
// we use the more universal HTTP 401 status + JSON body and let Poke
// render the message field.

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  missing: 'Missing Authorization: Bearer header',
  invalid: 'Invalid API key',
  revoked: 'API key has been revoked',
  forbidden: 'Current membership does not permit this API key',
};

function unauthorizedResponse(
  reason: 'missing' | 'invalid' | 'revoked' | 'forbidden',
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: AUTH_ERROR_MESSAGES[reason] ?? 'Unauthorized',
      },
      id: null,
    }),
    {
      status: reason === 'forbidden' ? 403 : 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer realm="odesa-mcp"',
      },
    },
  );
}

// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------
//
// Per-request: registers the three Poke-facing tools, each closed over
// the resolved auth scope so handlers can scope every DB read by org.
//
// Tool input schemas are passed as plain Zod raw shapes (per the SDK's
// registerTool signature); the SDK validates inbound tool call args
// against them before invoking the handler.

function buildServer(
  admin: ReturnType<typeof createAdminClient>,
  scope: McpAuthScope,
): McpServer {
  const server = new McpServer({
    name: 'odesa-mcp',
    version: '1.0.0',
  });

  const deps: HandlerDeps = {
    admin,
    access: scope,
  };

  server.registerTool(
    'list_properties',
    {
      title: 'List properties',
      description:
        'List every property in the operator’s organization. Use this first when the operator names a property by partial name — match the response to find the right propertyId.',
      inputSchema: {},
    },
    async () => {
      return listProperties(deps);
    },
  );

  server.registerTool(
    'get_property',
    {
      title: 'Get property snapshot',
      description:
        'Return a snapshot for one property: name, address, autonomy level, KPIs (tenants, active leases, open work orders), and recent activity count over the last 7 days.',
      inputSchema: {
        propertyId: z
          .string()
          .uuid()
          .describe('UUID of the property to load (from list_properties).'),
      },
    },
    async ({ propertyId }) => {
      return getProperty(deps, { propertyId });
    },
  );

  server.registerTool(
    'ask_property',
    {
      title: 'Ask about a property',
      description:
        'Ask Odesa a free-form question about a specific property and optionally take action (text a tenant, schedule a vendor, etc.). Returns the operator dispatcher’s aggregated reply.',
      inputSchema: {
        propertyId: z
          .string()
          .uuid()
          .describe('UUID of the property the question is about.'),
        message: z
          .string()
          .min(1)
          .describe('The operator’s question or instruction in plain English.'),
      },
    },
    async ({ propertyId, message }) => {
      return askProperty(deps, { propertyId, message });
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Common request handler
// ---------------------------------------------------------------------------
//
// All three HTTP methods (POST/GET/DELETE) flow through the same
// transport.handleRequest path; routing inside MCP is by JSON-RPC
// method on the body, not by HTTP verb. Our App Router exports just
// dispatch the same function.

async function handle(req: Request): Promise<Response> {
  const admin = createAdminClient();
  const auth = await requireMcpAuth(admin, req.headers);

  if ('error' in auth) {
    return unauthorizedResponse(auth.error);
  }

  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = buildServer(admin, auth);

  await server.connect(transport);

  return transport.handleRequest(req);
}

// ---------------------------------------------------------------------------
// HTTP method exports
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function DELETE(req: Request): Promise<Response> {
  return handle(req);
}
