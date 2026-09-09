/**
 * Properties — mock portfolio command-center data.
 *
 * Source of truth for the `/properties` "portfolio operations command center".
 * Transcribed verbatim from the approved mockup (odesa-properties4.html
 * `ATTENTION` + `PROPERTIES`). Ordered by operational severity, NOT
 * alphabetically — do not reorder.
 *
 * TODO(properties backend): replace this static data with a derived health
 * model computed from real properties / work-orders / leases / payments via
 * src/lib/properties/queries.ts once a status taxonomy + priority ranking
 * exists. At that point, map the slug `id`s here to real property UUIDs so
 * `propertyHref()` resolves to a live detail page.
 */

export type PropertyStatus = 'atrisk' | 'watching' | 'leasing' | 'calm';

export interface StatMetric {
  label: string;
  value: string;
  /** `warn` = clay, `good` = green-ink; omitted = default ink. */
  tone?: 'warn' | 'good';
}

export interface PropertyIssue {
  tone: 'amber' | 'clay' | 'neutral' | 'allclear';
  /** Decorative leading glyph (aria-hidden at render). */
  glyph: string;
  text: string;
  meta?: string;
}

/**
 * Operator triage signals — boolean flags the `/properties` filters key off.
 * Derived from the same aggregate that drives `status`/`issues`, never faked.
 */
export interface PropertySignalFlags {
  /** status !== "calm" OR any active operational item. */
  needsAttention: boolean;
  /** A late current-cycle rent event is present. */
  rentLate: boolean;
  /** One or more open work orders. */
  maintenanceOpen: boolean;
  /** One or more units with no active lease. */
  vacant: boolean;
  /** An active lease ends within the renewal window (≤60 days). */
  leaseEnding: boolean;
}

export interface PortfolioUnit {
  id: string;
  label: string;
  tenantName: string | null;
  occupancy: 'occupied' | 'vacant';
  leaseEnd: string | null;
  rentState: 'current' | 'outstanding' | 'late' | 'not-recorded';
  openWorkCount: number;
  openIssue: string | null;
}

export interface PortfolioProperty {
  id: string;
  name: string;
  /** Recorded street/city/state/ZIP display line when address fields exist. */
  address?: string;
  /** e.g. "Sterling, VA · 5 units". */
  location: string;
  status: PropertyStatus;
  /** Human label, e.g. "At risk". */
  statusLabel: string;
  /** Bold lead phrase of the summary (omitted for calm properties). */
  summaryLead?: string;
  /** Remainder of the summary after the lead. */
  summaryRest: string;
  stats: StatMetric[];
  issues: PropertyIssue[];
  /** Count used for the (correctly pluralized) card accessible label. */
  activeItems: number;
  /** Operator triage signals for filter chips / attention badges. */
  signals: PropertySignalFlags;
  /** Sum of current-cycle outstanding balances on this property (cents, positive only). */
  outstandingCents: number;
  /** Units/leases with late or outstanding rent this cycle. */
  rentIssueCount: number;
  /** Open work orders on this property. */
  maintenanceOpenCount: number;
  /** Exact live counts. Optional so legacy fixtures remain source-compatible. */
  unitCount?: number;
  occupiedUnitCount?: number;
  /** Lowercased corpus for client-side search: name + location + unit labels + tenant names. */
  searchText: string;
  /** Honest unit-level operating rows. Omitted by legacy fixtures. */
  units?: PortfolioUnit[];
}

export interface PriorityAction {
  label: string;
  variant: 'primary' | 'default';
}

export interface PriorityItem {
  id: string;
  dot: 'clay' | 'amber' | 'neutral';
  kind: string;
  /** e.g. "108 Cedar Ln · Unit 2C". */
  loc: string;
  detail: string;
  actions: PriorityAction[];
}

/**
 * Portfolio-level attention breakdown for the sticky header. Counts are summed
 * across every property. Owner-decision is intentionally omitted — there is no
 * reliable portfolio-level proposal count to back it, so it is not faked.
 */
export interface PortfolioAttention {
  /** Total units/leases with late or outstanding rent. */
  rent: number;
  /** Total open work orders. */
  maintenance: number;
  /** Total leases ending within the renewal window. */
  leasing: number;
  /** Total vacant units. */
  vacant: number;
  /** rent + maintenance + leasing + vacant. */
  total: number;
}

export interface PortfolioSummary {
  properties: number;
  units: number;
  /** Formatted, e.g. "94%". */
  occupancy: string;
  /** Formatted monthly, e.g. "$24,180". */
  mrr: string;
  /** Portfolio-level attention breakdown for the header. */
  attention: PortfolioAttention;
}

