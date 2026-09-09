/**
 * Retell webhook mock — STUB for Phase 5.
 *
 * Scripted responses for Retell tool-call posts. Real implementation
 * stands up a local fastify (or Next.js route handler) endpoint that
 * accepts POST bodies matching Retell's tool-call schema, records the
 * payloads for assertion, and returns deterministic scripted responses
 * mapped to the agent's 7 tools (per spec §4.4):
 *
 *   - lookup_tenant_by_phone
 *   - get_rent_status
 *   - get_lease_details
 *   - create_work_order
 *   - escalate_to_landlord
 *   - schedule_callback
 *   - send_sms_followup
 *
 * This file intentionally exposes only the skeleton shape that
 * downstream specs will code against; full wiring lands in Phase 5.
 */

/** One recorded Retell tool-call invocation. */
export interface RetellToolCall {
  tool:
    | 'lookup_tenant_by_phone'
    | 'get_rent_status'
    | 'get_lease_details'
    | 'create_work_order'
    | 'escalate_to_landlord'
    | 'schedule_callback'
    | 'send_sms_followup';
  args: Record<string, unknown>;
  /** ISO timestamp when the mock received the call. */
  receivedAt: string;
}

/** Scripted response overrides passed at startup. */
export interface RetellMockOptions {
  /** Port to bind the mock HTTP server on. Defaults to 5555. */
  port?: number;
  /**
   * Map of tool name → scripted response body. Falls back to a canned
   * success response per tool when omitted.
   */
  scripts?: Partial<Record<RetellToolCall['tool'], unknown>>;
}

/** Handle returned by `startMockServer()` for teardown + assertions. */
export interface RetellMockHandle {
  port: number;
  baseUrl: string;
  stop: () => Promise<void>;
  getRecordedPayloads: () => readonly RetellToolCall[];
}

/**
 * Starts the Retell mock server.
 *
 * STUB: returns a non-listening handle that records in memory. Phase 5
 * replaces this with a real fastify instance.
 *
 * @param opts - optional port + script overrides
 * @returns handle to inspect recorded payloads + stop the mock
 */
export async function startMockServer(
  opts: RetellMockOptions = {},
): Promise<RetellMockHandle> {
  const port = opts.port ?? 5555;
  const recorded: RetellToolCall[] = [];

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    getRecordedPayloads: () => recorded as readonly RetellToolCall[],
    stop: async () => {
      recorded.length = 0;
    },
  };
}

/**
 * Convenience: synchronous teardown of a previously-started handle.
 * Kept for symmetry with the messaging mock; specs generally call
 * `handle.stop()` directly.
 */
export async function stopMockServer(handle: RetellMockHandle): Promise<void> {
  await handle.stop();
}
