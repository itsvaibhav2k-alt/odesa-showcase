/**
 * Tenant-portal read queries — the ONE data choke point for /portal pages.
 *
 * Every function takes the verified {@link PortalSession} from
 * `./session.ts` and reads through the admin client, so EVERY query here
 * double-keys on `(tenant_id | lease scope, organization_id)`. Portal
 * pages import only from `src/lib/portal/*` — never the admin client
 * directly — which makes "never leak another tenant's data" a property
 * of this module instead of a convention across many.
 *
 * Query style mirrors `src/lib/tenants/queries.ts`: explicit columns,
 * follow-up `.in()` queries (no PostgREST embeds), and the canonical
 * `@/lib/domain` derivations with `localTodayIso()` computed once at the
 * IO boundary. View-model types are consumer-oriented (dollars, plain
 * facts) — copy lives in the pages.
 */

import { DOCUMENTS_BUCKET } from "@/lib/documents/upload";
import {
  rentCycleFromRow,
  type DerivedRentCycleStatus,
} from "@/lib/domain";
import { createAdminClient } from "@/lib/supabase/admin";

import type { PortalSession } from "./session";

export type AdminClient = ReturnType<typeof createAdminClient>;

/** Signed lease-document links stay valid for an hour. */
const DOCUMENT_URL_TTL_SECONDS = 60 * 60;

/** Most recent messages shown in the portal thread. */
const THREAD_MESSAGE_LIMIT = 50;

/**
 * Outbound rows in these delivery states never reached the tenant —
 * showing them would present a failed/suppressed send as a real reply.
 */
const HIDDEN_DELIVERY_STATUSES: ReadonlySet<string> = new Set([
  "failed",
  "undelivered",
  "suppressed",
]);

/** Draft states that must never be visible to the tenant. */
const HIDDEN_DRAFT_STATUSES: ReadonlySet<string> = new Set([
  "pending_review",
  "rejected",
]);

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

/** The tenant's current rent cycle, derived once via `@/lib/domain`. */
export interface PortalRentCycle {
  /** The underlying rent_events row — the pay flow links payments to it. */
  rentEventId: string;
  /** ISO first-of-month, e.g. "2026-08-01". */
  cycleMonth: string;
  /** Next due date (ISO day) or null when the cycle has none. */
  dueDate: string | null;
  amountDueDollars: number;
  balanceDollars: number;
  /** Canonical derived status — pages read paid/due/late from here. */
  status: DerivedRentCycleStatus;
}

/**
 * Home-page overview. `hasActiveLease: false` is the marker the page
 * renders as the friendly "contact your property manager" state.
 */
export type PortalOverview =
  | { hasActiveLease: false; firstName: string }
  | {
      hasActiveLease: true;
      firstName: string;
      /** "428 Ranson St · Unit 2B" (falls back to the property name). */
      addressLine: string | null;
      rentAmountDollars: number;
      /** Null when no rent cycle exists yet. */
      cycle: PortalRentCycle | null;
    };

/**
 * One payment-history entry. `stripe` rows are real card payments with a
 * receipt; `recorded` rows are month-granularity cycles the property
 * manager marked paid outside Stripe.
 */
export type PortalPaymentEntry =
  | {
      kind: "stripe";
      amountDollars: number;
      /** ISO timestamp. */
      paidAt: string;
      method: string | null;
      receiptUrl: string | null;
    }
  | {
      kind: "recorded";
      amountDollars: number;
      /** ISO first-of-month — month granularity only. */
      cycleMonth: string;
    };

/** Lease terms + a short-lived signed link to the lease document. */
export interface PortalLease {
  rentAmountDollars: number;
  /** Day of the month rent is due (1–31). */
  dueDay: number;
  graceDays: number | null;
  lateFeeDollars: number | null;
  startDate: string | null;
  endDate: string | null;
  addressLine: string | null;
  /** Signed URL for the lease PDF, or null when none is on file. */
  documentUrl: string | null;
}

/** One tenant-visible message. `fromYou` = the tenant sent it. */
export interface PortalThreadMessage {
  id: string;
  fromYou: boolean;
  body: string;
  /** ISO timestamp (sent_at, falling back to created_at). */
  sentAt: string;
}

