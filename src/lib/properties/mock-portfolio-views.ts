// TODO(properties backend): swap these mock lookups for real queries in
// ./queries.ts (listTenantsDirectory / listRentLedger / listVendors /
// getVendor / listDocuments / listOpenItems are reserved) and map slugs ->
// real UUIDs. The directory in `TENANTS_DIRECTORY` is the AUTHORITATIVE roster
// — when the backend lands, reconcile ./mock-detail.ts to it, not the reverse.

/**
 * Properties — mock data for the 6 portfolio list views.
 *
 * Source of truth for the sidebar / command-center list routes that each drill
 * into an existing detail page:
 *   /tenants    (rows -> /tenants/<slug>)              — TENANTS_DIRECTORY
 *   /rent       (rows -> /properties/<p>/units/<u>)    — RENT_LEDGER
 *   /vendors    (rows -> /vendors/<slug>)              — VENDORS_DIRECTORY
 *   /vendors/<slug> (rows -> /work-orders/<woId>)      — VENDOR_DETAILS
 *   /documents  (rows -> /tenants/<s> | /vendors/<s>)  — DOCUMENTS
 *   /open-items (rows -> the relevant detail page)     — OPEN_ITEMS
 *
 * Every row is transcribed VERBATIM from the approved static mockups
 * (tenants.html, rent.html, vendors.html, vendor-detail.html, documents.html,
 * open-items.html). Diaz Plumbing's vendor brief is transcribed verbatim; the
 * other four vendor briefs are generated to stay consistent with the vendors
 * directory + the work orders each one already owns in ./mock-detail.ts.
 */

import {
  tenantHref,
  unitHref,
  workOrderHref,
  type ActionLink,
  type AskSpec,
  type KvCell,
  type MetricCell,
  type SourceItem,
} from './mock-detail';

/* ------------------------------------------------------------------ */
/* HREF helpers (pure — build URLs with template strings)              */
/* ------------------------------------------------------------------ */

/** Vendor brief route, e.g. `/vendors/diaz-plumbing`. */
export function vendorHref(slug: string): string {
  return `/vendors/${slug}`;
}

/** Tenants directory route. */
export function tenantsHref(): string {
  return '/tenants';
}

/** Rent ledger route. */
export function rentHref(): string {
  return '/rent';
}

/** Vendors directory route. */
export function vendorsHref(): string {
  return '/vendors';
}

/** Documents list route. */
export function documentsHref(): string {
  return '/documents';
}

/** Open items route. */
export function openItemsHref(): string {
  return '/open-items';
}

/** Owner queue route (an open-items target). */
export function ownerQueueHref(): string {
  return '/owner-queue';
}

/* ================================================================== */
/* TENANTS DIRECTORY                                                    */
/* ================================================================== */

/** Status pill on a directory row — text label + variant for the tint. */
export type TenantStatusVariant =
  | 'plan'
  | 'current'
  | 'watching'
  | 'renewal';

export interface TenantStatusPill {
  variant: TenantStatusVariant;
  label: string;
}

export interface TenantDirectoryRow {
  slug: string;
  /** Avatar glyph (first initial). */
  initial: string;
  name: string;
  /** e.g. "22 Oak St". */
  property: string;
  /** e.g. "1A". */
  unit: string;
  /** e.g. "$1,520/mo". */
  rentLabel: string;
  statusPill: TenantStatusPill;
  /** Row link target. */
  href: string;
}

/** Header summary line for the tenants list. */
export interface TenantsDirectoryHeader {
  /** e.g. "17 tenants · 17 of 18 units occupied · 1 on a plan · 1 watching". */
  summary: string;
  total: number;
}

/** Filter facets for the tenants list (membership computed below). */
export type TenantFacetId = 'all' | 'attention' | 'plan' | 'renewals';

export interface FacetSpec<TId extends string> {
  id: TId;
  label: string;
  count: number;
}

const TENANTS_DIRECTORY: readonly TenantDirectoryRow[] = [
  row('maya', 'Maya R.', '22 Oak St', '1A', '$1,520/mo', { variant: 'plan', label: 'Payment plan' }),
  row('aaron', 'Aaron V.', '22 Oak St', '2B', '$1,480/mo', { variant: 'current', label: 'Current' }),
  row('dana-w', 'Dana W.', '22 Oak St', '3C', '$1,535/mo', { variant: 'current', label: 'Current' }),
  row('jon', 'Jon Bell', '22 Oak St', '4', '$1,560/mo', { variant: 'watching', label: 'Watching' }),
  row('nora', 'Nora K.', '22 Oak St', '5', '$1,545/mo', { variant: 'current', label: 'Current' }),
  row('marcus', 'Marcus T.', '108 Cedar Ln', '1A', '$1,410/mo', { variant: 'current', label: 'Current' }),
  row('sandra-k', 'Sandra K.', '108 Cedar Ln', '2C', '$1,390/mo', { variant: 'current', label: 'Current' }),
  row('owen', 'Owen L.', '108 Cedar Ln', '3B', '$1,430/mo', { variant: 'current', label: 'Current' }),
  row('lena', 'Lena M.', '14 Maple Ct', '1A', '$1,495/mo', { variant: 'current', label: 'Current' }),
  row('carlos-r', 'Carlos R.', '14 Maple Ct', '2B', '$1,500/mo', { variant: 'current', label: 'Current' }),
  row('priya', 'Priya S.', '14 Maple Ct', '3B', '$1,540/mo', { variant: 'watching', label: 'Watching' }),
  row('eli-n', 'Eli N.', '14 Maple Ct', '4D', '$1,510/mo', { variant: 'renewal', label: 'Renewal due' }),
  row('grace-h', 'Grace H.', '30 Elm St', '1', '$1,475/mo', { variant: 'current', label: 'Current' }),
  row('tom-b', 'Tom B.', '30 Elm St', '3', '$1,460/mo', { variant: 'current', label: 'Current' }),
  row('ravi-p', 'Ravi P.', '7 Birch Way', '1', '$1,580/mo', { variant: 'current', label: 'Current' }),
  row('joan-f', 'Joan F.', '7 Birch Way', '2', '$1,565/mo', { variant: 'current', label: 'Current' }),
  row('dell-k', 'Dell K.', '19 Pine Ct', '1', '$1,620/mo', { variant: 'current', label: 'Current' }),
];

