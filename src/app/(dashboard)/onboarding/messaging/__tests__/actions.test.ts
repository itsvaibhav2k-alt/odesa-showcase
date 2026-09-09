/**
 * Unit tests for the Messaging onboarding step server actions.
 *
 * The actions cross three boundaries:
 *
 *   1. Auth (Supabase SSR client) — `auth.getUser` + a `users` lookup
 *      drive the `requireAuthContext` helper.
 *   2. The admin (service-role) Supabase client — used to read/write
 *      `sendblue_number_pool` and the org row.
 *   3. The MessagingProvider abstraction — `sendTestSmsAction`
 *      delegates to whichever provider `getPrimaryProvider` returns.
 *
 * We mock all three at the module level. The mocks are *thin* — they
 * implement only the chains the actions actually call. Each test sets
 * up the chain, invokes the action, asserts both the side effects and
 * the Result shape returned to the caller.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}));

vi.mock("@/lib/messaging/send-with-failover", () => ({
  sendWithFailover: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { sendWithFailover } from "@/lib/messaging/send-with-failover";

import {
  assignNumberAction,
  sendTestSmsAction,
  setAssistantNameAction,
} from "../actions";
import {
  ASSISTANT_NAME_MAX_LENGTH,
  DEFAULT_ASSISTANT_NAME,
  NO_AVAILABLE_NUMBERS_ERROR,
} from "../constants";

const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockCreateServerClient = vi.mocked(createServerClient);
const mockBoundarySend = vi.mocked(sendWithFailover);

const TEST_USER_ID = "user-1";
const TEST_ORG_ID = "org-1";

// ---------------------------------------------------------------------------
// Server (auth) client stub — every action calls `requireAuthContext` which
// resolves the auth'd user + a `users.organization_id` lookup.
// ---------------------------------------------------------------------------

interface ServerStubOptions {
  authError?: boolean;
  userMissing?: boolean;
}

function stubAuthedServerClient(options: ServerStubOptions = {}): void {
  const { authError = false, userMissing = false } = options;

  const getUser = vi.fn(async () => {
    if (authError) {
      return { data: { user: null }, error: { message: "no session" } };
    }
    return {
      data: {
        user: { id: TEST_USER_ID, email: "op@example.test" },
      },
      error: null,
    };
  });

  const usersSingle = vi.fn(async () => {
    if (userMissing) {
      return { data: null, error: { message: "no row" } };
    }
    return {
      data: { organization_id: TEST_ORG_ID },
      error: null,
    };
  });
  const usersEq = vi.fn(() => ({ single: usersSingle }));
  const usersSelect = vi.fn(() => ({ eq: usersEq }));

  const from = vi.fn((table: string) => {
    if (table === "users") {
      return { select: usersSelect };
    }
    throw new Error(`Unexpected server-client call to from("${table}")`);
  });

  mockCreateServerClient.mockResolvedValue({
    auth: { getUser },
    from,
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);
}

// ---------------------------------------------------------------------------
// Admin client builder — composes table-specific stubs into a single
// `from(table)` mock so the actions can run their full sequence of calls.
// ---------------------------------------------------------------------------

interface OrgRowState {
  odesa_phone_number: string | null;
  assistant_name: string;
}

interface UserRowState {
  phone_e164: string | null;
  phone_verified_at: string | null;
}

interface PoolRow {
  id: string;
  e164: string;
  status: "available" | "assigned";
  assigned_to_organization_id: string | null;
  assigned_at: string | null;
  created_at: string;
}

interface AdminStubOptions {
  /** State of the operator's `organizations` row at start. */
  org: OrgRowState;
  /** State of the operator's `users` row at start. */
  user?: UserRowState;
  /** Initial pool. Order is preserved as the SELECT order. */
  pool: PoolRow[];
  /** Forced error on the org SELECT (idempotency check). */
  orgSelectError?: string;
  /** Forced error on the org UPDATE. */
  orgUpdateError?: string;
  /**
   * Hook fired before every conditional UPDATE to the pool. Lets a
   * test simulate a cross-process race by mutating `pool` between our
   * SELECT and our UPDATE.
   */
  beforePoolUpdate?: (rowId: string) => void;
}

