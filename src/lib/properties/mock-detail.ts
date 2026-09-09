// TODO(properties backend): swap these mock lookups for real queries in ./queries.ts (getProperty/getUnitDetail/listUnitsTableRowsForProperty/listMaintenanceTicketsForProperty/listRentPaymentsForProperty are reserved) and map slugs -> property UUIDs.

/**
 * Properties — mock detail data for the interior pages.
 *
 * Source of truth for every interior route the `/properties` command center
 * drills into: the property brief (`/properties/<slug>`), unit brief
 * (`/properties/<slug>/units/<unitSlug>`), tenant brief (`/tenants/<slug>`)
 * and maintenance ticket (`/work-orders/<woId>`).
 *
 * The `oak`, `oak/1a`, `maya` and `WO-1042` entities are transcribed VERBATIM
 * from the approved static mockups (property-detail.html, unit-detail.html,
 * tenant-detail.html, maintenance-ticket.html). The remaining properties
 * (cedar, maple, elm, birch, pine) and their units / tenants / work orders are
 * generated to stay consistent with the command-center summaries in
 * ./mock-portfolio.ts so EVERY card drills into a complete page.
 */

/* ------------------------------------------------------------------ */
/* Shared sub-types                                                    */
/* ------------------------------------------------------------------ */

/** Status badge variants — match the mockup `.badge.<variant>` class names. */
export type BadgeVariant =
  | 'atrisk'
  | 'watching'
  | 'leasing'
  | 'calm'
  | 'plan'
  | 'needsaction'
  | 'dispatched'
  | 'scheduled'
  | 'resolved'
  | 'open'
  | 'current'
  | 'clear';

/** Pill variants — match the mockup `.pill.<variant>` class names. */
export type PillVariant =
  | 'plan'
  | 'watching'
  | 'current'
  | 'good'
  | 'aging'
  | 'replace';

/** Dot / accent tones — match the mockup `.bdot.<tone>` + ctx tints. */
export type Tone = 'clay' | 'amber' | 'green' | 'gold' | 'neutral' | 'ink';

/** Metric value tone — `warn` => clay, `good` => green-ink; omit for default. */
export type MetricTone = 'warn' | 'good';

/** Maintenance / work-order priority — match `.prio.<urgency>`. */
export type Urgency = 'urgent' | 'high' | 'normal' | 'low';

export interface BadgeSpec {
  variant: BadgeVariant;
  /** Human label, e.g. "At risk". */
  label: string;
}

export interface PillSpec {
  variant: PillVariant;
  label: string;
}

/** A row in the operating brief (`.brief-row`). */
export interface AttentionItem {
  /** Brief dot tone. */
  dot: Tone;
  /** Lead phrase, e.g. "Rent late". */
  kind: string;
  /** Optional location/who chip (`.bloc`). */
  loc?: string;
  /** Remainder of the line (`.bdetail`). */
  detail: string;
  /** Accessible label for the whole row. */
  ariaLabel: string;
  /** Action buttons (first may be primary). */
  actions: ActionLink[];
}

/** A single metric strip cell (`.metric-cell`). */
export interface MetricCell {
  label: string;
  value: string;
  tone?: MetricTone;
  /** Optional priority pill rendered in place of plain value (ticket page). */
  prio?: Urgency;
}

/** A key/value grid cell (`.kv .cell`). */
export interface KvCell {
  k: string;
  v: string;
  /** Render value in the mono/tabular face (currency etc.). */
  mono?: boolean;
}

/** A timeline event (`.event`). */
export interface TimelineEvent {
  time: string;
  /** Event actor variant => dot color. */
  variant: 'odesa' | 'tenant' | 'future' | 'neutral';
  /** Optional actor chip (`.actor`). */
  actor?: string;
  line: string;
}

/** A source / audit-trail row (`.source-item`). */
export interface SourceItem {
  label: string;
  /** Freshness suffix (`.sfresh`). */
  freshness: string;
}

/** A button-style action link. */
export interface ActionLink {
  label: string;
  /** `primary` => filled ink button. */
  variant: 'primary' | 'default';
  /** Optional href; when set, render as `<a>` rather than `<button>`. */
  href?: string;
}

/** The Ask-Odesa island config for a page. */
export interface AskSpec {
  /** Placeholder + sr-only label subject, e.g. "22 Oak St". */
  subject: string;
  /** In-context label suffix, e.g. "22 Oak St". */
  contextLabel: string;
  /** Suggestion chips. */
  prompts: string[];
}

/** The "Based on" evidence line under an Odesa note. */
export interface OdesaNote {
  /** Body HTML-free segments; `b` segments are bolded ink. */
  body: string;
  /** Optional "Based on" sources line. */
  basedOn?: string;
}

/** A "Next action" callout (`.next-action`). */
export interface NextAction {
  body: string;
}

/** A context / entity card (`.ctx-card`). */
export interface CtxCardSpec {
  /** Avatar glyph / initials / number. */
  avatar: string;
  name: string;
  /** Optional inline pill beside the name. */
  pill?: PillSpec;
  sub: string;
  actions: ActionLink[];
}

/* ------------------------------------------------------------------ */
/* Unit-specific sub-types                                             */
/* ------------------------------------------------------------------ */

/** An appliance registry row (`.reg-row`). */
export interface ApplianceRow {
  name: string;
  /** Optional sub line (e.g. "Replace recommended · linked to WO-1031"). */
  sub?: string;
  model: string;
  /** Warranty line (`.wl`). */
  warranty: string;
  /** Installed + age, e.g. "2012 · 14 yrs". */
  age: string;
  status: PillSpec;
  ariaLabel: string;
}

/** A maintenance ticket reference row (`.ticket-row`). */
export interface MaintenanceRef {
  /** `true` => resolved/calm check glyph; else terracotta diamond. */
  calm: boolean;
  title: string;
  /** Work-order display label, e.g. "WO-1031". */
  wo: string;
  /** Real work-order id for the route href (UUID). Falls back to `wo`. */
  woId?: string;
  sub: string;
  badge: BadgeSpec;
  /** Optional priority pill. */
  prio?: Urgency;
  ariaLabel: string;
}

/* ------------------------------------------------------------------ */
/* Work-order-specific sub-types                                       */
/* ------------------------------------------------------------------ */

/** A status stepper step (`.step`). */
export interface StepperStep {
  label: string;
  state: 'done' | 'current' | 'todo';
}

/** An owner-approval grid cell (`.approval .ac`). */
export interface ApprovalCell {
  k: string;
  v: string;
  mono?: boolean;
  /** Span the full grid width (`.ac.wide`). */
  wide?: boolean;
}

/** A tenant photo tile (`.photo`). */
export interface PhotoTile {
  caption: string;
}

/* ------------------------------------------------------------------ */
/* Communication thread (tenant page)                                  */
/* ------------------------------------------------------------------ */

export interface ThreadMessage {
  who: string;
  /** `true` => render in terracotta as Odesa. */
  odesa: boolean;
  time: string;
  body: string;
  /** `true` => italic serif draft styling. */
  draft?: boolean;
}

/* ------------------------------------------------------------------ */
/* Units table row (property page)                                     */
/* ------------------------------------------------------------------ */

export interface UnitRow {
  unitSlug: string;
  /** e.g. "Unit 1A". */
  label: string;
  tenantName: string;
  /** Optional tenant slug for cross-linking; absent => no tenant page. */
  tenantSlug?: string;
  /** Optional sub line under the tenant name (e.g. "3 days late"). */
  sub?: string;
  /** Formatted, e.g. "$1,520/mo". */
  rent: string;
  status: PillSpec;
  ariaLabel: string;
}

/* ------------------------------------------------------------------ */
/* Top-level entity shapes                                             */
/* ------------------------------------------------------------------ */

export interface PropertyDetailMock {
  slug: string;
  /** e.g. "22 Oak St". */
  name: string;
  badge: BadgeSpec;
  /** Title meta segments, joined by `·`. */
  meta: string[];
  /** Brief header count, e.g. "2 active · 1 risk". */
  attentionCount: string;
  attention: AttentionItem[];
  odesaNote: OdesaNote;
  metrics: MetricCell[];
  /** Units section sub line, e.g. "5 units · 1 on a plan · 1 watching". */
  unitsSub: string;
  units: UnitRow[];
  /** Rent panel. */
  rent: {
    /** Section head label, e.g. "Rent · May". */
    label: string;
    cells: KvCell[];
    note?: string;
  };
  /** Vendors / maintenance panel. */
  vendors: {
    /** Lead brief-row dot tone. */
    dot: Tone;
    kind: string;
    detail: string;
    cells: KvCell[];
  };
  sources: SourceItem[];
  ask: AskSpec;
}

export interface UnitDetailMock {
  propSlug: string;
  unitSlug: string;
  /** e.g. "Unit 1A". */
  label: string;
  badge: BadgeSpec;
  meta: string[];
  attentionCount: string;
  attention: AttentionItem[];
  odesaNote: OdesaNote;
  nextAction?: NextAction;
  metrics: MetricCell[];
  /** Tenant context card. */
  tenant: CtxCardSpec;
  /** Rent ledger KV. */
  rent: KvCell[];
  /** Lease KV. */
  lease: KvCell[];
  appliancesSub: string;
  appliances: ApplianceRow[];
  maintenanceSub: string;
  maintenance: MaintenanceRef[];
  /** Access / utilities KV (collapsed details). */
  access: KvCell[];
  /** Specs / safety KV (collapsed details). */
  specs: KvCell[];
  /**
   * rent_events.id of the current displayed cycle — the exact row the
   * "Record payment" modal targets. `null` (or absent on static mocks) when
   * the unit is vacant / has no rent activity.
   */
  rentEventId?: string | null;
  /**
   * Active lease id — powers the "Record payment" modal. `null` (or absent on
   * static mocks) when the unit is vacant.
   */
  leaseId?: string | null;
  /**
   * Current-cycle outstanding balance in DOLLARS (RecordPaymentModal expects
   * dollars). `0` when nothing is owed. Optional so static mocks needn't carry it.
   */
  outstandingDollars?: number;
  /**
   * True when Odesa recommends recording a payment for this unit (outstanding
   * balance > 0). Optional so static mocks needn't carry it.
   */
  recommendsPayment?: boolean;
  sources: SourceItem[];
  ask: AskSpec;
}

export interface TenantDetailMock {
  slug: string;
  /** e.g. "Maya R.". */
  name: string;
  badge: BadgeSpec;
  meta: string[];
  /** Property slug for the related card + crumb. */
  propSlug: string;
  unitSlug: string;
  /** Brief header label + count. */
  attentionLabel: string;
  attentionCount: string;
  attention: AttentionItem[];
  odesaNote: OdesaNote;
  metrics: MetricCell[];
  /** Payment timeline sub + events. */
  timelineSub: string;
  timeline: TimelineEvent[];
  /** Communication thread. */
  thread: ThreadMessage[];
  threadActions: ActionLink[];
  /**
   * Active lease id — present only for real rows with an active lease.
   * Powers the "Record payment" modal; absent on the static mocks.
   */
  leaseId?: string;
  /**
   * rent_events.id of the displayed/latest cycle — the exact row the
   * "Record payment" modal targets. Absent on the static mocks.
   */
  rentEventId?: string;
  /**
   * Current-cycle outstanding balance in DOLLARS. Drives whether the
   * "Record payment" affordance is offered (balance > 0). Optional so the
   * static mocks don't have to carry it.
   */
  outstandingDollars?: number;
  /** Lease & rules KV. */
  leaseRules: KvCell[];
  /** Related property/unit card. */
  related: CtxCardSpec;
  sources: SourceItem[];
  ask: AskSpec;
}

export interface WorkOrderMock {
  woId: string;
  /**
   * Raw urgency/status enum values from the real query, so the detail page can
   * offer an operator override of the AI-set fields. Optional: the static mocks
   * omit them; `getWorkOrderDetail` always populates them.
   */
  urgency?: string;
  status?: string;
  /** e.g. "Active leak under kitchen sink". */
  title: string;
  badge: BadgeSpec;
  meta: string[];
  propSlug: string;
  unitSlug: string;
  /**
   * Slug of the vendor that owns this order, for cross-linking to the vendor
   * brief via `vendorHref(slug)` (see ./mock-portfolio-views.ts). Matches the
   * vendor named in `vendor.name` / `metrics` (e.g. "Diaz Plumbing" =>
   * "diaz-plumbing"). Omitted only when no vendor is assigned yet.
   */
  vendorSlug?: string;
  /** Status stepper. */
  stepperAria: string;
  stepper: StepperStep[];
  attentionCount: string;
  attention: AttentionItem[];
  odesaNote: OdesaNote;
  nextAction: NextAction;
  metrics: MetricCell[];
  /** Work-order timeline sub + events. */
  timelineSub: string;
  timeline: TimelineEvent[];
  /** Owner approval block. */
  approvalSub: string;
  approval: ApprovalCell[];
  /** Vendor context card. */
  vendor: CtxCardSpec;
  /** Access / mitigation KV. */
  access: KvCell[];
  photos: PhotoTile[];
  sources: SourceItem[];
  ask: AskSpec;
}

/* ------------------------------------------------------------------ */
/* HREF helpers (pure — build URLs with template strings)              */
/* ------------------------------------------------------------------ */

export function propertyHref(propSlug: string): string {
  return `/properties/${propSlug}`;
}

export function unitHref(propSlug: string, unitSlug: string): string {
  return `/properties/${propSlug}/units/${unitSlug}`;
}

export function tenantHref(slug: string): string {
  return `/tenants/${slug}`;
}

export function workOrderHref(woId: string): string {
  return `/work-orders/${woId}`;
}

/* ================================================================== */
/* PROPERTY: oak — 22 Oak St (VERBATIM from property-detail.html)      */
/* ================================================================== */

const OAK_PROPERTY: PropertyDetailMock = {
  slug: 'oak',
  name: '22 Oak St',
  badge: { variant: 'atrisk', label: 'At risk' },
  meta: ['Sterling, VA', '5 units', '5/5 occupied', '88% May collected'],
  attentionCount: '2 active · 1 risk',
  attention: [
    {
      dot: 'clay',
      kind: 'Rent late',
      loc: 'Unit 1A',
      detail: '3 days late · payment plan set · first catch-up due Friday',
      ariaLabel:
        'Rent late at Unit 1A. 3 days late · payment plan set · first catch-up due Friday',
      actions: [
        { label: 'Review plan', variant: 'primary' },
        { label: 'Message tenant', variant: 'default' },
      ],
    },
    {
      dot: 'amber',
      kind: 'Noise complaint',
      loc: 'Unit 4',
      detail: 'Second report in 30 days · watching',
      ariaLabel:
        'Noise complaint at Unit 4. Second report in 30 days · watching',
      actions: [
        { label: 'View thread', variant: 'default' },
        { label: 'Prepare reminder', variant: 'default' },
      ],
    },
    {
      dot: 'amber',
      kind: 'Collection risk',
      detail: '$1,520 outstanding · 88% of May collected',
      ariaLabel:
        'Collection risk. $1,520 outstanding · 88% of May collected',
      actions: [{ label: 'View ledger', variant: 'default' }],
    },
  ],
  odesaNote: {
    body: "Odesa is watching Unit 1A's payment plan and the Unit 4 noise pattern. **No owner escalation** is recommended unless Friday's catch-up payment is missed or another complaint is reported.",
    basedOn: 'payment history · tenant messages · owner rules · noise log',
  },
  metrics: [
    { label: 'Occupancy', value: '5/5' },
    { label: 'May collected', value: '88%', tone: 'warn' },
    { label: 'Active items', value: '2' },
    { label: 'Monthly rent', value: '$7,640' },
    { label: 'Next deadline', value: 'Fri' },
  ],
  unitsSub: '5 units · 1 on a plan · 1 watching',
  units: [
    {
      unitSlug: '1a',
      label: 'Unit 1A',
      tenantName: 'Maya R.',
      tenantSlug: 'maya',
      sub: '3 days late',
      rent: '$1,520/mo',
      status: { variant: 'plan', label: 'Payment plan' },
      ariaLabel:
        'View Unit 1A, tenant Maya R., $1,520/mo, Payment plan, 3 days late',
    },
    {
      unitSlug: '2b',
      label: 'Unit 2B',
      tenantName: 'Aaron V.',
      rent: '$1,480/mo',
      status: { variant: 'current', label: 'Current' },
      ariaLabel: 'View Unit 2B, tenant Aaron V., $1,480/mo, Current',
    },
    {
      unitSlug: '3c',
      label: 'Unit 3C',
      tenantName: 'Dana W.',
      tenantSlug: 'dana-w',
      rent: '$1,535/mo',
      status: { variant: 'current', label: 'Current' },
      ariaLabel: 'View Unit 3C, tenant Dana W., $1,535/mo, Current',
    },
    {
      unitSlug: '4',
      label: 'Unit 4',
      tenantName: 'Jon Bell',
      sub: 'Noise complaint',
      rent: '$1,560/mo',
      status: { variant: 'watching', label: 'Watching' },
      ariaLabel:
        'View Unit 4, tenant Jon Bell, $1,560/mo, Watching, Noise complaint',
    },
    {
      unitSlug: '5',
      label: 'Unit 5',
      tenantName: 'Nora K.',
      rent: '$1,545/mo',
      status: { variant: 'current', label: 'Current' },
      ariaLabel: 'View Unit 5, tenant Nora K., $1,545/mo, Current',
    },
  ],
  rent: {
    label: 'Rent · May',
    cells: [
      { k: 'May collected', v: '88%' },
      { k: 'Outstanding', v: '$1,520', mono: true },
      { k: 'Late unit', v: 'Unit 1A' },
      { k: 'Next expected', v: 'Friday' },
    ],
    note: "If Friday's payment is missed, Odesa will draft escalation options for your review.",
  },
  vendors: {
    dot: 'green',
    kind: 'No open work orders',
    detail: 'This property is operationally calm on maintenance.',
    cells: [
      { k: 'Last vendor visit', v: 'Apr 18' },
      { k: 'Work', v: 'HVAC filter' },
    ],
  },
  sources: [
    { label: 'Payment history', freshness: 'synced 11m ago' },
    { label: 'Tenant message thread', freshness: 'last reply May 6' },
    { label: 'Lease terms', freshness: 'active' },
    { label: 'Owner rules', freshness: 'active' },
    { label: 'Noise complaint log', freshness: '2 reports / 30d' },
  ],
  ask: {
    subject: '22 Oak St',
    contextLabel: '22 Oak St',
    prompts: [
      'What should I do first?',
      'Draft Maya a payment-plan message',
      'Show rent risk',
      'Summarize Unit 4 noise history',
      'Prepare owner update',
    ],
  },
};