/** Build a directory row, deriving the avatar initial + href from inputs. */
function row(
  slug: string,
  name: string,
  property: string,
  unit: string,
  rentLabel: string,
  statusPill: TenantStatusPill,
): TenantDirectoryRow {
  return {
    slug,
    initial: name.charAt(0).toUpperCase(),
    name,
    property,
    unit,
    rentLabel,
    statusPill,
    href: tenantHref(slug),
  };
}

const TENANTS_HEADER: TenantsDirectoryHeader = {
  summary: '17 tenants · 17 of 18 units occupied · 1 on a plan · 1 watching',
  total: 17,
};

/** Facet membership predicates — keep in sync with the directory statuses. */
function inTenantFacet(facet: TenantFacetId, r: TenantDirectoryRow): boolean {
  switch (facet) {
    case 'all':
      return true;
    case 'attention':
      return r.statusPill.variant === 'watching' || r.statusPill.variant === 'renewal';
    case 'plan':
      return r.statusPill.variant === 'plan';
    case 'renewals':
      return r.statusPill.variant === 'renewal';
  }
}

const TENANT_FACETS: readonly FacetSpec<TenantFacetId>[] = [
  { id: 'all', label: 'All', count: count(TENANTS_DIRECTORY, (r) => inTenantFacet('all', r)) },
  { id: 'attention', label: 'Needs attention', count: count(TENANTS_DIRECTORY, (r) => inTenantFacet('attention', r)) },
  { id: 'plan', label: 'On a plan', count: count(TENANTS_DIRECTORY, (r) => inTenantFacet('plan', r)) },
  { id: 'renewals', label: 'Renewals', count: count(TENANTS_DIRECTORY, (r) => inTenantFacet('renewals', r)) },
];

/** Count rows matching a predicate (pure helper). */
function count<T>(rows: readonly T[], pred: (r: T) => boolean): number {
  return rows.reduce((n, r) => (pred(r) ? n + 1 : n), 0);
}

/* ================================================================== */
/* RENT LEDGER (May 2026)                                               */
/* ================================================================== */

export type RentStatus = 'paid' | 'outstanding' | 'on-plan';

export interface RentStatusPill {
  status: RentStatus;
  label: string;
}

/**
 * Editable lease terms carried on a real-data ledger row. Mock rows omit
 * this — the inline "Edit terms" affordance only renders when present
 * (live Supabase rows with an ACTIVE lease).
 */
export interface RentLeaseTerms {
  leaseId: string;
  /** Whole-dollar-and-cents number (numeric(10,2) coerced). */
  rentAmount: number;
  rentDueDay: number;
  endDate: string | null;
}

export interface RentLedgerRow {
  /** Avatar glyph. */
  initial: string;
  tenantName: string;
  /** e.g. "22 Oak St". */
  property: string;
  /** e.g. "1A". */
  unit: string;
  propSlug: string;
  unitSlug: string;
  /** e.g. "$1,520". */
  amount: string;
  /** When paid / due, e.g. "May 1" or "Due Fri". */
  when: string;
  statusPill: RentStatusPill;
  href: string;
  /** Present only for live rows whose lease is still active (editable). */
  leaseTerms?: RentLeaseTerms;
  /**
   * rent_events.id for the displayed cycle — present on live Supabase rows.
   * The "Record payment" action targets this exact row (never a recomputed
   * cycle); the affordance is omitted when it is absent.
   */
  rentEventId?: string;
  /**
   * Lease id for the row's rent cycle — present on live Supabase rows.
   * Powers the "Record payment" affordance on outstanding rows.
   */
  leaseId?: string;
  /**
   * Current-cycle outstanding balance in DOLLARS (live rows only). Drives
   * the default amount + whether "Record payment" is offered.
   */
  outstandingDollars?: number;
}

/** Header summary metrics for the rent ledger. */
export interface RentSummary {
  /** e.g. "May 2026". */
  period: string;
  /** e.g. "$24,180 billed · 94% collected · $1,520 outstanding · 1 on a plan". */
  summary: string;
  metrics: MetricCell[];
  /**
   * Exact source values for dense rent dashboards. Optional so legacy mock
   * ledgers remain valid; the live Supabase query always supplies them.
   */
  facts?: {
    billedCents: number;
    collectedCents: number;
    outstandingCents: number;
    collectionRate: number;
    onPlanCount: number;
    lateCount: number;
  };
}