export interface PortfolioTab {
  id: string;
  label: string;
  count?: number;
}

/**
 * Property detail link. Resolves to the mock detail page rendered from
 * `./mock-detail.ts` (`getPropertyDetail(id)`). TODO(properties backend): swap
 * to `/properties/${uuid}` once slug ids map to real property records.
 */
export function propertyHref(id: string): string {
  return `/properties/${id}`;
}

export const PRIORITY_ITEMS: PriorityItem[] = [
  {
    id: 'cedar-vendor',
    dot: 'clay',
    kind: 'Vendor overdue',
    loc: '108 Cedar Ln · Unit 2C',
    detail: 'Northstar 24h late · escalation ready',
    actions: [
      { label: 'Escalate', variant: 'primary' },
      { label: 'View', variant: 'default' },
    ],
  },
  {
    id: 'oak-rent',
    dot: 'amber',
    kind: 'Rent late',
    loc: '22 Oak St · Unit 1A',
    detail: '3 days late · payment plan set',
    actions: [
      { label: 'Review plan', variant: 'primary' },
      { label: 'View', variant: 'default' },
    ],
  },
  {
    id: 'maple-leak',
    dot: 'amber',
    kind: 'Leak active',
    loc: '14 Maple Ct · Unit 3B',
    detail: 'Vendor dispatched · awaiting ETA',
    actions: [
      { label: 'Check ETA', variant: 'primary' },
      { label: 'View', variant: 'default' },
    ],
  },
  {
    id: 'elm-vacancy',
    dot: 'neutral',
    kind: 'Vacancy',
    loc: '30 Elm St · Unit 2',
    detail: 'Listed · 4 tours booked',
    actions: [
      { label: 'View tours', variant: 'primary' },
      { label: 'View', variant: 'default' },
    ],
  },
];