interface AdminStub {
  client: ReturnType<typeof createAdminClient>;
  pool: PoolRow[];
  orgUpdates: Array<Partial<OrgRowState & { messaging_primary: string }>>;
  send: ReturnType<typeof vi.fn>;
}

function buildAdminStub(options: AdminStubOptions): AdminStub {
  const orgUpdates: AdminStub["orgUpdates"] = [];
  const pool = options.pool.map((row) => ({ ...row }));

  // -- organizations table mock ----------------------------------------------

  const orgSelectSingle = vi.fn(async () => {
    if (options.orgSelectError) {
      return { data: null, error: { message: options.orgSelectError } };
    }
    return {
      data: {
        odesa_phone_number: options.org.odesa_phone_number,
        assistant_name: options.org.assistant_name,
      },
      error: null,
    };
  });
  const orgSelectEq = vi.fn(() => ({ single: orgSelectSingle }));
  const orgSelect = vi.fn(() => ({ eq: orgSelectEq }));

  const orgUpdateEq = vi.fn(async () => {
    if (options.orgUpdateError) {
      return { error: { message: options.orgUpdateError } };
    }
    return { error: null };
  });
  const orgUpdate = vi.fn(
    (patch: Partial<OrgRowState & { messaging_primary: string }>) => {
      orgUpdates.push(patch);
      // Reflect the mutation back into the org state for chained reads.
      if (typeof patch.odesa_phone_number !== "undefined") {
        options.org.odesa_phone_number = patch.odesa_phone_number;
      }
      if (typeof patch.assistant_name !== "undefined") {
        options.org.assistant_name = patch.assistant_name as string;
      }
      return { eq: orgUpdateEq };
    },
  );

  // -- users table mock (for sendTestSms) ------------------------------------

  const usersSelectSingle = vi.fn(async () => {
    if (!options.user) {
      return { data: null, error: { message: "no user row" } };
    }
    return {
      data: {
        phone_e164: options.user.phone_e164,
        phone_verified_at: options.user.phone_verified_at,
      },
      error: null,
    };
  });
  const usersSelectEq = vi.fn(() => ({ single: usersSelectSingle }));
  const usersSelect = vi.fn(() => ({ eq: usersSelectEq }));

  // -- sendblue_number_pool mock ---------------------------------------------

  const poolSelectLimit = vi.fn(async () => {
    const available = pool
      .filter((row) => row.status === "available")
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, 5)
      .map((row) => ({ id: row.id, e164: row.e164 }));
    return { data: available, error: null };
  });
  const poolSelectOrder = vi.fn(() => ({ limit: poolSelectLimit }));
  const poolSelectEq = vi.fn(() => ({ order: poolSelectOrder }));
  const poolSelect = vi.fn(() => ({ eq: poolSelectEq }));

  const poolUpdate = vi.fn(
    (patch: { status: string; assigned_to_organization_id: string }) => {
      // First .eq('id', id) then .eq('status', 'available') then .select().maybeSingle()
      let candidateId = "";
      let requireStatus = "";

      const maybeSingle = vi.fn(async () => {
        if (options.beforePoolUpdate) {
          options.beforePoolUpdate(candidateId);
        }
        const candidate = pool.find((r) => r.id === candidateId);
        if (!candidate) {
          return { data: null, error: null };
        }
        if (requireStatus && candidate.status !== requireStatus) {
          return { data: null, error: null };
        }
        // Apply the update.
        candidate.status = patch.status as PoolRow["status"];
        candidate.assigned_to_organization_id =
          patch.assigned_to_organization_id;
        candidate.assigned_at = new Date().toISOString();
        return { data: { e164: candidate.e164 }, error: null };
      });

      const select = vi.fn(() => ({ maybeSingle }));
      const eqStatus = vi.fn((_col: string, val: string) => {
        requireStatus = val;
        return { select };
      });
      const eqId = vi.fn((_col: string, val: string) => {
        candidateId = val;
        return { eq: eqStatus };
      });
      return { eq: eqId };
    },
  );

  // -- top-level dispatcher --------------------------------------------------

  const from = vi.fn((table: string) => {
    if (table === "organizations") {
      return { select: orgSelect, update: orgUpdate };
    }
    if (table === "users") {
      return { select: usersSelect };
    }
    if (table === "sendblue_number_pool") {
      return { select: poolSelect, update: poolUpdate };
    }
    throw new Error(`Unexpected admin call to from("${table}")`);
  });

  const client = { from } as unknown as ReturnType<typeof createAdminClient>;

  return { client, pool, orgUpdates, send: vi.fn() };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function poolRow(
  partial: Partial<PoolRow> & Pick<PoolRow, "id" | "e164">,
): PoolRow {
  return {
    status: "available",
    assigned_to_organization_id: null,
    assigned_at: null,
    created_at: "2026-05-01T00:00:00Z",
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBoundarySend.mockResolvedValue({
    ok: true,
    provider: "linq",
    providerMessageId: "mock-boundary",
    attempted: ["linq"],
    failedOver: false,
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

// ===========================================================================
// assignNumberAction
// ===========================================================================

describe("assignNumberAction", () => {
  it("should return Err Not authenticated when auth.getUser fails", async () => {
    stubAuthedServerClient({ authError: true });
    const result = await assignNumberAction();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Not authenticated");
    }
  });

  it("should claim the oldest available pool number and persist e164 onto organizations", async () => {
    stubAuthedServerClient();
    const stub = buildAdminStub({
      org: { odesa_phone_number: null, assistant_name: "Odesa" },
      pool: [
        poolRow({
          id: "p1",
          e164: "+12025550100",
          created_at: "2026-05-01T00:00:00Z",
        }),
        poolRow({
          id: "p2",
          e164: "+16452468236",
          created_at: "2026-05-02T00:00:00Z",
        }),
      ],
    });
    mockCreateAdminClient.mockReturnValue(stub.client);

    const result = await assignNumberAction();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.e164).toBe("+12025550100");
    }
    // Pool row should now be 'assigned'.
    expect(stub.pool[0].status).toBe("assigned");
    expect(stub.pool[0].assigned_to_organization_id).toBe(TEST_ORG_ID);
    // Org should have number + messaging_primary persisted.
    expect(stub.orgUpdates).toEqual([
      {
        odesa_phone_number: "+12025550100",
        messaging_primary: "linq",
      },
    ]);
  });

  it("should return NO_AVAILABLE_NUMBERS error when pool is empty", async () => {
    stubAuthedServerClient();
    const stub = buildAdminStub({
      org: { odesa_phone_number: null, assistant_name: "Odesa" },
      pool: [],
    });
    mockCreateAdminClient.mockReturnValue(stub.client);

    const result = await assignNumberAction();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(NO_AVAILABLE_NUMBERS_ERROR);
    }
    // No org update happens when the pool is empty.
    expect(stub.orgUpdates).toEqual([]);
  });

  it("should be race-safe: a concurrent claim that flips the candidate status forces the next candidate to be picked", async () => {
    stubAuthedServerClient();
    const stub = buildAdminStub({
      org: { odesa_phone_number: null, assistant_name: "Odesa" },
      pool: [
        poolRow({
          id: "p1",
          e164: "+12025550100",
          created_at: "2026-05-01T00:00:00Z",
        }),
        poolRow({
          id: "p2",
          e164: "+16452468236",
          created_at: "2026-05-02T00:00:00Z",
        }),
      ],
      // Simulate another worker grabbing p1 between our SELECT and our
      // UPDATE. The conditional UPDATE will see p1 as 'assigned' and
      // skip it, falling through to p2.
      beforePoolUpdate: (rowId) => {
        if (rowId === "p1") {
          const winner = stub.pool.find((r) => r.id === "p1");
          if (winner) {
            winner.status = "assigned";
            winner.assigned_to_organization_id = "other-org";
          }
        }
      },
    });
    mockCreateAdminClient.mockReturnValue(stub.client);

    const result = await assignNumberAction();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.e164).toBe("+16452468236");
    }
    // p1 stays with the other org; p2 is ours.
    expect(stub.pool[0].assigned_to_organization_id).toBe("other-org");
    expect(stub.pool[1].assigned_to_organization_id).toBe(TEST_ORG_ID);
  });

  it("should be idempotent: re-running with an already-assigned number returns it without claiming a new row", async () => {
    stubAuthedServerClient();
    const stub = buildAdminStub({
      org: {
        odesa_phone_number: "+16452468201",
        assistant_name: "Odesa",
      },
      pool: [
        poolRow({
          id: "p1",
          e164: "+12025550100",
          created_at: "2026-05-01T00:00:00Z",
        }),
      ],
    });
    mockCreateAdminClient.mockReturnValue(stub.client);

    const result = await assignNumberAction();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.e164).toBe("+16452468201");
    }
    // No claim happens — the pool row stays available.
    expect(stub.pool[0].status).toBe("available");
    // No org updates — we already have a number.
    expect(stub.orgUpdates).toEqual([]);
  });
});

