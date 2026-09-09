/**
 * Unit tests for `src/lib/portal/otp.ts`.
 *
 * The library reads/writes through `createAdminClient()`, so we mock the
 * admin module with a small chainable stub (the tests/tenants/queries
 * style) extended with mutating insert/update so the atomic-consume and
 * attempt-increment semantics are observable. `sendWithFailover` is
 * mocked so we can assert what was (not) sent.
 *
 * The module-scope rate limiters persist across tests in this file, so
 * every test uses its own phone number and IP.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}));

vi.mock("@/lib/messaging/send-with-failover", () => ({
  sendWithFailover: sendMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => buildQuery(table),
  }),
}));

import {
  confirmPortalOtp,
  hashPortalOtpCode,
  requestPortalOtp,
} from "@/lib/portal/otp";

// ---------------------------------------------------------------------------
// Supabase stub — chainable, with mutating insert/update
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

let db: {
  tenants: Row[];
  portal_otps: Row[];
  messaging_recipient_consents: Row[];
  organizations: Row[];
};

function buildQuery(table: string): unknown {
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let insertRows: Row[] | null = null;
  let orderBy: { col: string; ascending: boolean } | null = null;
  let limitN: number | null = null;

  const exec = (): Row[] => {
    const rows = db[table as keyof typeof db] ?? [];
    if (insertRows) {
      const withDefaults = insertRows.map((r) => ({
        id: randomUUID(),
        created_at: new Date().toISOString(),
        ...r,
      }));
      rows.push(...withDefaults);
      return withDefaults;
    }
    let matched = rows.filter((r) => filters.every((f) => f(r)));
    if (patch) {
      for (const r of matched) Object.assign(r, patch);
    }
    if (orderBy) {
      const { col, ascending } = orderBy;
      matched = [...matched].sort((a, b) => {
        const av = String(a[col] ?? "");
        const bv = String(b[col] ?? "");
        if (av < bv) return ascending ? -1 : 1;
        if (av > bv) return ascending ? 1 : -1;
        return 0;
      });
    }
    if (limitN != null) matched = matched.slice(0, limitN);
    return matched;
  };

  const chain = {
    select() {
      return chain;
    },
    insert(payload: Row | Row[]) {
      insertRows = Array.isArray(payload) ? payload : [payload];
      return chain;
    },
    update(p: Row) {
      patch = p;
      return chain;
    },
    eq(col: string, value: unknown) {
      filters.push((r) => r[col] === value);
      return chain;
    },
    is(col: string, value: unknown) {
      filters.push((r) => (value === null ? r[col] == null : r[col] === value));
      return chain;
    },
    gte(col: string, value: unknown) {
      filters.push((r) => String(r[col]) >= String(value));
      return chain;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderBy = { col, ascending: opts?.ascending !== false };
      return chain;
    },
    limit(n: number) {
      limitN = n;
      return chain;
    },
    maybeSingle() {
      const rows = exec();
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    single() {
      const rows = exec();
      return Promise.resolve({
        data: rows[0] ?? null,
        error: rows[0] ? null : { message: "not found" },
      });
    },
    then(
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ): Promise<unknown> {
      const rows = exec();
      return Promise.resolve({ data: rows, error: null }).then(
        onFulfilled,
        onRejected,
      );
    },
  };
  return chain;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET = "test-portal-secret";
const ORG_ID = "org-1";
const TENANT_ID = "tenant-1";

function seedTenantAndOrg(phone: string): void {
  db.tenants.push({
    id: TENANT_ID,
    organization_id: ORG_ID,
    phone_e164: phone,
    created_at: "2026-01-01T00:00:00.000Z",
  });
  db.organizations.push({ id: ORG_ID, odesa_phone_number: "+12025550100" });
}

function seedOtpRow(phone: string, code: string, overrides: Row = {}): Row {
  const row: Row = {
    id: randomUUID(),
    organization_id: ORG_ID,
    tenant_id: TENANT_ID,
    phone_e164: phone,
    code_hash: hashPortalOtpCode(code, SECRET),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    consumed_at: null,
    attempts: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
  db.portal_otps.push(row);
  return row;
}

beforeEach(() => {
  db = {
    tenants: [],
    portal_otps: [],
    messaging_recipient_consents: [],
    organizations: [],
  };
  process.env.PORTAL_SESSION_SECRET = SECRET;
  sendMock.mockReset();
  sendMock.mockResolvedValue({
    ok: true,
    provider: "linq",
    providerMessageId: "pm-1",
    attempted: ["linq"],
    failedOver: false,
  });
});

// ---------------------------------------------------------------------------
// requestPortalOtp
// ---------------------------------------------------------------------------

describe("requestPortalOtp", () => {
  it("should return identical generic success for unknown and multi-org phones without sending", async () => {
    // Unknown phone — nothing on file.
    const unknown = await requestPortalOtp("+15550000001", "ip-unknown");

    // Multi-org phone — same number tenanted in two orgs.
    const phone = "+15550000002";
    db.tenants.push(
      { id: "t-a", organization_id: "org-a", phone_e164: phone },
      { id: "t-b", organization_id: "org-b", phone_e164: phone },
    );
    const multiOrg = await requestPortalOtp(phone, "ip-multi");

    expect(unknown).toEqual({ ok: true });
    expect(multiOrg).toEqual(unknown);
    expect(sendMock).not.toHaveBeenCalled();
    expect(db.portal_otps).toHaveLength(0);
  });

  it("should send one code then honor the 60s resend cooldown", async () => {
    const phone = "+15550000003";
    seedTenantAndOrg(phone);

    const first = await requestPortalOtp(phone, "ip-cd-1");
    const second = await requestPortalOtp(phone, "ip-cd-2");

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(db.portal_otps).toHaveLength(1);
    // The SMS body carries a 6-digit code; the stored row holds only a hash.
    const body = (sendMock.mock.calls[0][1] as { body: string }).body;
    const code = body.match(/\d{6}/)?.[0];
    expect(code).toBeDefined();
    expect(db.portal_otps[0].code_hash).toBe(hashPortalOtpCode(code!, SECRET));
    expect(db.portal_otps[0].code_hash).not.toContain(code);
  });

  it("should trip the 3-per-phone rate limit on the fourth request", async () => {
    const phone = "+15550000004";
    seedTenantAndOrg(phone);

    await requestPortalOtp(phone, "ip-rl-1");
    await requestPortalOtp(phone, "ip-rl-2");
    await requestPortalOtp(phone, "ip-rl-3");
    const fourth = await requestPortalOtp(phone, "ip-rl-4");

    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.error).toMatch(/too many tries/i);
    // Cooldown already capped sends at 1 — the limiter caps the probing.
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("should return generic success without sending when the recipient texted STOP", async () => {
    const phone = "+15550000005";
    seedTenantAndOrg(phone);
    db.messaging_recipient_consents.push({
      organization_id: ORG_ID,
      recipient_e164: phone,
      state: "suppressed",
    });

    const result = await requestPortalOtp(phone, "ip-stop");

    expect(result).toEqual({ ok: true });
    expect(sendMock).not.toHaveBeenCalled();
    expect(db.portal_otps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// confirmPortalOtp
// ---------------------------------------------------------------------------

describe("confirmPortalOtp", () => {
  it("should confirm a valid code, return the identity, and consume the row", async () => {
    const phone = "+15550000010";
    seedTenantAndOrg(phone);
    seedOtpRow(phone, "123456");

    const result = await confirmPortalOtp(phone, "123456");

    expect(result).toEqual({
      ok: true,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    });
    expect(db.portal_otps[0].consumed_at).not.toBeNull();
  });

  it("should reject a consumed row so codes are single-use", async () => {
    const phone = "+15550000011";
    seedOtpRow(phone, "123456", {
      consumed_at: new Date().toISOString(),
    });

    const result = await confirmPortalOtp(phone, "123456");

    expect(result).toEqual({
      ok: false,
      error: "That code didn't work — it may have expired. Send a new one.",
    });
  });

  it("should reject an expired code with the same generic copy", async () => {
    const phone = "+15550000012";
    seedOtpRow(phone, "123456", {
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    const result = await confirmPortalOtp(phone, "123456");

    expect(result).toEqual({
      ok: false,
      error: "That code didn't work — it may have expired. Send a new one.",
    });
  });

  it("should return the identical generic copy for an unknown phone as for a wrong code", async () => {
    const phone = "+15550000013";
    seedOtpRow(phone, "123456");

    const wrongCode = await confirmPortalOtp(phone, "654321");
    const unknownPhone = await confirmPortalOtp("+15550009999", "123456");

    expect(wrongCode).toEqual(unknownPhone);
    expect(wrongCode.ok).toBe(false);
  });

  it("should count wrong attempts and lock the row out after 5", async () => {
    const phone = "+15550000014";
    const row = seedOtpRow(phone, "123456", { attempts: 4 });

    // Fifth wrong attempt — increments to the cap.
    const fifth = await confirmPortalOtp(phone, "000000");
    expect(fifth.ok).toBe(false);
    expect(row.attempts).toBe(5);

    // Locked: even the CORRECT code is refused, the row is consumed, and
    // the copy stays GENERIC — a distinct lockout message would be a
    // phone-enumeration oracle (live rows only exist for known phones).
    const afterLock = await confirmPortalOtp(phone, "123456");
    expect(afterLock).toEqual({
      ok: false,
      error: "That code didn't work — it may have expired. Send a new one.",
    });
    expect(row.consumed_at).not.toBeNull();

    // And the consumed row stays dead.
    const replay = await confirmPortalOtp(phone, "123456");
    expect(replay.ok).toBe(false);
  });
});
