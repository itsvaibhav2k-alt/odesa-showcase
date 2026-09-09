/**
 * Work-order drill-down queries.
 *
 * Powers the `/work-orders/[woId]` maintenance-ticket page. Like the
 * properties queries (see ../properties/queries.ts), all reads go through
 * `createServerClient()` so RLS auto-scopes to the caller's organization —
 * a work order belonging to another org resolves to `null`, which the page
 * turns into `notFound()`.
 *
 * `getWorkOrderDetail(id)` returns the SAME `WorkOrderMock` shape the page
 * already renders, so the existing component kit stays untouched. The real
 * `work_orders` table is far leaner than the approved mockup, so many rich
 * fields (stepper labels, owner-approval grid, tenant photos, access /
 * mitigation, Ask-Odesa prompts) are DERIVED from real columns or returned
 * as sensible empties. See the field-by-field notes inline.
 *
 * Joins are decomposed into follow-up queries rather than PostgREST embeds,
 * matching the properties-queries house style.
 */

import { createServerClient } from '@/lib/supabase/server';
import type {
  WorkOrderCategory,
  WorkOrderStatus,
  WorkOrderUrgency,
  WorkOrderVendorResponse,
} from '@/types/database';
import type {
  ActionLink,
  BadgeSpec,
  CtxCardSpec,
  KvCell,
  MetricCell,
  MetricTone,
  StepperStep,
  TimelineEvent,
  Urgency,
  WorkOrderMock,
} from '@/lib/properties/mock-detail';
import { deriveVendorChip } from '@/lib/work-orders/vendor-lifecycle';

/**
 * Lifecycle props for the WO detail island — kept OFF `WorkOrderMock` (which
 * the static mocks share) and handed to the page as an extra field so the
 * client controls get the version + vendor state + org vendor picklist.
 */
export interface WorkOrderLifecycleProps {
  category: WorkOrderCategory;
  lifecycleVersion: number;
  vendorId: string | null;
  vendorName: string | null;
  vendorResponse: WorkOrderVendorResponse | null;
  vendorAssignedAt: string | null;
  reviewedAt: string | null;
  vendors: ReadonlyArray<{ id: string; name: string; category: string }>;
}

// =====================================================================
// Helpers
// =====================================================================

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

/** Human-readable label for each work-order category. */
const CATEGORY_LABEL: Record<WorkOrderCategory, string> = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  hvac: 'HVAC',
  appliances: 'Appliances',
  flooring: 'Flooring',
  painting: 'Painting',
  landscaping: 'Landscaping',
  security: 'Security',
  cleaning: 'Cleaning',
  general: 'General',
  other: 'Other',
};

/** Badge variant + label for each real `work_order_status`. */
const STATUS_BADGE: Record<WorkOrderStatus, BadgeSpec> = {
  open: { variant: 'needsaction', label: 'Open' },
  assigned: { variant: 'dispatched', label: 'Assigned' },
  in_progress: { variant: 'scheduled', label: 'In progress' },
  completed: { variant: 'resolved', label: 'Completed' },
  cancelled: { variant: 'clear', label: 'Cancelled' },
};

/** Short status word used in the metrics strip + Odesa note. */
const STATUS_WORD: Record<WorkOrderStatus, string> = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/**
 * The real schema has 5 statuses on a single linear track; the mockup
 * stepper had its own vendor-centric labels. We render a faithful 4-step
 * lifecycle and mark each step done / current / todo from the status.
 */
const STEPPER_ORDER: ReadonlyArray<{
  label: string;
  status: WorkOrderStatus;
}> = [
  { label: 'Open', status: 'open' },
  { label: 'Assigned', status: 'assigned' },
  { label: 'In progress', status: 'in_progress' },
  { label: 'Completed', status: 'completed' },
];

const STATUS_RANK: Record<WorkOrderStatus, number> = {
  open: 0,
  assigned: 1,
  in_progress: 2,
  completed: 3,
  cancelled: -1,
};