// ===========================================================================
// setAssistantNameAction
// ===========================================================================

describe("setAssistantNameAction", () => {
  it("should reject Not authenticated when no user session", async () => {
    stubAuthedServerClient({ authError: true });
    const result = await setAssistantNameAction({ name: "Maya" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Not authenticated");
    }
  });

  it("should persist a valid trimmed name", async () => {
    stubAuthedServerClient();
    const stub = buildAdminStub({
      org: { odesa_phone_number: null, assistant_name: "Odesa" },
      pool: [],
    });
    mockCreateAdminClient.mockReturnValue(stub.client);

    const result = await setAssistantNameAction({ name: "  Maya  " });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assistantName).toBe("Maya");
    }
    expect(stub.orgUpdates).toEqual([{ assistant_name: "Maya" }]);
  });

  it("should reject an empty name", async () => {
    stubAuthedServerClient();
    const stub = buildAdminStub({
      org: { odesa_phone_number: null, assistant_name: "Odesa" },
      pool: [],
    });
    mockCreateAdminClient.mockReturnValue(stub.client);

    const result = await setAssistantNameAction({ name: "   " });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/1 to 30/);
    }
    expect(stub.orgUpdates).toEqual([]);
  });

  it(`should reject names longer than ${ASSISTANT_NAME_MAX_LENGTH} characters`, async () => {
    stubAuthedServerClient();
    const stub = buildAdminStub({
      org: { odesa_phone_number: null, assistant_name: "Odesa" },
      pool: [],
    });
    mockCreateAdminClient.mockReturnValue(stub.client);

    const tooLong = "A".repeat(ASSISTANT_NAME_MAX_LENGTH + 1);
    const result = await setAssistantNameAction({ name: tooLong });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/1 to 30/);
    }
  });

  it("should reject names without any letter (digits and punctuation only)", async () => {
    stubAuthedServerClient();
    const stub = buildAdminStub({
      org: { odesa_phone_number: null, assistant_name: "Odesa" },
      pool: [],
    });
    mockCreateAdminClient.mockReturnValue(stub.client);

    const result = await setAssistantNameAction({ name: "12345!" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/letter/);
    }
  });

  it("should reject names containing control characters", async () => {
    stubAuthedServerClient();
    const stub = buildAdminStub({
      org: { odesa_phone_number: null, assistant_name: "Odesa" },
      pool: [],
    });
    mockCreateAdminClient.mockReturnValue(stub.client);

    const result = await setAssistantNameAction({ name: "Maya" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/control/);
    }
  });

  it('should accept the default name "Odesa"', async () => {
    stubAuthedServerClient();
    const stub = buildAdminStub({
      org: { odesa_phone_number: null, assistant_name: "Maya" },
      pool: [],
    });
    mockCreateAdminClient.mockReturnValue(stub.client);

    const result = await setAssistantNameAction({
      name: DEFAULT_ASSISTANT_NAME,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assistantName).toBe(DEFAULT_ASSISTANT_NAME);
    }
  });
});