const RENT_LEDGER: readonly RentLedgerRow[] = [
  rentRow('Maya R.', '22 Oak St', '1A', 'oak', '1a', '$1,520', 'Due Fri', { status: 'on-plan', label: 'On plan' }),
  rentRow('Aaron V.', '22 Oak St', '2B', 'oak', '2b', '$1,480', 'May 1', { status: 'paid', label: 'Paid' }),
  rentRow('Dana W.', '22 Oak St', '3C', 'oak', '3c', '$1,535', 'May 1', { status: 'paid', label: 'Paid' }),
  rentRow('Jon Bell', '22 Oak St', '4', 'oak', '4', '$1,560', 'May 2', { status: 'paid', label: 'Paid' }),
  rentRow('Nora K.', '22 Oak St', '5', 'oak', '5', '$1,545', 'May 1', { status: 'paid', label: 'Paid' }),
  rentRow('Sandra K.', '108 Cedar Ln', '2C', 'cedar', '2c', '$1,390', 'May 3', { status: 'paid', label: 'Paid' }),
  rentRow('Eli N.', '14 Maple Ct', '4D', 'maple', '4d', '$1,510', 'May 1', { status: 'paid', label: 'Paid' }),
  rentRow('Priya S.', '14 Maple Ct', '3B', 'maple', '3b', '$1,540', 'May 2', { status: 'paid', label: 'Paid' }),
  rentRow('Grace H.', '30 Elm St', '1', 'elm', '1', '$1,475', 'May 1', { status: 'paid', label: 'Paid' }),
  rentRow('Ravi P.', '7 Birch Way', '1', 'birch', '1', '$1,580', 'May 1', { status: 'paid', label: 'Paid' }),
  rentRow('Dell K.', '19 Pine Ct', '1', 'pine', '1', '$1,620', 'May 1', { status: 'paid', label: 'Paid' }),
];

/** Build a rent-ledger row, deriving the avatar initial + unit href. */
function rentRow(
  tenantName: string,
  property: string,
  unit: string,
  propSlug: string,
  unitSlug: string,
  amount: string,
  when: string,
  statusPill: RentStatusPill,
): RentLedgerRow {
  return {
    initial: tenantName.charAt(0).toUpperCase(),
    tenantName,
    property,
    unit,
    propSlug,
    unitSlug,
    amount,
    when,
    statusPill,
    href: unitHref(propSlug, unitSlug),
  };
}

const RENT_SUMMARY: RentSummary = {
  period: 'May 2026',
  summary: '$24,180 billed · 94% collected · $1,520 outstanding · 1 on a plan',
  metrics: [
    { label: 'Billed', value: '$24,180' },
    { label: 'Collected', value: '94%' },
    { label: 'Outstanding', value: '$1,520', tone: 'warn' },
    { label: 'On a plan', value: '1' },
    { label: 'Late', value: '1', tone: 'warn' },
  ],
};

export type RentFacetId = 'all' | 'paid' | 'outstanding' | 'on-plan';

function inRentFacet(facet: RentFacetId, r: RentLedgerRow): boolean {
  switch (facet) {
    case 'all':
      return true;
    case 'paid':
      return r.statusPill.status === 'paid';
    case 'outstanding':
      return r.statusPill.status === 'outstanding';
    case 'on-plan':
      return r.statusPill.status === 'on-plan';
  }
}

const RENT_FACETS: readonly FacetSpec<RentFacetId>[] = [
  { id: 'all', label: 'All', count: count(RENT_LEDGER, (r) => inRentFacet('all', r)) },
  { id: 'paid', label: 'Paid', count: count(RENT_LEDGER, (r) => inRentFacet('paid', r)) },
  { id: 'outstanding', label: 'Outstanding', count: count(RENT_LEDGER, (r) => inRentFacet('outstanding', r)) },
  { id: 'on-plan', label: 'On a plan', count: count(RENT_LEDGER, (r) => inRentFacet('on-plan', r)) },
];

/* ================================================================== */
/* VENDORS DIRECTORY                                                    */
/* ================================================================== */

export type VendorStatusVariant = 'preferred' | 'active' | 'switch' | 'alternative';

export interface VendorStatusPill {
  variant: VendorStatusVariant;
  label: string;
}

export interface VendorDirectoryRow {
  slug: string;
  initial: string;
  name: string;
  /** e.g. "Plumbing". */
  trade: string;
  /** e.g. "4.8". */
  rating: string;
  /** e.g. "1 open" / "1 overdue" / "0 open". */
  openLabel: string;
  statusPill: VendorStatusPill;
  href: string;
}

/** Header summary line for the vendors list. */
export interface VendorsDirectoryHeader {
  /** e.g. "5 vendors · 2 open work orders · 1 overdue · 1 switch pending". */
  summary: string;
  total: number;
}

