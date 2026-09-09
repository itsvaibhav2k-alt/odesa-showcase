/**
 * Unit tests for `src/lib/portal/queries.ts`.
 *
 * Chainable admin-client stub (style of `tests/tenants/queries.test.ts`)
 * with a frozen clock at 2026-08-05 local time.
 *
 * The headline is THE MANDATORY CROSS-TENANT LEAK TEST: two tenants in
 * one org plus one in another org, with deliberately poisoned rows
 * (right tenant / wrong org, and a NEWER sibling-tenant conversation)
 * — session A must see zero rows of B/C across all four functions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPortalLease,
  getPortalOverview,
  getPortalThread,
  listPortalPayments,
  listPortalWorkOrders,
} from "@/lib/portal/queries";
import type { PortalSession } from "@/lib/portal/session";

// ---------------------------------------------------------------------------
// Admin-client stub
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface Tables {
  tenants?: readonly Row[];
  leases?: readonly Row[];
  units?: readonly Row[];
  properties?: readonly Row[];
  rent_events?: readonly Row[];
  rent_payments?: readonly Row[];
  conversations?: readonly Row[];
  messages?: readonly Row[];
  organizations?: readonly Row[];
  documents?: readonly Row[];
  work_orders?: readonly Row[];
}

let adminStub: unknown;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminStub,
}));

function buildAdminStub(tables: Tables): unknown {
  return {
    from: (table: keyof Tables) => buildQuery(tables[table] ?? []),
    storage: {
      from: () => ({
        createSignedUrl: (path: string) =>
          Promise.resolve({
            data: { signedUrl: `https://signed.example/${path}` },
            error: null,
          }),
      }),
    },
  };
}

function buildQuery(rows: readonly Row[]): unknown {
  let result = [...rows];
  const chain = {
    select() {
      return chain;
    },
    eq(col: string, value: unknown) {
      result = result.filter((r) => r[col] === value);
      return chain;
    },
    in(col: string, values: readonly unknown[]) {
      result = result.filter((r) => values.includes(r[col]));
      return chain;
    },
    not(col: string, op: string, value: unknown) {
      if (op === "is" && value === null) {
        result = result.filter((r) => r[col] != null);
      }
      return chain;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      const ascending = opts?.ascending !== false;
      result = [...result].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if ((av as string) < (bv as string)) return ascending ? -1 : 1;
        if ((av as string) > (bv as string)) return ascending ? 1 : -1;
        return 0;
      });
      return chain;
    },
    limit(n: number) {
      result = result.slice(0, n);
      return chain;
    },
    maybeSingle() {
      return Promise.resolve({ data: result[0] ?? null, error: null });
    },
    then(
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ): Promise<unknown> {
      return Promise.resolve({ data: result, error: null }).then(
        onFulfilled,
        onRejected,
      );
    },
  };
  return chain;
}

// ---------------------------------------------------------------------------
// Fixtures — frozen "today" is 2026-08-05
// ---------------------------------------------------------------------------

const ORG_1 = "org-1";
const ORG_2 = "org-2";

const SESSION_A: PortalSession = { tenantId: "tenant-a", organizationId: ORG_1 };

const TENANTS: Row[] = [
  { id: "tenant-a", organization_id: ORG_1, full_name: "Amara Singh" },
  { id: "tenant-b", organization_id: ORG_1, full_name: "Bruno Diaz" },
  { id: "tenant-c", organization_id: ORG_2, full_name: "Cleo Park" },
];

const LEASES: Row[] = [
  {
    id: "lease-a",
    tenant_id: "tenant-a",
    organization_id: ORG_1,
    unit_id: "unit-a",
    status: "active",
    rent_amount: 1850,
    rent_due_day: 1,
    late_fee_policy: { grace_days: 3, fixed_fee_cents: 5000 },
    start_date: "2025-08-01",
    end_date: "2026-12-31",
  },
  {
    id: "lease-b",
    tenant_id: "tenant-b",
    organization_id: ORG_1,
    unit_id: "unit-b",
    status: "active",
    rent_amount: 999,
    rent_due_day: 5,
    late_fee_policy: {},
    start_date: "2025-09-01",
    end_date: null,
  },
  {
    id: "lease-c",
    tenant_id: "tenant-c",
    organization_id: ORG_2,
    unit_id: "unit-c",
    status: "active",
    rent_amount: 3333,
    rent_due_day: 1,
    late_fee_policy: {},
    start_date: "2025-10-01",
    end_date: null,
  },
  // POISON: right tenant, WRONG org, NEWER start_date. If any lease query
  // drops the organization_id key, this row wins the latest-start sort.
  {
    id: "lease-poison",
    tenant_id: "tenant-a",
    organization_id: ORG_2,
    unit_id: "unit-c",
    status: "active",
    rent_amount: 7777,
    rent_due_day: 15,
    late_fee_policy: {},
    start_date: "2026-05-01",
    end_date: null,
  },
];

const UNITS: Row[] = [
  { id: "unit-a", organization_id: ORG_1, label: "2B", property_id: "prop-1" },
  { id: "unit-b", organization_id: ORG_1, label: "3C", property_id: "prop-1" },
  { id: "unit-c", organization_id: ORG_2, label: "9Z", property_id: "prop-2" },
];

const PROPERTIES: Row[] = [
  {
    id: "prop-1",
    organization_id: ORG_1,
    name: "Ranson Apartments",
    address_street: "428 Ranson St",
  },
  {
    id: "prop-2",
    organization_id: ORG_2,
    name: "Elsewhere Court",
    address_street: "1 Other Way",
  },
];

const RENT_EVENTS: Row[] = [
  // Current cycle for A — due Aug 1, unpaid, today Aug 5 → 4 days late.
  {
    id: "ev-a-aug",
    lease_id: "lease-a",
    organization_id: ORG_1,
    cycle_month: "2026-08-01",
    status: "pending",
    due_date: "2026-08-01",
    amount_due: 1850,
    amount_paid: 0,
  },
  // July: paid via Stripe (rent_payments row below references it).
  {
    id: "ev-a-jul",
    lease_id: "lease-a",
    organization_id: ORG_1,
    cycle_month: "2026-07-01",
    status: "paid",
    due_date: "2026-07-01",
    amount_due: 1850,
    amount_paid: 1850,
  },
  // June: paid but NO Stripe payment → "recorded by your property manager".
  {
    id: "ev-a-jun",
    lease_id: "lease-a",
    organization_id: ORG_1,
    cycle_month: "2026-06-01",
    status: "paid",
    due_date: "2026-06-01",
    amount_due: 1850,
    amount_paid: 1850,
  },
  { // B's cycle — must never surface for A.
    id: "ev-b-aug",
    lease_id: "lease-b",
    organization_id: ORG_1,
    cycle_month: "2026-08-01",
    status: "paid",
    due_date: "2026-08-05",
    amount_due: 999,
    amount_paid: 999,
  },
  // POISON: A's lease id, WRONG org, newer cycle. A missing org key on the
  // rent_events query would make this the "current" cycle.
  {
    id: "ev-poison",
    lease_id: "lease-a",
    organization_id: ORG_2,
    cycle_month: "2026-09-01",
    status: "pending",
    due_date: "2026-09-01",
    amount_due: 7777,
    amount_paid: 7777,
  },
];

const RENT_PAYMENTS: Row[] = [
  {
    id: "pay-a-jul",
    tenant_id: "tenant-a",
    organization_id: ORG_1,
    lease_id: "lease-a",
    rent_event_id: "ev-a-jul",
    amount_cents: 185000,
    paid_at: "2026-07-03T10:00:00Z",
    payment_method_type: "card",
    receipt_url: "https://stripe.example/receipt-a-jul",
  },
  // Older Stripe payment with no rent_event link — still listed.
  {
    id: "pay-a-may",
    tenant_id: "tenant-a",
    organization_id: ORG_1,
    lease_id: "lease-a",
    rent_event_id: null,
    amount_cents: 185000,
    paid_at: "2026-05-02T09:00:00Z",
    payment_method_type: "us_bank_account",
    receipt_url: null,
  },
  // Pending checkout (never paid) — must not show in history.
  {
    id: "pay-a-pending",
    tenant_id: "tenant-a",
    organization_id: ORG_1,
    lease_id: "lease-a",
    rent_event_id: "ev-a-aug",
    amount_cents: 185000,
    paid_at: null,
    payment_method_type: null,
    receipt_url: null,
  },
  { // B's payment — must never surface for A.
    id: "pay-b",
    tenant_id: "tenant-b",
    organization_id: ORG_1,
    lease_id: "lease-b",
    rent_event_id: "ev-b-aug",
    amount_cents: 99900,
    paid_at: "2026-08-04T10:00:00Z",
    payment_method_type: "card",
    receipt_url: "https://stripe.example/receipt-b",
  },
  // POISON: A's tenant id, WRONG org.
  {
    id: "pay-poison",
    tenant_id: "tenant-a",
    organization_id: ORG_2,
    lease_id: "lease-poison",
    rent_event_id: null,
    amount_cents: 777700,
    paid_at: "2026-08-01T10:00:00Z",
    payment_method_type: "card",
    receipt_url: "https://stripe.example/receipt-poison",
  },
];

const CONVERSATIONS: Row[] = [
  {
    id: "conv-a",
    tenant_id: "tenant-a",
    organization_id: ORG_1,
    last_message_at: "2026-08-01T09:30:00Z",
  },
  // B's conversation is NEWER — a query missing the tenant key picks it.
  {
    id: "conv-b",
    tenant_id: "tenant-b",
    organization_id: ORG_1,
    last_message_at: "2026-08-04T18:00:00Z",
  },
  {
    id: "conv-c",
    tenant_id: "tenant-c",
    organization_id: ORG_2,
    last_message_at: "2026-08-05T08:00:00Z",
  },
];

const VISIBLE_A_BODIES = ["Hi, the sink is fixed — thank you!", "Glad to hear it, Amara."];

const MESSAGES: Row[] = [
  {
    id: "msg-a-in",
    conversation_id: "conv-a",
    organization_id: ORG_1,
    direction: "inbound",
    body: VISIBLE_A_BODIES[0],
    draft_status: "auto_sent",
    delivery_status: "delivered",
    sent_at: null,
    created_at: "2026-08-01T09:00:00Z",
  },
  {
    id: "msg-a-out-sent",
    conversation_id: "conv-a",
    organization_id: ORG_1,
    direction: "outbound",
    body: VISIBLE_A_BODIES[1],
    draft_status: "approved",
    delivery_status: "delivered",
    sent_at: "2026-08-01T09:30:00Z",
    created_at: "2026-08-01T09:25:00Z",
  },
  // Unapproved draft — sent_at IS NULL — must NEVER be visible.
  {
    id: "msg-a-draft",
    conversation_id: "conv-a",
    organization_id: ORG_1,
    direction: "outbound",
    body: "DRAFT: proposing a payment plan before owner review",
    draft_status: "pending_review",
    delivery_status: "draft",
    sent_at: null,
    created_at: "2026-08-02T10:00:00Z",
  },
  // Rejected draft — must NEVER be visible.
  {
    id: "msg-a-rejected",
    conversation_id: "conv-a",
    organization_id: ORG_1,
    direction: "outbound",
    body: "REJECTED: too harsh, owner said no",
    draft_status: "rejected",
    delivery_status: "draft",
    sent_at: null,
    created_at: "2026-08-02T11:00:00Z",
  },
  // Sent but delivery failed — must NEVER be visible.
  {
    id: "msg-a-failed",
    conversation_id: "conv-a",
    organization_id: ORG_1,
    direction: "outbound",
    body: "FAILED: this never reached the tenant",
    draft_status: "approved",
    delivery_status: "failed",
    sent_at: "2026-08-03T09:00:00Z",
    created_at: "2026-08-03T09:00:00Z",
  },
  { // B's message.
    id: "msg-b",
    conversation_id: "conv-b",
    organization_id: ORG_1,
    direction: "inbound",
    body: "Bruno's private message",
    draft_status: "auto_sent",
    delivery_status: "delivered",
    sent_at: null,
    created_at: "2026-08-04T18:00:00Z",
  },
  // POISON: A's conversation id, WRONG org.
  {
    id: "msg-poison",
    conversation_id: "conv-a",
    organization_id: ORG_2,
    direction: "inbound",
    body: "Cross-org poison message",
    draft_status: "auto_sent",
    delivery_status: "delivered",
    sent_at: null,
    created_at: "2026-08-04T20:00:00Z",
  },
];

const ORGANIZATIONS: Row[] = [
  { id: ORG_1, odesa_phone_number: "+12025550100" },
  { id: ORG_2, odesa_phone_number: "+15550009999" },
];

const DOCUMENTS: Row[] = [
  {
    id: "doc-a",
    organization_id: ORG_1,
    lease_id: "lease-a",
    type: "lease",
    file_key: "org-1/lease-a.pdf",
    created_at: "2025-08-01T00:00:00Z",
  },
  // POISON: A's lease id, WRONG org, newer.
  {
    id: "doc-poison",
    organization_id: ORG_2,
    lease_id: "lease-a",
    type: "lease",
    file_key: "org-2/poison.pdf",
    created_at: "2026-01-01T00:00:00Z",
  },
];

const WORK_ORDERS: Row[] = [
  {
    id: "wo-a-new",
    tenant_id: "tenant-a",
    organization_id: ORG_1,
    unit_id: "unit-a",
    category: "plumbing",
    urgency: "urgent",
    status: "open",
    description: "Kitchen sink is leaking under the cabinet",
    created_at: "2026-08-04T09:00:00Z",
    // Vendor fields exist on the row but must NEVER be selected/exposed.
    vendor_id: "vendor-1",
    vendor_response: "accepted",
  },
  {
    id: "wo-a-old",
    tenant_id: "tenant-a",
    organization_id: ORG_1,
    unit_id: "unit-a",
    category: "hvac",
    urgency: "routine",
    status: "completed",
    description: "AC filter replacement",
    created_at: "2026-06-10T09:00:00Z",
    vendor_id: "vendor-2",
    vendor_response: "accepted",
  },
  { // B's work order — must never surface for A.
    id: "wo-b",
    tenant_id: "tenant-b",
    organization_id: ORG_1,
    unit_id: "unit-b",
    category: "electrical",
    urgency: "emergency",
    status: "open",
    description: "Bruno's private outage",
    created_at: "2026-08-05T09:00:00Z",
    vendor_id: null,
    vendor_response: null,
  },
  // POISON: A's tenant id, WRONG org, newest of all. A missing org key
  // would put this row first.
  {
    id: "wo-poison",
    tenant_id: "tenant-a",
    organization_id: ORG_2,
    unit_id: "unit-c",
    category: "other",
    urgency: "emergency",
    status: "open",
    description: "Cross-org poison work order",
    created_at: "2026-08-05T12:00:00Z",
    vendor_id: null,
    vendor_response: null,
  },
];

const ALL_TABLES: Tables = {
  tenants: TENANTS,
  leases: LEASES,
  units: UNITS,
  properties: PROPERTIES,
  rent_events: RENT_EVENTS,
  rent_payments: RENT_PAYMENTS,
  conversations: CONVERSATIONS,
  messages: MESSAGES,
  organizations: ORGANIZATIONS,
  documents: DOCUMENTS,
  work_orders: WORK_ORDERS,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 5, 12, 0, 0)); // 2026-08-05 local
  adminStub = buildAdminStub(ALL_TABLES);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Cross-tenant leak test — the mandatory privacy invariant
// ---------------------------------------------------------------------------

describe("portal queries", () => {
  describe("cross-tenant isolation", () => {
    it("should show session A only A's overview — never the poisoned cross-org lease or cycle", async () => {
      const overview = await getPortalOverview(SESSION_A);

      expect(overview.hasActiveLease).toBe(true);
      if (!overview.hasActiveLease) return;
      expect(overview.firstName).toBe("Amara");
      expect(overview.addressLine).toBe("428 Ranson St · Unit 2B");
      expect(overview.rentAmountDollars).toBe(1850); // not 7777 (poison) / 999 (B)
      expect(overview.cycle?.cycleMonth).toBe("2026-08-01"); // not poison Sep
      expect(overview.cycle?.amountDueDollars).toBe(1850);
    });

    it("should show session A zero payment rows of B or the cross-org poison", async () => {
      const entries = await listPortalPayments(SESSION_A);

      const amounts = entries.map((e) => e.amountDollars);
      expect(amounts).not.toContain(999); // B's payment/cycle
      expect(amounts).not.toContain(7777); // cross-org poison payment + cycle
      const receipts = entries
        .filter((e) => e.kind === "stripe")
        .map((e) => e.receiptUrl);
      expect(receipts).not.toContain("https://stripe.example/receipt-b");
      expect(receipts).not.toContain("https://stripe.example/receipt-poison");
    });

    it("should show session A only A's lease and never sign the cross-org document", async () => {
      const lease = await getPortalLease(SESSION_A);

      expect(lease).not.toBeNull();
      expect(lease!.rentAmountDollars).toBe(1850);
      expect(lease!.dueDay).toBe(1);
      expect(lease!.addressLine).toBe("428 Ranson St · Unit 2B");
      expect(lease!.documentUrl).toBe("https://signed.example/org-1/lease-a.pdf");
      expect(lease!.documentUrl).not.toContain("poison");
    });

    it("should show session A only A's thread even though B's conversation is newer", async () => {
      const thread = await getPortalThread(SESSION_A);

      const bodies = thread.messages.map((m) => m.body);
      expect(bodies).toEqual(VISIBLE_A_BODIES);
      expect(bodies).not.toContain("Bruno's private message");
      expect(bodies).not.toContain("Cross-org poison message");
    });

    it("should show session A only A's work orders — never B's or the newer cross-org poison", async () => {
      const orders = await listPortalWorkOrders(SESSION_A);

      expect(orders.map((o) => o.id)).toEqual(["wo-a-new", "wo-a-old"]);
      const descriptions = orders.map((o) => o.description);
      expect(descriptions).not.toContain("Bruno's private outage");
      expect(descriptions).not.toContain("Cross-org poison work order");
    });

    it("should show sibling tenant B only B's data with the same fixture", async () => {
      const sessionB: PortalSession = {
        tenantId: "tenant-b",
        organizationId: ORG_1,
      };

      const [overview, payments, thread] = await Promise.all([
        getPortalOverview(sessionB),
        listPortalPayments(sessionB),
        getPortalThread(sessionB),
      ]);

      expect(overview.hasActiveLease).toBe(true);
      if (overview.hasActiveLease) {
        expect(overview.rentAmountDollars).toBe(999);
      }
      expect(payments.map((e) => e.amountDollars)).toEqual([999]);
      expect(thread.messages.map((m) => m.body)).toEqual([
        "Bruno's private message",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // getPortalOverview
  // -------------------------------------------------------------------------

  describe("getPortalOverview", () => {
    it("should derive the current cycle as late with the canonical balance", async () => {
      // Due Aug 1, unpaid, today Aug 5 → 4 days late, $1,850 balance.
      const overview = await getPortalOverview(SESSION_A);

      if (!overview.hasActiveLease) throw new Error("expected active lease");
      expect(overview.cycle?.status.isLate).toBe(true);
      expect(overview.cycle?.status.daysLate).toBe(4);
      expect(overview.cycle?.balanceDollars).toBe(1850);
      expect(overview.cycle?.dueDate).toBe("2026-08-01");
    });

    it("should return the no-active-lease marker when the tenant has no active lease", async () => {
      adminStub = buildAdminStub({
        ...ALL_TABLES,
        leases: LEASES.filter((l) => l.id !== "lease-a"),
      });

      const overview = await getPortalOverview(SESSION_A);

      expect(overview).toEqual({ hasActiveLease: false, firstName: "Amara" });
    });
  });

  // -------------------------------------------------------------------------
  // listPortalPayments
  // -------------------------------------------------------------------------

  describe("listPortalPayments", () => {
    it("should interleave Stripe payments and manager-recorded cycles newest first", async () => {
      const entries = await listPortalPayments(SESSION_A);

      expect(
        entries.map((e) =>
          e.kind === "stripe" ? `stripe:${e.paidAt}` : `recorded:${e.cycleMonth}`,
        ),
      ).toEqual([
        "stripe:2026-07-03T10:00:00Z",
        "recorded:2026-06-01",
        "stripe:2026-05-02T09:00:00Z",
      ]);
    });

    it("should not duplicate a Stripe-paid cycle as a recorded entry", async () => {
      const entries = await listPortalPayments(SESSION_A);

      const recordedMonths = entries
        .filter((e) => e.kind === "recorded")
        .map((e) => e.cycleMonth);
      expect(recordedMonths).toEqual(["2026-06-01"]); // ev-a-jul is Stripe-paid
    });

    it("should hide pending checkout rows that were never paid", async () => {
      const entries = await listPortalPayments(SESSION_A);

      expect(entries.filter((e) => e.kind === "stripe")).toHaveLength(2);
    });

    it("should carry method and receipt on Stripe entries", async () => {
      const entries = await listPortalPayments(SESSION_A);

      const jul = entries.find(
        (e) => e.kind === "stripe" && e.paidAt === "2026-07-03T10:00:00Z",
      );
      expect(jul).toMatchObject({
        amountDollars: 1850,
        method: "card",
        receiptUrl: "https://stripe.example/receipt-a-jul",
      });
    });
  });

  // -------------------------------------------------------------------------
  // getPortalLease
  // -------------------------------------------------------------------------

  describe("getPortalLease", () => {
    it("should return terms, late-fee policy, and dates from the active lease", async () => {
      const lease = await getPortalLease(SESSION_A);

      expect(lease).toMatchObject({
        rentAmountDollars: 1850,
        dueDay: 1,
        graceDays: 3,
        lateFeeDollars: 50,
        startDate: "2025-08-01",
        endDate: "2026-12-31",
      });
    });

    it("should return null when there is no active lease", async () => {
      adminStub = buildAdminStub({
        ...ALL_TABLES,
        leases: LEASES.filter((l) => l.id !== "lease-a"),
      });

      expect(await getPortalLease(SESSION_A)).toBeNull();
    });

    it("should omit the document link when no lease document exists", async () => {
      adminStub = buildAdminStub({ ...ALL_TABLES, documents: [] });

      const lease = await getPortalLease(SESSION_A);

      expect(lease!.documentUrl).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // listPortalWorkOrders
  // -------------------------------------------------------------------------

  describe("listPortalWorkOrders", () => {
    it("should list the tenant's requests newest first with mapped fields", async () => {
      const orders = await listPortalWorkOrders(SESSION_A);

      expect(orders).toHaveLength(2);
      expect(orders[0]).toEqual({
        id: "wo-a-new",
        description: "Kitchen sink is leaking under the cabinet",
        category: "plumbing",
        urgency: "urgent",
        status: "open",
        createdAt: "2026-08-04T09:00:00Z",
      });
      expect(orders[1].status).toBe("completed");
    });

    it("should never expose vendor fields even when the row carries them", async () => {
      const orders = await listPortalWorkOrders(SESSION_A);

      for (const order of orders) {
        const keys = Object.keys(order);
        expect(keys.some((k) => k.toLowerCase().includes("vendor"))).toBe(false);
        expect(keys.sort()).toEqual(
          ["id", "description", "category", "urgency", "status", "createdAt"].sort(),
        );
      }
    });

    it("should return an empty list when the tenant has no work orders", async () => {
      adminStub = buildAdminStub({ ...ALL_TABLES, work_orders: [] });

      expect(await listPortalWorkOrders(SESSION_A)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getPortalThread
  // -------------------------------------------------------------------------

  describe("getPortalThread", () => {
    it("should never include unapproved drafts, rejected drafts, or failed sends", async () => {
      const thread = await getPortalThread(SESSION_A);

      const bodies = thread.messages.map((m) => m.body);
      expect(bodies.some((b) => b.startsWith("DRAFT:"))).toBe(false);
      expect(bodies.some((b) => b.startsWith("REJECTED:"))).toBe(false);
      expect(bodies.some((b) => b.startsWith("FAILED:"))).toBe(false);
      expect(bodies).toEqual(VISIBLE_A_BODIES);
    });

    it("should mark inbound messages as fromYou and order oldest to newest", async () => {
      const thread = await getPortalThread(SESSION_A);

      expect(thread.messages.map((m) => m.fromYou)).toEqual([true, false]);
      const times = thread.messages.map((m) => m.sentAt);
      expect([...times].sort()).toEqual(times);
    });

    it("should return the org's Odesa number for the Text-us link", async () => {
      const thread = await getPortalThread(SESSION_A);

      expect(thread.textUsNumber).toBe("+12025550100");
    });

    it("should be null-safe when the org has no Odesa number and no conversation exists", async () => {
      adminStub = buildAdminStub({
        ...ALL_TABLES,
        conversations: [],
        organizations: [{ id: ORG_1, odesa_phone_number: null }],
      });

      const thread = await getPortalThread(SESSION_A);

      expect(thread.messages).toEqual([]);
      expect(thread.textUsNumber).toBeNull();
    });
  });
});