export interface PortalThread {
  /** Oldest → newest, only inbound or approved-and-sent outbound. */
  messages: PortalThreadMessage[];
  /** The property's Odesa number for the "Text us" sms: link. */
  textUsNumber: string | null;
}

/**
 * One maintenance request. Raw enum values — the page owns the consumer
 * status/category copy. NO vendor fields exist on this shape (and none
 * are ever selected): vendor contact info must never reach a tenant.
 */
export interface PortalWorkOrder {
  id: string;
  description: string;
  category: string;
  urgency: string;
  /** Raw work_order_status ("open", "in_progress", …). */
  status: string;
  /** ISO timestamp. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Local-time YYYY-MM-DD for "today" — computed ONCE at the IO boundary
 * and passed into the pure domain derivations (no hidden clock in the
 * domain module). Mirrors `src/lib/tenants/queries.ts`.
 */
export function localTodayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Numeric dollars (number or Supabase string numeric) → number, else 0. */
function toDollars(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const dollars = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(dollars) ? dollars : 0;
}

/** Reads a finite numeric field out of a jsonb policy blob, else null. */
function readNumberField(policy: unknown, key: string): number | null {
  if (!policy || typeof policy !== "object") return null;
  const value = (policy as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface ActiveLeaseRow {
  id: string;
  unit_id: string;
  rent_amount: number;
  rent_due_day: number;
  late_fee_policy: unknown;
  start_date: string | null;
  end_date: string | null;
}

/**
 * The tenant's active lease — latest `start_date` wins when several are
 * active (staff-brief convention). Null when the tenant has none.
 */
export async function fetchActiveLease(
  admin: AdminClient,
  session: PortalSession,
): Promise<ActiveLeaseRow | null> {
  const { data } = await admin
    .from("leases")
    .select(
      "id, unit_id, rent_amount, rent_due_day, late_fee_policy, start_date, end_date",
    )
    .eq("tenant_id", session.tenantId)
    .eq("organization_id", session.organizationId)
    .eq("status", "active")
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * "428 Ranson St · Unit 2B" for the lease's unit — street address first,
 * property name as fallback. Null-safe when the unit/property rows are
 * missing (the page shows nothing rather than a wrong address).
 */
async function fetchAddressLine(
  admin: AdminClient,
  session: PortalSession,
  unitId: string,
): Promise<string | null> {
  const { data: unit } = await admin
    .from("units")
    .select("id, label, property_id")
    .eq("id", unitId)
    .eq("organization_id", session.organizationId)
    .maybeSingle();
  if (!unit) return null;

  const { data: property } = await admin
    .from("properties")
    .select("id, name, address_street")
    .eq("id", unit.property_id)
    .eq("organization_id", session.organizationId)
    .maybeSingle();
  if (!property) return null;

  const where = property.address_street?.trim() || property.name;
  return `${where} · Unit ${unit.label}`;
}

/** Newest rent cycle on the lease, derived through `@/lib/domain`. */
export async function fetchCurrentCycle(
  admin: AdminClient,
  session: PortalSession,
  leaseId: string,
  todayIso: string,
): Promise<PortalRentCycle | null> {
  const { data: event } = await admin
    .from("rent_events")
    .select("id, cycle_month, status, due_date, amount_due, amount_paid")
    .eq("lease_id", leaseId)
    .eq("organization_id", session.organizationId)
    .order("cycle_month", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!event) return null;

  const status = rentCycleFromRow(event, todayIso);
  return {
    rentEventId: event.id,
    cycleMonth: event.cycle_month,
    dueDate: event.due_date,
    amountDueDollars: toDollars(event.amount_due),
    balanceDollars: status.balanceCents / 100,
    status,
  };
}

// ---------------------------------------------------------------------------
// getPortalOverview
// ---------------------------------------------------------------------------

/**
 * Home-page overview: first name, address line, and the current rent
 * cycle. Returns the `hasActiveLease: false` marker when the tenant has
 * no active lease.
 */
export async function getPortalOverview(
  session: PortalSession,
): Promise<PortalOverview> {
  const admin = createAdminClient();
  const todayIso = localTodayIso();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, full_name")
    .eq("id", session.tenantId)
    .eq("organization_id", session.organizationId)
    .maybeSingle();
  const firstName = tenant?.full_name.split(/\s+/)[0] ?? "";

  const lease = await fetchActiveLease(admin, session);
  if (!lease) return { hasActiveLease: false, firstName };

  const [addressLine, cycle] = await Promise.all([
    fetchAddressLine(admin, session, lease.unit_id),
    fetchCurrentCycle(admin, session, lease.id, todayIso),
  ]);

  return {
    hasActiveLease: true,
    firstName,
    addressLine,
    rentAmountDollars: toDollars(lease.rent_amount),
    cycle,
  };
}

// ---------------------------------------------------------------------------
// listPortalPayments
// ---------------------------------------------------------------------------

/**
 * Payment history, newest first: real Stripe payments (amount, paid_at,
 * method, receipt) interleaved with month-level cycles that carry a paid
 * amount but no Stripe payment — those were recorded by the property
 * manager and only have month granularity.
 */
export async function listPortalPayments(
  session: PortalSession,
): Promise<PortalPaymentEntry[]> {
  const admin = createAdminClient();

  const { data: paymentRows } = await admin
    .from("rent_payments")
    .select("amount_cents, paid_at, payment_method_type, receipt_url, rent_event_id")
    .eq("tenant_id", session.tenantId)
    .eq("organization_id", session.organizationId)
    .not("paid_at", "is", null)
    .order("paid_at", { ascending: false });
  const payments = paymentRows ?? [];

  // Cycles across ALL the tenant's leases (history spans past leases too).
  const { data: leaseRows } = await admin
    .from("leases")
    .select("id")
    .eq("tenant_id", session.tenantId)
    .eq("organization_id", session.organizationId);
  const leaseIds = (leaseRows ?? []).map((l) => l.id);

  const paidEventIds = new Set(
    payments.map((p) => p.rent_event_id).filter(Boolean),
  );

  let recorded: Array<{ cycle_month: string; amount_paid: number | string | null }> =
    [];
  if (leaseIds.length > 0) {
    const { data: events } = await admin
      .from("rent_events")
      .select("id, cycle_month, amount_paid")
      .in("lease_id", leaseIds)
      .eq("organization_id", session.organizationId)
      .order("cycle_month", { ascending: false });
    recorded = (events ?? []).filter(
      (e) => toDollars(e.amount_paid) > 0 && !paidEventIds.has(e.id),
    );
  }

  const entries: PortalPaymentEntry[] = [
    ...payments.map(
      (p): PortalPaymentEntry => ({
        kind: "stripe",
        amountDollars: p.amount_cents / 100,
        // .not("paid_at", "is", null) above guarantees paid_at.
        paidAt: p.paid_at ?? "",
        method: p.payment_method_type,
        receiptUrl: p.receipt_url,
      }),
    ),
    ...recorded.map(
      (e): PortalPaymentEntry => ({
        kind: "recorded",
        amountDollars: toDollars(e.amount_paid),
        cycleMonth: e.cycle_month,
      }),
    ),
  ];

  // ISO strings compare chronologically; a month-only key sorts with the
  // timestamps at day-one granularity, which is as honest as the data.
  const sortKey = (entry: PortalPaymentEntry): string =>
    entry.kind === "stripe" ? entry.paidAt : entry.cycleMonth;
  return entries.sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1));
}

// ---------------------------------------------------------------------------
// getPortalLease
// ---------------------------------------------------------------------------

/**
 * Lease terms + address + a signed link to the newest lease document.
 * Null when the tenant has no active lease (friendly page state).
 */
export async function getPortalLease(
  session: PortalSession,
): Promise<PortalLease | null> {
  const admin = createAdminClient();

  const lease = await fetchActiveLease(admin, session);
  if (!lease) return null;

  const [addressLine, documentUrl] = await Promise.all([
    fetchAddressLine(admin, session, lease.unit_id),
    fetchLeaseDocumentUrl(admin, session, lease.id),
  ]);

  return {
    rentAmountDollars: toDollars(lease.rent_amount),
    dueDay: lease.rent_due_day,
    graceDays: readNumberField(lease.late_fee_policy, "grace_days"),
    lateFeeDollars: (() => {
      const cents = readNumberField(lease.late_fee_policy, "fixed_fee_cents");
      return cents == null ? null : cents / 100;
    })(),
    startDate: lease.start_date,
    endDate: lease.end_date,
    addressLine,
    documentUrl,
  };
}

/**
 * Short-lived signed URL for the newest lease document on the lease.
 * Null when no document (or file) exists, or signing fails — the page
 * simply omits the download link.
 */
async function fetchLeaseDocumentUrl(
  admin: AdminClient,
  session: PortalSession,
  leaseId: string,
): Promise<string | null> {
  const { data: doc } = await admin
    .from("documents")
    .select("id, file_key")
    .eq("lease_id", leaseId)
    .eq("organization_id", session.organizationId)
    .eq("type", "lease")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!doc?.file_key) return null;

  const { data, error } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.file_key, DOCUMENT_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// listPortalWorkOrders
// ---------------------------------------------------------------------------

/**
 * The tenant's maintenance requests, newest first. Explicit columns only
 * — never vendor_id or any vendor contact/response fields.
 */
export async function listPortalWorkOrders(
  session: PortalSession,
): Promise<PortalWorkOrder[]> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("work_orders")
    .select("id, description, category, urgency, status, created_at")
    .eq("tenant_id", session.tenantId)
    .eq("organization_id", session.organizationId)
    .order("created_at", { ascending: false });

  return (data ?? []).map(
    (w): PortalWorkOrder => ({
      id: w.id,
      description: w.description ?? "",
      category: w.category,
      urgency: w.urgency,
      status: w.status,
      createdAt: w.created_at,
    }),
  );
}

// ---------------------------------------------------------------------------
// getPortalThread
// ---------------------------------------------------------------------------

interface ThreadMessageRow {
  id: string;
  direction: string;
  body: string | null;
  draft_status: string;
  delivery_status: string;
  sent_at: string | null;
  created_at: string;
}

/**
 * A message is tenant-visible iff it's inbound, or outbound that was
 * actually approved AND sent AND not a delivery error. Unapproved /
 * rejected drafts (outbound with `sent_at IS NULL`) and failed sends
 * must NEVER appear in the portal.
 */
function isTenantVisible(m: ThreadMessageRow): boolean {
  if (!m.body) return false;
  if (m.direction === "inbound") return true;
  if (m.sent_at === null) return false;
  if (HIDDEN_DRAFT_STATUSES.has(m.draft_status)) return false;
  if (HIDDEN_DELIVERY_STATUSES.has(m.delivery_status)) return false;
  return true;
}

/**
 * The tenant's newest conversation, filtered to tenant-visible messages,
 * plus the org's Odesa number for the "Text us" sms: link (null-safe).
 */
export async function getPortalThread(
  session: PortalSession,
): Promise<PortalThread> {
  const admin = createAdminClient();

  const [{ data: conversation }, { data: org }] = await Promise.all([
    admin
      .from("conversations")
      .select("id, last_message_at")
      .eq("tenant_id", session.tenantId)
      .eq("organization_id", session.organizationId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("organizations")
      .select("id, odesa_phone_number")
      .eq("id", session.organizationId)
      .maybeSingle(),
  ]);

  const textUsNumber = org?.odesa_phone_number ?? null;
  if (!conversation) return { messages: [], textUsNumber };

  const { data: messageRows } = await admin
    .from("messages")
    .select("id, direction, body, draft_status, delivery_status, sent_at, created_at")
    .eq("conversation_id", conversation.id)
    .eq("organization_id", session.organizationId)
    .order("created_at", { ascending: false })
    .limit(THREAD_MESSAGE_LIMIT);

  const messages = (messageRows ?? [])
    .filter(isTenantVisible)
    .reverse() // fetched newest-first for the limit; render oldest → newest
    .map(
      (m): PortalThreadMessage => ({
        id: m.id,
        fromYou: m.direction === "inbound",
        body: m.body ?? "",
        sentAt: m.sent_at ?? m.created_at,
      }),
    );

  return { messages, textUsNumber };
}