const VENDORS_DIRECTORY: readonly VendorDirectoryRow[] = [
  vendorRow('diaz-plumbing', 'Diaz Plumbing', 'Plumbing', '4.8', '1 open', { variant: 'preferred', label: 'Preferred' }),
  vendorRow('comfort-air', 'Comfort Air', 'HVAC', '4.6', '0 open', { variant: 'active', label: 'Active' }),
  vendorRow('northstar-appliance', 'Northstar Appliance', 'Appliance', '3.9', '1 overdue', { variant: 'switch', label: 'Switch pending' }),
  vendorRow('quicker-repair', 'Quicker Repair', 'Appliance', '4.7', '0 open', { variant: 'alternative', label: 'Alternative' }),
  vendorRow('brightturn-services', 'BrightTurn Services', 'Landscaping', '4.4', '0 open', { variant: 'active', label: 'Active' }),
];

/** Build a vendor directory row, deriving the avatar initial + href. */
function vendorRow(
  slug: string,
  name: string,
  trade: string,
  rating: string,
  openLabel: string,
  statusPill: VendorStatusPill,
): VendorDirectoryRow {
  return {
    slug,
    initial: name.charAt(0).toUpperCase(),
    name,
    trade,
    rating,
    openLabel,
    statusPill,
    href: vendorHref(slug),
  };
}

const VENDORS_HEADER: VendorsDirectoryHeader = {
  summary: '5 vendors · 2 open work orders · 1 overdue · 1 switch pending',
  total: 5,
};

/* ================================================================== */
/* VENDOR DETAIL (one brief per vendor)                                 */
/* ================================================================== */

/** A work-order row inside a vendor brief (`.wo-row`). */
export interface VendorWorkOrderRow {
  /** `false` => active/terracotta diamond; `true` => resolved/calm check. */
  calm: boolean;
  woId: string;
  title: string;
  /** e.g. "14 Maple Ct · Unit 3B · accepted · ETA 2–4 PM". */
  sub: string;
  /** Status badge label, e.g. "Accepted" / "Resolved". */
  badge: string;
  href: string;
}

/** A "What's active" tile (`.active-row`). */
export interface VendorActiveRow {
  /** Leading numeral / glyph. */
  index: string;
  kind: string;
  detail: string;
  action: ActionLink;
}

export interface VendorDetailMock {
  slug: string;
  name: string;
  statusPill: VendorStatusPill;
  /** Title meta segments joined by `·`, e.g. "Plumbing · 4.8★ · 14 jobs · since 2023". */
  meta: string[];
  /** "What's active" section. */
  activeSub: string;
  active: VendorActiveRow[];
  /** Odesa note body + "Based on" line. */
  odesaNote: { body: string; basedOn: string };
  metrics: MetricCell[];
  /** Work orders section. */
  workOrdersSub: string;
  workOrders: VendorWorkOrderRow[];
  /** Contact / terms KV. */
  contact: KvCell[];
  sources: SourceItem[];
  ask: AskSpec;
}

/** A vendor work-order row, deriving its href from the WO id. */
function woRow(
  calm: boolean,
  woId: string,
  title: string,
  sub: string,
  badge: string,
): VendorWorkOrderRow {
  return { calm, woId, title, sub, badge, href: workOrderHref(woId) };
}

/** Diaz Plumbing — transcribed VERBATIM from vendor-detail.html. */
const DIAZ_PLUMBING: VendorDetailMock = {
  slug: 'diaz-plumbing',
  name: 'Diaz Plumbing',
  statusPill: { variant: 'preferred', label: 'Preferred' },
  meta: ['Plumbing', '4.8★', '14 jobs', 'since 2023'],
  activeSub: '1 open · reliable',
  active: [
    {
      index: '1',
      kind: 'Open work order WO-1042',
      detail: 'Active leak at 14 Maple Ct · accepted · ETA 2–4 PM',
      action: { label: 'View ticket', variant: 'default', href: workOrderHref('WO-1042') },
    },
    {
      index: '2',
      kind: 'Responsive',
      detail: 'Avg response 1.2h · 96% on-time across 14 jobs',
      action: { label: 'View history', variant: 'default' },
    },
  ],
  odesaNote: {
    body: 'Diaz is your most reliable plumber — **4.8★ over 14 jobs** with a 1.2h average response. Currently on WO-1042; no issues flagged.',
    basedOn: 'job history · vendor ratings · work order log',
  },
  metrics: [
    { label: 'Rating', value: '4.8★', tone: 'good' },
    { label: 'Jobs', value: '14' },
    { label: 'Avg response', value: '1.2h' },
    { label: 'On-time', value: '96%', tone: 'good' },
    { label: 'Open WOs', value: '1' },
  ],
  workOrdersSub: '1 open · 13 completed',
  workOrders: [
    woRow(false, 'WO-1042', 'Active leak under kitchen sink', '14 Maple Ct · Unit 3B · accepted · ETA 2–4 PM', 'Accepted'),
    woRow(true, 'WO-0974', 'Disposal replacement', '108 Cedar Ln · Unit 1A · resolved Apr 2', 'Resolved'),
    woRow(true, 'WO-0921', 'Water line repair', '22 Oak St · Unit 5 · resolved Mar 14', 'Resolved'),
  ],
  contact: [
    { k: 'Phone', v: '(703) 555-0142' },
    { k: 'Email', v: 'ops@diazplumbing.co' },
    { k: 'Trades', v: 'Plumbing · drain · heater' },
    { k: 'Coverage', v: 'Loudoun · Fairfax' },
    { k: 'Insurance', v: 'On file · exp 2027' },
    { k: 'Payment terms', v: 'Net 15' },
  ],
  sources: [
    { label: 'Vendor agreement', freshness: 'active' },
    { label: 'W-9 on file', freshness: '2025' },
    { label: 'Insurance certificate', freshness: 'exp 2027' },
    { label: 'Job history', freshness: '14 jobs' },
  ],
  ask: {
    subject: 'Diaz Plumbing',
    contextLabel: 'Diaz Plumbing',
    prompts: [
      'Check WO-1042 status',
      'Message the vendor',
      'Show past jobs',
      'Compare with Quicker Repair',
      'Assign to a property',
    ],
  },
};

