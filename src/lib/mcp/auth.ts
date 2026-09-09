/**
 * Bearer-token authentication for the Poke MCP server (Phase 4).
 *
 * Companion to the key-mint flow in
 * src/app/(dashboard)/settings/integrations/actions.ts which produces
 * `odesa_mcp_<32-char-base64url>` keys, sha256-hashes the plaintext
 * into `mcp_api_keys.key_hash`, and stores the unhashed prefix for
 * display. This module is the read path:
 *
 *   1. extractBearerToken — pull `Authorization: Bearer <token>` off
 *      the inbound HTTP headers (whitespace-tolerant; case-insensitive
 *      scheme).
 *   2. lookupApiKey       — sha256 the token, query mcp_api_keys for a
 *      live (revoked_at IS NULL) row, return the resolved scope.
 *   3. recordKeyUsage     — fire-and-forget bump of `last_used_at`. Not
 *      awaited on the hot path so a slow DB write never delays the
 *      MCP response.
 *   4. requireMcpAuth     — composes 1+2+3 into the only function MCP
 *      route handlers need to call. Returns either the resolved scope
 *      or a discriminated `{ error }` so the caller can map to a
 *      well-formed MCP/HTTP status without leaking internals.
 *
 * Auth runs against the admin client (no `auth.uid()` JWT in webhook
 * land) — RLS on mcp_api_keys still gates dashboard reads, but server-
 * side lookups need to bypass it to do the sha256 join.
 */

import * as crypto from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import {
  resolveActiveAccessContextForUser,
  type AccessContext,
} from '@/lib/authz/context';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AdminClient = SupabaseClient<Database>;

/** Resolved scope for a successful auth lookup. */
export interface McpKeyIdentity {
  organizationId: string;
  userId: string;
  /** mcp_api_keys.id — needed to bump last_used_at after auth. */
  keyId: string;
}

/** Scope re-resolved from the caller's current active membership per request. */
export type McpAuthScope = AccessContext & { keyId: string };

/** Reason an auth attempt failed. Mapped to MCP errors by callers. */
export type McpAuthError = 'missing' | 'invalid' | 'revoked' | 'forbidden';

export type McpAuthResult = McpAuthScope | { error: McpAuthError };

// ---------------------------------------------------------------------------
// extractBearerToken
// ---------------------------------------------------------------------------

const BEARER_PATTERN = /^bearer\s+(.+)$/i;

/**
 * Pull the bearer token out of the standard `Authorization` header.
 *
 * Returns `null` for any of:
 *   - header absent
 *   - non-Bearer scheme (Basic, Token, etc.)
 *   - Bearer scheme present but empty token after the space
 *
 * Whitespace inside the token is preserved (real keys never contain
 * whitespace, but trimming inside would mask a malformed token bug
 * earlier than we want).
 */
export function extractBearerToken(headers: Headers): string | null {
  const raw = headers.get('authorization');
  if (!raw) return null;

  const match = raw.trim().match(BEARER_PATTERN);
  if (!match) return null;

  const token = match[1]!.trim();
  return token.length > 0 ? token : null;
}

// ---------------------------------------------------------------------------
// lookupApiKey
// ---------------------------------------------------------------------------

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Resolve a plaintext token to a scope by hashing it and looking up
 * the matching `mcp_api_keys` row.
 *
 * Returns `null` if there is no matching live row (token never minted,
 * or row exists but revoked_at IS NOT NULL). Callers map `null` to
 * either 'invalid' or 'revoked' depending on whether a *revoked* row
 * exists (see `requireMcpAuth`).
 */
export async function lookupApiKey(
  admin: AdminClient,
  token: string,
): Promise<McpKeyIdentity | null> {
  const keyHash = sha256Hex(token);

  const { data, error } = await admin
    .from('mcp_api_keys')
    .select('id, organization_id, user_id')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error || !data) return null;

  return {
    organizationId: data.organization_id,
    userId: data.user_id,
    keyId: data.id,
  };
}

/**
 * Returns true iff a row exists for `token` AND it has been revoked.
 * Used to disambiguate 'invalid' (never minted) from 'revoked' (minted
 * then revoked) in error responses — useful for the operator who just
 * revoked a key and is wondering why Poke stopped working.
 */
async function isTokenRevoked(
  admin: AdminClient,
  token: string,
): Promise<boolean> {
  const keyHash = sha256Hex(token);

  const { data, error } = await admin
    .from('mcp_api_keys')
    .select('id')
    .eq('key_hash', keyHash)
    .not('revoked_at', 'is', null)
    .maybeSingle();

  if (error || !data) return false;
  return true;
}

// ---------------------------------------------------------------------------
// recordKeyUsage
// ---------------------------------------------------------------------------

/**
 * Bump `last_used_at` to NOW for the given key id.
 *
 * Intentionally NOT awaited on the hot path — the MCP response should
 * not block on this write. The function still returns a Promise so
 * callers can `void recordKeyUsage(...)` and let it run in the
 * background; failures are swallowed because the only consequence of a
 * missed bump is a stale "last used" display, never a wrong auth
 * outcome.
 */
export async function recordKeyUsage(
  admin: AdminClient,
  keyId: string,
): Promise<void> {
  try {
    await admin
      .from('mcp_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyId);
  } catch {
    // Swallow — best-effort observability, never an auth blocker.
  }
}

// ---------------------------------------------------------------------------
// requireMcpAuth — the only function MCP route handlers need
// ---------------------------------------------------------------------------

/**
 * End-to-end auth for an MCP request. Composes extract → lookup →
 * record. Returns the resolved scope on success, or a discriminated
 * `{ error }` on failure so the caller can decide on the appropriate
 * MCP-protocol error response.
 *
 * The `last_used_at` bump runs in the background — `requireMcpAuth`
 * resolves as soon as the auth decision is made.
 */
export async function requireMcpAuth(
  admin: AdminClient,
  headers: Headers,
): Promise<McpAuthResult> {
  const token = extractBearerToken(headers);
  if (!token) return { error: 'missing' };

  const scope = await lookupApiKey(admin, token);
  if (scope) {
    const active = await resolveActiveAccessContextForUser(
      admin,
      scope.userId,
      scope.organizationId,
    );
    if (!active.ok) return { error: 'forbidden' };
    // Fire-and-forget — don't block the auth path on the bump.
    void recordKeyUsage(admin, scope.keyId);
    return { ...active.context, keyId: scope.keyId };
  }

  // Disambiguate revoked-vs-invalid for the error message. If the
  // revoked check itself errors, fall back to 'invalid' — never leak
  // DB state details into an unauth response.
  const revoked = await isTokenRevoked(admin, token);
  return { error: revoked ? 'revoked' : 'invalid' };
}
