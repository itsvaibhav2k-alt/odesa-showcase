/**
 * Conversation queries for the redesigned `/inbox` surface — wave 4.
 *
 * The wave-3 inbox was an approval queue (Needs Judgment / Ready to Send /
 * Sent Today). Inbox is now the conversation evidence surface and manual
 * outlet; tenant-facing AI drafts remain review-first, with Owner Queue as
 * the canonical commitment ledger.
 *
 * RLS-aware reads: every call uses the SSR (auth-cookie-bound) supabase
 * client passed in by the caller. The caller MUST pass the client
 * returned from `createServerClient()`, never the admin one, so RLS
 * scopes results to the signed-in user's org.
 *
 * Three exports:
 *
 *   - `listConversations` → left-rail rows. One row per conversation,
 *     ordered by `last_message_at desc`. Each row carries the latest
 *     message preview and a `pendingDraftId` if a `pending_review`
 *     outbound draft exists for that conversation.
 *
 *   - `getConversation`   → full thread for one conversation. Returns
 *     tenant context + every message (asc) + the pending draft (if any)
 *     so the right-pane viewer can render bubbles + the inline
 *     "AI suggested" card.
 *
 *   - `getActivitySummary` → the small monitor strip at the top of the
 *     thread column (handled today and drafts awaiting review).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getCaseContext, type CaseContext } from "@/lib/inbox/case-context";
import { getDraftsAwaitingReviewCount } from "@/lib/operator/counts";
import type { Database } from "@/types/database";

type ServerSupabase = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConversationListItem {
  id: string;
  tenantId: string | null;
  tenantName: string;
  unitLabel: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastMessageDirection: "inbound" | "outbound";
  pendingDraftId: string | null;
}

export interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  draftStatus:
    | "auto_sent"
    | "sent_by_human"
    | "pending_review"
    | "rejected"
    | "approved"
    | "sending";
  createdAt: string;
  sentAt: string | null;
  deliveryStatus:
    | "draft"
    | "approved"
    | "queued"
    | "provider_accepted"
    | "delivered"
    | "undelivered"
    | "failed"
    | "suppressed";
}

export interface ConversationDetail {
  id: string;
  tenant: {
    id: string | null;
    name: string;
    phoneE164: string | null;
    badge: string | null;
    propertyName: string | null;
    unitLabel: string | null;
    bedBath: string | null;
    currentRent: string | null;
  };
  messages: ThreadMessage[];
  pendingDraft: { id: string; body: string; reasoning: string | null } | null;
  /**
   * Operator-facing case context: lease, payment history, most-relevant
   * work order with primary + backup vendor. Always present; for unknown
   * SMS senders (`tenant.id === null`) this is the canonical empty
   * shape from `emptyCaseContext()` rather than null, so the case-file
   * column can render without branching.
   */
  caseContext: CaseContext;
  /** ISO timestamp the thread is snoozed until, or null when not snoozed. */
  snoozedUntil: string | null;
  /** True when `snoozedUntil` is set and still in the future (computed server-side). */
  snoozedActive: boolean;
  /** True when the operator has muted the thread (no count / no escalation). */
  muted: boolean;
}

export interface ActivitySummary {
  aiSentToday: number;
  pendingReviewCount: number;
  organizationId: string;
}

// ---------------------------------------------------------------------------
// listConversations
// ---------------------------------------------------------------------------

/**
 * Returns one row per conversation visible to the caller, ordered by
 * `last_message_at desc`. Each row is enriched with the latest
 * message preview, the tenant name + active-lease unit label, and a
 * `pendingDraftId` if a `pending_review` outbound exists.
 */