/** Comfort Air — HVAC, owns the resolved HVAC work orders + WO-1031 owner-review. */
const COMFORT_AIR: VendorDetailMock = {
  slug: 'comfort-air',
  name: 'Comfort Air',
  statusPill: { variant: 'active', label: 'Active' },
  meta: ['HVAC', '4.6★', '21 jobs', 'since 2022'],
  activeSub: 'no open jobs · steady',
  active: [
    {
      index: '1',
      kind: 'Owner review WO-1031',
      detail: 'Water heater replacement at 22 Oak St · awaiting owner decision',
      action: { label: 'View ticket', variant: 'default', href: workOrderHref('WO-1031') },
    },
    {
      index: '2',
      kind: 'Dependable',
      detail: 'Avg response 2.4h · 94% on-time across 21 jobs',
      action: { label: 'View history', variant: 'default' },
    },
  ],
  odesaNote: {
    body: 'Comfort Air handles your **routine HVAC** across the portfolio — **4.6★ over 21 jobs**. No active emergencies; the only open thread is the WO-1031 water-heater quote in owner review.',
    basedOn: 'job history · vendor ratings · work order log',
  },
  metrics: [
    { label: 'Rating', value: '4.6★', tone: 'good' },
    { label: 'Jobs', value: '21' },
    { label: 'Avg response', value: '2.4h' },
    { label: 'On-time', value: '94%', tone: 'good' },
    { label: 'Open WOs', value: '0' },
  ],
  workOrdersSub: '0 open · 21 completed',
  workOrders: [
    woRow(false, 'WO-1031', 'Replace water heater', '22 Oak St · Unit 1A · owner review · $1,180 quote', 'Owner review'),
    woRow(true, 'WO-0998', 'HVAC filter replacement', '22 Oak St · Unit 1A · resolved Apr 18', 'Resolved'),
    woRow(true, 'WO-1009', 'Routine HVAC service', '14 Maple Ct · Unit 3B · resolved this spring', 'Resolved'),
  ],
  contact: [
    { k: 'Phone', v: '(703) 555-0188' },
    { k: 'Email', v: 'service@comfortair.co' },
    { k: 'Trades', v: 'HVAC · heating · cooling' },
    { k: 'Coverage', v: 'Loudoun · Fairfax · Prince William' },
    { k: 'Insurance', v: 'On file · exp 2027' },
    { k: 'Payment terms', v: 'Net 30' },
  ],
  sources: [
    { label: 'Vendor agreement', freshness: 'active' },
    { label: 'W-9 on file', freshness: '2025' },
    { label: 'Insurance certificate', freshness: 'exp 2027' },
    { label: 'Job history', freshness: '21 jobs' },
  ],
  ask: {
    subject: 'Comfort Air',
    contextLabel: 'Comfort Air',
    prompts: [
      'Check WO-1031 status',
      'Message the vendor',
      'Show past jobs',
      'Schedule a seasonal service',
      'Assign to a property',
    ],
  },
};

/** Northstar Appliance — appliance vendor, currently overdue on WO-1044. */
const NORTHSTAR_APPLIANCE: VendorDetailMock = {
  slug: 'northstar-appliance',
  name: 'Northstar Appliance',
  statusPill: { variant: 'switch', label: 'Switch pending' },
  meta: ['Appliance', '3.9★', '9 jobs', 'since 2024'],
  activeSub: '1 overdue · under review',
  active: [
    {
      index: '1',
      kind: 'Overdue work order WO-1044',
      detail: 'Disposal repair at 108 Cedar Ln · 24h past window · escalation ready',
      action: { label: 'View ticket', variant: 'default', href: workOrderHref('WO-1044') },
    },
    {
      index: '2',
      kind: 'Slipping reliability',
      detail: 'Avg response 6.1h · 71% on-time across 9 jobs',
      action: { label: 'View history', variant: 'default' },
    },
  ],
  odesaNote: {
    body: 'Northstar is **24h overdue on WO-1044** and its on-time rate has slipped to 71%. Odesa recommends **switching the disposal repair to Quicker Repair** and putting Northstar on a watch.',
    basedOn: 'job history · vendor ratings · work order log',
  },
  metrics: [
    { label: 'Rating', value: '3.9★', tone: 'warn' },
    { label: 'Jobs', value: '9' },
    { label: 'Avg response', value: '6.1h', tone: 'warn' },
    { label: 'On-time', value: '71%', tone: 'warn' },
    { label: 'Open WOs', value: '1' },
  ],
  workOrdersSub: '1 open · 8 completed',
  workOrders: [
    woRow(false, 'WO-1044', 'Repair garbage disposal', '108 Cedar Ln · Unit 2C · 24h overdue · escalation drafted', 'Vendor overdue'),
  ],
  contact: [
    { k: 'Phone', v: '(571) 555-0119' },
    { k: 'Email', v: 'dispatch@northstarappliance.co' },
    { k: 'Trades', v: 'Appliance · disposal · refrigeration' },
    { k: 'Coverage', v: 'Loudoun' },
    { k: 'Insurance', v: 'On file · exp 2026' },
    { k: 'Payment terms', v: 'Net 15' },
  ],
  sources: [
    { label: 'Vendor agreement', freshness: 'under review' },
    { label: 'W-9 on file', freshness: '2024' },
    { label: 'Insurance certificate', freshness: 'exp 2026' },
    { label: 'Job history', freshness: '9 jobs' },
  ],
  ask: {
    subject: 'Northstar Appliance',
    contextLabel: 'Northstar Appliance',
    prompts: [
      'Escalate WO-1044',
      'Switch to Quicker Repair',
      'Show past jobs',
      'Message the vendor',
      'Compare with Quicker Repair',
    ],
  },
};

