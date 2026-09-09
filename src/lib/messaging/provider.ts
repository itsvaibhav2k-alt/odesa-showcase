/**
 * `MessagingProvider` interface — the narrow contract every SMS/iMessage
 * backend must implement so the rest of the app stays provider-agnostic.
 *
 * Two implementations in Phase 4:
 *   - `LinqProvider`  (primary, see ./linq.ts)
 *   - `TwilioProvider` (standby, see ./twilio.ts)
 *
 * Helpers:
 *   - `getPrimaryProvider(orgId)` / `getFallbackProvider(orgId)` read
 *     `organizations.messaging_primary` and return the matching instance.
 *   - `getProvider(name)` returns a named instance directly, used by the
 *     send-with-failover flow.
 *
 * All selection is pure (no network); lookups use the server Supabase
 * client and RLS enforces tenancy.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { LinqProvider } from './linq';
import { RetellSmsProvider } from './retell';
import { TwilioProvider } from './twilio';
import type {
  OutboundMessage,
  ProviderChoice,
  SendResult,
  VerifyResult,
} from './types';

/**
 * Request shape handed to `verifyInbound()`. We surface the body and
 * headers explicitly so the verifier does not need to know about the
 * full NextRequest and can be unit-tested with plain objects.
 */
export interface VerifyInboundRequest {
  /** The full request URL (including query string) the provider signed. */
  url: string;
  /** Raw body as a UTF-8 string — providers sign the raw bytes. */
  rawBody: string;
  /** Header bag. Keys are lower-cased by the caller. */
  headers: Record<string, string>;
}

/**
 * The narrow interface all messaging backends must satisfy. Keeping
 * the surface tiny means a third provider (e.g. MessageBird) can slot
 * in without any call-site changes.
 */
export interface MessagingProvider {
  /** Canonical provider name that matches `MessagingProviderChoice`. */
  readonly name: ProviderChoice;

  /**
   * Verify an inbound webhook. Must return `{ ok: false, reason }`
   * (never throw) so the route handler can turn that into a 401.
   */
  verifyInbound(req: VerifyInboundRequest): VerifyResult;

  /** Send an outbound message. Must resolve to a discriminated result. */
  send(msg: OutboundMessage): Promise<SendResult>;

  /**
   * Optional: fire a typing-indicator (iMessage-only). Twilio SMS has
   * no equivalent so this is left undefined on `TwilioProvider`. Linq
   * does not yet expose the endpoint either, so the current
   * `LinqProvider` does not implement it; the operator dispatcher
   * treats absence as a no-op.
   */
  sendTypingIndicator?(toE164: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Singleton instances
// ---------------------------------------------------------------------------

const linq = new LinqProvider();
const twilio = new TwilioProvider();
const retell = new RetellSmsProvider();

// Explicit map — the old ternary silently returned Twilio for any
// unknown name, which would have sent Retell-destined messages over
// Twilio. A new enum value now fails typecheck here instead.
const providers: Record<ProviderChoice, MessagingProvider> = {
  linq,
  twilio,
  retell,
};

/** Return the concrete provider instance by name. */
export function getProvider(name: ProviderChoice): MessagingProvider {
  return providers[name];
}

/**
 * Return the fallback partner for `name`, or null when there is none.
 * Linq and Twilio pair with each other; Retell has no fallback — a
 * failed Retell send must surface as a failure, never silently reroute
 * through a legacy channel.
 */
export function getOppositeProvider(
  name: ProviderChoice,
): MessagingProvider | null {
  if (name === 'linq') return twilio;
  if (name === 'twilio') return linq;
  return null;
}

/**
 * Reads `organizations.messaging_primary` via the admin client (webhook
 * handlers run without an auth session). Defaults to `'linq'` when the
 * lookup fails so inbound message processing never silently drops.
 */
export async function getPrimaryProviderChoice(
  organizationId: string,
): Promise<ProviderChoice> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('organizations')
    .select('messaging_primary')
    .eq('id', organizationId)
    .single();

  if (error || !data) {
    console.warn(
      `[messaging] falling back to linq; org lookup failed: ${
        error?.message ?? 'no row'
      }`,
    );
    return 'linq';
  }
  return data.messaging_primary;
}

/** Returns the org's configured primary provider instance. */
export async function getPrimaryProvider(
  organizationId: string,
): Promise<MessagingProvider> {
  const choice = await getPrimaryProviderChoice(organizationId);
  return getProvider(choice);
}

/** Returns the standby for the org's primary — null when it has none. */
export async function getFallbackProvider(
  organizationId: string,
): Promise<MessagingProvider | null> {
  const choice = await getPrimaryProviderChoice(organizationId);
  return getOppositeProvider(choice);
}