export async function listConversations(
  supabase: ServerSupabase,
): Promise<ConversationListItem[]> {
  const { data: convs } = await supabase
    .from("conversations")
    .select("id, tenant_id, last_message_at")
    .order("last_message_at", { ascending: false, nullsFirst: false });

  if (!convs || convs.length === 0) return [];

  const conversationIds = convs.map((c) => c.id);
  const tenantIds = uniqStrings(convs.map((c) => c.tenant_id));

  const [tenantMap, latestMessages, pendingDrafts] = await Promise.all([
    fetchTenantMap(supabase, tenantIds),
    fetchLatestMessages(supabase, conversationIds),
    fetchPendingDrafts(supabase, conversationIds),
  ]);

  const items: ConversationListItem[] = [];
  for (const c of convs) {
    const latest = latestMessages.get(c.id);
    if (!latest) continue;
    const tenant = c.tenant_id ? tenantMap.get(c.tenant_id) : undefined;
    const fallbackName = tenant?.phoneE164
      ? `Unknown ${tenant.phoneE164}`
      : "Unknown tenant";
    items.push({
      id: c.id,
      tenantId: c.tenant_id ?? null,
      tenantName: tenant?.name ?? fallbackName,
      unitLabel: tenant?.unitLabel ?? null,
      lastMessageAt: latest.createdAt,
      lastMessagePreview: previewBody(latest.body),
      lastMessageDirection: latest.direction,
      pendingDraftId: pendingDrafts.get(c.id) ?? null,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// getConversation
// ---------------------------------------------------------------------------

/**
 * Loads the full thread for one conversation. Returns `null` when the
 * conversation is invisible (RLS) or missing. Messages are returned
 * ascending so the UI can paint them top-to-bottom.
 */
export async function getConversation(
  supabase: ServerSupabase,
  conversationId: string,
): Promise<ConversationDetail | null> {
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, tenant_id, snoozed_until, muted")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return null;

  const [tenantContext, rows, caseContext] = await Promise.all([
    conv.tenant_id ? fetchTenantContext(supabase, conv.tenant_id) : null,
    supabase
      .from("messages")
      .select(
        "id, direction, body, draft_status, created_at, sent_at, delivery_status",
      )
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true }),
    getCaseContext(supabase, conv.tenant_id ?? null),
  ]);

  const allRows = rows.data ?? [];
  const messages: ThreadMessage[] = allRows
    .filter((r) => r.draft_status !== "rejected")
    .map(
      (r): ThreadMessage => ({
        id: r.id,
        direction: r.direction as "inbound" | "outbound",
        body: r.body ?? "",
        draftStatus: r.draft_status as ThreadMessage["draftStatus"],
        createdAt: r.created_at ?? "",
        sentAt: r.sent_at ?? null,
        deliveryStatus: r.delivery_status,
      }),
    );

  const pendingRow = allRows.find(
    (r) => r.direction === "outbound" && r.draft_status === "pending_review",
  );
  const pendingDraft = pendingRow
    ? {
        id: pendingRow.id,
        body: pendingRow.body ?? "",
        reasoning: null as string | null,
      }
    : null;

  return {
    id: conv.id,
    tenant: {
      id: conv.tenant_id ?? null,
      name: tenantContext?.name ?? "Unknown tenant",
      phoneE164: tenantContext?.phone ?? null,
      badge: tenantContext?.badge ?? null,
      propertyName: tenantContext?.property ?? null,
      unitLabel: tenantContext?.unit ?? null,
      bedBath: tenantContext?.bedBath ?? null,
      currentRent: tenantContext?.currentRent ?? null,
    },
    messages,
    pendingDraft,
    caseContext,
    snoozedUntil: conv.snoozed_until ?? null,
    snoozedActive:
      Boolean(conv.snoozed_until) &&
      Date.parse(conv.snoozed_until ?? "") > Date.now(),
    muted: conv.muted ?? false,
  };
}

// ---------------------------------------------------------------------------
// getActivitySummary
// ---------------------------------------------------------------------------

/**
 * Counts the AI's auto-sent messages today and the number of drafts
 * waiting for owner review. Drives the small monitor strip at the top
 * of the thread column.
 */
export async function getActivitySummary(
  supabase: ServerSupabase,
): Promise<ActivitySummary> {
  const organizationId = await resolveOrganizationId(supabase);
  const startOfDayIso = startOfTodayIsoUtc();

  // `pendingReviewCount` routes through the shared canonical
  // `draftsAwaitingReview` scope (src/lib/operator/counts.ts) so the Inbox
  // strip, Today's handling panel, and the sidebar badge all show the same
  // number — muting/snoozing a thread drops its draft out immediately.
  const [{ count: aiSentToday }, pendingReviewCount] = await Promise.all([
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "outbound")
      .eq("draft_status", "auto_sent")
      .gte("sent_at", startOfDayIso),
    getDraftsAwaitingReviewCount(supabase),
  ]);

  return {
    organizationId,
    aiSentToday: aiSentToday ?? 0,
    pendingReviewCount,
  };
}

// ---------------------------------------------------------------------------
// Org resolution
// ---------------------------------------------------------------------------

async function resolveOrganizationId(
  supabase: ServerSupabase,
): Promise<string> {
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) return "";

  const { data: row } = await supabase
    .from("users")
    .select("organization_id")
    .eq("id", userId)
    .maybeSingle();

  return row?.organization_id ?? "";
}

// ---------------------------------------------------------------------------
// Per-conversation latest message + pending draft lookup
// ---------------------------------------------------------------------------

interface LatestMessage {
  body: string;
  direction: "inbound" | "outbound";
  createdAt: string;
}

async function fetchLatestMessages(
  supabase: ServerSupabase,
  conversationIds: readonly string[],
): Promise<Map<string, LatestMessage>> {
  if (conversationIds.length === 0) return new Map();

  // Pull all visible messages for the listed conversations and reduce
  // client-side. Skipping rejected drafts so the preview reflects
  // what the user actually saw in the thread.
  const { data } = await supabase
    .from("messages")
    .select("conversation_id, direction, body, draft_status, created_at")
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: false });

  const out = new Map<string, LatestMessage>();
  for (const row of data ?? []) {
    if (row.draft_status === "rejected") continue;
    if (out.has(row.conversation_id)) continue;
    out.set(row.conversation_id, {
      body: row.body ?? "",
      direction: row.direction as "inbound" | "outbound",
      createdAt: row.created_at ?? "",
    });
  }
  return out;
}

