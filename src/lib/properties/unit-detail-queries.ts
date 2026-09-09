/**
 * Unit-brief queries — real Supabase data for `/properties/[id]/units/[unitId]`.
 *
 * `getUnitBrief(unitId)` returns the exact `UnitDetailMock` shape the unit
 * detail page consumes (from ./mock-detail.ts) so the locked UI renders
 * unchanged — only the data source swaps from the static mock to live rows.
 *
 * All reads go through `createServerClient()` so RLS auto-scopes to the
 * caller's organization. We never accept an `organizationId` argument.
 * Joins are decomposed into follow-up `.in()`/`.eq()` queries with explicit
 * column selects (never `select('*')`), matching the house style in
 * ./queries.ts (which we READ for patterns but do not edit).
 *
 * The mock carried far richer data than the v1 schema models (payment plans,
 * smart-lock access codes, smoke/CO detector dates, appliance warranties).
 * Where there is no real source we derive a sensible value or fall back to an
 * empty array; every such field is documented in the function body and
 * reported back to the caller.
 */

import {
  deriveUnitOccupancyStatus,
  rentCycleFromRow,
  rentRecommendationCopy,
  type DerivedRentCycleStatus,
  type LeaseStatus,
  type UnitOccupancyKind,
} from '@/lib/domain';
import { createServerClient } from '@/lib/supabase/server';
import { displayName, displayUnitLabel } from '@/lib/demo-safe/normalize';

// TYPE-ONLY import from the mock module — values still come from Supabase.
import type {
  ApplianceRow,
  AttentionItem,
  BadgeSpec,
  CtxCardSpec,
  KvCell,
  MaintenanceRef,
  MetricCell,
  OdesaNote,
  PillSpec,
  UnitDetailMock,
  Urgency,
} from '@/lib/properties/mock-detail';
import { tenantHref, unitHref } from '@/lib/properties/mock-detail';

/** Read-only Ask-Odesa desk route. Draft-only — nothing sends without approval. */
function assistantHref(prompt: string): string {
  return `/assistant?q=${encodeURIComponent(prompt)}`;
}

// =====================================================================
// Constants
// =====================================================================

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

/** work_order statuses that count as still-open. */
const OPEN_WO_STATUSES = new Set(['open', 'assigned', 'in_progress']);

/** Map work_order_category → a human appliance label for the appliance fallback. */
const APPLIANCE_TYPE_LABELS: Record<string, string> = {
  fridge: 'Refrigerator',
  hvac: 'HVAC system',
  washer: 'Washer',
  dryer: 'Dryer',
  water_heater: 'Water heater',
  dishwasher: 'Dishwasher',
  oven: 'Range / oven',
  microwave: 'Microwave',
  other: 'Appliance',
};

/** Map work_order_category → a derived ticket title (work_orders has no title column). */
const WORK_ORDER_TITLES: Record<string, string> = {
  plumbing: 'Plumbing issue',
  electrical: 'Electrical issue',
  hvac: 'HVAC service',
  appliances: 'Appliance repair',
  flooring: 'Flooring repair',
  painting: 'Painting',
  landscaping: 'Landscaping',
  security: 'Security issue',
  cleaning: 'Cleaning',
  general: 'General maintenance',
  other: 'Maintenance request',
};

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// =====================================================================
// Small formatting helpers
// =====================================================================

function dollars(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** "2025-10-01" → "Oct 2025". Returns null on missing/invalid input. */
function monthYear(iso: string | null | undefined): string | null {
  if (!iso || iso.length < 7) return null;
  const year = iso.slice(0, 4);
  const monthIdx = Number(iso.slice(5, 7)) - 1;
  if (monthIdx < 0 || monthIdx > 11) return null;
  return `${MONTH_NAMES[monthIdx]} ${year}`;
}

function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : '?';
}

/**
 * Pull a `deposit_cents`/`deposit` and `fixed_fee_cents`/`grace_days` out of
 * the lease `late_fee_policy` jsonb blob — the schema stores both here in v1.
 */