/** Quicker Repair — the alternative appliance vendor proposed for the switch. */
const QUICKER_REPAIR: VendorDetailMock = {
  slug: 'quicker-repair',
  name: 'Quicker Repair',
  statusPill: { variant: 'alternative', label: 'Alternative' },
  meta: ['Appliance', '4.7★', '6 jobs', 'since 2025'],
  activeSub: 'no open jobs · ready',
  active: [
    {
      index: '1',
      kind: 'Available now',
      detail: 'Proposed backup for the Unit 2C disposal · same-day capacity',
      action: { label: 'View proposal', variant: 'default' },
    },
    {
      index: '2',
      kind: 'Fast and rated',
      detail: 'Avg response 1.6h · 98% on-time across 6 jobs',
      action: { label: 'View history', variant: 'default' },
    },
  ],
  odesaNote: {
    body: 'Quicker Repair is your **alternative appliance vendor** — **4.7★ over 6 jobs** with a 1.6h average response. Odesa has it staged to take over WO-1044 if Northstar stays silent.',
    basedOn: 'job history · vendor ratings · work order log',
  },
  metrics: [
    { label: 'Rating', value: '4.7★', tone: 'good' },
    { label: 'Jobs', value: '6' },
    { label: 'Avg response', value: '1.6h' },
    { label: 'On-time', value: '98%', tone: 'good' },
    { label: 'Open WOs', value: '0' },
  ],
  workOrdersSub: '0 open · 6 completed',
  workOrders: [
    woRow(true, 'WO-0962', 'Refrigerator compressor swap', '7 Birch Way · Unit 1 · resolved Mar 30', 'Resolved'),
    woRow(true, 'WO-0948', 'Dishwasher repair', '30 Elm St · Unit 1 · resolved Feb 21', 'Resolved'),
  ],
  contact: [
    { k: 'Phone', v: '(571) 555-0207' },
    { k: 'Email', v: 'hello@quickerrepair.co' },
    { k: 'Trades', v: 'Appliance · disposal · laundry' },
    { k: 'Coverage', v: 'Loudoun · Fairfax' },
    { k: 'Insurance', v: 'On file · exp 2027' },
    { k: 'Payment terms', v: 'Net 15' },
  ],
  sources: [
    { label: 'Vendor agreement', freshness: 'active' },
    { label: 'W-9 on file', freshness: '2025' },
    { label: 'Insurance certificate', freshness: 'exp 2027' },
    { label: 'Job history', freshness: '6 jobs' },
  ],
  ask: {
    subject: 'Quicker Repair',
    contextLabel: 'Quicker Repair',
    prompts: [
      'Assign WO-1044 to Quicker',
      'Message the vendor',
      'Show past jobs',
      'Compare with Northstar Appliance',
      'Assign to a property',
    ],
  },
};

/** BrightTurn Services — landscaping + make-ready turns (owns WO-1020). */
const BRIGHTTURN_SERVICES: VendorDetailMock = {
  slug: 'brightturn-services',
  name: 'BrightTurn Services',
  statusPill: { variant: 'active', label: 'Active' },
  meta: ['Landscaping', '4.4★', '17 jobs', 'since 2022'],
  activeSub: 'no open jobs · seasonal',
  active: [
    {
      index: '1',
      kind: 'Recent turn',
      detail: 'Completed the Unit 2 make-ready turn at 30 Elm St · paint + deep clean',
      action: { label: 'View ticket', variant: 'default', href: workOrderHref('WO-1020') },
    },
    {
      index: '2',
      kind: 'Seasonal coverage',
      detail: 'Avg response 1d · 92% on-time across 17 jobs',
      action: { label: 'View history', variant: 'default' },
    },
  ],
  odesaNote: {
    body: 'BrightTurn handles **landscaping and make-ready turns** — **4.4★ over 17 jobs**. Most recent was the Elm St Unit 2 turn before listing. No open jobs right now.',
    basedOn: 'job history · vendor ratings · work order log',
  },
  metrics: [
    { label: 'Rating', value: '4.4★' },
    { label: 'Jobs', value: '17' },
    { label: 'Avg response', value: '1d' },
    { label: 'On-time', value: '92%', tone: 'good' },
    { label: 'Open WOs', value: '0' },
  ],
  workOrdersSub: '0 open · 17 completed',
  workOrders: [
    woRow(true, 'WO-1020', 'Make-ready turn', '30 Elm St · Unit 2 · resolved Apr 30', 'Resolved'),
  ],
  contact: [
    { k: 'Phone', v: '(703) 555-0164' },
    { k: 'Email', v: 'crew@brightturn.co' },
    { k: 'Trades', v: 'Landscaping · turns · cleaning' },
    { k: 'Coverage', v: 'Loudoun · Fairfax' },
    { k: 'Insurance', v: 'On file · exp 2027' },
    { k: 'Payment terms', v: 'Net 30' },
  ],
  sources: [
    { label: 'Vendor agreement', freshness: 'active' },
    { label: 'W-9 on file', freshness: '2025' },
    { label: 'Insurance certificate', freshness: 'exp 2027' },
    { label: 'Job history', freshness: '17 jobs' },
  ],
  ask: {
    subject: 'BrightTurn Services',
    contextLabel: 'BrightTurn Services',
    prompts: [
      'Schedule a turn',
      'Message the vendor',
      'Show past jobs',
      'Book seasonal landscaping',
      'Assign to a property',
    ],
  },
};