/** Map the real urgency enum onto the mock `Urgency` priority union. */
const URGENCY_TO_PRIO: Record<WorkOrderUrgency, Urgency> = {
  emergency: 'urgent',
  urgent: 'high',
  routine: 'normal',
};

/** Title-case the urgency for display in the metrics strip. */
const URGENCY_LABEL: Record<WorkOrderUrgency, string> = {
  emergency: 'Emergency',
  urgent: 'Urgent',
  routine: 'Routine',
};

/**
 * Builds the lifecycle stepper from the current status. `cancelled` is an
 * off-track terminal state, so every step is left `todo` (the badge carries
 * the "Cancelled" signal instead).
 */
function buildStepper(status: WorkOrderStatus): StepperStep[] {
  const rank = STATUS_RANK[status];
  return STEPPER_ORDER.map((step) => {
    const stepRank = STATUS_RANK[step.status];
    let state: StepperStep['state'];
    if (rank < 0) {
      state = 'todo';
    } else if (stepRank < rank) {
      state = 'done';
    } else if (stepRank === rank) {
      state = status === 'completed' ? 'done' : 'current';
    } else {
      state = 'todo';
    }
    return { label: step.label, state };
  });
}

/** A `status_timeline` jsonb entry as seeded (all fields optional but `at`). */
interface StatusTimelineEntry {
  at?: string;
  event?: string;
  by?: string;
  vendor?: string;
  note?: string;
  reason?: string;
  cost_cents?: number;
}

/**
 * Maps the `status_timeline` jsonb array onto `TimelineEvent[]`. Each entry
 * becomes one event; the actor chip prefers an explicit vendor/by field and
 * the dot variant is inferred from the event verb.
 */
function buildTimeline(raw: unknown): TimelineEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: TimelineEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as StatusTimelineEntry;
    const time = formatTimelineTime(entry.at);
    const actor = entry.vendor ?? entry.by ?? undefined;
    const line = composeTimelineLine(entry);
    events.push({
      time,
      variant: timelineVariant(entry),
      ...(actor ? { actor } : {}),
      line,
    });
  }
  return events;
}

function timelineVariant(entry: StatusTimelineEntry): TimelineEvent['variant'] {
  const event = (entry.event ?? '').toLowerCase();
  if (event === 'cancelled') return 'neutral';
  if (entry.vendor) return 'neutral';
  if (entry.by) return 'odesa';
  if (event === 'created') return 'tenant';
  return 'neutral';
}

function composeTimelineLine(entry: StatusTimelineEntry): string {
  const event = entry.event ?? 'updated';
  const verb = event.charAt(0).toUpperCase() + event.slice(1).replace(/_/g, ' ');
  const parts: string[] = [verb];
  if (entry.vendor) parts.push(`· ${entry.vendor}`);
  if (entry.note) parts.push(`· ${entry.note}`);
  if (entry.reason) parts.push(`· ${entry.reason}`);
  if (typeof entry.cost_cents === 'number') {
    parts.push(`· $${(entry.cost_cents / 100).toFixed(2)}`);
  }
  return parts.join(' ');
}

/** Renders an ISO timestamp as a short, locale-stable label (UTC). */
function formatTimelineTime(at: string | undefined): string {
  if (!at) return '';
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return at;
  const d = new Date(ms);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(d);
}

/** Single uppercase initial for the vendor avatar glyph. */
function vendorAvatar(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : 'V';
}

/** Short "opened N ago" label from the created_at timestamp. */
function openedAgo(createdAt: string): string {
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) return 'recently';
  const diffMs = Date.now() - ms;
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// =====================================================================
// Work-order detail
// =====================================================================

/**
 * Returns the maintenance-ticket payload for `/work-orders/[woId]` in the
 * `WorkOrderMock` shape, or `null` when the id is unknown or RLS hides it
 * (foreign org). The page renders `notFound()` on `null`.
 *
 * @param id - work_orders.id (a real UUID)
 */