function parseLatePolicy(policy: unknown): {
  depositCents: number | null;
  lateFeeCents: number | null;
  graceDays: number | null;
} {
  const empty = { depositCents: null, lateFeeCents: null, graceDays: null };
  if (!policy || typeof policy !== 'object') return empty;
  const rec = policy as Record<string, unknown>;

  let depositCents: number | null = null;
  if (typeof rec.deposit_cents === 'number' && Number.isFinite(rec.deposit_cents)) {
    depositCents = Math.round(rec.deposit_cents);
  } else if (typeof rec.deposit === 'number' && Number.isFinite(rec.deposit)) {
    depositCents = Math.round(rec.deposit * 100);
  }

  const lateFeeCents =
    typeof rec.fixed_fee_cents === 'number' && Number.isFinite(rec.fixed_fee_cents)
      ? Math.round(rec.fixed_fee_cents)
      : null;

  const graceDays =
    typeof rec.grace_days === 'number' && Number.isFinite(rec.grace_days)
      ? Math.round(rec.grace_days)
      : null;

  return { depositCents, lateFeeCents, graceDays };
}

function centsToDollars(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

// =====================================================================
// Internal row shapes (decomposed query results)
// =====================================================================

interface UnitRow {
  id: string;
  label: string;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  property_id: string;
}

interface LeaseRow {
  id: string;
  tenant_id: string;
  rent_amount: number;
  start_date: string | null;
  end_date: string | null;
  status: string;
  late_fee_policy: unknown;
}

interface TenantRow {
  id: string;
  full_name: string;
  phone_e164: string;
}

interface RentEventRow {
  id: string;
  cycle_month: string;
  amount_due: number;
  amount_paid: number;
  status: string;
  due_date: string | null;
}

interface ApplianceTableRow {
  type: string;
  make: string | null;
  model: string | null;
  install_date: string | null;
  warranty_expires_at: string | null;
}

interface WorkOrderRow {
  id: string;
  category: string;
  status: string;
  urgency: string;
  description: string | null;
}

// =====================================================================
// Public API
// =====================================================================

/**
 * Returns the unit-brief payload for the given unit id in the
 * `UnitDetailMock` shape consumed by the unit detail page. Returns `null`
 * when the unit doesn't exist or RLS hides it (→ caller renders notFound()).
 *
 * @param unitId - units.id UUID from the route segment
 */
export async function getUnitBrief(
  unitId: string,
): Promise<UnitDetailMock | null> {
  const supabase = await createServerClient();

  const { data: unit, error: unitError } = await supabase
    .from('units')
    .select('id, label, bedrooms, bathrooms, square_feet, property_id')
    .eq('id', unitId)
    .maybeSingle();

  if (unitError) {
    throw new Error('Failed to load unit: ' + unitError.message);
  }

  if (!unit) return null;

  const { data: property } = await supabase
    .from('properties')
    .select('id, name, address_city, address_state')
    .eq('id', unit.property_id)
    .maybeSingle();

  // RLS hides cross-org properties — if the parent is missing, treat the
  // whole unit as not found rather than rendering an orphaned brief.
  if (!property) return null;

  // Active + pending leases — pending feeds occupancy (`pending_move_in`
  // is NOT vacant); the newest active lease stays the tenant/rent source.
  const { data: leaseRows } = await supabase
    .from('leases')
    .select('id, tenant_id, rent_amount, start_date, end_date, status, late_fee_policy')
    .eq('unit_id', unitId)
    .in('status', ['active', 'pending'])
    .order('start_date', { ascending: false, nullsFirst: false });

  const leases = (leaseRows as LeaseRow[] | null) ?? [];
  const leaseRow = leases.find((l) => l.status === 'active') ?? null;

  // One clock read at the IO boundary so every derived status agrees.
  const todayIso = new Date().toISOString().slice(0, 10);
  const occupancy = deriveUnitOccupancyStatus(
    leases.map((l) => ({ status: l.status as LeaseStatus, endDate: l.end_date })),
    todayIso,
  );

  const [tenant, rentEvents] = await Promise.all([
    leaseRow ? fetchTenant(supabase, leaseRow.tenant_id) : Promise.resolve(null),
    leaseRow ? fetchRentEvents(supabase, leaseRow.id) : Promise.resolve([]),
  ]);

  const [appliances, workOrders] = await Promise.all([
    fetchAppliances(supabase, unitId),
    fetchWorkOrders(supabase, unitId),
  ]);

  return buildUnitBrief({
    // Normalize the unit label for display; id/property_id stay raw so
    // slugs, hrefs, and floor inference keep working off real values.
    unit: {
      ...(unit as UnitRow),
      label: displayUnitLabel((unit as UnitRow).label),
    },
    propertyName: property.name,
    propertyCity: property.address_city,
    propertyState: property.address_state,
    lease: leaseRow,
    occupancy,
    todayIso,
    tenant,
    rentEvents,
    appliances,
    workOrders,
  });
}

// =====================================================================
// Decomposed fetch helpers
// =====================================================================

async function fetchTenant(
  supabase: SupabaseServerClient,
  tenantId: string,
): Promise<TenantRow | null> {
  const { data } = await supabase
    .from('tenants')
    .select('id, full_name, phone_e164')
    .eq('id', tenantId)
    .maybeSingle();
  const row = (data as TenantRow | null) ?? null;
  if (!row) return null;
  // Normalize the tenant's name at the display boundary; id/phone untouched
  // so downstream lookups + hrefs keep using the real identifiers.
  return { ...row, full_name: displayName(row.full_name) };
}

async function fetchRentEvents(
  supabase: SupabaseServerClient,
  leaseId: string,
): Promise<RentEventRow[]> {
  const { data } = await supabase
    .from('rent_events')
    .select('id, cycle_month, amount_due, amount_paid, status, due_date')
    .eq('lease_id', leaseId)
    .order('cycle_month', { ascending: false })
    .limit(12);
  return (data as RentEventRow[] | null) ?? [];
}

async function fetchAppliances(
  supabase: SupabaseServerClient,
  unitId: string,
): Promise<ApplianceTableRow[]> {
  const { data } = await supabase
    .from('appliances')
    .select('type, make, model, install_date, warranty_expires_at')
    .eq('unit_id', unitId)
    .order('type', { ascending: true });
  return (data as ApplianceTableRow[] | null) ?? [];
}

async function fetchWorkOrders(
  supabase: SupabaseServerClient,
  unitId: string,
): Promise<WorkOrderRow[]> {
  const { data } = await supabase
    .from('work_orders')
    .select('id, category, status, urgency, description')
    .eq('unit_id', unitId)
    .order('created_at', { ascending: false });
  return (data as WorkOrderRow[] | null) ?? [];
}

// =====================================================================
// Pure builders (shape mappers — no I/O)
// =====================================================================

interface BuildInput {
  unit: UnitRow;
  propertyName: string;
  propertyCity: string | null;
  propertyState: string | null;
  lease: LeaseRow | null;
  /** Canonical unit occupancy derived from active + pending leases. */
  occupancy: UnitOccupancyKind;
  /** 'YYYY-MM-DD' — one clock read at the IO boundary. */
  todayIso: string;
  tenant: TenantRow | null;
  rentEvents: RentEventRow[];
  appliances: ApplianceTableRow[];
  workOrders: WorkOrderRow[];
}

function buildUnitBrief(input: BuildInput): UnitDetailMock {
  const {
    unit,
    propertyName,
    propertyCity,
    propertyState,
    lease,
    occupancy,
    todayIso,
    tenant,
    rentEvents,
    appliances,
    workOrders,
  } = input;

  // Newest rent_event is the current cycle (events fetched cycle_month desc).
  // Lateness comes from the canonical derivation (due_date vs today +
  // balance), never the raw enum; `plan_agreed` is never late.
  const currentCycle = rentEvents[0] ?? null;
  const derived: DerivedRentCycleStatus | null = currentCycle
    ? rentCycleFromRow(currentCycle, todayIso)
    : null;
  const isLate = derived?.isLate ?? false;
  const isEscalated = derived?.isEscalated ?? false;
  const isOnPlan = derived?.isOnPlan ?? false;
  // `balanceCents / 100` is DOLLARS — the unit RecordPaymentModal expects.
  const outstanding = derived ? derived.balanceCents / 100 : 0;
  const hasUnpaidBalance = outstanding > 0;
  // Ids the unit-detail page hands to RecordPaymentModal. Null when there is
  // no current rent_events row (vacant / no activity) or no active lease.
  const rentEventId = currentCycle?.id ?? null;
  const leaseId = lease?.id ?? null;
  // Odesa recommends recording a payment only when a positive balance is owed.
  const recommendsPayment = outstanding > 0;

  const openWorkOrders = workOrders.filter((w) => OPEN_WO_STATUSES.has(w.status));
  const occupied = Boolean(lease && tenant);
  const pendingMoveIn = occupancy === 'pending_move_in';
  const policy = parseLatePolicy(lease?.late_fee_policy);

  const rentMonthly = lease ? dollars(lease.rent_amount) : null;
  const cityState = [propertyCity, propertyState].filter(Boolean).join(', ');
  const leaseEndLabel = monthYear(lease?.end_date) ?? '—';

  // -------- badge / meta ----------------------------------------------------
  const badge: BadgeSpec = !occupied
    ? pendingMoveIn
      ? { variant: 'leasing', label: 'Lease pending' }
      : { variant: 'leasing', label: 'Vacant' }
    : isLate
      ? { variant: 'watching', label: 'Watching' }
      : isOnPlan
        ? { variant: 'plan', label: 'Payment plan' }
        : hasUnpaidBalance
          ? { variant: 'watching', label: 'Due' }
          : { variant: 'current', label: 'Current' };

  const meta: string[] = [
    propertyName,
    ...(cityState ? [cityState] : []),
    occupied ? 'occupied' : pendingMoveIn ? 'lease pending' : 'vacant',
    ...(rentMonthly ? [`${rentMonthly}/mo`] : []),
  ];

  // -------- attention + odesa note -----------------------------------------
  const attention = buildAttention({
    propertyId: unit.property_id,
    unitId: unit.id,
    occupied,
    pendingMoveIn,
    isLate,
    isOnPlan,
    outstanding,
    daysLate: derived?.daysLate ?? 0,
    tenantName: tenant?.full_name ?? null,
    tenantId: tenant?.id ?? null,
    leaseEndLabel,
    hasLease: Boolean(lease),
    openCount: openWorkOrders.length,
  });
  const attentionCount =
    attention.length === 0 ? 'all clear' : `${attention.length} active`;

  const odesaNote: OdesaNote = {
    body: buildOdesaBody({
      label: unit.label,
      occupied,
      pendingMoveIn,
      isLate,
      isEscalated,
      isOnPlan,
      outstanding,
      tenantName: tenant?.full_name ?? null,
      openCount: openWorkOrders.length,
    }),
    basedOn: 'ledger · lease terms · maintenance history',
  };

  // -------- metrics strip (5 cells) ----------------------------------------
  const metrics: MetricCell[] = [
    occupied
      ? { label: 'Occupancy', value: 'Occupied', tone: 'good' }
      : pendingMoveIn
        ? { label: 'Occupancy', value: 'Lease pending' }
        : { label: 'Occupancy', value: 'Vacant', tone: 'warn' },
    { label: 'Rent', value: rentMonthly ?? '—' },
    outstanding > 0
      ? { label: 'Balance', value: dollars(outstanding), tone: 'warn' }
      : { label: 'Balance', value: '$0', tone: 'good' },
    { label: 'Lease end', value: leaseEndLabel },
    openWorkOrders.length === 0
      ? { label: 'Maintenance', value: '0 open', tone: 'good' }
      : { label: 'Maintenance', value: `${openWorkOrders.length} open` },
  ];

  // -------- tenant ctx card -------------------------------------------------
  const tenantCard: CtxCardSpec = tenant
    ? {
        avatar: initial(tenant.full_name),
        name: tenant.full_name,
        pill: isLate
          ? ({ variant: 'watching', label: 'Rent late' } as PillSpec)
          : isOnPlan
            ? ({ variant: 'plan', label: 'Payment plan' } as PillSpec)
            : hasUnpaidBalance
              ? ({ variant: 'watching', label: 'Due' } as PillSpec)
              : ({ variant: 'current', label: 'Current' } as PillSpec),
        sub: tenant.phone_e164,
        actions: [
          { label: 'View tenant', variant: 'default', href: tenantHref(tenant.id) },
          // "Draft reminder" routes to the read-only Ask-Odesa desk with this
          // tenant's rent context (draft-only — nothing sends without owner
          // approval), so it is distinct from "View tenant" and truthful.
          {
            label: 'Draft reminder',
            variant: 'primary',
            href: assistantHref(
              `Draft a calm rent reminder for ${tenant.full_name.split(/\s+/)[0] || tenant.full_name} — Unit ${unit.label}${
                outstanding > 0 ? `, balance ${dollars(outstanding)}` : ''
              }${
                (derived?.daysLate ?? 0) > 0
                  ? `, ${derived?.daysLate} day${derived?.daysLate === 1 ? '' : 's'} late`
                  : ''
              }. Draft only — nothing sends to the tenant until I approve it.`,
            ),
          },
        ],
      }
    : pendingMoveIn
      ? {
          avatar: '—',
          name: 'Lease pending',
          sub: 'Move-in being set up',
          actions: [],
        }
      : {
          avatar: '—',
          name: 'Vacant',
          sub: 'No active lease',
          actions: [],
        };

  // -------- rent KV ---------------------------------------------------------
  const cycleLabel = currentCycle
    ? monthYear(currentCycle.cycle_month) ?? 'Current cycle'
    : 'Current cycle';
  const rent: KvCell[] = currentCycle && derived
    ? [
        { k: 'Cycle', v: cycleLabel },
        { k: 'Due', v: dollars(currentCycle.amount_due), mono: true },
        { k: 'Paid', v: dollars(currentCycle.amount_paid), mono: true },
        { k: 'Outstanding', v: dollars(outstanding), mono: true },
        { k: 'Status', v: derived.label },
      ]
    : [
        {
          k: 'Status',
          v: occupied
            ? 'No rent activity yet'
            : pendingMoveIn
              ? 'Lease pending — move-in being set up'
              : 'No active lease',
        },
      ];

  // -------- lease KV --------------------------------------------------------
  const lease_: KvCell[] = lease
    ? [
        { k: 'Start', v: monthYear(lease.start_date) ?? '—' },
        { k: 'End', v: leaseEndLabel },
        ...(policy.depositCents != null
          ? [{ k: 'Deposit', v: centsToDollars(policy.depositCents)!, mono: true }]
          : []),
        ...(policy.lateFeeCents != null
          ? [
              {
                k: 'Late fee',
                // Explicit fee state — never implies it is folded into the
                // outstanding balance. Eligible once past grace, else configured.
                v: `${centsToDollars(policy.lateFeeCents)} ${
                  (derived?.daysLate ?? 0) > (policy.graceDays ?? 0) ? 'eligible' : 'configured'
                }, not applied`,
              },
            ]
          : []),
        ...(policy.graceDays != null
          ? [{ k: 'Grace period', v: `${policy.graceDays} days` }]
          : []),
      ]
    : [{ k: 'Status', v: 'No active lease' }];

  // -------- appliances ------------------------------------------------------
  const applianceRows = appliances.map(buildApplianceRow);
  const flagged = 0; // No replacement flag in the v1 schema.
  const appliancesSub =
    applianceRows.length === 0
      ? 'No appliances on file'
      : `${applianceRows.length} tracked${flagged ? ` · ${flagged} flagged` : ''}`;

  // -------- maintenance -----------------------------------------------------
  const maintenance = workOrders.map(buildMaintenanceRef);
  const maintenanceSub =
    workOrders.length === 0
      ? 'No maintenance history'
      : `${openWorkOrders.length} open · ${workOrders.length - openWorkOrders.length} resolved`;

  // -------- access · utilities (no real source) ----------------------------
  // The schema has no entry/mailbox/parking/utility columns — surface only
  // what we can derive (floor inferred from the unit label prefix digit).
  const access: KvCell[] = [];
  const floor = inferFloor(unit.label);
  if (floor) access.push({ k: 'Floor', v: floor });

  // -------- specs · safety --------------------------------------------------
  const specs: KvCell[] = [];
  if (unit.square_feet != null) specs.push({ k: 'Size', v: `${unit.square_feet} sq ft` });
  const layout = buildLayout(unit.bedrooms, unit.bathrooms);
  if (layout) specs.push({ k: 'Layout', v: layout });

  return {
    propSlug: unit.property_id,
    unitSlug: unit.id,
    label: `Unit ${unit.label}`,
    badge,
    meta,
    attentionCount,
    attention,
    odesaNote,
    metrics,
    tenant: tenantCard,
    rent,
    lease: lease_,
    appliancesSub,
    appliances: applianceRows,
    maintenanceSub,
    maintenance,
    access,
    specs,
    // RecordPaymentModal enablement (real-data ids; outstanding in DOLLARS).
    rentEventId,
    leaseId,
    outstandingDollars: outstanding,
    recommendsPayment,
    sources: [
      { label: 'Lease', freshness: lease ? 'active' : pendingMoveIn ? 'pending' : 'none' },
      { label: 'Ledger', freshness: currentCycle ? cycleLabel : 'no activity' },
      { label: 'Maintenance history', freshness: `${workOrders.length} on file` },
    ],
    ask: {
      subject: `Unit ${unit.label}`,
      contextLabel: `Unit ${unit.label}`,
      prompts: [
        'What needs attention?',
        'Draft tenant reminder',
        'Show lease terms',
        'Summarize rent status',
        'Show maintenance history',
      ],
    },
  };
}

// =====================================================================
// Builder sub-helpers
// =====================================================================

function buildAttention(args: {
  propertyId: string;
  unitId: string;
  occupied: boolean;
  pendingMoveIn: boolean;
  isLate: boolean;
  isOnPlan: boolean;
  outstanding: number;
  daysLate: number;
  tenantName: string | null;
  tenantId: string | null;
  leaseEndLabel: string;
  hasLease: boolean;
  openCount: number;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  // Every attention action routes to a real destination — so none of these
  // render as silent no-op buttons. "Review ledger" focuses THIS unit's rent
  // ledger (the #rent section on the unit page) rather than the generic
  // property payments room, so the label matches what the user sees.
  const rentHref = `/properties/${args.propertyId}?room=payments`;
  const unitLedgerHref = `${unitHref(args.propertyId, args.unitId)}#rent`;
  const unitsHref = `/properties/${args.propertyId}?room=units`;
  const maintenanceHref = `/properties/${args.propertyId}?room=maintenance`;

  if (!args.occupied) {
    if (args.pendingMoveIn) {
      items.push({
        dot: 'gold',
        kind: 'Lease pending',
        detail: 'Lease pending — move-in being set up',
        ariaLabel: 'Lease pending. Lease pending — move-in being set up',
        actions: [
          { label: 'Finish lease terms', variant: 'default', href: rentHref },
        ],
      });
    } else {
      items.push({
        dot: 'gold',
        kind: 'Vacant',
        detail: 'No active lease on this unit',
        ariaLabel: 'Vacant. No active lease on this unit',
        actions: [
          { label: 'Manage occupancy', variant: 'default', href: unitsHref },
        ],
      });
    }
    return items;
  }

  if (args.isLate) {
    items.push({
      dot: 'clay',
      kind: 'Rent late',
      loc: args.tenantName ?? undefined,
      detail: `${dollars(args.outstanding)} outstanding this cycle`,
      ariaLabel: `Rent late${args.tenantName ? ` for ${args.tenantName}` : ''}. ${dollars(args.outstanding)} outstanding this cycle`,
      actions: [
        { label: 'Review ledger', variant: 'primary', href: unitLedgerHref },
        ...(args.tenantId
          ? [
              {
                // Truthful label: routes to the tenant record (where the
                // message composer lives) — it does not itself send a message.
                label: 'Open tenant record',
                variant: 'default' as const,
                href: tenantHref(args.tenantId),
              },
            ]
          : []),
      ],
    });
  }

  if (args.isOnPlan) {
    items.push({
      dot: 'amber',
      kind: 'Payment plan',
      loc: args.tenantName ?? undefined,
      detail: `${dollars(args.outstanding)} outstanding on an agreed plan`,
      ariaLabel: `Payment plan${args.tenantName ? ` for ${args.tenantName}` : ''}. ${dollars(args.outstanding)} outstanding on an agreed plan`,
      actions: [{ label: 'Review ledger', variant: 'default', href: unitLedgerHref }],
    });
  }

  if (args.hasLease && !args.isLate && args.outstanding > 0) {
    items.push({
      dot: 'gold',
      kind: 'Rent due',
      detail: `${dollars(args.outstanding)} due this cycle · not late yet`,
      ariaLabel: `Rent due. ${dollars(args.outstanding)} due this cycle, not late yet`,
      actions: [{ label: 'Review ledger', variant: 'default', href: unitLedgerHref }],
    });
  } else if (args.hasLease && !args.isLate) {
    items.push({
      dot: 'green',
      kind: 'Lease healthy',
      detail: `Lease through ${args.leaseEndLabel} · no renewal action needed`,
      ariaLabel: `Lease healthy. Lease through ${args.leaseEndLabel} · no renewal action needed`,
      actions: [{ label: 'View lease', variant: 'default', href: rentHref }],
    });
  }

  if (args.openCount > 0) {
    items.push({
      dot: 'amber',
      kind: 'Maintenance open',
      detail: `${args.openCount} open work order${args.openCount === 1 ? '' : 's'}`,
      ariaLabel: `Maintenance open. ${args.openCount} open work order${args.openCount === 1 ? '' : 's'}`,
      actions: [
        { label: 'View tickets', variant: 'default', href: maintenanceHref },
      ],
    });
  }

  return items;
}

function buildOdesaBody(args: {
  label: string;
  occupied: boolean;
  pendingMoveIn: boolean;
  isLate: boolean;
  isEscalated: boolean;
  isOnPlan: boolean;
  outstanding: number;
  tenantName: string | null;
  openCount: number;
}): string {
  if (!args.occupied) {
    if (args.pendingMoveIn) {
      return `Unit ${args.label} has a **lease pending** — move-in being set up. Finish lease terms to complete the setup.`;
    }
    return `Unit ${args.label} is **vacant** with no active lease. Odesa will surface listing and turnover steps when they're ready.`;
  }
  // Escalated is also late, so it must be checked first — an escalated unit
  // shows escalation-started copy, never the "before escalation" reminder line.
  if (args.isEscalated) {
    const who = args.tenantName ? `${args.tenantName}'s` : 'this unit’s';
    return `Unit ${args.label} has an active rent balance on ${who} ledger. ${rentRecommendationCopy('escalated')}`;
  }
  if (args.isLate) {
    const who = args.tenantName ? `${args.tenantName}'s` : 'this unit’s';
    return `Unit ${args.label} has an active rent balance on ${who} ledger. ${rentRecommendationCopy('late')}`;
  }
  if (args.isOnPlan) {
    const who = args.tenantName ? `${args.tenantName} is` : 'This unit’s tenant is';
    return `Unit ${args.label} has a balance on an **agreed payment plan**. ${who} not late — Odesa will flag the plan if it slips.`;
  }
  if (args.outstanding > 0) {
    const who = args.tenantName ? `${args.tenantName}'s` : 'this unit’s';
    return `Unit ${args.label} has ${dollars(args.outstanding)} due on ${who} ledger. It is not late yet, but Odesa is watching the grace window and will escalate if it slips.`;
  }
  if (args.openCount > 0) {
    return `Unit ${args.label} is current on rent with **${args.openCount} open maintenance item${args.openCount === 1 ? '' : 's'}** in progress. No owner action is needed right now.`;
  }
  return `Unit ${args.label} is **operationally calm** — rent is current and no maintenance is open. Odesa will flag anything new the moment it appears.`;
}

function buildApplianceRow(a: ApplianceTableRow): ApplianceRow {
  const name = APPLIANCE_TYPE_LABELS[a.type] ?? 'Appliance';
  const model = [a.make, a.model].filter(Boolean).join(' ') || 'Unknown model';
  const installYear = a.install_date?.slice(0, 4) ?? null;

  const warranty = a.warranty_expires_at
    ? warrantyLabel(a.warranty_expires_at)
    : 'Warranty unknown';

  const status: PillSpec = a.warranty_expires_at
    && Date.parse(a.warranty_expires_at) < Date.now()
    ? { variant: 'aging', label: 'Out of warranty' }
    : { variant: 'good', label: 'Good' };

  const age = installYear ? `${installYear}` : 'Install date unknown';

  return {
    name,
    model,
    warranty,
    age,
    status,
    ariaLabel: `${name}, ${model}, ${age}, ${status.label}`,
  };
}

function warrantyLabel(iso: string): string {
  const year = iso.slice(0, 4);
  return Date.parse(iso) < Date.now()
    ? 'Out of warranty'
    : `Warranty to ${year}`;
}

function buildMaintenanceRef(w: WorkOrderRow): MaintenanceRef {
  const open = OPEN_WO_STATUSES.has(w.status);
  const title = WORK_ORDER_TITLES[w.category] ?? 'Maintenance request';
  const badge = workOrderBadge(w.status);

  return {
    calm: !open,
    title,
    // No human WO number column in v1 — surface a short id slice for display,
    // but route the href to the real work-order UUID.
    wo: `WO-${w.id.slice(0, 4).toUpperCase()}`,
    woId: w.id,
    sub: w.description ?? `${w.category} · ${humanizeWoStatus(w.status)}`,
    badge,
    prio: mapUrgency(w.urgency),
    ariaLabel: title,
  };
}

function workOrderBadge(status: string): MaintenanceRef['badge'] {
  switch (status) {
    case 'completed':
      return { variant: 'resolved', label: 'Resolved' };
    case 'cancelled':
      return { variant: 'clear', label: 'Cancelled' };
    case 'assigned':
      return { variant: 'dispatched', label: 'Assigned' };
    case 'in_progress':
      return { variant: 'scheduled', label: 'In progress' };
    default:
      return { variant: 'open', label: 'Open' };
  }
}

function mapUrgency(urgency: string): Urgency | undefined {
  switch (urgency) {
    case 'emergency':
      return 'urgent';
    case 'urgent':
      return 'high';
    case 'routine':
      return 'normal';
    default:
      return undefined;
  }
}

function humanizeWoStatus(status: string): string {
  switch (status) {
    case 'in_progress':
      return 'In progress';
    case 'assigned':
      return 'Assigned';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Open';
  }
}

/** Infer floor from a numeric unit label (e.g. "201" → "2nd"). */
function inferFloor(label: string): string | null {
  const m = label.match(/^(\d)\d{2}$/);
  if (!m) return null;
  const digit = Number(m[1]);
  const suffix = digit === 1 ? 'st' : digit === 2 ? 'nd' : digit === 3 ? 'rd' : 'th';
  return `${digit}${suffix}`;
}

function buildLayout(
  bedrooms: number | null,
  bathrooms: number | null,
): string | null {
  const parts: string[] = [];
  if (bedrooms != null) parts.push(`${bedrooms} bed`);
  if (bathrooms != null) parts.push(`${bathrooms} bath`);
  return parts.length ? parts.join(' · ') : null;
}