/* ================================================================== */
/* UNIT: oak/1a — Unit 1A (VERBATIM from unit-detail.html)             */
/* ================================================================== */

const OAK_1A_UNIT: UnitDetailMock = {
  propSlug: 'oak',
  unitSlug: '1a',
  label: 'Unit 1A',
  badge: { variant: 'watching', label: 'Watching' },
  meta: ['22 Oak St', 'Sterling, VA', 'occupied', '$1,520/mo'],
  attentionCount: '1 active',
  attention: [
    {
      dot: 'clay',
      kind: 'Rent late',
      loc: 'Maya R.',
      detail: '3 days late · payment plan set',
      ariaLabel: 'Rent late at Maya R.. 3 days late · payment plan set',
      actions: [
        { label: 'Review plan', variant: 'primary' },
        { label: 'Message tenant', variant: 'default' },
      ],
    },
    {
      dot: 'green',
      kind: 'Lease healthy',
      detail: 'Lease through Mar 2027 · no renewal action needed',
      ariaLabel:
        'Lease healthy. Lease through Mar 2027 · no renewal action needed',
      actions: [{ label: 'View lease', variant: 'default' }],
    },
    {
      dot: 'green',
      kind: 'Maintenance stable',
      detail: 'No tenant requests open · water heater replacement in owner review',
      ariaLabel:
        'Maintenance stable. No tenant requests open · water heater replacement in owner review',
      actions: [{ label: 'View item', variant: 'default' }],
    },
  ],
  odesaNote: {
    body: "Unit 1A is operationally stable except for Maya's active payment plan. Odesa recommends **watching Friday's catch-up payment** before escalating.",
    basedOn: 'ledger · lease terms · maintenance history · owner rules',
  },
  nextAction: {
    body: "Watch Friday's catch-up payment from Maya. If it's missed, Odesa will prepare escalation options and notify the owner — no action needed before then.",
  },
  metrics: [
    { label: 'Occupancy', value: 'Occupied', tone: 'good' },
    { label: 'Rent', value: '$1,520' },
    { label: 'Balance', value: '$1,520', tone: 'warn' },
    { label: 'Lease end', value: 'Mar 2027' },
    { label: 'Maintenance', value: '0 open', tone: 'good' },
  ],
  tenant: {
    avatar: 'M',
    name: 'Maya R.',
    pill: { variant: 'plan', label: 'Payment plan' },
    sub: 'First late payment in 12 months',
    actions: [
      { label: 'View tenant', variant: 'default', href: tenantHref('maya') },
      { label: 'Draft reminder', variant: 'primary' },
    ],
  },
  rent: [
    { k: 'Due', v: '$1,520', mono: true },
    { k: 'Paid', v: '$0', mono: true },
    { k: 'Outstanding', v: '$1,520', mono: true },
    { k: 'Next expected', v: 'Friday' },
    { k: 'Payment plan', v: 'Active' },
    { k: 'Status', v: '3 days late' },
  ],
  lease: [
    { k: 'Start', v: 'Apr 2025' },
    { k: 'End', v: 'Mar 2027' },
    { k: 'Deposit', v: '$1,520', mono: true },
    { k: 'Late fee', v: '$50', mono: true },
    { k: 'Renewal window', v: 'Opens Dec 2026' },
  ],
  appliancesSub: '5 tracked · 1 flagged for replacement',
  appliances: [
    {
      name: 'Water heater',
      sub: 'Replace recommended · linked to WO-1031',
      model: 'Rheem XE40 · 40 gal',
      warranty: 'Out of warranty',
      age: '2012 · 14 yrs',
      status: { variant: 'replace', label: 'Replace' },
      ariaLabel:
        'Water heater, Rheem XE40 · 40 gal, installed 2012 · 14 yrs, Replace',
    },
    {
      name: 'HVAC system',
      sub: 'Serviced Apr 18 · Comfort Air',
      model: 'Carrier 24ABC6',
      warranty: 'Warranty to 2029',
      age: '2019 · 7 yrs',
      status: { variant: 'good', label: 'Good' },
      ariaLabel: 'HVAC system, Carrier 24ABC6, installed 2019 · 7 yrs, Good',
    },
    {
      name: 'Refrigerator',
      model: 'Whirlpool WRX735',
      warranty: 'Warranty to 2026',
      age: '2021 · 5 yrs',
      status: { variant: 'good', label: 'Good' },
      ariaLabel: 'Refrigerator, Whirlpool WRX735, installed 2021 · 5 yrs, Good',
    },
    {
      name: 'Dishwasher',
      model: 'Bosch 300 · SHEM63',
      warranty: 'Warranty to 2026',
      age: '2021 · 5 yrs',
      status: { variant: 'good', label: 'Good' },
      ariaLabel: 'Dishwasher, Bosch 300 · SHEM63, installed 2021 · 5 yrs, Good',
    },
    {
      name: 'Range / oven',
      model: 'GE JB645',
      warranty: 'Out of warranty',
      age: '2018 · 8 yrs',
      status: { variant: 'aging', label: 'Aging' },
      ariaLabel: 'Range / oven, GE JB645, installed 2018 · 8 yrs, Aging',
    },
  ],
  maintenanceSub: 'No open tenant requests · 1 owner decision pending',
  maintenance: [
    {
      calm: false,
      title: 'Replace water heater',
      wo: 'WO-1031',
      sub: 'Linked from the water heater appliance flag · queued in owner decisions',
      badge: { variant: 'scheduled', label: 'Owner review' },
      prio: 'high',
      ariaLabel: 'Replace water heater',
    },
    {
      calm: true,
      title: 'HVAC filter replacement',
      wo: 'WO-0998',
      sub: 'Completed Apr 18 · Comfort Air',
      badge: { variant: 'resolved', label: 'Resolved' },
      ariaLabel: 'HVAC filter replacement',
    },
  ],
  access: [
    { k: 'Entry', v: 'Smart lock · code on file' },
    { k: 'Mailbox', v: '#1A' },
    { k: 'Parking', v: '1 space · Lot B-3' },
    { k: 'Internet', v: 'Tenant' },
    { k: 'Electricity', v: 'Tenant · Dominion' },
    { k: 'Water / sewer', v: 'Owner' },
    { k: 'Gas', v: 'Tenant · WGL' },
    { k: 'Trash', v: 'Owner · HOA' },
  ],
  specs: [
    { k: 'Size', v: '720 sq ft' },
    { k: 'Layout', v: '1 bed · 1 bath' },
    { k: 'Floor', v: '1st' },
    { k: 'HVAC filter', v: 'Next due Jul 2026' },
    { k: 'Smoke detector', v: 'Checked Jan 2026' },
    { k: 'CO detector', v: 'Checked Jan 2026' },
  ],
  sources: [
    { label: 'Lease', freshness: 'active' },
    { label: 'Ledger', freshness: 'synced 11m ago' },
    { label: 'Tenant messages', freshness: 'last reply May 6' },
    { label: 'Maintenance history', freshness: 'updated Apr 18' },
    { label: 'Owner rules', freshness: 'active' },
  ],
  ask: {
    subject: 'Unit 1A',
    contextLabel: 'Unit 1A',
    prompts: [
      'What needs attention?',
      'Draft tenant reminder',
      'Show lease terms',
      'Summarize payment plan',
      'Create escalation plan',
    ],
  },
};

/* ================================================================== */
/* TENANT: maya — Maya R. (VERBATIM from tenant-detail.html)           */
/* ================================================================== */

const MAYA_TENANT: TenantDetailMock = {
  slug: 'maya',
  name: 'Maya R.',
  badge: { variant: 'plan', label: 'Payment plan' },
  meta: ['22 Oak St', 'Unit 1A', '$1,520/mo', 'lease through Mar 2027'],
  propSlug: 'oak',
  unitSlug: '1a',
  attentionLabel: 'What matters with Maya',
  attentionCount: 'payment risk: low',
  attention: [
    {
      dot: 'clay',
      kind: 'Rent late',
      detail: '3 days late · $1,520 outstanding',
      ariaLabel: 'Rent late. 3 days late · $1,520 outstanding',
      actions: [{ label: 'Review plan', variant: 'primary' }],
    },
    {
      dot: 'amber',
      kind: 'Payment plan active',
      detail: 'First catch-up payment due Friday',
      ariaLabel: 'Payment plan active. First catch-up payment due Friday',
      actions: [{ label: 'Schedule reminder', variant: 'default' }],
    },
    {
      dot: 'green',
      kind: 'Strong relationship',
      detail: 'No prior late payments in 12 months',
      ariaLabel: 'Strong relationship. No prior late payments in 12 months',
      actions: [{ label: 'View history', variant: 'default' }],
    },
  ],
  odesaNote: {
    body: "Odesa recommends keeping the current payment plan in place and sending a **calm reminder Thursday afternoon**. Escalation is not recommended unless Friday's payment is missed.",
    basedOn: 'payment ledger · message thread · owner rules',
  },
  metrics: [
    { label: 'Balance', value: '$1,520', tone: 'warn' },
    { label: 'Days late', value: '3', tone: 'warn' },
    { label: 'Rent', value: '$1,520' },
    { label: 'Lease end', value: 'Mar 2027' },
    { label: 'History', value: '1st in 12mo', tone: 'good' },
  ],
  timelineSub: 'May cycle',
  timeline: [
    { time: 'May 1', variant: 'tenant', line: 'Rent due for May.' },
    {
      time: 'May 4',
      variant: 'tenant',
      line: 'Grace period ended — payment not received.',
    },
    {
      time: 'May 5',
      variant: 'odesa',
      actor: 'Odesa',
      line: 'Sent a calm payment reminder by SMS.',
    },
    {
      time: 'May 6',
      variant: 'tenant',
      actor: 'Maya',
      line: 'Replied citing a paycheck timing issue; agreed to a payment plan.',
    },
    {
      time: 'Friday',
      variant: 'future',
      line: 'Catch-up payment due — Odesa will confirm receipt.',
    },
  ],
  thread: [
    {
      who: 'Odesa',
      odesa: true,
      time: 'May 5',
      body: 'Reminder that May rent is past the grace period — offered a short payment plan.',
    },
    {
      who: 'Maya R.',
      odesa: false,
      time: 'May 6',
      body: '“So sorry — paycheck landed late. Can I split it and clear it by Friday?”',
    },
    {
      who: 'Odesa',
      odesa: true,
      time: 'Draft',
      body: 'Hi Maya — just a friendly reminder your catch-up payment is set for Friday. Thanks again for the heads up.',
      draft: true,
    },
  ],
  threadActions: [
    { label: 'Draft reminder', variant: 'primary' },
    { label: 'Schedule for Thursday', variant: 'default' },
  ],
  leaseRules: [
    { k: 'Grace period', v: '3 days' },
    { k: 'Late fee', v: '$50', mono: true },
    { k: 'Escalation', v: 'Owner review after missed plan payment' },
    { k: 'Auto-message', v: 'Reminder 24h before plan due' },
  ],
  related: {
    avatar: '22',
    name: '22 Oak St · Unit 1A',
    sub: 'Property status: At risk · collection + noise items (unit: watching)',
    actions: [
      { label: 'View property', variant: 'default', href: '/properties/oak' },
      { label: 'View unit', variant: 'default', href: unitHref('oak', '1a') },
    ],
  },
  sources: [
    { label: 'Payment ledger', freshness: 'synced 11m ago' },
    { label: 'Lease terms', freshness: 'active' },
    { label: 'Message thread', freshness: 'last reply May 6' },
    { label: 'Owner rules', freshness: 'active' },
  ],
  ask: {
    subject: 'Maya R.',
    contextLabel: 'Maya R.',
    prompts: [
      'Draft a reminder',
      'Should we waive the late fee?',
      'Summarize payment history',
      'What happens if Friday is missed?',
      'Prepare escalation options',
    ],
  },
};

/* ================================================================== */
/* WORK ORDER: WO-1042 (VERBATIM from maintenance-ticket.html)         */
/* ================================================================== */

const WO_1042: WorkOrderMock = {
  woId: 'WO-1042',
  title: 'Active leak under kitchen sink',
  badge: { variant: 'dispatched', label: 'Vendor accepted' },
  meta: ['WO-1042', '14 Maple Ct', 'Unit 3B', 'opened 6h ago'],
  propSlug: 'maple',
  unitSlug: '3b',
  vendorSlug: 'diaz-plumbing',
  stepperAria: 'Status: Accepted',
  stepper: [
    { label: 'Dispatched', state: 'done' },
    { label: 'Accepted', state: 'current' },
    { label: 'En route', state: 'todo' },
    { label: 'On site', state: 'todo' },
    { label: 'Completed', state: 'todo' },
  ],
  attentionCount: 'urgent · on track',
  attention: [
    {
      dot: 'clay',
      kind: 'Active leak',
      loc: 'Unit 3B kitchen',
      detail: 'Vendor dispatched · ETA today 2–4 PM',
      ariaLabel:
        'Active leak at Unit 3B kitchen. Vendor dispatched · ETA today 2–4 PM',
      actions: [
        { label: 'Check ETA', variant: 'primary' },
        { label: 'Message tenant', variant: 'default' },
      ],
    },
    {
      dot: 'amber',
      kind: 'Tenant impact',
      loc: 'Priya S.',
      detail: 'Notified · entry access confirmed',
      ariaLabel:
        'Tenant impact at Priya S.. Notified · entry access confirmed',
      actions: [{ label: 'View thread', variant: 'default' }],
    },
    {
      dot: 'green',
      kind: 'Cost approved',
      detail: '$640 cleared in the owner queue this morning',
      ariaLabel:
        'Cost approved. $640 cleared in the owner queue this morning',
      actions: [{ label: 'View decision', variant: 'default' }],
    },
  ],
  odesaNote: {
    body: 'Odesa dispatched **Diaz Plumbing** after the $640 estimate was approved in the owner queue. Vendor ETA is **2–4 PM today**. No further action is needed unless the vendor misses the window — Odesa will re-dispatch automatically.',
    basedOn: 'tenant report · owner approval · vendor quote · work order log',
  },
  nextAction: {
    body: "Waiting for **Diaz Plumbing** to arrive (2–4 PM). Odesa will check the ETA and **re-dispatch automatically** if the vendor isn't on site by 4:15 PM.",
  },
  metrics: [
    { label: 'Priority', value: 'Urgent', prio: 'urgent' },
    { label: 'Status', value: 'Accepted', tone: 'warn' },
    { label: 'Vendor', value: 'Diaz Plumbing' },
    { label: 'Estimate', value: '$640' },
    { label: 'Opened', value: '6h ago' },
  ],
  timelineSub: 'Reported → dispatched',
  timeline: [
    {
      time: '8:12 AM',
      variant: 'tenant',
      actor: 'Priya S.',
      line: 'Reported water pooling under the kitchen sink. Two photos attached.',
    },
    {
      time: '8:14 AM',
      variant: 'odesa',
      actor: 'Odesa',
      line: 'Triaged as an urgent active leak; categorized as plumbing.',
    },
    {
      time: '8:20 AM',
      variant: 'odesa',
      actor: 'Odesa',
      line: 'Flagged for owner approval — $640 estimate exceeds the $250 auto-approve ceiling.',
    },
    {
      time: '9:05 AM',
      variant: 'tenant',
      actor: 'Owner',
      line: 'Vaibhav approved the dispatch from the owner queue.',
    },
    {
      time: '9:06 AM',
      variant: 'odesa',
      actor: 'Odesa',
      line: 'Dispatched Diaz Plumbing · same-day · ETA 2–4 PM.',
    },
    {
      time: '9:18 AM',
      variant: 'neutral',
      actor: 'Diaz Plumbing',
      line: 'Accepted the job and confirmed the 2–4 PM arrival window.',
    },
    {
      time: '2–4 PM',
      variant: 'future',
      line: 'Vendor on-site window — Odesa will confirm arrival and resolution.',
    },
  ],
  approvalSub: 'cleared in the owner queue',
  approval: [
    { k: 'Approved by', v: 'Vaibhav S.' },
    { k: 'Approved at', v: '9:05 AM today' },
    { k: 'Amount', v: '$640', mono: true },
    { k: 'Basis', v: 'Exceeded the $250 auto-approve threshold' },
    {
      k: 'Scope',
      v: 'Dispatch Diaz Plumbing for the under-sink leak at Unit 3B',
      wide: true,
    },
  ],
  vendor: {
    avatar: 'D',
    name: 'Diaz Plumbing',
    sub: 'Same-day plumber · 4.8★ · accepted · ETA 2–4 PM',
    actions: [
      { label: 'View vendor', variant: 'default', href: '/vendors/diaz-plumbing' },
      { label: 'Call', variant: 'default' },
    ],
  },
  access: [
    { k: 'Water', v: 'Shut off at valve · by tenant' },
    { k: 'Containment', v: 'Bucket + towels placed' },
    { k: 'Tenant home', v: 'No · entry authorized' },
    { k: 'Pets', v: '1 cat · indoors' },
    { k: 'Access', v: 'Lockbox code shared w/ vendor' },
    { k: 'Issue', v: 'Under-sink plumbing' },
  ],
  photos: [{ caption: 'Under sink' }, { caption: 'Cabinet floor' }],
  sources: [
    { label: 'Tenant report & photos', freshness: '8:12 AM today' },
    { label: 'Owner approval (queue)', freshness: '9:05 AM today' },
    { label: 'Vendor quote · Diaz Plumbing', freshness: '$640 · today' },
    { label: 'Work order log', freshness: 'live' },
    { label: 'Lease §9 entry terms', freshness: 'active' },
  ],
  ask: {
    subject: 'WO-1042',
    contextLabel: 'WO-1042',
    prompts: [
      'Check the vendor ETA',
      'Message Priya',
      'Reschedule the visit',
      'Mark resolved',
      'Summarize for the owner',
    ],
  },
};

/* ================================================================== */
/* GENERATED: cedar — 108 Cedar Ln (watching · vendor overdue)         */
/* ================================================================== */