// ===========================================================================
// sendTestSmsAction
// ===========================================================================

describe("sendTestSmsAction", () => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  it("should refuse to send when the user has no verified phone", async () => {
    stubAuthedServerClient();
    const stub = buildAdminStub({
      org: {
        odesa_phone_number: "+12025550100",
        assistant_name: "Maya",
      },
      user: { phone_e164: null, phone_verified_at: null },
      pool: [],
    });
    mockCreateAdminClient.mockReturnValue(stub.client);
    const send = mockBoundarySend;

    const result = await sendTestSmsAction(requestId);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/Verify your personal phone/);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("should refuse to send when the org has no odesa_phone_number assigned", async () => {
    stubAuthedServerClient();
    const stub = buildAdminStub({
      org: { odesa_phone_number: null, assistant_name: "Maya" },
      user: {
        phone_e164: "+15551234567",
        phone_verified_at: "2026-05-01T00:00:00Z",
      },
      pool: [],
    });
    mockCreateAdminClient.mockReturnValue(stub.client);
    const send = mockBoundarySend;

    const result = await sendTestSmsAction(requestId);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/Assign a number first/);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("should send a test message via the primary provider with the assistant name interpolated", async () => {
    stubAuthedServerClient();
    const stub = buildAdminStub({
      org: {
        odesa_phone_number: "+12025550100",
        assistant_name: "Maya",
      },
      user: {
        phone_e164: "+15551234567",
        phone_verified_at: "2026-05-01T00:00:00Z",
      },
      pool: [],
    });
    mockCreateAdminClient.mockReturnValue(stub.client);
    const send = mockBoundarySend;

    const result = await sendTestSmsAction(requestId);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.toE164).toBe("+15551234567");
      expect(result.data.providerMessageId).toBe("mock-boundary");
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(TEST_ORG_ID, {
      toE164: "+15551234567",
      fromE164: "+12025550100",
      body: "This is a test from Maya. Reply with anything to confirm.",
      idempotencyKey: `onboarding-test:user-1:${requestId}`,
    });
  });

  it("should bubble the provider failure as a Result Err", async () => {
    stubAuthedServerClient();
    const stub = buildAdminStub({
      org: {
        odesa_phone_number: "+12025550100",
        assistant_name: "Maya",
      },
      user: {
        phone_e164: "+15551234567",
        phone_verified_at: "2026-05-01T00:00:00Z",
      },
      pool: [],
    });
    mockCreateAdminClient.mockReturnValue(stub.client);
    const send = mockBoundarySend;
    mockBoundarySend.mockResolvedValue({
      ok: false,
      status: "failed",
      attempted: ["linq"],
      errors: [{ provider: "linq", error: "simulated failure" }],
    });

    const result = await sendTestSmsAction(requestId);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/Couldn't send the test SMS/);
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("should fall back to the default assistant name when org has no override", async () => {
    stubAuthedServerClient();
    const stub = buildAdminStub({
      org: {
        odesa_phone_number: "+12025550100",
        // Empty string is the only legit "no override" path because the
        // column is NOT NULL with a default of 'Odesa'.
        assistant_name: "",
      },
      user: {
        phone_e164: "+15551234567",
        phone_verified_at: "2026-05-01T00:00:00Z",
      },
      pool: [],
    });
    mockCreateAdminClient.mockReturnValue(stub.client);
    const send = mockBoundarySend;

    await sendTestSmsAction(requestId);

    expect(send).toHaveBeenCalledWith(
      TEST_ORG_ID,
      expect.objectContaining({
        body: `This is a test from ${DEFAULT_ASSISTANT_NAME}. Reply with anything to confirm.`,
      }),
    );
  });
});