export async function getWorkOrderDetail(
  id: string,
): Promise<(WorkOrderMock & { lifecycle: WorkOrderLifecycleProps }) | null> {
  const supabase = await createServerClient();

  const { data: wo } = await supabase
    .from('work_orders')
    .select(
      'id, unit_id, vendor_id, category, urgency, status, description, status_timeline, created_at, updated_at, vendor_response, vendor_responded_at, vendor_assigned_at, reviewed_at, lifecycle_version',
    )
    .eq('id', id)
    .maybeSingle();

  if (!wo) return null;

  const category = wo.category as WorkOrderCategory;
  const urgency = wo.urgency as WorkOrderUrgency;
  const status = wo.status as WorkOrderStatus;
  const vendorResponse = (wo.vendor_response ?? null) as WorkOrderVendorResponse | null;

  // Decomposed joins: unit → property, optional current vendor, plus the org
  // vendor picklist for the assign/reassign control (RLS scopes it to the org).
  const [unitRow, vendorRow, vendors] = await Promise.all([
    fetchUnit(supabase, wo.unit_id),
    wo.vendor_id ? fetchVendor(supabase, wo.vendor_id) : Promise.resolve(null),
    fetchOrgVendors(supabase),
  ]);

  const propertyRow = unitRow
    ? await fetchProperty(supabase, unitRow.property_id)
    : null;

  const categoryLabel = CATEGORY_LABEL[category] ?? 'General';
  const title = `${categoryLabel} work order`;
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.open;
  const propertyName = propertyRow?.name ?? 'Property';
  const unitLabel = unitRow?.label ?? 'Unit';

  // Title meta line: id · property · unit · opened-ago.
  const meta = [
    propertyName,
    unitLabel,
    `opened ${openedAgo(wo.created_at)}`,
  ];

  // Real UUIDs (not slugs) so cross-links resolve to the real detail routes.
  const propId = propertyRow?.id ?? '';
  const unitId = unitRow?.id ?? '';
  const vendorId = vendorRow?.id ?? undefined;

  // "What's happening" — one real row summarising the ticket. Detail text
  // comes from `description`; tone follows urgency.
  const attention: WorkOrderMock['attention'] = [
    {
      dot: urgency === 'routine' ? 'amber' : 'clay',
      kind: `${categoryLabel} issue`,
      ...(unitRow ? { loc: unitLabel } : {}),
      detail: wo.description ?? 'No description on file.',
      ariaLabel: `${categoryLabel} issue${unitRow ? ` at ${unitLabel}` : ''}. ${
        wo.description ?? 'No description on file.'
      }`,
      // No hrefless placeholder buttons here — the timeline is on-page and the
      // real state controls live in the "Adjust" section. Per-WO tenant
      // messaging is Wave 4 territory, so no "Message tenant" button.
      actions: [],
    },
  ];

  // Honest one-line summary of the vendor half of the ticket (Awaiting reply ·
  // Nh / accepted / declined / needs review / approved …), null when there is
  // nothing to assert (open, no vendor). Drives the "Vendor response" cell.
  const vendorChip = deriveVendorChip({
    status,
    vendorId: vendorRow?.id ?? null,
    vendorName: vendorRow?.name ?? null,
    vendorResponse,
    vendorAssignedAt: wo.vendor_assigned_at ?? null,
    reviewedAt: wo.reviewed_at ?? null,
  });

  const vendorResponseTone = chipToMetricTone(vendorChip);
  const metrics: MetricCell[] = [
    { label: 'Priority', value: URGENCY_LABEL[urgency], prio: URGENCY_TO_PRIO[urgency] },
    {
      label: 'Status',
      value: STATUS_WORD[status],
      ...(status === 'open' ? { tone: 'warn' as const } : {}),
      ...(status === 'completed' ? { tone: 'good' as const } : {}),
    },
    {
      label: 'Vendor response',
      value: vendorChip?.label ?? '—',
      ...(vendorResponseTone ? { tone: vendorResponseTone } : {}),
    },
    { label: 'Vendor', value: vendorRow?.name ?? 'Unassigned' },
    { label: 'Category', value: categoryLabel },
    { label: 'Opened', value: openedAgo(wo.created_at) },
  ];

  const vendor = buildVendorCard(vendorRow, vendorId);

  return {
    woId: wo.id,
    // Raw enum values so the operator can override the AI-set priority/status.
    urgency,
    status,
    title,
    badge,
    meta,
    propSlug: propId,
    unitSlug: unitId,
    ...(vendorId ? { vendorSlug: vendorId } : {}),
    stepperAria: `Status: ${STATUS_WORD[status]}`,
    stepper: buildStepper(status),
    attentionCount: `${URGENCY_LABEL[urgency].toLowerCase()} · ${STATUS_WORD[status].toLowerCase()}`,
    attention,
    odesaNote: {
      body:
        wo.description != null && wo.description.length > 0
          ? `Odesa is tracking this ${categoryLabel.toLowerCase()} ticket — ${wo.description}`
          : `Odesa is tracking this ${categoryLabel.toLowerCase()} ticket.`,
      basedOn: 'work order log',
    },
    nextAction: {
      body: buildNextAction(status, vendorRow?.name ?? null, vendorResponse, wo.reviewed_at ?? null),
    },
    metrics,
    timelineSub: 'Work order log',
    timeline: buildTimeline(wo.status_timeline),
    // No owner-approval source in the real schema — show the actor/cost we
    // can derive from the status_timeline, else an empty grid.
    approvalSub: 'from the work order log',
    approval: buildApprovalCells(wo.status_timeline),
    vendor,
    // No structured access / mitigation source — derive the issue summary.
    access: buildAccessCells(categoryLabel, wo.description),
    // No tenant-photo source in the real schema.
    photos: [],
    sources: [{ label: 'Work order log', freshness: 'live' }],
    ask: {
      subject: `this ${categoryLabel.toLowerCase()} ticket`,
      contextLabel: `${unitLabel} · ${propertyName}`,
      prompts: [
        'Summarize this work order',
        'Message the tenant',
        'Check the vendor status',
        'Mark resolved',
        'Prepare an owner update',
      ],
    },
    lifecycle: {
      category,
      lifecycleVersion: wo.lifecycle_version ?? 0,
      vendorId: vendorRow?.id ?? null,
      vendorName: vendorRow?.name ?? null,
      vendorResponse,
      vendorAssignedAt: wo.vendor_assigned_at ?? null,
      reviewedAt: wo.reviewed_at ?? null,
      vendors,
    },
  };
}