const CEDAR_PROPERTY: PropertyDetailMock = {
  slug: 'cedar',
  name: '108 Cedar Ln',
  badge: { variant: 'watching', label: 'Watching' },
  meta: ['Leesburg, VA', '3 units', '3/3 occupied', '100% May collected'],
  attentionCount: '1 active',
  attention: [
    {
      dot: 'clay',
      kind: 'Vendor overdue',
      loc: 'Unit 2C',
      detail: 'Northstar 24h late on the disposal repair · escalation ready',
      ariaLabel:
        'Vendor overdue at Unit 2C. Northstar 24h late on the disposal repair · escalation ready',
      actions: [
        { label: 'Escalate', variant: 'primary' },
        { label: 'View order', variant: 'default' },
      ],
    },
    {
      dot: 'green',
      kind: 'Rent collected',
      detail: '100% of May collected across all three units',
      ariaLabel: 'Rent collected. 100% of May collected across all three units',
      actions: [{ label: 'View ledger', variant: 'default' }],
    },
  ],
  odesaNote: {
    body: 'Odesa flagged **Northstar Appliance** as 24h past its committed window on the Unit 2C disposal. An escalation message is **drafted and ready** — Odesa will send it if there is no response by end of day.',
    basedOn: 'work order log · vendor SLA · tenant messages',
  },
  metrics: [
    { label: 'Occupancy', value: '3/3' },
    { label: 'May collected', value: '100%', tone: 'good' },
    { label: 'Active items', value: '1' },
    { label: 'Monthly rent', value: '$4,230' },
    { label: 'Next deadline', value: 'Today' },
  ],
  unitsSub: '3 units · 1 vendor delay · 2 calm',
  units: [
    {
      unitSlug: '1a',
      label: 'Unit 1A',
      tenantName: 'Marcus T.',
      tenantSlug: 'marcus',
      rent: '$1,410/mo',
      status: { variant: 'current', label: 'Current' },
      ariaLabel: 'View Unit 1A, tenant Marcus T., $1,410/mo, Current',
    },
    {
      unitSlug: '2c',
      label: 'Unit 2C',
      tenantName: 'Sandra K.',
      tenantSlug: 'sandra-k',
      sub: 'Disposal repair pending',
      rent: '$1,390/mo',
      status: { variant: 'current', label: 'Current' },
      ariaLabel:
        'View Unit 2C, tenant Sandra K., $1,390/mo, Current, Disposal repair pending',
    },
    {
      unitSlug: '3b',
      label: 'Unit 3B',
      tenantName: 'Owen L.',
      tenantSlug: 'owen',
      rent: '$1,430/mo',
      status: { variant: 'current', label: 'Current' },
      ariaLabel: 'View Unit 3B, tenant Owen L., $1,430/mo, Current',
    },
  ],
  rent: {
    label: 'Rent · May',
    cells: [
      { k: 'May collected', v: '100%' },
      { k: 'Outstanding', v: '$0', mono: true },
      { k: 'Late unit', v: 'None' },
      { k: 'Next expected', v: 'Jun 1' },
    ],
  },
  vendors: {
    dot: 'clay',
    kind: 'Vendor delay · Unit 2C',
    detail: 'Northstar Appliance 24h overdue · escalation drafted',
    cells: [
      { k: 'Open order', v: 'WO-1044' },
      { k: 'Vendor', v: 'Northstar Appliance' },
    ],
  },
  sources: [
    { label: 'Work order log', freshness: 'updated 2h ago' },
    { label: 'Vendor SLA terms', freshness: 'active' },
    { label: 'Payment history', freshness: 'synced 11m ago' },
    { label: 'Tenant message thread', freshness: 'last reply May 7' },
    { label: 'Owner rules', freshness: 'active' },
  ],
  ask: {
    subject: '108 Cedar Ln',
    contextLabel: '108 Cedar Ln',
    prompts: [
      'Escalate the overdue vendor',
      'Draft a Northstar follow-up',
      'Show the Unit 2C work order',
      'Summarize maintenance status',
      'Prepare owner update',
    ],
  },
};

/* ================================================================== */
/* GENERATED: maple — 14 Maple Ct (watching · active leak owns WO-1042)*/
/* ================================================================== */

const MAPLE_PROPERTY: PropertyDetailMock = {
  slug: 'maple',
  name: '14 Maple Ct',
  badge: { variant: 'watching', label: 'Watching' },
  meta: ['Ashburn, VA', '4 units', '4/4 occupied', '100% May collected'],
  attentionCount: '2 active',
  attention: [
    {
      dot: 'clay',
      kind: 'Leak active',
      loc: 'Unit 3B',
      detail: 'Vendor dispatched · Diaz Plumbing ETA 2–4 PM · WO-1042',
      ariaLabel:
        'Leak active at Unit 3B. Vendor dispatched · Diaz Plumbing ETA 2–4 PM · work order WO-1042',
      actions: [
        { label: 'Check ETA', variant: 'primary', href: workOrderHref('WO-1042') },
        { label: 'View order', variant: 'default', href: workOrderHref('WO-1042') },
      ],
    },
    {
      dot: 'amber',
      kind: 'Renewal due',
      loc: 'Unit 4D',
      detail: 'Lease renewal deadline Friday · owner approval needed',
      ariaLabel:
        'Renewal due at Unit 4D. Lease renewal deadline Friday · owner approval needed',
      actions: [
        { label: 'Review renewal', variant: 'default' },
        { label: 'Send to owner', variant: 'default' },
      ],
    },
  ],
  odesaNote: {
    body: "Odesa is tracking the Unit 3B leak (vendor **on the way, 2–4 PM**) and the Unit 4D renewal due Friday. **No owner escalation** on the leak — the $640 estimate is already approved. The renewal needs an owner decision before Friday.",
    basedOn: 'work order log · vendor quote · lease calendar · owner rules',
  },
  metrics: [
    { label: 'Occupancy', value: '4/4' },
    { label: 'May collected', value: '100%', tone: 'good' },
    { label: 'Active items', value: '2' },
    { label: 'Monthly rent', value: '$6,045' },
    { label: 'Next deadline', value: 'Fri' },
  ],
  unitsSub: '4 units · 1 active leak · 1 renewal due',
  units: [
    {
      unitSlug: '1a',
      label: 'Unit 1A',
      tenantName: 'Lena M.',
      tenantSlug: 'lena',
      rent: '$1,495/mo',
      status: { variant: 'current', label: 'Current' },
      ariaLabel: 'View Unit 1A, tenant Lena M., $1,495/mo, Current',
    },
    {
      unitSlug: '2b',
      label: 'Unit 2B',
      tenantName: 'Carlos R.',
      tenantSlug: 'carlos-r',
      rent: '$1,500/mo',
      status: { variant: 'current', label: 'Current' },
      ariaLabel: 'View Unit 2B, tenant Carlos R., $1,500/mo, Current',
    },
    {
      unitSlug: '3b',
      label: 'Unit 3B',
      tenantName: 'Priya S.',
      tenantSlug: 'priya',
      sub: 'Active leak · vendor en route',
      rent: '$1,540/mo',
      status: { variant: 'watching', label: 'Watching' },
      ariaLabel:
        'View Unit 3B, tenant Priya S., $1,540/mo, Watching, Active leak vendor en route',
    },
    {
      unitSlug: '4d',
      label: 'Unit 4D',
      tenantName: 'Eli N.',
      tenantSlug: 'eli-n',
      sub: 'Renewal due Friday',
      rent: '$1,510/mo',
      status: { variant: 'watching', label: 'Watching' },
      ariaLabel:
        'View Unit 4D, tenant Eli N., $1,510/mo, Watching, Renewal due Friday',
    },
  ],
  rent: {
    label: 'Rent · May',
    cells: [
      { k: 'May collected', v: '100%' },
      { k: 'Outstanding', v: '$0', mono: true },
      { k: 'Late unit', v: 'None' },
      { k: 'Next expected', v: 'Jun 1' },
    ],
    note: 'All four units are current for May — the open items are the Unit 3B leak and the Unit 4D renewal, not rent.',
  },
  vendors: {
    dot: 'amber',
    kind: 'Leak repair in progress · Unit 3B',
    detail: 'Diaz Plumbing accepted · ETA 2–4 PM · WO-1042',
    cells: [
      { k: 'Open order', v: 'WO-1042' },
      { k: 'Vendor', v: 'Diaz Plumbing' },
    ],
  },
  sources: [
    { label: 'Work order log', freshness: 'live' },
    { label: 'Vendor quote · Diaz Plumbing', freshness: '$640 · today' },
    { label: 'Lease calendar', freshness: 'renewal Fri' },
    { label: 'Payment history', freshness: 'synced 11m ago' },
    { label: 'Owner rules', freshness: 'active' },
  ],
  ask: {
    subject: '14 Maple Ct',
    contextLabel: '14 Maple Ct',
    prompts: [
      'Check the Unit 3B leak ETA',
      'Review the Unit 4D renewal',
      'Show rent outstanding',
      'Summarize maintenance status',
      'Prepare owner update',
    ],
  },
};

/* ================================================================== */
/* GENERATED: elm — 30 Elm St (leasing · 1 vacancy)                    */
/* ================================================================== */

const ELM_PROPERTY: PropertyDetailMock = {
  slug: 'elm',
  name: '30 Elm St',
  badge: { variant: 'leasing', label: 'Leasing' },
  meta: ['Herndon, VA', '3 units', '2/3 occupied', '100% May collected'],
  attentionCount: '1 active',
  attention: [
    {
      dot: 'gold',
      kind: 'Vacancy',
      loc: 'Unit 2',
      detail: 'Listed 9 days · 4 tours booked · 1 application in review',
      ariaLabel:
        'Vacancy at Unit 2. Listed 9 days · 4 tours booked · 1 application in review',
      actions: [
        { label: 'View tours', variant: 'primary' },
        { label: 'Review application', variant: 'default' },
      ],
    },
    {
      dot: 'green',
      kind: 'Rent collected',
      detail: '100% of May collected from both occupied units',
      ariaLabel: 'Rent collected. 100% of May collected from both occupied units',
      actions: [{ label: 'View ledger', variant: 'default' }],
    },
  ],
  odesaNote: {
    body: 'Unit 2 has been on the market **9 days** with healthy interest — 4 tours and 1 application under review. Odesa recommends **screening the current applicant** before lowering the asking rent.',
    basedOn: 'listing analytics · application queue · market comps',
  },
  metrics: [
    { label: 'Occupancy', value: '2/3', tone: 'warn' },
    { label: 'May collected', value: '100%', tone: 'good' },
    { label: 'Active items', value: '1' },
    { label: 'Monthly rent', value: '$2,935' },
    { label: 'Days listed', value: '9' },
  ],
  unitsSub: '3 units · 1 vacant · listing active',
  units: [
    {
      unitSlug: '1',
      label: 'Unit 1',
      tenantName: 'Grace H.',
      tenantSlug: 'grace-h',
      rent: '$1,475/mo',
      status: { variant: 'current', label: 'Current' },
      ariaLabel: 'View Unit 1, tenant Grace H., $1,475/mo, Current',
    },
    {
      unitSlug: '2',
      label: 'Unit 2',
      tenantName: 'Vacant',
      sub: 'Listed · 4 tours booked',
      rent: '$1,575/mo',
      status: { variant: 'watching', label: 'Listed' },
      ariaLabel:
        'View Unit 2, vacant, $1,575/mo asking, Listed, 4 tours booked',
    },
    {
      unitSlug: '3',
      label: 'Unit 3',
      tenantName: 'Tom B.',
      tenantSlug: 'tom-b',
      rent: '$1,460/mo',
      status: { variant: 'current', label: 'Current' },
      ariaLabel: 'View Unit 3, tenant Tom B., $1,460/mo, Current',
    },
  ],
  rent: {
    label: 'Rent · May',
    cells: [
      { k: 'May collected', v: '100%' },
      { k: 'Outstanding', v: '$0', mono: true },
      { k: 'Vacancy loss', v: '$1,575', mono: true },
      { k: 'Next expected', v: 'Jun 1' },
    ],
    note: 'Each vacant week costs roughly $360 — Odesa is prioritizing tour-to-application conversion.',
  },
  vendors: {
    dot: 'green',
    kind: 'Turn complete · Unit 2',
    detail: 'Paint + clean finished before listing · no open work orders.',
    cells: [
      { k: 'Last turn', v: 'Apr 30' },
      { k: 'Work', v: 'Paint · deep clean' },
    ],
  },
  sources: [
    { label: 'Listing analytics', freshness: '4 tours booked' },
    { label: 'Application queue', freshness: '1 in review' },
    { label: 'Market comps', freshness: 'updated weekly' },
    { label: 'Payment history', freshness: 'synced 11m ago' },
    { label: 'Owner rules', freshness: 'active' },
  ],
  ask: {
    subject: '30 Elm St',
    contextLabel: '30 Elm St',
    prompts: [
      'Show the tour schedule',
      'Screen the current applicant',
      'Should we adjust the asking rent?',
      'Summarize listing performance',
      'Prepare owner update',
    ],
  },
};

/* ================================================================== */
/* GENERATED: birch — 7 Birch Way (calm · all clear)                   */
/* ================================================================== */

const BIRCH_PROPERTY: PropertyDetailMock = {
  slug: 'birch',
  name: '7 Birch Way',
  badge: { variant: 'calm', label: 'Calm' },
  meta: ['Ashburn, VA', '2 units', '2/2 occupied', '100% May collected'],
  attentionCount: 'all clear',
  attention: [
    {
      dot: 'green',
      kind: 'All clear',
      detail: 'Rent collected · no open items · no vendor activity',
      ariaLabel:
        'All clear. Rent collected · no open items · no vendor activity',
      actions: [{ label: 'View ledger', variant: 'default' }],
    },
  ],
  odesaNote: {
    body: '7 Birch Way is **operationally calm**. Both units are current, no maintenance is open, and the next lease event is months out. Odesa will surface anything new the moment it appears.',
    basedOn: 'payment history · lease calendar · maintenance log',
  },
  metrics: [
    { label: 'Occupancy', value: '2/2' },
    { label: 'May collected', value: '100%', tone: 'good' },
    { label: 'Active items', value: '0' },
    { label: 'Monthly rent', value: '$3,145' },
    { label: 'Next deadline', value: 'None' },
  ],
  unitsSub: '2 units · all current',
  units: [
    {
      unitSlug: '1',
      label: 'Unit 1',
      tenantName: 'Ravi P.',
      tenantSlug: 'ravi-p',
      rent: '$1,580/mo',
      status: { variant: 'current', label: 'Current' },
      ariaLabel: 'View Unit 1, tenant Ravi P., $1,580/mo, Current',
    },
    {
      unitSlug: '2',
      label: 'Unit 2',
      tenantName: 'Joan F.',
      tenantSlug: 'joan-f',
      rent: '$1,565/mo',
      status: { variant: 'current', label: 'Current' },
      ariaLabel: 'View Unit 2, tenant Joan F., $1,565/mo, Current',
    },
  ],
  rent: {
    label: 'Rent · May',
    cells: [
      { k: 'May collected', v: '100%' },
      { k: 'Outstanding', v: '$0', mono: true },
      { k: 'Late unit', v: 'None' },
      { k: 'Next expected', v: 'Jun 1' },
    ],
  },
  vendors: {
    dot: 'green',
    kind: 'No open work orders',
    detail: 'This property is operationally calm on maintenance.',
    cells: [
      { k: 'Last vendor visit', v: 'Mar 22' },
      { k: 'Work', v: 'Gutter clean' },
    ],
  },
  sources: [
    { label: 'Payment history', freshness: 'synced 11m ago' },
    { label: 'Lease calendar', freshness: 'no events' },
    { label: 'Maintenance log', freshness: 'updated Mar 22' },
    { label: 'Owner rules', freshness: 'active' },
  ],
  ask: {
    subject: '7 Birch Way',
    contextLabel: '7 Birch Way',
    prompts: [
      'Confirm everything is on track',
      'Show upcoming lease dates',
      'Summarize maintenance history',
      'Show rent collected',
      'Prepare owner update',
    ],
  },
};

/* ================================================================== */
/* GENERATED: pine — 19 Pine Ct (calm · all clear · single unit)       */
/* ================================================================== */

const PINE_PROPERTY: PropertyDetailMock = {
  slug: 'pine',
  name: '19 Pine Ct',
  badge: { variant: 'calm', label: 'Calm' },
  meta: ['Reston, VA', '1 unit', '1/1 occupied', '100% May collected'],
  attentionCount: 'all clear',
  attention: [
    {
      dot: 'green',
      kind: 'All clear',
      detail: 'Rent collected · no open items · lease healthy',
      ariaLabel: 'All clear. Rent collected · no open items · lease healthy',
      actions: [{ label: 'View ledger', variant: 'default' }],
    },
  ],
  odesaNote: {
    body: '19 Pine Ct is a **single-unit, operationally calm** property. Rent is current and the lease runs through next spring. Nothing needs your attention right now.',
    basedOn: 'payment history · lease terms · maintenance log',
  },
  metrics: [
    { label: 'Occupancy', value: '1/1' },
    { label: 'May collected', value: '100%', tone: 'good' },
    { label: 'Active items', value: '0' },
    { label: 'Monthly rent', value: '$1,620' },
    { label: 'Next deadline', value: 'None' },
  ],
  unitsSub: '1 unit · current',
  units: [
    {
      unitSlug: '1',
      label: 'Unit 1',
      tenantName: 'Dell K.',
      tenantSlug: 'dell-k',
      rent: '$1,620/mo',
      status: { variant: 'current', label: 'Current' },
      ariaLabel: 'View Unit 1, tenant Dell K., $1,620/mo, Current',
    },
  ],
  rent: {
    label: 'Rent · May',
    cells: [
      { k: 'May collected', v: '100%' },
      { k: 'Outstanding', v: '$0', mono: true },
      { k: 'Late unit', v: 'None' },
      { k: 'Next expected', v: 'Jun 1' },
    ],
  },
  vendors: {
    dot: 'green',
    kind: 'No open work orders',
    detail: 'This property is operationally calm on maintenance.',
    cells: [
      { k: 'Last vendor visit', v: 'Feb 14' },
      { k: 'Work', v: 'Furnace tune-up' },
    ],
  },
  sources: [
    { label: 'Payment history', freshness: 'synced 11m ago' },
    { label: 'Lease terms', freshness: 'active' },
    { label: 'Maintenance log', freshness: 'updated Feb 14' },
    { label: 'Owner rules', freshness: 'active' },
  ],
  ask: {
    subject: '19 Pine Ct',
    contextLabel: '19 Pine Ct',
    prompts: [
      'Confirm everything is on track',
      'Show the lease end date',
      'Summarize maintenance history',
      'Show rent collected',
      'Prepare owner update',
    ],
  },
};

/* ================================================================== */
/* GENERATED UNITS — one complete UnitDetailMock per non-oak unit      */
/* ================================================================== */

