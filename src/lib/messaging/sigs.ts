/**
 * Shared signature helpers — used by both LinqProvider and TwilioProvider.
 */

/**
 * Constant-time string equality check. Short-circuits on length
 * mismatch (same as Twilio's reference implementation) because
 * signature length is public.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