const VENDOR_DETAILS_BY_SLUG: Record<string, VendorDetailMock> = {
  'diaz-plumbing': DIAZ_PLUMBING,
  'comfort-air': COMFORT_AIR,
  'northstar-appliance': NORTHSTAR_APPLIANCE,
  'quicker-repair': QUICKER_REPAIR,
  'brightturn-services': BRIGHTTURN_SERVICES,
};

/* ================================================================== */
/* DOCUMENTS (37 total)                                                 */
/* ================================================================== */

export type DocumentType = 'lease' | 'inspection' | 'insurance' | 'notice' | 'tax' | 'hoa';

export interface DocumentRow {
  /** Title, e.g. "Lease — Maya R.". */
  title: string;
  type: DocumentType;
  /** Type badge label, e.g. "Active" / "Renewal" / "Inspection". */
  badge: string;
  /** Related entity, e.g. "22 Oak St · 1A". */
  related: string;
  /** Date / span line, e.g. "Apr 2025 – Mar 2027". */
  span: string;
  /** Row link target (tenant or vendor detail). */
  href: string;
}

/** Header summary line for the documents list. */
export interface DocumentsHeader {
  /** e.g. "37 files · 17 leases · 2 renewals due · 1 insurance expiring". */
  summary: string;
  /** The headline total (37) — more files than are individually transcribed. */
  total: number;
}

const DOCUMENTS: readonly DocumentRow[] = [
  { title: 'Lease — Maya R.', type: 'lease', badge: 'Active', related: '22 Oak St · 1A', span: 'Apr 2025 – Mar 2027', href: tenantHref('maya') },
  { title: 'Lease — Eli N.', type: 'lease', badge: 'Renewal', related: '14 Maple Ct · 4D', span: 'Renewal due Fri', href: tenantHref('eli-n') },
  { title: 'Move-in inspection', type: 'inspection', badge: 'Inspection', related: '22 Oak St · 1A', span: 'Apr 2025', href: tenantHref('maya') },
  { title: 'W-9 — Diaz Plumbing', type: 'tax', badge: 'Tax', related: 'Vendor record', span: '2025', href: vendorHref('diaz-plumbing') },
  { title: 'Insurance — 22 Oak St', type: 'insurance', badge: 'Insurance', related: 'Property policy', span: 'Exp Dec 2026', href: tenantHref('maya') },
  { title: 'Notice — Unit 4 noise', type: 'notice', badge: 'Notice', related: '22 Oak St · 4', span: 'May 2026', href: tenantHref('jon') },
  { title: 'Lease — Sandra K.', type: 'lease', badge: 'Expiring', related: '108 Cedar Ln · 2C', span: 'Jun 2024 – May 2026', href: tenantHref('sandra-k') },
  { title: 'HOA agreement', type: 'hoa', badge: 'HOA', related: '108 Cedar Ln', span: '2025', href: tenantHref('marcus') },
];

const DOCUMENTS_HEADER: DocumentsHeader = {
  summary: '37 files · 17 leases · 2 renewals due · 1 insurance expiring',
  total: 37,
};

export type DocumentFacetId = 'all' | 'leases' | 'inspections' | 'insurance' | 'notices';

const DOCUMENT_FACETS: readonly FacetSpec<DocumentFacetId>[] = [
  { id: 'all', label: 'All', count: 37 },
  { id: 'leases', label: 'Leases', count: 17 },
  { id: 'inspections', label: 'Inspections', count: 6 },
  { id: 'insurance', label: 'Insurance', count: 6 },
  { id: 'notices', label: 'Notices', count: 8 },
];

/* ================================================================== */
/* OPEN ITEMS (7)                                                       */
/* ================================================================== */

export type OpenItemKind = 'maintenance' | 'rent' | 'owner' | 'leasing';

export interface OpenItemRow {
  /** Leading numeral. */
  index: string;
  kind: OpenItemKind;
  title: string;
  /** Location line, e.g. "14 Maple Ct · Unit 3B". */
  loc: string;
  /** Detail line, e.g. "WO-1042 · vendor accepted · ETA 2–4 PM". */
  detail: string;
  /** Primary action label (e.g. "View ticket"). */
  action: string;
  href: string;
}