/** Shared default for a calm, current, fully-occupied unit. */
function makeCalmUnit(args: {
  propSlug: string;
  propName: string;
  propLocation: string;
  unitSlug: string;
  label: string;
  tenantSlug: string;
  tenantName: string;
  tenantInitial: string;
  rent: string;
  rentNum: string;
  deposit: string;
  leaseStart: string;
  leaseEnd: string;
  size: string;
  layout: string;
  floor: string;
}): UnitDetailMock {
  return {
    propSlug: args.propSlug,
    unitSlug: args.unitSlug,
    label: args.label,
    badge: { variant: 'calm', label: 'Calm' },
    meta: [args.propName, args.propLocation, 'occupied', args.rent],
    attentionCount: 'all clear',
    attention: [
      {
        dot: 'green',
        kind: 'Rent current',
        loc: args.tenantName,
        detail: `Paid in full for May · ${args.rent}`,
        ariaLabel: `Rent current for ${args.tenantName}. Paid in full for May · ${args.rent}`,
        actions: [{ label: 'View ledger', variant: 'default' }],
      },
      {
        dot: 'green',
        kind: 'Lease healthy',
        detail: `Lease through ${args.leaseEnd} · no renewal action needed`,
        ariaLabel: `Lease healthy. Lease through ${args.leaseEnd} · no renewal action needed`,
        actions: [{ label: 'View lease', variant: 'default' }],
      },
      {
        dot: 'green',
        kind: 'Maintenance stable',
        detail: 'No open requests · appliances in good standing',
        ariaLabel:
          'Maintenance stable. No open requests · appliances in good standing',
        actions: [{ label: 'View history', variant: 'default' }],
      },
    ],
    odesaNote: {
      body: `${args.label} is **operationally calm**. Rent is current, the lease is healthy, and no maintenance is open. Odesa will surface anything new the moment it appears.`,
      basedOn: 'ledger · lease terms · maintenance history · owner rules',
    },
    metrics: [
      { label: 'Occupancy', value: 'Occupied', tone: 'good' },
      { label: 'Rent', value: args.rentNum },
      { label: 'Balance', value: '$0', tone: 'good' },
      { label: 'Lease end', value: args.leaseEnd },
      { label: 'Maintenance', value: '0 open', tone: 'good' },
    ],
    tenant: {
      avatar: args.tenantInitial,
      name: args.tenantName,
      pill: { variant: 'current', label: 'Current' },
      sub: 'No late payments on record',
      actions: [
        {
          label: 'View tenant',
          variant: 'default',
          href: tenantHref(args.tenantSlug),
        },
        { label: 'Message tenant', variant: 'primary' },
      ],
    },
    rent: [
      { k: 'Due', v: args.rentNum, mono: true },
      { k: 'Paid', v: args.rentNum, mono: true },
      { k: 'Outstanding', v: '$0', mono: true },
      { k: 'Next expected', v: 'Jun 1' },
      { k: 'Payment plan', v: 'None' },
      { k: 'Status', v: 'Current' },
    ],
    lease: [
      { k: 'Start', v: args.leaseStart },
      { k: 'End', v: args.leaseEnd },
      { k: 'Deposit', v: args.deposit, mono: true },
      { k: 'Late fee', v: '$50', mono: true },
      { k: 'Renewal window', v: 'Not yet open' },
    ],
    appliancesSub: '4 tracked · all in good standing',
    appliances: [
      {
        name: 'HVAC system',
        sub: 'Serviced this spring',
        model: 'Carrier 24ABC6',
        warranty: 'Warranty to 2029',
        age: '2019 · 7 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'HVAC system, Carrier 24ABC6, installed 2019 · 7 yrs, Good',
      },
      {
        name: 'Water heater',
        model: 'Rheem XE40 · 40 gal',
        warranty: 'Warranty to 2028',
        age: '2020 · 6 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'Water heater, Rheem XE40 · 40 gal, installed 2020 · 6 yrs, Good',
      },
      {
        name: 'Refrigerator',
        model: 'Whirlpool WRX735',
        warranty: 'Warranty to 2026',
        age: '2021 · 5 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'Refrigerator, Whirlpool WRX735, installed 2021 · 5 yrs, Good',
      },
      {
        name: 'Range / oven',
        model: 'GE JB645',
        warranty: 'Out of warranty',
        age: '2018 · 8 yrs',
        status: { variant: 'aging', label: 'Aging' },
        ariaLabel: 'Range / oven, GE JB645, installed 2018 · 8 yrs, Aging',
      },
    ],
    maintenanceSub: 'No open requests · history clean',
    maintenance: [
      {
        calm: true,
        title: 'Routine HVAC service',
        wo: 'WO-0980',
        sub: 'Completed this spring · Comfort Air',
        badge: { variant: 'resolved', label: 'Resolved' },
        ariaLabel: 'Routine HVAC service',
      },
    ],
    access: [
      { k: 'Entry', v: 'Smart lock · code on file' },
      { k: 'Mailbox', v: `#${args.unitSlug.toUpperCase()}` },
      { k: 'Parking', v: '1 space · assigned' },
      { k: 'Internet', v: 'Tenant' },
      { k: 'Electricity', v: 'Tenant · Dominion' },
      { k: 'Water / sewer', v: 'Owner' },
      { k: 'Gas', v: 'Tenant · WGL' },
      { k: 'Trash', v: 'Owner · HOA' },
    ],
    specs: [
      { k: 'Size', v: args.size },
      { k: 'Layout', v: args.layout },
      { k: 'Floor', v: args.floor },
      { k: 'HVAC filter', v: 'Next due Aug 2026' },
      { k: 'Smoke detector', v: 'Checked Jan 2026' },
      { k: 'CO detector', v: 'Checked Jan 2026' },
    ],
    sources: [
      { label: 'Lease', freshness: 'active' },
      { label: 'Ledger', freshness: 'synced 11m ago' },
      { label: 'Tenant messages', freshness: 'no recent activity' },
      { label: 'Maintenance history', freshness: 'clean' },
      { label: 'Owner rules', freshness: 'active' },
    ],
    ask: {
      subject: args.label,
      contextLabel: args.label,
      prompts: [
        'Confirm everything is on track',
        'Show lease terms',
        'Summarize maintenance history',
        'Show the rent ledger',
        'Message the tenant',
      ],
    },
  };
}

/** Maple Unit 3B — the active-leak unit owning WO-1042 (Priya S.). */
const MAPLE_3B_UNIT: UnitDetailMock = {
  propSlug: 'maple',
  unitSlug: '3b',
  label: 'Unit 3B',
  badge: { variant: 'watching', label: 'Watching' },
  meta: ['14 Maple Ct', 'Ashburn, VA', 'occupied', '$1,540/mo'],
  attentionCount: '1 active',
  attention: [
    {
      dot: 'clay',
      kind: 'Active leak',
      loc: 'Priya S.',
      detail: 'Vendor dispatched · Diaz Plumbing ETA 2–4 PM · WO-1042',
      ariaLabel:
        'Active leak for Priya S.. Vendor dispatched · Diaz Plumbing ETA 2–4 PM · work order WO-1042',
      actions: [
        { label: 'Check ETA', variant: 'primary', href: workOrderHref('WO-1042') },
        { label: 'View order', variant: 'default', href: workOrderHref('WO-1042') },
      ],
    },
    {
      dot: 'green',
      kind: 'Rent current',
      detail: 'Paid in full for May · no balance',
      ariaLabel: 'Rent current. Paid in full for May · no balance',
      actions: [{ label: 'View ledger', variant: 'default' }],
    },
    {
      dot: 'green',
      kind: 'Lease healthy',
      detail: 'Lease through Aug 2027 · no renewal action needed',
      ariaLabel:
        'Lease healthy. Lease through Aug 2027 · no renewal action needed',
      actions: [{ label: 'View lease', variant: 'default' }],
    },
  ],
  odesaNote: {
    body: "Unit 3B's only open item is the **under-sink leak** — vendor is en route (2–4 PM) and the $640 cost is already approved. Rent and lease are healthy. Odesa will confirm the repair on arrival.",
    basedOn: 'work order log · vendor quote · ledger · lease terms',
  },
  nextAction: {
    body: 'Waiting for **Diaz Plumbing** to arrive (2–4 PM) for the under-sink leak. Odesa will confirm resolution and close WO-1042 automatically once the vendor reports complete.',
  },
  metrics: [
    { label: 'Occupancy', value: 'Occupied', tone: 'good' },
    { label: 'Rent', value: '$1,540' },
    { label: 'Balance', value: '$0', tone: 'good' },
    { label: 'Lease end', value: 'Aug 2027' },
    { label: 'Maintenance', value: '1 open', tone: 'warn' },
  ],
  tenant: {
    avatar: 'P',
    name: 'Priya S.',
    pill: { variant: 'current', label: 'Current' },
    sub: 'Reported the leak this morning · cooperative',
    actions: [
      { label: 'View tenant', variant: 'default', href: tenantHref('priya') },
      { label: 'Message tenant', variant: 'primary' },
    ],
  },
  rent: [
    { k: 'Due', v: '$1,540', mono: true },
    { k: 'Paid', v: '$1,540', mono: true },
    { k: 'Outstanding', v: '$0', mono: true },
    { k: 'Next expected', v: 'Jun 1' },
    { k: 'Payment plan', v: 'None' },
    { k: 'Status', v: 'Current' },
  ],
  lease: [
    { k: 'Start', v: 'Sep 2025' },
    { k: 'End', v: 'Aug 2027' },
    { k: 'Deposit', v: '$1,540', mono: true },
    { k: 'Late fee', v: '$50', mono: true },
    { k: 'Renewal window', v: 'Opens May 2027' },
  ],
  appliancesSub: '4 tracked · 1 under repair',
  appliances: [
    {
      name: 'Kitchen plumbing',
      sub: 'Active leak · linked to WO-1042',
      model: 'Under-sink supply line',
      warranty: 'N/A',
      age: '2016 · 10 yrs',
      status: { variant: 'replace', label: 'Repair' },
      ariaLabel:
        'Kitchen plumbing, under-sink supply line, installed 2016 · 10 yrs, Repair in progress',
    },
    {
      name: 'HVAC system',
      sub: 'Serviced this spring',
      model: 'Carrier 24ABC6',
      warranty: 'Warranty to 2029',
      age: '2019 · 7 yrs',
      status: { variant: 'good', label: 'Good' },
      ariaLabel: 'HVAC system, Carrier 24ABC6, installed 2019 · 7 yrs, Good',
    },
    {
      name: 'Water heater',
      model: 'Rheem XE40 · 40 gal',
      warranty: 'Warranty to 2027',
      age: '2019 · 7 yrs',
      status: { variant: 'good', label: 'Good' },
      ariaLabel: 'Water heater, Rheem XE40 · 40 gal, installed 2019 · 7 yrs, Good',
    },
    {
      name: 'Refrigerator',
      model: 'Whirlpool WRX735',
      warranty: 'Warranty to 2026',
      age: '2021 · 5 yrs',
      status: { variant: 'good', label: 'Good' },
      ariaLabel: 'Refrigerator, Whirlpool WRX735, installed 2021 · 5 yrs, Good',
    },
  ],
  maintenanceSub: '1 open work order · vendor en route',
  maintenance: [
    {
      calm: false,
      title: 'Active leak under kitchen sink',
      wo: 'WO-1042',
      sub: 'Diaz Plumbing accepted · ETA 2–4 PM · $640 approved',
      badge: { variant: 'dispatched', label: 'Vendor accepted' },
      prio: 'urgent',
      ariaLabel: 'Active leak under kitchen sink, work order WO-1042',
    },
    {
      calm: true,
      title: 'Routine HVAC service',
      wo: 'WO-1009',
      sub: 'Completed this spring · Comfort Air',
      badge: { variant: 'resolved', label: 'Resolved' },
      ariaLabel: 'Routine HVAC service',
    },
  ],
  access: [
    { k: 'Entry', v: 'Lockbox · code shared w/ vendor' },
    { k: 'Mailbox', v: '#3B' },
    { k: 'Parking', v: '1 space · Lot A-2' },
    { k: 'Internet', v: 'Tenant' },
    { k: 'Electricity', v: 'Tenant · Dominion' },
    { k: 'Water / sewer', v: 'Owner' },
    { k: 'Gas', v: 'Tenant · WGL' },
    { k: 'Trash', v: 'Owner · HOA' },
  ],
  specs: [
    { k: 'Size', v: '880 sq ft' },
    { k: 'Layout', v: '2 bed · 1 bath' },
    { k: 'Floor', v: '3rd' },
    { k: 'HVAC filter', v: 'Next due Sep 2026' },
    { k: 'Smoke detector', v: 'Checked Jan 2026' },
    { k: 'CO detector', v: 'Checked Jan 2026' },
  ],
  sources: [
    { label: 'Work order log', freshness: 'live' },
    { label: 'Vendor quote · Diaz Plumbing', freshness: '$640 · today' },
    { label: 'Lease', freshness: 'active' },
    { label: 'Ledger', freshness: 'synced 11m ago' },
    { label: 'Owner rules', freshness: 'active' },
  ],
  ask: {
    subject: 'Unit 3B',
    contextLabel: 'Unit 3B',
    prompts: [
      'Check the leak repair ETA',
      'Message Priya',
      'Show the work order',
      'Summarize maintenance status',
      'Create escalation plan',
    ],
  },
};