async function fetchPendingDrafts(
  supabase: ServerSupabase,
  conversationIds: readonly string[],
): Promise<Map<string, string>> {
  if (conversationIds.length === 0) return new Map();

  const { data } = await supabase
    .from("messages")
    .select("id, conversation_id, created_at")
    .in("conversation_id", conversationIds)
    .eq("direction", "outbound")
    .eq("draft_status", "pending_review")
    .order("created_at", { ascending: false });

  const out = new Map<string, string>();
  for (const row of data ?? []) {
    if (out.has(row.conversation_id)) continue;
    out.set(row.conversation_id, row.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tenant lookups
// ---------------------------------------------------------------------------

interface TenantSummary {
  name: string;
  phoneE164: string | null;
  unitLabel: string | null;
}

async function fetchTenantMap(
  supabase: ServerSupabase,
  tenantIds: readonly string[],
): Promise<Map<string, TenantSummary>> {
  if (tenantIds.length === 0) return new Map();

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, full_name, phone_e164")
    .in("id", tenantIds);

  const { data: leases } = await supabase
    .from("leases")
    .select("tenant_id, unit_id, status")
    .in("tenant_id", tenantIds)
    .eq("status", "active");

  const unitIds = uniqStrings((leases ?? []).map((l) => l.unit_id));
  const { data: units } = unitIds.length
    ? await supabase.from("units").select("id, label").in("id", unitIds)
    : { data: [] as Array<{ id: string; label: string }> };

  const unitLabelMap = new Map<string, string>();
  (units ?? []).forEach((u) => unitLabelMap.set(u.id, u.label));

  const out = new Map<string, TenantSummary>();
  (tenants ?? []).forEach((t) => {
    const lease = (leases ?? []).find((l) => l.tenant_id === t.id);
    const unitLabel = lease ? (unitLabelMap.get(lease.unit_id) ?? null) : null;
    out.set(t.id, {
      name: t.full_name,
      phoneE164: t.phone_e164 ?? null,
      unitLabel,
    });
  });
  return out;
}

interface TenantContext {
  name: string;
  phone: string;
  badge: string;
  property: string;
  unit: string;
  bedBath: string;
  currentRent: string;
}

async function fetchTenantContext(
  supabase: ServerSupabase,
  tenantId: string,
): Promise<TenantContext | null> {
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, full_name, phone_e164, created_at")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) return null;

  const { data: lease } = await supabase
    .from("leases")
    .select("id, unit_id, rent_amount, start_date, status")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  let unitLabel = "";
  let bedBath = "";
  let propertyName = "";
  let currentRent = "";
  let badge = "";
  if (lease) {
    currentRent = formatRent(lease.rent_amount);
    badge = leaseStartBadge(lease.start_date);
    const { data: unit } = await supabase
      .from("units")
      .select("id, label, bedrooms, bathrooms, property_id")
      .eq("id", lease.unit_id)
      .maybeSingle();
    if (unit) {
      unitLabel = unit.label;
      bedBath = formatBedBath(unit.bedrooms, unit.bathrooms);
      const { data: property } = await supabase
        .from("properties")
        .select("id, name")
        .eq("id", unit.property_id)
        .maybeSingle();
      if (property) {
        propertyName = property.name;
      }
    }
  }

  return {
    name: tenant.full_name,
    phone: tenant.phone_e164 ?? "",
    badge,
    property: propertyName,
    unit: unitLabel,
    bedBath,
    currentRent,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqStrings(
  values: ReadonlyArray<string | null | undefined>,
): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v))));
}

function previewBody(body: string | null | undefined): string {
  if (!body) return "";
  const trimmed = body.replace(/\s+/g, " ").trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

function startOfTodayIsoUtc(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function leaseStartBadge(startDate: string | null | undefined): string {
  if (!startDate) return "";
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return "";
  return `TENANT SINCE ${d.getUTCFullYear()}`;
}

function formatRent(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return "";
  const num = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(num)) return "";
  const rounded = Math.round(num);
  return `$${rounded.toLocaleString("en-US")}/mo`;
}

function formatBedBath(
  bedrooms: number | null | undefined,
  bathrooms: number | string | null | undefined,
): string {
  if (bedrooms === null || bedrooms === undefined) return "";
  const baths = typeof bathrooms === "string" ? Number(bathrooms) : bathrooms;
  const bedLabel = `${bedrooms} Bed`;
  if (baths === null || baths === undefined || !Number.isFinite(baths)) {
    return bedLabel;
  }
  const bathStr = Number.isInteger(baths) ? String(baths) : baths.toFixed(1);
  return `${bedLabel}, ${bathStr} Bath`;
}