export const PROPERTIES: PortfolioProperty[] = [
  {
    id: 'oak',
    name: '22 Oak St',
    location: 'Sterling, VA · 5 units',
    status: 'atrisk',
    statusLabel: 'At risk',
    summaryLead: 'Rent late',
    summaryRest: 'Payment plan set · Noise complaint open',
    stats: [
      { label: 'Occupancy', value: '5/5' },
      { label: 'May collected', value: '88%', tone: 'warn' },
      { label: 'Active items', value: '2' },
    ],
    issues: [
      { tone: 'amber', glyph: '⚠', text: 'Unit 1A rent late', meta: '3 days · plan set' },
      { tone: 'neutral', glyph: '◷', text: 'Noise complaint · Unit 4', meta: 'watching' },
    ],
    activeItems: 2,
    signals: {
      needsAttention: true,
      rentLate: true,
      maintenanceOpen: false,
      vacant: false,
      leaseEnding: false,
    },
    outstandingCents: 165000,
    rentIssueCount: 1,
    maintenanceOpenCount: 0,
    searchText: '22 oak st · sterling, va · 5 units · unit 1a · unit 4',
  },
  {
    id: 'cedar',
    name: '108 Cedar Ln',
    location: 'Leesburg, VA · 3 units',
    status: 'watching',
    statusLabel: 'Watching',
    summaryLead: 'Vendor overdue',
    summaryRest: 'Unit 2C · Northstar 24h late',
    stats: [
      { label: 'Occupancy', value: '3/3' },
      { label: 'May collected', value: '100%', tone: 'good' },
      { label: 'Active items', value: '1' },
    ],
    issues: [
      { tone: 'clay', glyph: '⚠', text: 'Vendor delay · Unit 2C', meta: 'Northstar 24h overdue · escalation ready' },
    ],
    activeItems: 1,
    signals: {
      needsAttention: true,
      rentLate: false,
      maintenanceOpen: true,
      vacant: false,
      leaseEnding: false,
    },
    outstandingCents: 0,
    rentIssueCount: 0,
    maintenanceOpenCount: 1,
    searchText: '108 cedar ln · leesburg, va · 3 units · unit 2c',
  },
  {
    id: 'maple',
    name: '14 Maple Ct',
    location: 'Ashburn, VA · 4 units',
    status: 'watching',
    statusLabel: 'Watching',
    summaryLead: 'Leak active',
    summaryRest: 'Vendor dispatched · Renewal due Fri',
    stats: [
      { label: 'Occupancy', value: '4/4' },
      { label: 'May collected', value: '92%', tone: 'warn' },
      { label: 'Active items', value: '2' },
    ],
    issues: [
      { tone: 'amber', glyph: '⚠', text: 'Unit 3B leak · Vendor dispatched', meta: 'awaiting ETA' },
      { tone: 'neutral', glyph: '◷', text: 'Unit 4D renewal · Deadline Fri', meta: 'approval needed' },
    ],
    activeItems: 2,
    signals: {
      needsAttention: true,
      rentLate: false,
      maintenanceOpen: true,
      vacant: false,
      leaseEnding: true,
    },
    outstandingCents: 120000,
    rentIssueCount: 1,
    maintenanceOpenCount: 1,
    searchText: '14 maple ct · ashburn, va · 4 units · unit 3b · unit 4d',
  },
  {
    id: 'elm',
    name: '30 Elm St',
    location: 'Herndon, VA · 3 units',
    status: 'leasing',
    statusLabel: 'Leasing',
    summaryLead: 'Leasing active',
    summaryRest: 'Vacancy being worked · 4 tours booked',
    stats: [
      { label: 'Occupancy', value: '2/3', tone: 'warn' },
      { label: 'May collected', value: '100%', tone: 'good' },
      { label: 'Active items', value: '1' },
    ],
    issues: [
      { tone: 'neutral', glyph: '◷', text: 'Unit 2 vacant · Listed', meta: '4 tours booked' },
    ],
    activeItems: 1,
    signals: {
      needsAttention: true,
      rentLate: false,
      maintenanceOpen: false,
      vacant: true,
      leaseEnding: false,
    },
    outstandingCents: 0,
    rentIssueCount: 0,
    maintenanceOpenCount: 0,
    searchText: '30 elm st · herndon, va · 3 units · unit 2',
  },
  {
    id: 'birch',
    name: '7 Birch Way',
    location: 'Ashburn, VA · 2 units',
    status: 'calm',
    statusLabel: 'Calm',
    summaryRest: 'All clear · Rent collected · No open items',
    stats: [
      { label: 'Occupancy', value: '2/2' },
      { label: 'May collected', value: '100%', tone: 'good' },
      { label: 'Active items', value: '0' },
    ],
    issues: [{ tone: 'allclear', glyph: '✓', text: 'All clear' }],
    activeItems: 0,
    signals: {
      needsAttention: false,
      rentLate: false,
      maintenanceOpen: false,
      vacant: false,
      leaseEnding: false,
    },
    outstandingCents: 0,
    rentIssueCount: 0,
    maintenanceOpenCount: 0,
    searchText: '7 birch way · ashburn, va · 2 units',
  },
  {
    id: 'pine',
    name: '19 Pine Ct',
    location: 'Reston, VA · 1 unit',
    status: 'calm',
    statusLabel: 'Calm',
    summaryRest: 'All clear · Rent collected · No open items',
    stats: [
      { label: 'Occupancy', value: '1/1' },
      { label: 'May collected', value: '100%', tone: 'good' },
      { label: 'Active items', value: '0' },
    ],
    issues: [{ tone: 'allclear', glyph: '✓', text: 'All clear' }],
    activeItems: 0,
    signals: {
      needsAttention: false,
      rentLate: false,
      maintenanceOpen: false,
      vacant: false,
      leaseEnding: false,
    },
    outstandingCents: 0,
    rentIssueCount: 0,
    maintenanceOpenCount: 0,
    searchText: '19 pine ct · reston, va · 1 unit',
  },
];

export const PORTFOLIO_SUMMARY: PortfolioSummary = {
  properties: 6,
  units: 18,
  occupancy: '94%',
  mrr: '$24,180',
  // Summed across PROPERTIES: rent (oak, maple) + maintenance (cedar, maple)
  // + leasing (maple) + vacant (elm).
  attention: { rent: 2, maintenance: 2, leasing: 1, vacant: 1, total: 6 },
};

export const TABS: PortfolioTab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tenants', label: 'Tenants', count: 18 },
  { id: 'vendors', label: 'Vendors', count: 5 },
  { id: 'rent', label: 'Rent' },
  { id: 'documents', label: 'Documents', count: 37 },
];

export const ASK_PROMPTS: string[] = [
  'Which property needs attention first?',
  "Summarize today's risks",
  'Escalate overdue vendors',
  'Show rent outstanding by unit',
  'Draft an owner update',
];

export function getPriorityItems(): PriorityItem[] {
  return PRIORITY_ITEMS;
}

export function getProperties(): PortfolioProperty[] {
  return PROPERTIES;
}

export function getPortfolioSummary(): PortfolioSummary {
  return PORTFOLIO_SUMMARY;
}

export function getTabs(): PortfolioTab[] {
  return TABS;
}

export function getAskPrompts(): string[] {
  return ASK_PROMPTS;
}