const GENERATED_UNITS: UnitDetailMock[] = [
  // oak (non-1a units — 1a is transcribed verbatim above)
  makeCalmUnit({
    propSlug: 'oak',
    propName: '22 Oak St',
    propLocation: 'Sterling, VA',
    unitSlug: '2b',
    label: 'Unit 2B',
    tenantSlug: 'aaron',
    tenantName: 'Aaron V.',
    tenantInitial: 'A',
    rent: '$1,480/mo',
    rentNum: '$1,480',
    deposit: '$1,480',
    leaseStart: 'Feb 2025',
    leaseEnd: 'Jan 2027',
    size: '700 sq ft',
    layout: '1 bed · 1 bath',
    floor: '2nd',
  }),
  makeCalmUnit({
    propSlug: 'oak',
    propName: '22 Oak St',
    propLocation: 'Sterling, VA',
    unitSlug: '3c',
    label: 'Unit 3C',
    tenantSlug: 'dana-w',
    tenantName: 'Dana W.',
    tenantInitial: 'D',
    rent: '$1,535/mo',
    rentNum: '$1,535',
    deposit: '$1,535',
    leaseStart: 'Dec 2024',
    leaseEnd: 'Nov 2026',
    size: '720 sq ft',
    layout: '1 bed · 1 bath',
    floor: '3rd',
  }),
  {
    // oak/4 — Jon Bell, noise-complaint unit (watching)
    propSlug: 'oak',
    unitSlug: '4',
    label: 'Unit 4',
    badge: { variant: 'watching', label: 'Watching' },
    meta: ['22 Oak St', 'Sterling, VA', 'occupied', '$1,560/mo'],
    attentionCount: '1 active',
    attention: [
      {
        dot: 'amber',
        kind: 'Noise complaint',
        loc: 'Jon Bell',
        detail: 'Second report in 30 days · watching for a pattern',
        ariaLabel:
          'Noise complaint for Jon Bell. Second report in 30 days · watching for a pattern',
        actions: [
          { label: 'View thread', variant: 'primary' },
          { label: 'Prepare reminder', variant: 'default' },
        ],
      },
      {
        dot: 'green',
        kind: 'Rent current',
        detail: 'Paid in full for May · no balance',
        ariaLabel: 'Rent current. Paid in full for May · no balance',
        actions: [{ label: 'View ledger', variant: 'default' }],
      },
      {
        dot: 'green',
        kind: 'Lease healthy',
        detail: 'Lease through Oct 2026 · no renewal action needed',
        ariaLabel: 'Lease healthy. Lease through Oct 2026 · no renewal action needed',
        actions: [{ label: 'View lease', variant: 'default' }],
      },
    ],
    odesaNote: {
      body: "Unit 4 is current on rent; the only watch item is a **second noise report in 30 days**. Odesa recommends a **gentle quiet-hours reminder** over escalation, and will flag a third report immediately.",
      basedOn: 'noise complaint log · message thread · lease terms · owner rules',
    },
    nextAction: {
      body: 'Send Jon a **gentle quiet-hours reminder**. A third report within 30 days would trigger an owner-review flag — Odesa will surface it automatically.',
    },
    metrics: [
      { label: 'Occupancy', value: 'Occupied', tone: 'good' },
      { label: 'Rent', value: '$1,560' },
      { label: 'Balance', value: '$0', tone: 'good' },
      { label: 'Lease end', value: 'Oct 2026' },
      { label: 'Maintenance', value: '0 open', tone: 'good' },
    ],
    tenant: {
      avatar: 'J',
      name: 'Jon Bell',
      pill: { variant: 'watching', label: 'Watching' },
      sub: 'Second noise report in 30 days',
      actions: [
        { label: 'View tenant', variant: 'default', href: tenantHref('jon') },
        { label: 'Draft reminder', variant: 'primary' },
      ],
    },
    rent: [
      { k: 'Due', v: '$1,560', mono: true },
      { k: 'Paid', v: '$1,560', mono: true },
      { k: 'Outstanding', v: '$0', mono: true },
      { k: 'Next expected', v: 'Jun 1' },
      { k: 'Payment plan', v: 'None' },
      { k: 'Status', v: 'Current' },
    ],
    lease: [
      { k: 'Start', v: 'Nov 2024' },
      { k: 'End', v: 'Oct 2026' },
      { k: 'Deposit', v: '$1,560', mono: true },
      { k: 'Late fee', v: '$50', mono: true },
      { k: 'Renewal window', v: 'Opens Aug 2026' },
    ],
    appliancesSub: '4 tracked · all in good standing',
    appliances: [
      {
        name: 'HVAC system',
        model: 'Carrier 24ABC6',
        warranty: 'Warranty to 2029',
        age: '2019 · 7 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'HVAC system, Carrier 24ABC6, installed 2019 · 7 yrs, Good',
      },
      {
        name: 'Water heater',
        model: 'Rheem XE40 · 40 gal',
        warranty: 'Warranty to 2028',
        age: '2020 · 6 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'Water heater, Rheem XE40 · 40 gal, installed 2020 · 6 yrs, Good',
      },
      {
        name: 'Refrigerator',
        model: 'Whirlpool WRX735',
        warranty: 'Warranty to 2026',
        age: '2021 · 5 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'Refrigerator, Whirlpool WRX735, installed 2021 · 5 yrs, Good',
      },
      {
        name: 'Range / oven',
        model: 'GE JB645',
        warranty: 'Out of warranty',
        age: '2018 · 8 yrs',
        status: { variant: 'aging', label: 'Aging' },
        ariaLabel: 'Range / oven, GE JB645, installed 2018 · 8 yrs, Aging',
      },
    ],
    maintenanceSub: 'No open requests · history clean',
    maintenance: [
      {
        calm: true,
        title: 'Routine HVAC service',
        wo: 'WO-0990',
        sub: 'Completed this spring · Comfort Air',
        badge: { variant: 'resolved', label: 'Resolved' },
        ariaLabel: 'Routine HVAC service',
      },
    ],
    access: [
      { k: 'Entry', v: 'Smart lock · code on file' },
      { k: 'Mailbox', v: '#4' },
      { k: 'Parking', v: '1 space · Lot B-4' },
      { k: 'Internet', v: 'Tenant' },
      { k: 'Electricity', v: 'Tenant · Dominion' },
      { k: 'Water / sewer', v: 'Owner' },
      { k: 'Gas', v: 'Tenant · WGL' },
      { k: 'Trash', v: 'Owner · HOA' },
    ],
    specs: [
      { k: 'Size', v: '760 sq ft' },
      { k: 'Layout', v: '1 bed · 1 bath' },
      { k: 'Floor', v: '4th' },
      { k: 'HVAC filter', v: 'Next due Aug 2026' },
      { k: 'Smoke detector', v: 'Checked Jan 2026' },
      { k: 'CO detector', v: 'Checked Jan 2026' },
    ],
    sources: [
      { label: 'Noise complaint log', freshness: '2 reports / 30d' },
      { label: 'Message thread', freshness: 'last reply Apr 15' },
      { label: 'Ledger', freshness: 'synced 11m ago' },
      { label: 'Lease terms', freshness: 'active' },
      { label: 'Owner rules', freshness: 'active' },
    ],
    ask: {
      subject: 'Unit 4',
      contextLabel: 'Unit 4',
      prompts: [
        'Draft a quiet-hours reminder',
        'Summarize the noise history',
        'What happens on a third report?',
        'Show the rent ledger',
        'Message the tenant',
      ],
    },
  },
  makeCalmUnit({
    propSlug: 'oak',
    propName: '22 Oak St',
    propLocation: 'Sterling, VA',
    unitSlug: '5',
    label: 'Unit 5',
    tenantSlug: 'nora',
    tenantName: 'Nora K.',
    tenantInitial: 'N',
    rent: '$1,545/mo',
    rentNum: '$1,545',
    deposit: '$1,545',
    leaseStart: 'Mar 2025',
    leaseEnd: 'Feb 2027',
    size: '740 sq ft',
    layout: '1 bed · 1 bath',
    floor: '5th',
  }),
  // cedar
  makeCalmUnit({
    propSlug: 'cedar',
    propName: '108 Cedar Ln',
    propLocation: 'Leesburg, VA',
    unitSlug: '1a',
    label: 'Unit 1A',
    tenantSlug: 'marcus',
    tenantName: 'Marcus T.',
    tenantInitial: 'M',
    rent: '$1,410/mo',
    rentNum: '$1,410',
    deposit: '$1,410',
    leaseStart: 'Jun 2024',
    leaseEnd: 'May 2027',
    size: '760 sq ft',
    layout: '1 bed · 1 bath',
    floor: '1st',
  }),
  {
    // cedar/2c — vendor-overdue unit (Sandra K.)
    propSlug: 'cedar',
    unitSlug: '2c',
    label: 'Unit 2C',
    badge: { variant: 'watching', label: 'Watching' },
    meta: ['108 Cedar Ln', 'Leesburg, VA', 'occupied', '$1,390/mo'],
    attentionCount: '1 active',
    attention: [
      {
        dot: 'clay',
        kind: 'Vendor overdue',
        loc: 'Sandra K.',
        detail: 'Northstar 24h late on the disposal repair · WO-1044',
        ariaLabel:
          'Vendor overdue for Sandra K.. Northstar 24h late on the disposal repair · work order WO-1044',
        actions: [
          { label: 'Escalate', variant: 'primary' },
          { label: 'View order', variant: 'default' },
        ],
      },
      {
        dot: 'green',
        kind: 'Rent current',
        detail: 'Paid in full for May · no balance',
        ariaLabel: 'Rent current. Paid in full for May · no balance',
        actions: [{ label: 'View ledger', variant: 'default' }],
      },
      {
        dot: 'green',
        kind: 'Lease healthy',
        detail: 'Lease through Jul 2026 · renewal not yet due',
        ariaLabel: 'Lease healthy. Lease through Jul 2026 · renewal not yet due',
        actions: [{ label: 'View lease', variant: 'default' }],
      },
    ],
    odesaNote: {
      body: "Unit 2C's only open item is the **disposal repair** — Northstar Appliance is 24h past its window. An escalation message is drafted and ready. Rent and lease are healthy.",
      basedOn: 'work order log · vendor SLA · ledger · lease terms',
    },
    nextAction: {
      body: 'If **Northstar Appliance** does not respond by end of day, Odesa will send the drafted escalation and propose a backup vendor.',
    },
    metrics: [
      { label: 'Occupancy', value: 'Occupied', tone: 'good' },
      { label: 'Rent', value: '$1,390' },
      { label: 'Balance', value: '$0', tone: 'good' },
      { label: 'Lease end', value: 'Jul 2026' },
      { label: 'Maintenance', value: '1 open', tone: 'warn' },
    ],
    tenant: {
      avatar: 'S',
      name: 'Sandra K.',
      pill: { variant: 'current', label: 'Current' },
      sub: 'Reported the disposal issue 2 days ago',
      actions: [
        { label: 'View tenant', variant: 'default', href: tenantHref('sandra-k') },
        { label: 'Message tenant', variant: 'primary' },
      ],
    },
    rent: [
      { k: 'Due', v: '$1,390', mono: true },
      { k: 'Paid', v: '$1,390', mono: true },
      { k: 'Outstanding', v: '$0', mono: true },
      { k: 'Next expected', v: 'Jun 1' },
      { k: 'Payment plan', v: 'None' },
      { k: 'Status', v: 'Current' },
    ],
    lease: [
      { k: 'Start', v: 'Aug 2024' },
      { k: 'End', v: 'Jul 2026' },
      { k: 'Deposit', v: '$1,390', mono: true },
      { k: 'Late fee', v: '$50', mono: true },
      { k: 'Renewal window', v: 'Opens Apr 2026' },
    ],
    appliancesSub: '4 tracked · 1 under repair',
    appliances: [
      {
        name: 'Garbage disposal',
        sub: 'Repair pending · linked to WO-1044',
        model: 'InSinkErator Badger 5',
        warranty: 'Out of warranty',
        age: '2017 · 9 yrs',
        status: { variant: 'replace', label: 'Repair' },
        ariaLabel:
          'Garbage disposal, InSinkErator Badger 5, installed 2017 · 9 yrs, Repair pending',
      },
      {
        name: 'HVAC system',
        model: 'Carrier 24ABC6',
        warranty: 'Warranty to 2029',
        age: '2019 · 7 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'HVAC system, Carrier 24ABC6, installed 2019 · 7 yrs, Good',
      },
      {
        name: 'Water heater',
        model: 'Rheem XE40 · 40 gal',
        warranty: 'Warranty to 2028',
        age: '2020 · 6 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'Water heater, Rheem XE40 · 40 gal, installed 2020 · 6 yrs, Good',
      },
      {
        name: 'Refrigerator',
        model: 'Whirlpool WRX735',
        warranty: 'Warranty to 2026',
        age: '2021 · 5 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'Refrigerator, Whirlpool WRX735, installed 2021 · 5 yrs, Good',
      },
    ],
    maintenanceSub: '1 open work order · vendor overdue',
    maintenance: [
      {
        calm: false,
        title: 'Repair garbage disposal',
        wo: 'WO-1044',
        sub: 'Northstar Appliance 24h overdue · escalation drafted',
        badge: { variant: 'open', label: 'Vendor overdue' },
        prio: 'high',
        ariaLabel: 'Repair garbage disposal, work order WO-1044',
      },
    ],
    access: [
      { k: 'Entry', v: 'Smart lock · code on file' },
      { k: 'Mailbox', v: '#2C' },
      { k: 'Parking', v: '1 space · Lot C-1' },
      { k: 'Internet', v: 'Tenant' },
      { k: 'Electricity', v: 'Tenant · Dominion' },
      { k: 'Water / sewer', v: 'Owner' },
      { k: 'Gas', v: 'Tenant · WGL' },
      { k: 'Trash', v: 'Owner · HOA' },
    ],
    specs: [
      { k: 'Size', v: '840 sq ft' },
      { k: 'Layout', v: '2 bed · 1 bath' },
      { k: 'Floor', v: '2nd' },
      { k: 'HVAC filter', v: 'Next due Aug 2026' },
      { k: 'Smoke detector', v: 'Checked Jan 2026' },
      { k: 'CO detector', v: 'Checked Jan 2026' },
    ],
    sources: [
      { label: 'Work order log', freshness: 'updated 2h ago' },
      { label: 'Vendor SLA terms', freshness: 'active' },
      { label: 'Lease', freshness: 'active' },
      { label: 'Ledger', freshness: 'synced 11m ago' },
      { label: 'Owner rules', freshness: 'active' },
    ],
    ask: {
      subject: 'Unit 2C',
      contextLabel: 'Unit 2C',
      prompts: [
        'Escalate the overdue vendor',
        'Draft a Northstar follow-up',
        'Show the work order',
        'Message Sandra',
        'Propose a backup vendor',
      ],
    },
  },
  makeCalmUnit({
    propSlug: 'cedar',
    propName: '108 Cedar Ln',
    propLocation: 'Leesburg, VA',
    unitSlug: '3b',
    label: 'Unit 3B',
    tenantSlug: 'owen',
    tenantName: 'Owen L.',
    tenantInitial: 'O',
    rent: '$1,430/mo',
    rentNum: '$1,430',
    deposit: '$1,430',
    leaseStart: 'Mar 2025',
    leaseEnd: 'Feb 2027',
    size: '760 sq ft',
    layout: '1 bed · 1 bath',
    floor: '3rd',
  }),
  // maple
  makeCalmUnit({
    propSlug: 'maple',
    propName: '14 Maple Ct',
    propLocation: 'Ashburn, VA',
    unitSlug: '1a',
    label: 'Unit 1A',
    tenantSlug: 'lena',
    tenantName: 'Lena M.',
    tenantInitial: 'L',
    rent: '$1,495/mo',
    rentNum: '$1,495',
    deposit: '$1,495',
    leaseStart: 'May 2025',
    leaseEnd: 'Apr 2027',
    size: '810 sq ft',
    layout: '2 bed · 1 bath',
    floor: '1st',
  }),
  makeCalmUnit({
    propSlug: 'maple',
    propName: '14 Maple Ct',
    propLocation: 'Ashburn, VA',
    unitSlug: '2b',
    label: 'Unit 2B',
    tenantSlug: 'carlos-r',
    tenantName: 'Carlos R.',
    tenantInitial: 'C',
    rent: '$1,500/mo',
    rentNum: '$1,500',
    deposit: '$1,500',
    leaseStart: 'Jan 2025',
    leaseEnd: 'Dec 2026',
    size: '810 sq ft',
    layout: '2 bed · 1 bath',
    floor: '2nd',
  }),
  MAPLE_3B_UNIT,
  {
    // maple/4d — renewal-due unit (Eli N.)
    propSlug: 'maple',
    unitSlug: '4d',
    label: 'Unit 4D',
    badge: { variant: 'watching', label: 'Watching' },
    meta: ['14 Maple Ct', 'Ashburn, VA', 'occupied', '$1,510/mo'],
    attentionCount: '1 active',
    attention: [
      {
        dot: 'amber',
        kind: 'Renewal due',
        loc: 'Eli N.',
        detail: 'Lease renewal deadline Friday · owner approval needed',
        ariaLabel:
          'Renewal due for Eli N.. Lease renewal deadline Friday · owner approval needed',
        actions: [
          { label: 'Review renewal', variant: 'primary' },
          { label: 'Send to owner', variant: 'default' },
        ],
      },
      {
        dot: 'green',
        kind: 'Rent current',
        detail: 'Paid in full for May · no balance',
        ariaLabel: 'Rent current. Paid in full for May · no balance',
        actions: [{ label: 'View ledger', variant: 'default' }],
      },
      {
        dot: 'green',
        kind: 'Strong tenant',
        detail: 'On time for 22 months · good standing',
        ariaLabel: 'Strong tenant. On time for 22 months · good standing',
        actions: [{ label: 'View history', variant: 'default' }],
      },
    ],
    odesaNote: {
      body: "Eli's lease renews **Friday** and needs an owner decision. Odesa recommends offering renewal at a **3% increase** given his strong on-time record and current market comps.",
      basedOn: 'lease calendar · payment history · market comps · owner rules',
    },
    nextAction: {
      body: 'Send the **renewal recommendation** to the owner queue before Friday. Odesa has prepared the offer at a 3% increase with comps attached.',
    },
    metrics: [
      { label: 'Occupancy', value: 'Occupied', tone: 'good' },
      { label: 'Rent', value: '$1,510' },
      { label: 'Balance', value: '$0', tone: 'good' },
      { label: 'Lease end', value: 'May 2026' },
      { label: 'Maintenance', value: '0 open', tone: 'good' },
    ],
    tenant: {
      avatar: 'E',
      name: 'Eli N.',
      pill: { variant: 'current', label: 'Current' },
      sub: 'On time for 22 months',
      actions: [
        { label: 'View tenant', variant: 'default', href: tenantHref('eli-n') },
        { label: 'Draft renewal', variant: 'primary' },
      ],
    },
    rent: [
      { k: 'Due', v: '$1,510', mono: true },
      { k: 'Paid', v: '$1,510', mono: true },
      { k: 'Outstanding', v: '$0', mono: true },
      { k: 'Next expected', v: 'Jun 1' },
      { k: 'Payment plan', v: 'None' },
      { k: 'Status', v: 'Current' },
    ],
    lease: [
      { k: 'Start', v: 'Jun 2024' },
      { k: 'End', v: 'May 2026' },
      { k: 'Deposit', v: '$1,510', mono: true },
      { k: 'Late fee', v: '$50', mono: true },
      { k: 'Renewal window', v: 'Closes Friday' },
    ],
    appliancesSub: '4 tracked · all in good standing',
    appliances: [
      {
        name: 'HVAC system',
        model: 'Carrier 24ABC6',
        warranty: 'Warranty to 2029',
        age: '2019 · 7 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'HVAC system, Carrier 24ABC6, installed 2019 · 7 yrs, Good',
      },
      {
        name: 'Water heater',
        model: 'Rheem XE40 · 40 gal',
        warranty: 'Warranty to 2028',
        age: '2020 · 6 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'Water heater, Rheem XE40 · 40 gal, installed 2020 · 6 yrs, Good',
      },
      {
        name: 'Refrigerator',
        model: 'Whirlpool WRX735',
        warranty: 'Warranty to 2026',
        age: '2021 · 5 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'Refrigerator, Whirlpool WRX735, installed 2021 · 5 yrs, Good',
      },
      {
        name: 'Dishwasher',
        model: 'Bosch 300 · SHEM63',
        warranty: 'Warranty to 2026',
        age: '2021 · 5 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'Dishwasher, Bosch 300 · SHEM63, installed 2021 · 5 yrs, Good',
      },
    ],
    maintenanceSub: 'No open requests · history clean',
    maintenance: [
      {
        calm: true,
        title: 'Routine HVAC service',
        wo: 'WO-1012',
        sub: 'Completed this spring · Comfort Air',
        badge: { variant: 'resolved', label: 'Resolved' },
        ariaLabel: 'Routine HVAC service',
      },
    ],
    access: [
      { k: 'Entry', v: 'Smart lock · code on file' },
      { k: 'Mailbox', v: '#4D' },
      { k: 'Parking', v: '1 space · Lot A-4' },
      { k: 'Internet', v: 'Tenant' },
      { k: 'Electricity', v: 'Tenant · Dominion' },
      { k: 'Water / sewer', v: 'Owner' },
      { k: 'Gas', v: 'Tenant · WGL' },
      { k: 'Trash', v: 'Owner · HOA' },
    ],
    specs: [
      { k: 'Size', v: '880 sq ft' },
      { k: 'Layout', v: '2 bed · 1 bath' },
      { k: 'Floor', v: '4th' },
      { k: 'HVAC filter', v: 'Next due Sep 2026' },
      { k: 'Smoke detector', v: 'Checked Jan 2026' },
      { k: 'CO detector', v: 'Checked Jan 2026' },
    ],
    sources: [
      { label: 'Lease calendar', freshness: 'renewal Fri' },
      { label: 'Payment history', freshness: 'synced 11m ago' },
      { label: 'Market comps', freshness: 'updated weekly' },
      { label: 'Owner rules', freshness: 'active' },
      { label: 'Ledger', freshness: 'synced 11m ago' },
    ],
    ask: {
      subject: 'Unit 4D',
      contextLabel: 'Unit 4D',
      prompts: [
        'Draft the renewal offer',
        'Show market comps',
        'Send the renewal to the owner',
        'Message Eli',
        'Summarize the lease terms',
      ],
    },
  },
  // elm
  makeCalmUnit({
    propSlug: 'elm',
    propName: '30 Elm St',
    propLocation: 'Herndon, VA',
    unitSlug: '1',
    label: 'Unit 1',
    tenantSlug: 'grace-h',
    tenantName: 'Grace H.',
    tenantInitial: 'G',
    rent: '$1,475/mo',
    rentNum: '$1,475',
    deposit: '$1,475',
    leaseStart: 'Jul 2024',
    leaseEnd: 'Jun 2026',
    size: '900 sq ft',
    layout: '2 bed · 1 bath',
    floor: '1st',
  }),
  {
    // elm/2 — vacant, listed unit
    propSlug: 'elm',
    unitSlug: '2',
    label: 'Unit 2',
    badge: { variant: 'leasing', label: 'Listed' },
    meta: ['30 Elm St', 'Herndon, VA', 'vacant', '$1,575/mo asking'],
    attentionCount: '1 active',
    attention: [
      {
        dot: 'gold',
        kind: 'Vacancy',
        detail: 'Listed 9 days · 4 tours booked · 1 application in review',
        ariaLabel:
          'Vacancy. Listed 9 days · 4 tours booked · 1 application in review',
        actions: [
          { label: 'View tours', variant: 'primary' },
          { label: 'Review application', variant: 'default' },
        ],
      },
      {
        dot: 'green',
        kind: 'Turn complete',
        detail: 'Paint + deep clean finished Apr 30 · move-in ready',
        ariaLabel: 'Turn complete. Paint + deep clean finished Apr 30 · move-in ready',
        actions: [{ label: 'View turn', variant: 'default' }],
      },
    ],
    odesaNote: {
      body: 'Unit 2 is **vacant and listed** with strong interest — 4 tours and 1 application under review. Odesa recommends **screening the current applicant** before adjusting the asking rent.',
      basedOn: 'listing analytics · application queue · market comps',
    },
    nextAction: {
      body: 'Screen the **current application** today. If it does not qualify, Odesa will keep the remaining 3 tours on schedule and report conversion.',
    },
    metrics: [
      { label: 'Occupancy', value: 'Vacant', tone: 'warn' },
      { label: 'Asking', value: '$1,575' },
      { label: 'Days listed', value: '9' },
      { label: 'Tours', value: '4' },
      { label: 'Applications', value: '1' },
    ],
    tenant: {
      avatar: '—',
      name: 'No current tenant',
      sub: 'Listing active · 1 application in review',
      actions: [
        { label: 'View listing', variant: 'default', href: '#' },
        { label: 'Review application', variant: 'primary' },
      ],
    },
    rent: [
      { k: 'Asking', v: '$1,575', mono: true },
      { k: 'Collected', v: '$0', mono: true },
      { k: 'Vacancy loss', v: '$1,575', mono: true },
      { k: 'Listed', v: '9 days' },
      { k: 'Tours', v: '4 booked' },
      { k: 'Status', v: 'Listed' },
    ],
    lease: [
      { k: 'Start', v: 'Pending' },
      { k: 'End', v: 'Pending' },
      { k: 'Deposit', v: '$1,575', mono: true },
      { k: 'Late fee', v: '$50', mono: true },
      { k: 'Renewal window', v: 'N/A' },
    ],
    appliancesSub: '4 tracked · all in good standing',
    appliances: [
      {
        name: 'HVAC system',
        sub: 'Serviced before listing',
        model: 'Carrier 24ABC6',
        warranty: 'Warranty to 2029',
        age: '2019 · 7 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'HVAC system, Carrier 24ABC6, installed 2019 · 7 yrs, Good',
      },
      {
        name: 'Water heater',
        model: 'Rheem XE40 · 40 gal',
        warranty: 'Warranty to 2028',
        age: '2020 · 6 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'Water heater, Rheem XE40 · 40 gal, installed 2020 · 6 yrs, Good',
      },
      {
        name: 'Refrigerator',
        model: 'Whirlpool WRX735',
        warranty: 'Warranty to 2026',
        age: '2021 · 5 yrs',
        status: { variant: 'good', label: 'Good' },
        ariaLabel: 'Refrigerator, Whirlpool WRX735, installed 2021 · 5 yrs, Good',
      },
      {
        name: 'Range / oven',
        model: 'GE JB645',
        warranty: 'Out of warranty',
        age: '2018 · 8 yrs',
        status: { variant: 'aging', label: 'Aging' },
        ariaLabel: 'Range / oven, GE JB645, installed 2018 · 8 yrs, Aging',
      },
    ],
    maintenanceSub: 'No open requests · turn complete',
    maintenance: [
      {
        calm: true,
        title: 'Make-ready turn',
        wo: 'WO-1020',
        sub: 'Paint + deep clean completed Apr 30',
        badge: { variant: 'resolved', label: 'Resolved' },
        ariaLabel: 'Make-ready turn',
      },
    ],
    access: [
      { k: 'Entry', v: 'Lockbox · agent showings' },
      { k: 'Mailbox', v: '#2' },
      { k: 'Parking', v: '1 space · assigned' },
      { k: 'Internet', v: 'Available' },
      { k: 'Electricity', v: 'Owner · staging' },
      { k: 'Water / sewer', v: 'Owner' },
      { k: 'Gas', v: 'Owner · staging' },
      { k: 'Trash', v: 'Owner · HOA' },
    ],
    specs: [
      { k: 'Size', v: '900 sq ft' },
      { k: 'Layout', v: '2 bed · 1 bath' },
      { k: 'Floor', v: '2nd' },
      { k: 'HVAC filter', v: 'Replaced Apr 30' },
      { k: 'Smoke detector', v: 'Checked Apr 30' },
      { k: 'CO detector', v: 'Checked Apr 30' },
    ],
    sources: [
      { label: 'Listing analytics', freshness: '4 tours booked' },
      { label: 'Application queue', freshness: '1 in review' },
      { label: 'Market comps', freshness: 'updated weekly' },
      { label: 'Turn record', freshness: 'completed Apr 30' },
      { label: 'Owner rules', freshness: 'active' },
    ],
    ask: {
      subject: 'Unit 2',
      contextLabel: 'Unit 2',
      prompts: [
        'Show the tour schedule',
        'Screen the current applicant',
        'Should we adjust the asking rent?',
        'Summarize listing performance',
        'Prepare owner update',
      ],
    },
  },
  makeCalmUnit({
    propSlug: 'elm',
    propName: '30 Elm St',
    propLocation: 'Herndon, VA',
    unitSlug: '3',
    label: 'Unit 3',
    tenantSlug: 'tom-b',
    tenantName: 'Tom B.',
    tenantInitial: 'T',
    rent: '$1,460/mo',
    rentNum: '$1,460',
    deposit: '$1,460',
    leaseStart: 'Sep 2024',
    leaseEnd: 'Aug 2026',
    size: '900 sq ft',
    layout: '2 bed · 1 bath',
    floor: '3rd',
  }),
  // birch (calm)
  makeCalmUnit({
    propSlug: 'birch',
    propName: '7 Birch Way',
    propLocation: 'Ashburn, VA',
    unitSlug: '1',
    label: 'Unit 1',
    tenantSlug: 'ravi-p',
    tenantName: 'Ravi P.',
    tenantInitial: 'R',
    rent: '$1,580/mo',
    rentNum: '$1,580',
    deposit: '$1,580',
    leaseStart: 'Oct 2024',
    leaseEnd: 'Sep 2026',
    size: '820 sq ft',
    layout: '2 bed · 1 bath',
    floor: '1st',
  }),
  makeCalmUnit({
    propSlug: 'birch',
    propName: '7 Birch Way',
    propLocation: 'Ashburn, VA',
    unitSlug: '2',
    label: 'Unit 2',
    tenantSlug: 'joan-f',
    tenantName: 'Joan F.',
    tenantInitial: 'J',
    rent: '$1,565/mo',
    rentNum: '$1,565',
    deposit: '$1,565',
    leaseStart: 'Nov 2024',
    leaseEnd: 'Oct 2026',
    size: '820 sq ft',
    layout: '2 bed · 1 bath',
    floor: '2nd',
  }),
  // pine (calm)
  makeCalmUnit({
    propSlug: 'pine',
    propName: '19 Pine Ct',
    propLocation: 'Reston, VA',
    unitSlug: '1',
    label: 'Unit 1',
    tenantSlug: 'dell-k',
    tenantName: 'Dell K.',
    tenantInitial: 'D',
    rent: '$1,620/mo',
    rentNum: '$1,620',
    deposit: '$1,620',
    leaseStart: 'Apr 2025',
    leaseEnd: 'Mar 2027',
    size: '1,040 sq ft',
    layout: '3 bed · 2 bath',
    floor: 'Whole home',
  }),
];