// =====================================================================
// Decomposed fetch helpers
// =====================================================================

async function fetchUnit(
  supabase: SupabaseServerClient,
  unitId: string,
): Promise<{ id: string; label: string; property_id: string } | null> {
  const { data } = await supabase
    .from('units')
    .select('id, label, property_id')
    .eq('id', unitId)
    .maybeSingle();
  return data ?? null;
}

async function fetchProperty(
  supabase: SupabaseServerClient,
  propertyId: string,
): Promise<{ id: string; name: string } | null> {
  const { data } = await supabase
    .from('properties')
    .select('id, name')
    .eq('id', propertyId)
    .maybeSingle();
  return data ?? null;
}

async function fetchVendor(
  supabase: SupabaseServerClient,
  vendorId: string,
): Promise<{
  id: string;
  name: string;
  category: string;
  phone_e164: string | null;
} | null> {
  const { data } = await supabase
    .from('vendors')
    .select('id, name, category, phone_e164')
    .eq('id', vendorId)
    .maybeSingle();
  return data ?? null;
}

/**
 * The org's vendors for the assign / reassign picklist. RLS scopes the read to
 * the caller's organization, so no explicit org filter is needed.
 */
async function fetchOrgVendors(
  supabase: SupabaseServerClient,
): Promise<Array<{ id: string; name: string; category: string }>> {
  const { data } = await supabase
    .from('vendors')
    .select('id, name, category')
    .order('name', { ascending: true });
  return (data ?? []).map((v) => ({ id: v.id, name: v.name, category: v.category }));
}

// =====================================================================
// Derived-section builders
// =====================================================================

