/**
 * Fail-closed authorization for the test-hook endpoints.
 *
 * Both `/api/messaging/test-hooks` and `/api/agent/test-hooks` install
 * privileged provider/AI mocks (Claude, Anthropic, Linq/Twilio) and read
 * back recorded sends. If either endpoint opened up in a real deploy it
 * would be an unauthenticated backdoor that lets a caller swap live
 * providers for scripted mocks and exfiltrate recorded traffic. So the
 * rule is fail-closed: a production *misconfig* (flag set but no secret,
 * or secret set but wrong header) must return "unavailable", never "open".
 *
 * The enablement flag alone is NOT sufficient — Playwright's prod webServer
 * sets `MESSAGING_TEST_HOOKS=1`, so a shared secret contract is what
 * actually gates access. In production access requires ALL of: the flag,
 * a configured secret, and a matching request header. In non-production
 * (next dev / vitest) the secret is optional so local tooling stays
 * frictionless, but if a secret IS configured it is still enforced.
 */

export interface TestHooksAccessInput {
  nodeEnv: string | undefined;
  flag: string | undefined;
  configuredSecret: string | undefined;
  providedSecret: string | null;
}

/**
 * Pure fail-closed access decision. See module doc for the rationale.
 *
 * @param input - Resolved env + request-header values.
 * @returns true only when access is authorized.
 */
export function evaluateTestHooksAccess(input: TestHooksAccessInput): boolean {
  const { nodeEnv, flag, configuredSecret, providedSecret } = input;
  const hasSecret = typeof configuredSecret === 'string' && configuredSecret.length > 0;

  if (nodeEnv === 'production') {
    // Production: nothing is open unless explicitly opted in AND a secret
    // is configured AND the caller presents the exact matching secret.
    if (flag !== '1') return false;
    if (!hasSecret) return false;
    return providedSecret === configuredSecret;
  }

  // Non-production (next dev / vitest): a configured secret is still
  // enforced, but its absence is treated as dev convenience (open).
  if (hasSecret) return providedSecret === configuredSecret;
  return true;
}

/**
 * Request wrapper: reads env + the `x-test-hooks-secret` header and
 * delegates to {@link evaluateTestHooksAccess}.
 *
 * @param req - The incoming request.
 * @returns true only when access is authorized.
 */
export function authorizeTestHooks(req: Request): boolean {
  return evaluateTestHooksAccess({
    nodeEnv: process.env.NODE_ENV,
    flag: process.env.MESSAGING_TEST_HOOKS,
    configuredSecret: process.env.TEST_HOOKS_SECRET,
    providedSecret: req.headers.get('x-test-hooks-secret'),
  });
}
