/**
 * Unit tests for `src/lib/portal/pay.ts` — the portal pay flow's money
 * path: server-derived amounts only, nothing-due rejection, double-tap
 * reuse of a pending checkout URL, and fresh mint via
 * `createRentPaymentLink` with the derived balance.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPortalCheckout } from "@/lib/portal/pay";
import type { PortalSession } from "@/lib/portal/session";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface Tables {
  leases?: readonly Row[];
  rent_events?: readonly Row[];
  rent_payments?: readonly Row[];
}

let adminStub: unknown;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminStub,
}));

const createRentPaymentLink = vi.fn();
vi.mock("@/lib/integrations/stripe/payment-link", () => ({
  createRentPaymentLink: (...args: unknown[]) => createRentPaymentLink(...args),
}));

function buildAdminStub(tables: Tables): unknown {
  return { from: (table: keyof Tables) => buildQuery(tables[table] ?? []) };
}

function buildQuery(rows: readonly Row[]): unknown {
  let result = [...rows];
  const chain = {
    select: () => chain,
    eq(col: string, value: unknown) {
      result = result.filter((r) => r[col] === value);
      return chain;
    },
    not(col: string, op: string, value: unknown) {
      if (op === "is" && value === null) {
        result = result.filter((r) => r[col] != null);
      }
      return chain;
    },
    gte(col: string, value: unknown) {
      result = result.filter((r) => (r[col] as string) >= (value as string));
      return chain;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      const ascending = opts?.ascending !== false;
      result = [...result].sort((a, b) => {
        const av = a[col] as string;
        const bv = b[col] as string;
        if (av < bv) return ascending ? -1 : 1;
        if (av > bv) return ascending ? 1 : -1;
        return 0;
      });
      return chain;
    },
    limit(n: number) {
      result = result.slice(0, n);
      return chain;
    },
    maybeSingle: () =>
      Promise.resolve({ data: result[0] ?? null, error: null }),
  };
  return chain;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION: PortalSession = { tenantId: "tenant-1", organizationId: "org-1" };

const LEASE: Row = {
  id: "lease-1",
  tenant_id: "tenant-1",
  organization_id: "org-1",
  status: "active",
  unit_id: "unit-1",
  rent_amount: 1200,
  rent_due_day: 1,
  late_fee_policy: null,
  start_date: "2026-01-01",
  end_date: null,
};

const DUE_EVENT: Row = {
  id: "event-1",
  lease_id: "lease-1",
  organization_id: "org-1",
  cycle_month: "2026-08-01",
  status: "due",
  due_date: "2099-01-01",
  amount_due: 1200,
  amount_paid: 0,
};

const PAID_EVENT: Row = { ...DUE_EVENT, status: "paid", amount_paid: 1200 };

beforeEach(() => {
  createRentPaymentLink.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createPortalCheckout", () => {
  it("should reject with a friendly error when there is no active lease", async () => {
    adminStub = buildAdminStub({});

    const result = await createPortalCheckout(SESSION);

    expect(result.ok).toBe(false);
    expect(createRentPaymentLink).not.toHaveBeenCalled();
  });

  it("should reject when the newest cycle is already paid", async () => {
    adminStub = buildAdminStub({ leases: [LEASE], rent_events: [PAID_EVENT] });

    const result = await createPortalCheckout(SESSION);

    expect(result.ok).toBe(false);
    expect(createRentPaymentLink).not.toHaveBeenCalled();
  });

  it("should reuse an unexpired pending checkout URL instead of minting", async () => {
    adminStub = buildAdminStub({
      leases: [LEASE],
      rent_events: [DUE_EVENT],
      rent_payments: [
        {
          id: "rp-1",
          tenant_id: "tenant-1",
          organization_id: "org-1",
          rent_event_id: "event-1",
          status: "pending",
          amount_cents: 120000,
          payment_link_url: "https://checkout.stripe.com/c/cs_reuse",
          created_at: new Date().toISOString(),
        },
      ],
    });

    const result = await createPortalCheckout(SESSION);

    expect(result).toEqual({
      ok: true,
      url: "https://checkout.stripe.com/c/cs_reuse",
    });
    expect(createRentPaymentLink).not.toHaveBeenCalled();
  });

  it("should mint fresh when the pending link's amount no longer matches the balance", async () => {
    // Link minted at $1,200; a $700 partial was recorded since, so the
    // payable balance is $500 — reusing the old link would overcharge.
    adminStub = buildAdminStub({
      leases: [LEASE],
      rent_events: [{ ...DUE_EVENT, amount_paid: 700 }],
      rent_payments: [
        {
          id: "rp-stale-amount",
          tenant_id: "tenant-1",
          organization_id: "org-1",
          rent_event_id: "event-1",
          status: "pending",
          amount_cents: 120000,
          payment_link_url: "https://checkout.stripe.com/c/cs_overcharge",
          created_at: new Date().toISOString(),
        },
      ],
    });
    createRentPaymentLink.mockResolvedValue({
      ok: true,
      paymentLinkUrl: "https://checkout.stripe.com/c/cs_rebalanced",
      paymentIntentId: "pi_2",
      customerId: "cus_1",
      rentPaymentId: "rp-3",
    });

    const result = await createPortalCheckout(SESSION);

    expect(result).toEqual({
      ok: true,
      url: "https://checkout.stripe.com/c/cs_rebalanced",
    });
    expect(createRentPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 50000 }),
    );
  });

  it("should mint fresh with the derived balance when no reusable row exists", async () => {
    // An EXPIRED pending row (>23h old) must not be reused.
    adminStub = buildAdminStub({
      leases: [LEASE],
      rent_events: [DUE_EVENT],
      rent_payments: [
        {
          id: "rp-stale",
          tenant_id: "tenant-1",
          organization_id: "org-1",
          rent_event_id: "event-1",
          status: "pending",
          amount_cents: 120000,
          payment_link_url: "https://checkout.stripe.com/c/cs_stale",
          created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });
    createRentPaymentLink.mockResolvedValue({
      ok: true,
      paymentLinkUrl: "https://checkout.stripe.com/c/cs_fresh",
      paymentIntentId: "pi_1",
      customerId: "cus_1",
      rentPaymentId: "rp-2",
    });

    const result = await createPortalCheckout(SESSION);

    expect(result).toEqual({
      ok: true,
      url: "https://checkout.stripe.com/c/cs_fresh",
    });
    expect(createRentPaymentLink).toHaveBeenCalledTimes(1);
    expect(createRentPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        tenantId: "tenant-1",
        leaseId: "lease-1",
        amountCents: 120000,
        rentEventId: "event-1",
      }),
    );
  });

  it("should return a friendly error (no machine string) when minting fails", async () => {
    adminStub = buildAdminStub({ leases: [LEASE], rent_events: [DUE_EVENT] });
    createRentPaymentLink.mockResolvedValue({
      ok: false,
      error: "checkout_session_create_failed: boom",
    });

    const result = await createPortalCheckout(SESSION);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toContain("checkout_session_create_failed");
  });
});