/** MetricCell only carries 'warn' | 'good'; fold the chip's clay onto warn. */
function chipToMetricTone(
  chip: { tone: 'good' | 'warn' | 'clay' | 'neutral' } | null,
): MetricTone | null {
  if (!chip) return null;
  if (chip.tone === 'good') return 'good';
  if (chip.tone === 'warn' || chip.tone === 'clay') return 'warn';
  return null;
}

function buildNextAction(
  status: WorkOrderStatus,
  vendorName: string | null,
  vendorResponse: WorkOrderVendorResponse | null,
  reviewedAt: string | null,
): string {
  const who = vendorName ?? 'The assigned vendor';
  switch (status) {
    case 'open':
      return 'This ticket is open and unassigned. Assign a vendor from the Adjust section to move it forward.';
    case 'assigned':
      if (vendorResponse === 'declined') {
        return `${who} declined. Reassignment needed — pick another vendor in the Adjust section.`;
      }
      if (vendorResponse === 'no_response') {
        return `${who} has not responded. Reassignment needed — pick another vendor in the Adjust section.`;
      }
      if (vendorResponse === 'accepted') {
        return `${who} accepted. Start the work when they are on site.`;
      }
      return `${who} has been assigned. Record their reply, or start the work once confirmed.`;
    case 'in_progress':
      return `${who} is working the ticket. Mark it complete once the work is done.`;
    case 'completed':
      return reviewedAt
        ? 'This work order is complete and approved. No further action is needed.'
        : 'Work is complete and awaiting owner review. Approve the result or reopen it.';
    case 'cancelled':
      return 'This work order was cancelled. No further action is needed.';
    default:
      return 'Odesa is monitoring this work order.';
  }
}

function buildVendorCard(
  vendor: {
    id: string;
    name: string;
    category: string;
    phone_e164: string | null;
  } | null,
  vendorId: string | undefined,
): CtxCardSpec {
  if (!vendor) {
    return {
      avatar: '—',
      name: 'No vendor assigned',
      // The assign control in the Adjust section replaces the old
      // hrefless "Suggest a vendor" button, so no action here.
      sub: 'Assign a vendor from the Adjust section to move this ticket forward.',
      actions: [],
    };
  }
  const categoryLabel = CATEGORY_LABEL[vendor.category as WorkOrderCategory] ?? 'Vendor';
  const subParts = [`${categoryLabel} vendor`];
  if (vendor.phone_e164) subParts.push(vendor.phone_e164);
  const actions: ActionLink[] = [
    {
      label: 'View vendor',
      variant: 'default',
      ...(vendorId ? { href: `/vendors/${vendorId}` } : {}),
    },
    // "Call" becomes a real tel: link when a number is on file; otherwise
    // it is dropped rather than left as a dead button.
    ...(vendor.phone_e164
      ? [{ label: 'Call', variant: 'default' as const, href: `tel:${vendor.phone_e164}` }]
      : []),
  ];
  return {
    avatar: vendorAvatar(vendor.name),
    name: vendor.name,
    sub: subParts.join(' · '),
    actions,
  };
}

/**
 * Pulls an owner-approval-ish grid out of the status_timeline. The real
 * schema has no owner-approval record, but seeded timelines carry the
 * approving actor + cost on completion events, so we surface what exists.
 */
function buildApprovalCells(raw: unknown): WorkOrderMock['approval'] {
  if (!Array.isArray(raw)) return [];
  const cells: WorkOrderMock['approval'] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as StatusTimelineEntry;
    if (typeof entry.cost_cents === 'number') {
      cells.push({
        k: 'Amount',
        v: `$${(entry.cost_cents / 100).toFixed(2)}`,
        mono: true,
      });
    }
    if (entry.by) {
      cells.push({ k: 'Logged by', v: entry.by });
    }
  }
  return cells;
}

/** Derives an access / mitigation grid from the category + description. */
function buildAccessCells(
  categoryLabel: string,
  description: string | null,
): KvCell[] {
  const cells: KvCell[] = [{ k: 'Category', v: categoryLabel }];
  if (description) {
    cells.push({ k: 'Issue', v: description });
  }
  return cells;
}