/* ================================================================== */
/* GENERATED TENANTS — one complete TenantDetailMock per non-maya unit */
/* ================================================================== */

/** Shared default for a calm, current tenant in good standing. */
function makeCalmTenant(args: {
  slug: string;
  name: string;
  initial: string;
  propSlug: string;
  propName: string;
  unitSlug: string;
  unitLabel: string;
  rent: string;
  rentNum: string;
  leaseEnd: string;
  propStatusLabel: string;
}): TenantDetailMock {
  return {
    slug: args.slug,
    name: args.name,
    badge: { variant: 'current', label: 'Current' },
    meta: [
      args.propName,
      args.unitLabel,
      args.rent,
      `lease through ${args.leaseEnd}`,
    ],
    propSlug: args.propSlug,
    unitSlug: args.unitSlug,
    attentionLabel: `What matters with ${args.name.split(' ')[0]}`,
    attentionCount: 'payment risk: none',
    attention: [
      {
        dot: 'green',
        kind: 'Rent current',
        detail: `Paid in full for May · ${args.rent}`,
        ariaLabel: `Rent current. Paid in full for May · ${args.rent}`,
        actions: [{ label: 'View ledger', variant: 'default' }],
      },
      {
        dot: 'green',
        kind: 'Strong relationship',
        detail: 'No late payments on record · responsive',
        ariaLabel: 'Strong relationship. No late payments on record · responsive',
        actions: [{ label: 'View history', variant: 'default' }],
      },
      {
        dot: 'green',
        kind: 'Lease healthy',
        detail: `Lease through ${args.leaseEnd} · no renewal action needed`,
        ariaLabel: `Lease healthy. Lease through ${args.leaseEnd} · no renewal action needed`,
        actions: [{ label: 'View lease', variant: 'default' }],
      },
    ],
    odesaNote: {
      body: `${args.name.split(' ')[0]} is **in good standing** — rent is current and there is no open communication needed. Odesa will surface anything new the moment it appears.`,
      basedOn: 'payment ledger · message thread · owner rules',
    },
    metrics: [
      { label: 'Balance', value: '$0', tone: 'good' },
      { label: 'Days late', value: '0', tone: 'good' },
      { label: 'Rent', value: args.rentNum },
      { label: 'Lease end', value: args.leaseEnd },
      { label: 'History', value: 'Clean', tone: 'good' },
    ],
    timelineSub: 'May cycle',
    timeline: [
      { time: 'May 1', variant: 'tenant', line: 'Rent due for May.' },
      {
        time: 'May 1',
        variant: 'tenant',
        actor: args.name.split(' ')[0],
        line: 'Paid May rent in full on the due date.',
      },
      {
        time: 'May 1',
        variant: 'odesa',
        actor: 'Odesa',
        line: 'Confirmed receipt and marked the ledger current.',
      },
      {
        time: 'Jun 1',
        variant: 'future',
        line: 'Next rent due — Odesa will confirm receipt.',
      },
    ],
    thread: [
      {
        who: args.name,
        odesa: false,
        time: 'Apr 28',
        body: 'Thanks for the quick response on the filter swap — all good here.',
      },
      {
        who: 'Odesa',
        odesa: true,
        time: 'Apr 28',
        body: 'Glad to help. Reach out anytime if anything comes up.',
      },
    ],
    threadActions: [
      { label: 'Send a message', variant: 'primary' },
      { label: 'View full thread', variant: 'default' },
    ],
    leaseRules: [
      { k: 'Grace period', v: '3 days' },
      { k: 'Late fee', v: '$50', mono: true },
      { k: 'Escalation', v: 'Owner review after missed plan payment' },
      { k: 'Auto-message', v: 'Reminder 24h before rent due' },
    ],
    related: {
      avatar: args.unitLabel.replace(/\D/g, '') || args.unitLabel.charAt(0),
      name: `${args.propName} · ${args.unitLabel}`,
      sub: `Property status: ${args.propStatusLabel} (unit: current)`,
      actions: [
        {
          label: 'View property',
          variant: 'default',
          href: `/properties/${args.propSlug}`,
        },
        {
          label: 'View unit',
          variant: 'default',
          href: unitHref(args.propSlug, args.unitSlug),
        },
      ],
    },
    sources: [
      { label: 'Payment ledger', freshness: 'synced 11m ago' },
      { label: 'Lease terms', freshness: 'active' },
      { label: 'Message thread', freshness: 'last reply Apr 28' },
      { label: 'Owner rules', freshness: 'active' },
    ],
    ask: {
      subject: args.name,
      contextLabel: args.name,
      prompts: [
        'Summarize payment history',
        'Show the lease terms',
        'Send a message',
        'When does the lease renew?',
        'Prepare owner update',
      ],
    },
  };
}

/** Priya S. — reported the Maple 3B leak; current but with an active WO. */
const PRIYA_TENANT: TenantDetailMock = {
  slug: 'priya',
  name: 'Priya S.',
  badge: { variant: 'current', label: 'Current' },
  meta: ['14 Maple Ct', 'Unit 3B', '$1,620/mo', 'lease through Aug 2027'],
  propSlug: 'maple',
  unitSlug: '3b',
  attentionLabel: 'What matters with Priya',
  attentionCount: 'payment risk: none',
  attention: [
    {
      dot: 'clay',
      kind: 'Active leak reported',
      detail: 'Reported under-sink leak this morning · vendor en route · WO-1042',
      ariaLabel:
        'Active leak reported. Reported under-sink leak this morning · vendor en route · work order WO-1042',
      actions: [
        { label: 'Check ETA', variant: 'primary', href: workOrderHref('WO-1042') },
        { label: 'View order', variant: 'default', href: workOrderHref('WO-1042') },
      ],
    },
    {
      dot: 'green',
      kind: 'Rent current',
      detail: 'Paid in full for May · no balance',
      ariaLabel: 'Rent current. Paid in full for May · no balance',
      actions: [{ label: 'View ledger', variant: 'default' }],
    },
    {
      dot: 'green',
      kind: 'Cooperative tenant',
      detail: 'Shut off the water and granted entry access promptly',
      ariaLabel:
        'Cooperative tenant. Shut off the water and granted entry access promptly',
      actions: [{ label: 'View thread', variant: 'default' }],
    },
  ],
  odesaNote: {
    body: 'Priya reported the leak early and **mitigated it well** — water off, containment placed, entry authorized. Rent is current. Odesa will keep her posted on the vendor ETA automatically.',
    basedOn: 'tenant report · message thread · payment ledger · work order log',
  },
  metrics: [
    { label: 'Balance', value: '$0', tone: 'good' },
    { label: 'Days late', value: '0', tone: 'good' },
    { label: 'Rent', value: '$1,620' },
    { label: 'Lease end', value: 'Aug 2027' },
    { label: 'History', value: 'Clean', tone: 'good' },
  ],
  timelineSub: 'Today',
  timeline: [
    {
      time: '8:12 AM',
      variant: 'tenant',
      actor: 'Priya',
      line: 'Reported water pooling under the kitchen sink with two photos.',
    },
    {
      time: '8:14 AM',
      variant: 'odesa',
      actor: 'Odesa',
      line: 'Triaged as urgent and opened WO-1042.',
    },
    {
      time: '8:30 AM',
      variant: 'tenant',
      actor: 'Priya',
      line: 'Confirmed water shut off and entry authorized while at work.',
    },
    {
      time: '2–4 PM',
      variant: 'future',
      line: 'Vendor on-site window — Odesa will confirm the repair.',
    },
  ],
  thread: [
    {
      who: 'Priya S.',
      odesa: false,
      time: '8:12 AM',
      body: '“There’s water pooling under the kitchen sink — sending photos now.”',
    },
    {
      who: 'Odesa',
      odesa: true,
      time: '8:15 AM',
      body: 'Thanks Priya — got it triaged as urgent. Can you shut the valve under the sink and let me know if entry is OK while you’re out?',
    },
    {
      who: 'Odesa',
      odesa: true,
      time: 'Draft',
      body: 'Good news — Diaz Plumbing is confirmed for 2–4 PM today. They have the lockbox code. I’ll let you know the moment it’s fixed.',
      draft: true,
    },
  ],
  threadActions: [
    { label: 'Send vendor update', variant: 'primary' },
    { label: 'Schedule follow-up', variant: 'default' },
  ],
  leaseRules: [
    { k: 'Grace period', v: '3 days' },
    { k: 'Late fee', v: '$50', mono: true },
    { k: 'Entry terms', v: 'Lease §9 · 24h notice or emergency' },
    { k: 'Auto-message', v: 'Vendor ETA + completion updates' },
  ],
  related: {
    avatar: '3B',
    name: '14 Maple Ct · Unit 3B',
    sub: 'Property status: Watching · active leak (unit: watching)',
    actions: [
      { label: 'View property', variant: 'default', href: '/properties/maple' },
      { label: 'View unit', variant: 'default', href: unitHref('maple', '3b') },
    ],
  },
  sources: [
    { label: 'Tenant report & photos', freshness: '8:12 AM today' },
    { label: 'Message thread', freshness: 'live' },
    { label: 'Payment ledger', freshness: 'synced 11m ago' },
    { label: 'Work order log', freshness: 'live' },
  ],
  ask: {
    subject: 'Priya S.',
    contextLabel: 'Priya S.',
    prompts: [
      'Send a vendor ETA update',
      'Check the leak repair status',
      'Summarize the work order',
      'Show payment history',
      'Prepare owner update',
    ],
  },
};