/** Header summary line for open items. */
export interface OpenItemsHeader {
  /** e.g. "7 open · 1 urgent · 2 owner decisions · 4 properties". */
  summary: string;
  total: number;
}

const OPEN_ITEMS: readonly OpenItemRow[] = [
  { index: '1', kind: 'maintenance', title: 'Active leak', loc: '14 Maple Ct · Unit 3B', detail: 'WO-1042 · vendor accepted · ETA 2–4 PM', action: 'View ticket', href: workOrderHref('WO-1042') },
  { index: '2', kind: 'maintenance', title: 'Vendor overdue', loc: '108 Cedar Ln · Unit 2C', detail: 'Northstar 24h late · escalation ready', action: 'View vendor', href: vendorHref('northstar-appliance') },
  { index: '3', kind: 'rent', title: 'Rent late', loc: '22 Oak St · Unit 1A', detail: 'Maya R. · 3 days · payment plan set', action: 'Review plan', href: tenantHref('maya') },
  { index: '4', kind: 'owner', title: 'Water heater replacement', loc: '22 Oak St · Unit 1A', detail: 'WO-1031 · owner decision pending', action: 'View decision', href: ownerQueueHref() },
  { index: '5', kind: 'maintenance', title: 'Noise complaint', loc: '22 Oak St · Unit 4', detail: 'Jon Bell · 2nd report in 30 days · watching', action: 'View thread', href: tenantHref('jon') },
  { index: '6', kind: 'owner', title: 'Lease renewal', loc: '14 Maple Ct · Unit 4D', detail: 'Eli N. · deadline Friday · owner approval', action: 'Review', href: ownerQueueHref() },
  { index: '7', kind: 'leasing', title: 'Vacancy', loc: '30 Elm St · Unit 2', detail: 'Listed · 4 tours booked', action: 'View tours', href: unitHref('elm', '2') },
];

const OPEN_ITEMS_HEADER: OpenItemsHeader = {
  summary: '7 open · 1 urgent · 2 owner decisions · 4 properties',
  total: 7,
};

export type OpenItemFacetId = 'all' | 'maintenance' | 'rent' | 'owner' | 'leasing';

function inOpenItemFacet(facet: OpenItemFacetId, r: OpenItemRow): boolean {
  return facet === 'all' ? true : r.kind === facet;
}

const OPEN_ITEM_FACETS: readonly FacetSpec<OpenItemFacetId>[] = [
  { id: 'all', label: 'All', count: count(OPEN_ITEMS, (r) => inOpenItemFacet('all', r)) },
  { id: 'maintenance', label: 'Maintenance', count: count(OPEN_ITEMS, (r) => inOpenItemFacet('maintenance', r)) },
  { id: 'rent', label: 'Rent', count: count(OPEN_ITEMS, (r) => inOpenItemFacet('rent', r)) },
  { id: 'owner', label: 'Owner decisions', count: count(OPEN_ITEMS, (r) => inOpenItemFacet('owner', r)) },
  { id: 'leasing', label: 'Leasing', count: count(OPEN_ITEMS, (r) => inOpenItemFacet('leasing', r)) },
];

/* ================================================================== */
/* LOOKUPS                                                              */
/* ================================================================== */

export interface TenantsDirectory {
  header: TenantsDirectoryHeader;
  facets: readonly FacetSpec<TenantFacetId>[];
  rows: readonly TenantDirectoryRow[];
}

export interface RentLedger {
  summary: RentSummary;
  facets: readonly FacetSpec<RentFacetId>[];
  rows: readonly RentLedgerRow[];
}

export interface VendorsDirectory {
  header: VendorsDirectoryHeader;
  rows: readonly VendorDirectoryRow[];
}

export interface DocumentsList {
  header: DocumentsHeader;
  facets: readonly FacetSpec<DocumentFacetId>[];
  rows: readonly DocumentRow[];
}

export interface OpenItemsList {
  header: OpenItemsHeader;
  facets: readonly FacetSpec<OpenItemFacetId>[];
  rows: readonly OpenItemRow[];
}

/** Tenants directory (rows + facets + header summary). */
export function getTenantsDirectory(): TenantsDirectory {
  return { header: TENANTS_HEADER, facets: TENANT_FACETS, rows: TENANTS_DIRECTORY };
}

/** May 2026 rent ledger (rows + facets + summary metrics). */
export function getRentLedger(): RentLedger {
  return { summary: RENT_SUMMARY, facets: RENT_FACETS, rows: RENT_LEDGER };
}

/** Vendors directory (rows + header summary). */
export function getVendorsDirectory(): VendorsDirectory {
  return { header: VENDORS_HEADER, rows: VENDORS_DIRECTORY };
}

/** A single vendor brief by slug. Returns `undefined` for unknown slugs. */
export function getVendorDetail(slug: string): VendorDetailMock | undefined {
  return VENDOR_DETAILS_BY_SLUG[slug];
}

/** Documents list (rows + facets + header summary). */
export function getDocuments(): DocumentsList {
  return { header: DOCUMENTS_HEADER, facets: DOCUMENT_FACETS, rows: DOCUMENTS };
}

/** Open items list (rows + facets + header summary). */
export function getOpenItems(): OpenItemsList {
  return { header: OPEN_ITEMS_HEADER, facets: OPEN_ITEM_FACETS, rows: OPEN_ITEMS };
}