const GENERATED_TENANTS: TenantDetailMock[] = [
  // oak (non-maya)
  makeCalmTenant({
    slug: 'aaron',
    name: 'Aaron V.',
    initial: 'A',
    propSlug: 'oak',
    propName: '22 Oak St',
    unitSlug: '2b',
    unitLabel: 'Unit 2B',
    rent: '$1,480/mo',
    rentNum: '$1,480',
    leaseEnd: 'Jan 2027',
    propStatusLabel: 'At risk',
  }),
  makeCalmTenant({
    slug: 'dana-w',
    name: 'Dana W.',
    initial: 'D',
    propSlug: 'oak',
    propName: '22 Oak St',
    unitSlug: '3c',
    unitLabel: 'Unit 3C',
    rent: '$1,535/mo',
    rentNum: '$1,535',
    leaseEnd: 'Nov 2026',
    propStatusLabel: 'At risk',
  }),
  {
    // jon — Unit 4 noise-complaint tenant (watching)
    slug: 'jon',
    name: 'Jon Bell',
    badge: { variant: 'watching', label: 'Watching' },
    meta: ['22 Oak St', 'Unit 4', '$1,560/mo', 'lease through Oct 2026'],
    propSlug: 'oak',
    unitSlug: '4',
    attentionLabel: 'What matters with Jon',
    attentionCount: 'payment risk: none',
    attention: [
      {
        dot: 'amber',
        kind: 'Noise complaint',
        detail: 'Second report in 30 days · watching for a pattern',
        ariaLabel:
          'Noise complaint. Second report in 30 days · watching for a pattern',
        actions: [
          { label: 'View thread', variant: 'primary' },
          { label: 'Prepare reminder', variant: 'default' },
        ],
      },
      {
        dot: 'green',
        kind: 'Rent current',
        detail: 'Paid in full for May · no balance',
        ariaLabel: 'Rent current. Paid in full for May · no balance',
        actions: [{ label: 'View ledger', variant: 'default' }],
      },
      {
        dot: 'green',
        kind: 'Lease healthy',
        detail: 'Lease through Oct 2026 · no renewal action needed',
        ariaLabel: 'Lease healthy. Lease through Oct 2026 · no renewal action needed',
        actions: [{ label: 'View lease', variant: 'default' }],
      },
    ],
    odesaNote: {
      body: "Jon's rent is current; the only watch item is a **second noise report in 30 days**. Odesa recommends a **gentle reminder of quiet hours** rather than escalation, and will flag a third report immediately.",
      basedOn: 'noise complaint log · message thread · lease terms · owner rules',
    },
    metrics: [
      { label: 'Balance', value: '$0', tone: 'good' },
      { label: 'Days late', value: '0', tone: 'good' },
      { label: 'Rent', value: '$1,560' },
      { label: 'Lease end', value: 'Oct 2026' },
      { label: 'Complaints', value: '2 / 30d', tone: 'warn' },
    ],
    timelineSub: 'Noise log',
    timeline: [
      {
        time: 'Apr 14',
        variant: 'neutral',
        actor: 'Neighbor',
        line: 'First noise report logged — late-evening music.',
      },
      {
        time: 'Apr 15',
        variant: 'odesa',
        actor: 'Odesa',
        line: 'Sent a friendly quiet-hours reminder; Jon acknowledged.',
      },
      {
        time: 'May 9',
        variant: 'neutral',
        actor: 'Neighbor',
        line: 'Second noise report logged — watching for a pattern.',
      },
      {
        time: 'Next',
        variant: 'future',
        line: 'A third report would trigger an owner-review flag.',
      },
    ],
    thread: [
      {
        who: 'Odesa',
        odesa: true,
        time: 'Apr 15',
        body: 'Hi Jon — a quick reminder that quiet hours run 10 PM–7 AM. Thanks for keeping things easy for neighbors.',
      },
      {
        who: 'Jon Bell',
        odesa: false,
        time: 'Apr 15',
        body: '“Got it, sorry about that — will keep it down.”',
      },
      {
        who: 'Odesa',
        odesa: true,
        time: 'Draft',
        body: 'Hi Jon — we had another late-evening noise note this week. Just a gentle heads-up on quiet hours. Appreciate you.',
        draft: true,
      },
    ],
    threadActions: [
      { label: 'Send reminder', variant: 'primary' },
      { label: 'View noise log', variant: 'default' },
    ],
    leaseRules: [
      { k: 'Quiet hours', v: '10 PM – 7 AM' },
      { k: 'Late fee', v: '$50', mono: true },
      { k: 'Escalation', v: 'Owner review after 3rd report / 30d' },
      { k: 'Auto-message', v: 'Reminder on each logged report' },
    ],
    related: {
      avatar: '4',
      name: '22 Oak St · Unit 4',
      sub: 'Property status: At risk · noise + collection items (unit: watching)',
      actions: [
        { label: 'View property', variant: 'default', href: '/properties/oak' },
        { label: 'View unit', variant: 'default', href: unitHref('oak', '4') },
      ],
    },
    sources: [
      { label: 'Noise complaint log', freshness: '2 reports / 30d' },
      { label: 'Message thread', freshness: 'last reply Apr 15' },
      { label: 'Payment ledger', freshness: 'synced 11m ago' },
      { label: 'Lease terms', freshness: 'active' },
    ],
    ask: {
      subject: 'Jon Bell',
      contextLabel: 'Jon Bell',
      prompts: [
        'Draft a quiet-hours reminder',
        'Summarize the noise history',
        'What happens on a third report?',
        'Show payment history',
        'Prepare owner update',
      ],
    },
  },
  makeCalmTenant({
    slug: 'nora',
    name: 'Nora K.',
    initial: 'N',
    propSlug: 'oak',
    propName: '22 Oak St',
    unitSlug: '5',
    unitLabel: 'Unit 5',
    rent: '$1,545/mo',
    rentNum: '$1,545',
    leaseEnd: 'Feb 2027',
    propStatusLabel: 'At risk',
  }),
  // cedar
  makeCalmTenant({
    slug: 'marcus',
    name: 'Marcus T.',
    initial: 'M',
    propSlug: 'cedar',
    propName: '108 Cedar Ln',
    unitSlug: '1a',
    unitLabel: 'Unit 1A',
    rent: '$1,410/mo',
    rentNum: '$1,410',
    leaseEnd: 'May 2027',
    propStatusLabel: 'Watching',
  }),
  makeCalmTenant({
    slug: 'sandra-k',
    name: 'Sandra K.',
    initial: 'S',
    propSlug: 'cedar',
    propName: '108 Cedar Ln',
    unitSlug: '2c',
    unitLabel: 'Unit 2C',
    rent: '$1,390/mo',
    rentNum: '$1,390',
    leaseEnd: 'Jul 2026',
    propStatusLabel: 'Watching',
  }),
  makeCalmTenant({
    slug: 'owen',
    name: 'Owen L.',
    initial: 'O',
    propSlug: 'cedar',
    propName: '108 Cedar Ln',
    unitSlug: '3b',
    unitLabel: 'Unit 3B',
    rent: '$1,430/mo',
    rentNum: '$1,430',
    leaseEnd: 'Feb 2027',
    propStatusLabel: 'Watching',
  }),
  // maple
  makeCalmTenant({
    slug: 'lena',
    name: 'Lena M.',
    initial: 'L',
    propSlug: 'maple',
    propName: '14 Maple Ct',
    unitSlug: '1a',
    unitLabel: 'Unit 1A',
    rent: '$1,495/mo',
    rentNum: '$1,495',
    leaseEnd: 'Apr 2027',
    propStatusLabel: 'Watching',
  }),
  makeCalmTenant({
    slug: 'carlos-r',
    name: 'Carlos R.',
    initial: 'C',
    propSlug: 'maple',
    propName: '14 Maple Ct',
    unitSlug: '2b',
    unitLabel: 'Unit 2B',
    rent: '$1,500/mo',
    rentNum: '$1,500',
    leaseEnd: 'Dec 2026',
    propStatusLabel: 'Watching',
  }),
  PRIYA_TENANT,
  {
    // eli-n — maple 4D renewal-due tenant (current, strong)
    slug: 'eli-n',
    name: 'Eli N.',
    badge: { variant: 'current', label: 'Current' },
    meta: ['14 Maple Ct', 'Unit 4D', '$1,510/mo', 'renewal due Friday'],
    propSlug: 'maple',
    unitSlug: '4d',
    attentionLabel: 'What matters with Eli',
    attentionCount: 'payment risk: none',
    attention: [
      {
        dot: 'amber',
        kind: 'Renewal due Friday',
        detail: 'Lease ends May 2026 · owner decision needed this week',
        ariaLabel:
          'Renewal due Friday. Lease ends May 2026 · owner decision needed this week',
        actions: [
          { label: 'Review renewal', variant: 'primary' },
          { label: 'Send to owner', variant: 'default' },
        ],
      },
      {
        dot: 'green',
        kind: 'Strong tenant',
        detail: 'On time for 22 months · zero issues',
        ariaLabel: 'Strong tenant. On time for 22 months · zero issues',
        actions: [{ label: 'View history', variant: 'default' }],
      },
      {
        dot: 'green',
        kind: 'Rent current',
        detail: 'Paid in full for May · no balance',
        ariaLabel: 'Rent current. Paid in full for May · no balance',
        actions: [{ label: 'View ledger', variant: 'default' }],
      },
    ],
    odesaNote: {
      body: "Eli is a **22-month, on-time tenant** whose lease renews Friday. Odesa recommends offering renewal at a **3% increase** in line with comps, and has the offer ready for the owner queue.",
      basedOn: 'lease calendar · payment history · market comps · owner rules',
    },
    metrics: [
      { label: 'Balance', value: '$0', tone: 'good' },
      { label: 'Days late', value: '0', tone: 'good' },
      { label: 'Rent', value: '$1,510' },
      { label: 'Lease end', value: 'May 2026' },
      { label: 'History', value: '22mo clean', tone: 'good' },
    ],
    timelineSub: 'Renewal cycle',
    timeline: [
      {
        time: 'Apr 1',
        variant: 'odesa',
        actor: 'Odesa',
        line: 'Flagged the upcoming renewal window 60 days out.',
      },
      {
        time: 'May 8',
        variant: 'odesa',
        actor: 'Odesa',
        line: 'Prepared a renewal offer at a 3% increase with market comps.',
      },
      {
        time: 'Friday',
        variant: 'future',
        line: 'Renewal decision due — Odesa will send the offer once approved.',
      },
    ],
    thread: [
      {
        who: 'Eli N.',
        odesa: false,
        time: 'Apr 30',
        body: '“Happy here — planning to stay another year if that works.”',
      },
      {
        who: 'Odesa',
        odesa: true,
        time: 'Apr 30',
        body: 'Great to hear, Eli. I’ll prepare a renewal and send the details soon.',
      },
      {
        who: 'Odesa',
        odesa: true,
        time: 'Draft',
        body: 'Hi Eli — your renewal is ready at $1,555/mo for another 12 months. Let me know and I’ll get it over to you.',
        draft: true,
      },
    ],
    threadActions: [
      { label: 'Send renewal offer', variant: 'primary' },
      { label: 'View market comps', variant: 'default' },
    ],
    leaseRules: [
      { k: 'Grace period', v: '3 days' },
      { k: 'Late fee', v: '$50', mono: true },
      { k: 'Renewal window', v: 'Closes Friday' },
      { k: 'Auto-message', v: 'Renewal reminder 30d before end' },
    ],
    related: {
      avatar: '4D',
      name: '14 Maple Ct · Unit 4D',
      sub: 'Property status: Watching · renewal due (unit: watching)',
      actions: [
        { label: 'View property', variant: 'default', href: '/properties/maple' },
        { label: 'View unit', variant: 'default', href: unitHref('maple', '4d') },
      ],
    },
    sources: [
      { label: 'Lease calendar', freshness: 'renewal Fri' },
      { label: 'Payment history', freshness: 'synced 11m ago' },
      { label: 'Market comps', freshness: 'updated weekly' },
      { label: 'Message thread', freshness: 'last reply Apr 30' },
    ],
    ask: {
      subject: 'Eli N.',
      contextLabel: 'Eli N.',
      prompts: [
        'Draft the renewal offer',
        'Show market comps',
        'Send the renewal to the owner',
        'Summarize payment history',
        'What rent increase is fair?',
      ],
    },
  },
  // elm (occupied units only — Unit 2 is vacant)
  makeCalmTenant({
    slug: 'grace-h',
    name: 'Grace H.',
    initial: 'G',
    propSlug: 'elm',
    propName: '30 Elm St',
    unitSlug: '1',
    unitLabel: 'Unit 1',
    rent: '$1,475/mo',
    rentNum: '$1,475',
    leaseEnd: 'Jun 2026',
    propStatusLabel: 'Leasing',
  }),
  makeCalmTenant({
    slug: 'tom-b',
    name: 'Tom B.',
    initial: 'T',
    propSlug: 'elm',
    propName: '30 Elm St',
    unitSlug: '3',
    unitLabel: 'Unit 3',
    rent: '$1,460/mo',
    rentNum: '$1,460',
    leaseEnd: 'Aug 2026',
    propStatusLabel: 'Leasing',
  }),
  // birch (calm)
  makeCalmTenant({
    slug: 'ravi-p',
    name: 'Ravi P.',
    initial: 'R',
    propSlug: 'birch',
    propName: '7 Birch Way',
    unitSlug: '1',
    unitLabel: 'Unit 1',
    rent: '$1,580/mo',
    rentNum: '$1,580',
    leaseEnd: 'Sep 2026',
    propStatusLabel: 'Calm',
  }),
  makeCalmTenant({
    slug: 'joan-f',
    name: 'Joan F.',
    initial: 'J',
    propSlug: 'birch',
    propName: '7 Birch Way',
    unitSlug: '2',
    unitLabel: 'Unit 2',
    rent: '$1,565/mo',
    rentNum: '$1,565',
    leaseEnd: 'Oct 2026',
    propStatusLabel: 'Calm',
  }),
  // pine (calm)
  makeCalmTenant({
    slug: 'dell-k',
    name: 'Dell K.',
    initial: 'D',
    propSlug: 'pine',
    propName: '19 Pine Ct',
    unitSlug: '1',
    unitLabel: 'Unit 1',
    rent: '$1,620/mo',
    rentNum: '$1,620',
    leaseEnd: 'Mar 2027',
    propStatusLabel: 'Calm',
  }),
];

/* ================================================================== */
/* GENERATED: work orders — every referenced WO resolves to a page     */
/* ================================================================== */

/**
 * Lifecycle status for a generated work order. Drives the stepper, badge,
 * metrics, timeline shape, and whether an owner-approval block is shown.
 *
 * - `resolved`      — completed/historical (e.g. a finished HVAC service).
 *                     Stepper is fully done; resolved badge; no live next step.
 * - `owner-review`  — triaged but blocked on an owner decision before dispatch
 *                     (e.g. a flagged appliance replacement). Early/blocked
 *                     stepper; approval block is the pending ask.
 * - `vendor-overdue`— dispatched + accepted but the vendor missed its window.
 *                     Stepper stalls at "En route"; escalation is the next step.
 */
type WorkOrderStatus = 'resolved' | 'owner-review' | 'vendor-overdue';

interface MakeWorkOrderArgs {
  id: string;
  title: string;
  status: WorkOrderStatus;
  urgency: Urgency;
  badge: BadgeSpec;
  propSlug: string;
  unitSlug: string;
  /** e.g. "22 Oak St". */
  propName: string;
  /** e.g. "Unit 1A". */
  unitLabel: string;
  /** e.g. "Maya R." — falls back gracefully when a unit is vacant. */
  tenantName: string;
  /** First letter / glyph for the vendor avatar. */
  vendorName: string;
  /** Vendor slug for cross-linking to the vendor brief (omit when unassigned). */
  vendorSlug?: string;
  /** One-line, natural-voice description of the work. */
  description: string;
  /** Short trade label, e.g. "Plumbing" / "HVAC" / "Appliance". */
  category: string;
  /** Cost figure, e.g. "$1,180" — used in metrics + approval. */
  estimate: string;
  /** When the WO opened/closed, e.g. "Apr 18" or "opened 2 days ago". */
  when: string;
}

/** First grapheme of a name, for an avatar glyph. */
function avatarGlyph(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : '#';
}

/**
 * Build a complete, natural-voiced work-order page from a small set of params.
 *
 * Every section the `/work-orders/<id>` page renders is populated for all three
 * lifecycle states so nothing renders empty: status stepper, operating brief,
 * Odesa note, next action, metric strip, timeline, owner-approval block (shown
 * only when relevant), vendor context, access / mitigation KV, photos, audit
 * sources, and the Ask-Odesa island.
 *
 * @param args - Work-order context.
 * @returns A fully-populated, immutable `WorkOrderMock`.
 */
function makeWorkOrder(args: MakeWorkOrderArgs): WorkOrderMock {
  const {
    id,
    title,
    status,
    urgency,
    badge,
    propSlug,
    unitSlug,
    propName,
    unitLabel,
    tenantName,
    vendorName,
    vendorSlug,
    description,
    category,
    estimate,
    when,
  } = args;

  const unitHrefStr = unitHref(propSlug, unitSlug);
  const vendorGlyph = avatarGlyph(vendorName);
  const isResolved = status === 'resolved';
  const isOwnerReview = status === 'owner-review';
  const isOverdue = status === 'vendor-overdue';

  const stepper: StepperStep[] = isResolved
    ? [
        { label: 'Reported', state: 'done' },
        { label: 'Dispatched', state: 'done' },
        { label: 'On site', state: 'done' },
        { label: 'Completed', state: 'done' },
        { label: 'Closed', state: 'done' },
      ]
    : isOwnerReview
      ? [
          { label: 'Reported', state: 'done' },
          { label: 'Triaged', state: 'done' },
          { label: 'Owner review', state: 'current' },
          { label: 'Dispatch', state: 'todo' },
          { label: 'Completed', state: 'todo' },
        ]
      : [
          { label: 'Dispatched', state: 'done' },
          { label: 'Accepted', state: 'done' },
          { label: 'En route', state: 'current' },
          { label: 'On site', state: 'todo' },
          { label: 'Completed', state: 'todo' },
        ];

  const stepperAria = isResolved
    ? 'Status: Completed'
    : isOwnerReview
      ? 'Status: Owner review'
      : 'Status: Vendor overdue';

  const attentionCount = isResolved
    ? 'resolved · no action'
    : isOwnerReview
      ? `${urgency} · owner decision pending`
      : `${urgency} · vendor overdue`;

  const attention: AttentionItem[] = isResolved
    ? [
        {
          dot: 'green',
          kind: 'Work completed',
          loc: `${unitLabel} · ${propName}`,
          detail: `${vendorName} closed this out · ${when} · no follow-up needed`,
          ariaLabel: `Work completed at ${unitLabel}, ${propName}. ${vendorName} closed this out ${when}, no follow-up needed`,
          actions: [{ label: 'View receipt', variant: 'default' }],
        },
        {
          dot: 'green',
          kind: 'Tenant clear',
          loc: tenantName,
          detail: 'No open requests tied to this order',
          ariaLabel: `Tenant clear for ${tenantName}. No open requests tied to this order`,
          actions: [{ label: 'View unit', variant: 'default', href: unitHrefStr }],
        },
      ]
    : isOwnerReview
      ? [
          {
            dot: 'clay',
            kind: 'Owner decision pending',
            loc: `${unitLabel} · ${propName}`,
            detail: `${description} · ${estimate} estimate awaiting approval`,
            ariaLabel: `Owner decision pending at ${unitLabel}, ${propName}. ${description}, ${estimate} estimate awaiting approval`,
            actions: [
              { label: 'Review decision', variant: 'primary' },
              { label: 'View quote', variant: 'default' },
            ],
          },
          {
            dot: 'green',
            kind: 'Not urgent',
            detail: 'No active failure · planned replacement, owner can decide on timing',
            ariaLabel:
              'Not urgent. No active failure, planned replacement, owner can decide on timing',
            actions: [{ label: 'View item', variant: 'default', href: unitHrefStr }],
          },
        ]
      : [
          {
            dot: 'clay',
            kind: 'Vendor overdue',
            loc: `${unitLabel} · ${propName}`,
            detail: `${vendorName} is 24h past the committed window · escalation drafted`,
            ariaLabel: `Vendor overdue at ${unitLabel}, ${propName}. ${vendorName} is 24h past the committed window, escalation drafted`,
            actions: [
              { label: 'Escalate', variant: 'primary' },
              { label: 'Message vendor', variant: 'default' },
            ],
          },
          {
            dot: 'amber',
            kind: 'Tenant waiting',
            loc: tenantName,
            detail: `${description} · kept informed of the delay`,
            ariaLabel: `Tenant waiting, ${tenantName}. ${description}, kept informed of the delay`,
            actions: [{ label: 'View thread', variant: 'default' }],
          },
        ];

  const odesaNote: OdesaNote = isResolved
    ? {
        body: `This order is **resolved**. ${vendorName} completed ${description.toLowerCase()} on ${when} and the receipt is on file. Odesa is keeping it in the maintenance history for ${unitLabel} — no action needed.`,
        basedOn: 'work order log · vendor receipt · maintenance history',
      }
    : isOwnerReview
      ? {
          body: `Odesa flagged this from the ${unitLabel} appliance registry and triaged it as a **planned replacement**, not an emergency. The ${estimate} estimate sits above the auto-approve ceiling, so it is **queued for your decision**. No vendor is dispatched until you approve.`,
          basedOn: 'appliance registry · vendor quote · owner rules',
        }
      : {
          body: `Odesa dispatched **${vendorName}** for ${description.toLowerCase()}, but they are now **24h past** the committed window. An escalation message is **drafted and ready** — Odesa will send it and propose a backup vendor if there is no response by end of day.`,
          basedOn: 'work order log · vendor SLA · tenant messages',
        };

  const nextAction: NextAction = isResolved
    ? {
        body: `No further action — ${vendorName} closed this on ${when}. Odesa will keep the record in ${unitLabel}'s maintenance history and surface anything new automatically.`,
      }
    : isOwnerReview
      ? {
          body: `Review the **${estimate} replacement** in the owner queue. Once approved, Odesa will dispatch a vendor and schedule the swap; if you'd rather wait, it stays parked with no further nudges.`,
        }
      : {
          body: `If **${vendorName}** does not respond by end of day, Odesa will **send the drafted escalation** and offer a backup vendor so ${tenantName} isn't left waiting.`,
        };

  const metrics: MetricCell[] = [
    { label: 'Priority', value: capitalize(urgency), prio: urgency },
    {
      label: 'Status',
      value: isResolved ? 'Completed' : isOwnerReview ? 'Owner review' : 'Overdue',
      tone: isResolved ? 'good' : 'warn',
    },
    { label: 'Vendor', value: isOwnerReview ? 'Not yet assigned' : vendorName },
    { label: isResolved ? 'Cost' : 'Estimate', value: estimate },
    { label: isResolved ? 'Closed' : 'Opened', value: when },
  ];

  const timelineSub = isResolved
    ? 'Reported → closed'
    : isOwnerReview
      ? 'Reported → owner queue'
      : 'Dispatched → overdue';

  const timeline: TimelineEvent[] = isResolved
    ? [
        {
          time: 'Day 1',
          variant: 'odesa',
          actor: 'Odesa',
          line: `Opened ${id} for ${description.toLowerCase()} and matched ${vendorName} from the ${category.toLowerCase()} roster.`,
        },
        {
          time: 'Day 1',
          variant: 'neutral',
          actor: vendorName,
          line: 'Accepted the job and scheduled the visit.',
        },
        {
          time: when,
          variant: 'neutral',
          actor: vendorName,
          line: 'Completed the work on site and submitted the receipt.',
        },
        {
          time: when,
          variant: 'odesa',
          actor: 'Odesa',
          line: `Verified completion, logged the cost, and closed ${id}.`,
        },
      ]
    : isOwnerReview
      ? [
          {
            time: 'Day 1',
            variant: 'odesa',
            actor: 'Odesa',
            line: `Flagged ${description.toLowerCase()} from the ${unitLabel} appliance registry.`,
          },
          {
            time: 'Day 1',
            variant: 'odesa',
            actor: 'Odesa',
            line: `Triaged as a planned replacement — no active failure or tenant request.`,
          },
          {
            time: 'Day 2',
            variant: 'odesa',
            actor: 'Odesa',
            line: `Sourced a ${estimate} estimate and queued it for owner approval (over the auto-approve ceiling).`,
          },
          {
            time: 'Now',
            variant: 'future',
            line: 'Awaiting owner decision — Odesa will dispatch on approval.',
          },
        ]
      : [
          {
            time: 'Day 1',
            variant: 'tenant',
            actor: tenantName,
            line: `Reported the issue: ${description.toLowerCase()}.`,
          },
          {
            time: 'Day 1',
            variant: 'odesa',
            actor: 'Odesa',
            line: `Opened ${id}, triaged as ${category.toLowerCase()}, and dispatched ${vendorName}.`,
          },
          {
            time: 'Day 1',
            variant: 'neutral',
            actor: vendorName,
            line: 'Accepted the job and committed to a next-day window.',
          },
          {
            time: 'Day 2',
            variant: 'odesa',
            actor: 'Odesa',
            line: 'Window passed with no arrival — drafted an escalation and notified the tenant.',
          },
          {
            time: 'Now',
            variant: 'future',
            line: 'Awaiting vendor response — Odesa will escalate by end of day.',
          },
        ];

  const approvalSub = isResolved
    ? 'auto-approved · under the ceiling'
    : isOwnerReview
      ? 'waiting in the owner queue'
      : 'auto-approved · under the ceiling';

  const approval: ApprovalCell[] = isResolved
    ? [
        { k: 'Approval', v: 'Auto-approved' },
        { k: 'Basis', v: `Under the $250 auto-approve ceiling (${estimate})` },
        { k: 'Amount', v: estimate, mono: true },
        { k: 'Closed', v: when },
        {
          k: 'Scope',
          v: `${description} at ${unitLabel}, ${propName}`,
          wide: true,
        },
      ]
    : isOwnerReview
      ? [
          { k: 'Status', v: 'Awaiting owner approval' },
          { k: 'Amount', v: estimate, mono: true },
          { k: 'Basis', v: 'Exceeds the $250 auto-approve threshold' },
          { k: 'Recommended', v: 'Approve — appliance is past service life' },
          {
            k: 'Scope',
            v: `${description} at ${unitLabel}, ${propName}`,
            wide: true,
          },
        ]
      : [
          { k: 'Approval', v: 'Auto-approved' },
          { k: 'Basis', v: `Under the $250 auto-approve ceiling (${estimate})` },
          { k: 'Amount', v: estimate, mono: true },
          { k: 'Escalation', v: 'Drafted · sends end of day if silent' },
          {
            k: 'Scope',
            v: `${description} at ${unitLabel}, ${propName}`,
            wide: true,
          },
        ];

  const vendorSub = isResolved
    ? `${category} · 4.8★ · completed · receipt on file`
    : isOwnerReview
      ? 'No vendor dispatched until the owner approves'
      : `${category} · 4.6★ · accepted · 24h overdue`;

  const vendor: CtxCardSpec = {
    avatar: isOwnerReview ? '?' : vendorGlyph,
    name: isOwnerReview ? 'Vendor pending' : vendorName,
    sub: vendorSub,
    actions: isOwnerReview
      ? [{ label: 'Suggest a vendor', variant: 'default' }]
      : [
          {
            label: 'View vendor',
            variant: 'default',
            href: vendorSlug ? `/vendors/${vendorSlug}` : '#',
          },
          { label: 'Call', variant: 'default' },
        ],
  };

  const access: KvCell[] = isResolved
    ? [
        { k: 'Issue', v: `${category} · resolved` },
        { k: 'Tenant home', v: 'Was present for the visit' },
        { k: 'Access', v: 'Owner / manager escorted' },
        { k: 'Follow-up', v: 'None required' },
        { k: 'Warranty', v: 'Workmanship covered 90 days' },
        { k: 'Unit', v: `${unitLabel} · ${propName}` },
      ]
    : isOwnerReview
      ? [
          { k: 'Issue', v: `${category} · planned replacement` },
          { k: 'Active failure', v: 'No · still functioning' },
          { k: 'Tenant impact', v: 'None today · proactive swap' },
          { k: 'Access', v: 'Smart lock · code on file' },
          { k: 'Scheduling', v: 'After owner approval' },
          { k: 'Unit', v: `${unitLabel} · ${propName}` },
        ]
      : [
          { k: 'Issue', v: `${category} · awaiting vendor` },
          { k: 'Tenant home', v: 'Flexible · entry authorized' },
          { k: 'Access', v: 'Lockbox code shared w/ vendor' },
          { k: 'Containment', v: 'Tenant managing in the interim' },
          { k: 'Backup vendor', v: 'Identified · ready on escalation' },
          { k: 'Unit', v: `${unitLabel} · ${propName}` },
        ];

  const photos: PhotoTile[] = isResolved
    ? [{ caption: 'Before' }, { caption: 'After' }]
    : isOwnerReview
      ? [{ caption: 'Unit / model plate' }, { caption: 'Service tag' }]
      : [{ caption: 'Reported issue' }, { caption: 'Work area' }];

  const sources: SourceItem[] = isResolved
    ? [
        { label: 'Work order log', freshness: `closed ${when}` },
        { label: `Vendor receipt · ${vendorName}`, freshness: `${estimate} · ${when}` },
        { label: 'Maintenance history', freshness: 'updated' },
        { label: 'Owner rules', freshness: 'active' },
      ]
    : isOwnerReview
      ? [
          { label: 'Appliance registry', freshness: 'flagged' },
          { label: 'Vendor quote', freshness: `${estimate} · pending` },
          { label: 'Owner approval queue', freshness: 'awaiting decision' },
          { label: 'Owner rules', freshness: 'active' },
        ]
      : [
          { label: 'Work order log', freshness: 'live' },
          { label: 'Vendor SLA terms', freshness: 'breached' },
          { label: `Vendor quote · ${vendorName}`, freshness: `${estimate}` },
          { label: 'Tenant message thread', freshness: 'kept informed' },
          { label: 'Owner rules', freshness: 'active' },
        ];

  return {
    woId: id,
    title,
    badge,
    meta: [id, propName, unitLabel, when],
    propSlug,
    unitSlug,
    vendorSlug,
    stepperAria,
    stepper,
    attentionCount,
    attention,
    odesaNote,
    nextAction,
    metrics,
    timelineSub,
    timeline,
    approvalSub,
    approval,
    vendor,
    access,
    photos,
    sources,
    ask: {
      subject: id,
      contextLabel: id,
      prompts: isResolved
        ? [
            'Summarize what was done',
            'Show the receipt',
            'View the unit history',
            'Was this under warranty?',
            'Prepare owner update',
          ]
        : isOwnerReview
          ? [
              'Approve the replacement',
              'Show the estimate',
              'Why now?',
              'Find a cheaper vendor',
              'Prepare owner update',
            ]
          : [
              'Escalate the vendor',
              'Draft a follow-up',
              'Find a backup vendor',
              'Message the tenant',
              'Prepare owner update',
            ],
    },
  };
}

/** Capitalize the first letter of a lowercase token (e.g. urgency labels). */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Bespoke: oak/1a water-heater replacement parked in the owner queue. */
const WO_1031: WorkOrderMock = makeWorkOrder({
  id: 'WO-1031',
  title: 'Replace water heater',
  status: 'owner-review',
  urgency: 'high',
  badge: { variant: 'scheduled', label: 'Owner review' },
  propSlug: 'oak',
  unitSlug: '1a',
  propName: '22 Oak St',
  unitLabel: 'Unit 1A',
  tenantName: 'Maya R.',
  vendorName: 'Comfort Air',
  vendorSlug: 'comfort-air',
  description: 'Replace the 2012 Rheem XE40 water heater (out of warranty, 14 yrs)',
  category: 'Plumbing',
  estimate: '$1,180',
  when: 'opened 3 days ago',
});

/** Bespoke: oak/1a HVAC filter replacement, completed by Comfort Air Apr 18. */
const WO_0998: WorkOrderMock = makeWorkOrder({
  id: 'WO-0998',
  title: 'HVAC filter replacement',
  status: 'resolved',
  urgency: 'normal',
  badge: { variant: 'resolved', label: 'Resolved' },
  propSlug: 'oak',
  unitSlug: '1a',
  propName: '22 Oak St',
  unitLabel: 'Unit 1A',
  tenantName: 'Maya R.',
  vendorName: 'Comfort Air',
  vendorSlug: 'comfort-air',
  description: 'Replace the HVAC filter and check the Carrier 24ABC6 system',
  category: 'HVAC',
  estimate: '$85',
  when: 'Apr 18',
});

/** oak/2b routine HVAC service (also the shared calm-unit history WO). */
const WO_0980: WorkOrderMock = makeWorkOrder({
  id: 'WO-0980',
  title: 'Routine HVAC service',
  status: 'resolved',
  urgency: 'normal',
  badge: { variant: 'resolved', label: 'Resolved' },
  propSlug: 'oak',
  unitSlug: '2b',
  propName: '22 Oak St',
  unitLabel: 'Unit 2B',
  tenantName: 'Aaron V.',
  vendorName: 'Comfort Air',
  vendorSlug: 'comfort-air',
  description: 'Spring HVAC tune-up and filter replacement',
  category: 'HVAC',
  estimate: '$120',
  when: 'this spring',
});

/** oak/4 routine HVAC service (Jon Bell). */
const WO_0990: WorkOrderMock = makeWorkOrder({
  id: 'WO-0990',
  title: 'Routine HVAC service',
  status: 'resolved',
  urgency: 'normal',
  badge: { variant: 'resolved', label: 'Resolved' },
  propSlug: 'oak',
  unitSlug: '4',
  propName: '22 Oak St',
  unitLabel: 'Unit 4',
  tenantName: 'Jon Bell',
  vendorName: 'Comfort Air',
  vendorSlug: 'comfort-air',
  description: 'Spring HVAC tune-up and filter replacement',
  category: 'HVAC',
  estimate: '$120',
  when: 'this spring',
});

/** maple/3b routine HVAC service (Priya S.). */
const WO_1009: WorkOrderMock = makeWorkOrder({
  id: 'WO-1009',
  title: 'Routine HVAC service',
  status: 'resolved',
  urgency: 'normal',
  badge: { variant: 'resolved', label: 'Resolved' },
  propSlug: 'maple',
  unitSlug: '3b',
  propName: '14 Maple Ct',
  unitLabel: 'Unit 3B',
  tenantName: 'Priya S.',
  vendorName: 'Comfort Air',
  vendorSlug: 'comfort-air',
  description: 'Spring HVAC tune-up and filter replacement',
  category: 'HVAC',
  estimate: '$120',
  when: 'this spring',
});

/** maple/4d routine HVAC service (Owen L.). */
const WO_1012: WorkOrderMock = makeWorkOrder({
  id: 'WO-1012',
  title: 'Routine HVAC service',
  status: 'resolved',
  urgency: 'normal',
  badge: { variant: 'resolved', label: 'Resolved' },
  propSlug: 'maple',
  unitSlug: '4d',
  propName: '14 Maple Ct',
  unitLabel: 'Unit 4D',
  tenantName: 'Owen L.',
  vendorName: 'Comfort Air',
  vendorSlug: 'comfort-air',
  description: 'Spring HVAC tune-up and filter replacement',
  category: 'HVAC',
  estimate: '$120',
  when: 'this spring',
});

/** elm/2 make-ready turn before listing (vacant unit). */
const WO_1020: WorkOrderMock = makeWorkOrder({
  id: 'WO-1020',
  title: 'Make-ready turn',
  status: 'resolved',
  urgency: 'normal',
  badge: { variant: 'resolved', label: 'Resolved' },
  propSlug: 'elm',
  unitSlug: '2',
  propName: '30 Elm St',
  unitLabel: 'Unit 2',
  tenantName: 'No current tenant',
  vendorName: 'BrightTurn Services',
  vendorSlug: 'brightturn-services',
  description: 'Full paint and deep clean to ready the unit for listing',
  category: 'Turn / make-ready',
  estimate: '$1,640',
  when: 'Apr 30',
});

/** Bespoke: cedar/2c garbage-disposal repair, vendor 24h overdue. */
const WO_1044: WorkOrderMock = makeWorkOrder({
  id: 'WO-1044',
  title: 'Repair garbage disposal',
  status: 'vendor-overdue',
  urgency: 'high',
  badge: { variant: 'open', label: 'Vendor overdue' },
  propSlug: 'cedar',
  unitSlug: '2c',
  propName: '108 Cedar Ln',
  unitLabel: 'Unit 2C',
  tenantName: 'Sandra K.',
  vendorName: 'Northstar Appliance',
  vendorSlug: 'northstar-appliance',
  description: 'Repair the jammed InSinkErator Badger 5 disposal',
  category: 'Appliance',
  estimate: '$180',
  when: 'opened 2 days ago',
});

/* ================================================================== */
/* REGISTRIES + LOOKUPS                                                 */
/* ================================================================== */

const PROPERTIES_BY_SLUG: Record<string, PropertyDetailMock> = {
  oak: OAK_PROPERTY,
  cedar: CEDAR_PROPERTY,
  maple: MAPLE_PROPERTY,
  elm: ELM_PROPERTY,
  birch: BIRCH_PROPERTY,
  pine: PINE_PROPERTY,
};

const ALL_UNITS: UnitDetailMock[] = [OAK_1A_UNIT, ...GENERATED_UNITS];

const UNITS_BY_KEY: Record<string, UnitDetailMock> = Object.fromEntries(
  ALL_UNITS.map((unit) => [`${unit.propSlug}/${unit.unitSlug}`, unit]),
);

const ALL_TENANTS: TenantDetailMock[] = [MAYA_TENANT, ...GENERATED_TENANTS];

const TENANTS_BY_SLUG: Record<string, TenantDetailMock> = Object.fromEntries(
  ALL_TENANTS.map((tenant) => [tenant.slug, tenant]),
);

const WORK_ORDERS_BY_ID: Record<string, WorkOrderMock> = {
  'WO-1042': WO_1042,
  'WO-1031': WO_1031,
  'WO-0998': WO_0998,
  'WO-0980': WO_0980,
  'WO-0990': WO_0990,
  'WO-1009': WO_1009,
  'WO-1012': WO_1012,
  'WO-1020': WO_1020,
  'WO-1044': WO_1044,
};

/**
 * Look up a property brief by slug (oak, cedar, maple, elm, birch, pine).
 * Returns `undefined` for unknown slugs.
 */
export function getPropertyDetail(slug: string): PropertyDetailMock | undefined {
  return PROPERTIES_BY_SLUG[slug];
}

/**
 * Look up a unit brief by property slug + unit slug.
 * Returns `undefined` for unknown combinations.
 */
export function getUnitDetail(
  propSlug: string,
  unitSlug: string,
): UnitDetailMock | undefined {
  return UNITS_BY_KEY[`${propSlug}/${unitSlug}`];
}

/**
 * Look up a tenant brief by slug. Returns `undefined` for unknown slugs.
 */
export function getTenantDetail(slug: string): TenantDetailMock | undefined {
  return TENANTS_BY_SLUG[slug];
}

/**
 * Look up a maintenance work order by id (e.g. "WO-1042").
 * Returns `undefined` for unknown ids.
 */
export function getWorkOrder(woId: string): WorkOrderMock | undefined {
  return WORK_ORDERS_BY_ID[woId];
}
