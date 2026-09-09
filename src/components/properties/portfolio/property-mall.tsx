'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Hand,
  Home,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  createPortfolioProperty,
  deletePortfolioProperty,
  type CreatePortfolioPropertyInput,
} from '@/app/(dashboard)/properties/actions';
import type {
  PortfolioProperty,
  PropertySignalFlags,
  PropertyStatus,
  StatMetric,
} from '@/lib/properties/mock-portfolio';
import { AskOdesaPanel } from './ask-odesa-panel';

interface PropertyMallProps {
  properties: PortfolioProperty[];
  askPrompts: string[];
  readOnly?: boolean;
  /** Reuse the parent workspace's canonical Add and Ask Odesa controls. */
  embedded?: boolean;
}

type PropertyKind = 'single-family' | 'townhouse' | 'apartment' | 'condo';

type DisplayProperty = PortfolioProperty & {
  href: string;
  kind: PropertyKind;
};

const KIND_LABEL: Record<PropertyKind, string> = {
  'single-family': 'Single Family',
  townhouse: 'Townhouse',
  apartment: 'Apartment',
  condo: 'Condo',
};

const KIND_FILTERS: Array<'all' | PropertyKind> = [
  'all',
  'single-family',
  'townhouse',
  'apartment',
  'condo',
];

// Operational triage filters — keyed off the real `property.signals` flags.
// `all` clears the operational filter; every other chip narrows to properties
// whose corresponding signal is true. One operational chip is active at a time.
type OperationalFilter =
  | 'all'
  | 'needs-attention'
  | 'rent-late'
  | 'maintenance-open'
  | 'vacant'
  | 'lease-ending';

const OPERATIONAL_FILTERS: ReadonlyArray<{
  id: OperationalFilter;
  label: string;
  testid: string;
}> = [
  { id: 'all', label: 'All', testid: 'property-filter-all' },
  {
    id: 'needs-attention',
    label: 'Needs attention',
    testid: 'property-filter-needs-attention',
  },
  { id: 'rent-late', label: 'Rent late', testid: 'property-filter-rent-late' },
  {
    id: 'maintenance-open',
    label: 'Maintenance open',
    testid: 'property-filter-maintenance-open',
  },
  { id: 'vacant', label: 'Vacant', testid: 'property-filter-vacant' },
  {
    id: 'lease-ending',
    label: 'Lease ending',
    testid: 'property-filter-lease-ending',
  },
];

const OPERATIONAL_SIGNAL: Record<
  Exclude<OperationalFilter, 'all'>,
  keyof PropertySignalFlags
> = {
  'needs-attention': 'needsAttention',
  'rent-late': 'rentLate',
  'maintenance-open': 'maintenanceOpen',
  vacant: 'vacant',
  'lease-ending': 'leaseEnding',
};

const KIND_IMAGE_SRC: Record<PropertyKind, string> = {
  'single-family': '/property-icons/single-family-cutout.png',
  townhouse: '/property-icons/townhouse-cutout.png',
  apartment: '/property-icons/apartment-cutout.png',
  condo: '/property-icons/condo-cutout.png',
};

const DEFAULT_UNITS_BY_KIND: Record<PropertyKind, number> = {
  'single-family': 1,
  townhouse: 3,
  apartment: 8,
  condo: 12,
};

const STATUS_THEME: Record<
  PropertyStatus,
  {
    accent: string;
    soft: string;
    ink: string;
    label: string;
  }
> = {
  atrisk: {
    accent: 'var(--clay)',
    soft: 'var(--clay-bg)',
    ink: 'var(--clay-ink)',
    label: 'Needs Eyes',
  },
  watching: {
    accent: 'var(--amber)',
    soft: 'var(--amber-bg)',
    ink: 'var(--amber-ink)',
    label: 'Watching',
  },
  leasing: {
    accent: 'var(--gold)',
    soft: 'var(--neutral-bg)',
    ink: 'var(--neutral-ink)',
    label: 'Leasing',
  },
  calm: {
    accent: 'var(--green)',
    soft: 'var(--green-bg)',
    ink: 'var(--green-ink)',
    label: 'Calm',
  },
};

const workspaceStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '304px minmax(0, 1fr)',
  minHeight: 'calc(100vh - 52px)',
  background: 'var(--panel-clean)',
};

const railStyle: CSSProperties = {
  minWidth: 0,
  borderRight: '1px solid var(--hairline)',
  background: 'color-mix(in srgb, var(--canvas) 84%, var(--panel-clean))',
  display: 'flex',
  flexDirection: 'column',
};

const railHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '24px 20px 18px',
};

const railTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontSize: 28,
  fontWeight: 400,
  lineHeight: 1,
  letterSpacing: 0,
  color: 'var(--ink)',
};

const iconButtonStyle: CSSProperties = {
  width: 38,
  height: 38,
  display: 'inline-grid',
  placeItems: 'center',
  border: '1px solid var(--hairline)',
  borderRadius: 6,
  background: 'var(--panel)',
  color: 'var(--ink-2)',
  cursor: 'pointer',
};

const searchWrapStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '18px minmax(0, 1fr) 32px',
  alignItems: 'center',
  gap: 8,
  margin: '0 20px',
  padding: '0 10px',
  height: 40,
  border: '1px solid var(--hairline)',
  borderRadius: 7,
  background: 'var(--panel)',
};

const searchInputStyle: CSSProperties = {
  minWidth: 0,
  border: 0,
  outline: 0,
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 13,
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
};

const filterBarStyle: CSSProperties = {
  display: 'flex',
  gap: 14,
  overflowX: 'auto',
  padding: '18px 20px 12px',
  borderBottom: '1px solid var(--hairline)',
};

const filterButtonStyle: CSSProperties = {
  border: 0,
  padding: 0,
  background: 'transparent',
  color: 'var(--ink-3)',
  fontSize: 12,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const activeFilterStyle: CSSProperties = {
  color: 'var(--ink)',
  boxShadow: '0 1px 0 var(--ink)',
};

const railListStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
};

const addPropertyWrapStyle: CSSProperties = {
  padding: '14px 20px 20px',
  borderTop: '1px solid var(--hairline)',
};

const addPropertyButtonStyle: CSSProperties = {
  width: '100%',
  height: 44,
  border: '1px solid var(--hairline)',
  borderRadius: 7,
  background: 'var(--panel)',
  color: 'var(--ink)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 9,
  fontSize: 14,
  cursor: 'pointer',
};

const modalBackdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 80,
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  background: 'rgba(34, 29, 23, 0.18)',
  backdropFilter: 'blur(3px)',
};

const modalStyle: CSSProperties = {
  width: 'min(520px, 100%)',
  border: '1px solid var(--hairline)',
  borderRadius: 14,
  background: 'var(--panel)',
  boxShadow: '0 30px 80px rgba(35, 29, 22, 0.26)',
  color: 'var(--ink)',
  overflow: 'hidden',
};

const modalHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '24px 26px 6px',
};

const modalTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontSize: 26,
  fontWeight: 400,
  lineHeight: 1.1,
  letterSpacing: 0,
};

const modalFormStyle: CSSProperties = {
  display: 'grid',
  gap: 18,
  padding: '18px 26px 26px',
};

const fieldGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 14,
};

const addressGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.5fr 0.7fr 1fr',
  gap: 12,
};

const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: 7,
};

const labelTextStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--ink-3)',
};

const inputBoxStyle: CSSProperties = {
  width: '100%',
  height: 46,
  border: '1px solid var(--hairline)',
  borderRadius: 9,
  background: 'var(--panel-clean)',
  color: 'var(--ink)',
  padding: '0 12px',
  fontSize: 14,
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  outline: 0,
  transition: 'border-color 120ms ease, box-shadow 120ms ease',
};

const modalFooterStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 10,
  paddingTop: 2,
};

const modalActionGroupStyle: CSSProperties = {
  display: 'inline-flex',
  gap: 10,
};

const secondaryButtonStyle: CSSProperties = {
  height: 40,
  padding: '0 16px',
  border: '1px solid var(--hairline)',
  borderRadius: 9,
  background: 'var(--panel)',
  color: 'var(--ink-2)',
  fontSize: 14,
  cursor: 'pointer',
};

const primaryButtonStyle: CSSProperties = {
  height: 40,
  padding: '0 18px',
  border: '1px solid var(--ink)',
  borderRadius: 9,
  background: 'var(--ink)',
  color: 'var(--panel)',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const formErrorStyle: CSSProperties = {
  color: 'var(--clay-ink)',
  fontSize: 12.5,
  lineHeight: 1.4,
};

const mapPaneStyle: CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--panel-clean)',
};

const mapTopbarStyle: CSSProperties = {
  minHeight: 74,
  padding: '18px 22px 16px 28px',
  borderBottom: '1px solid var(--hairline)',
  display: 'grid',
  gridTemplateColumns: 'minmax(220px, 1fr) auto minmax(220px, 1fr)',
  alignItems: 'center',
  gap: 18,
};

const mapTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontSize: 30,
  fontWeight: 400,
  lineHeight: 1,
  letterSpacing: 0,
  color: 'var(--ink)',
};

const mapSubheadStyle: CSSProperties = {
  marginTop: 6,
  fontSize: 12.5,
  color: 'var(--ink-3)',
};

const attentionBreakdownStyle: CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: 'var(--ink-3)',
};

const attentionCountStyle: CSSProperties = {
  color: 'var(--ink)',
  fontWeight: 450,
};

const segmentedToolStyle: CSSProperties = {
  justifySelf: 'center',
  display: 'inline-flex',
  border: '1px solid var(--hairline)',
  borderRadius: 7,
  overflow: 'hidden',
  background: 'var(--panel)',
};

const segmentButtonStyle: CSSProperties = {
  width: 42,
  height: 36,
  border: 0,
  borderRight: '1px solid var(--hairline)',
  background: 'transparent',
  color: 'var(--ink-2)',
  display: 'inline-grid',
  placeItems: 'center',
  cursor: 'pointer',
};

const mapControlClusterStyle: CSSProperties = {
  justifySelf: 'end',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 14,
};

const zoomGroupStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 38,
  border: '1px solid var(--hairline)',
  borderRadius: 7,
  overflow: 'hidden',
  background: 'var(--panel)',
};

const zoomButtonStyle: CSSProperties = {
  width: 38,
  height: 38,
  border: 0,
  background: 'transparent',
  color: 'var(--ink-2)',
  display: 'inline-grid',
  placeItems: 'center',
  cursor: 'pointer',
};

const zoomValueStyle: CSSProperties = {
  minWidth: 58,
  textAlign: 'center',
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: 12,
  color: 'var(--ink-2)',
};

const mapCanvasStyle: CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 620,
  overflow: 'hidden',
  background: 'var(--panel-clean)',
};

const legendStyle: CSSProperties = {
  position: 'absolute',
  left: 34,
  bottom: 24,
  zIndex: 2,
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '7px 24px',
  padding: '12px 14px',
  border: '1px solid var(--hairline)',
  borderRadius: 6,
  background: 'color-mix(in srgb, var(--panel) 84%, transparent)',
  backdropFilter: 'blur(8px)',
  color: 'var(--ink-3)',
  fontSize: 11,
};

const mapFooterStyle: CSSProperties = {
  padding: '14px 22px 16px',
  borderTop: '1px solid var(--hairline)',
  background: 'var(--panel-clean)',
};

const markerStyle: CSSProperties = {
  ['--marker-accent' as string]: 'var(--green)',
  ['--marker-soft' as string]: 'var(--green-bg)',
  ['--marker-ink' as string]: 'var(--green-ink)',
  position: 'relative',
  width: 'min(100%, 156px)',
  minHeight: 0,
  transform: 'scale(var(--marker-counter-scale, 1))',
  transformOrigin: 'center',
  color: 'var(--ink)',
  textDecoration: 'none',
  display: 'grid',
  justifyItems: 'center',
  alignContent: 'start',
  gap: 5,
  zIndex: 3,
};

type MapTool = 'select' | 'pan' | 'delete';

const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 25;

const activeSegmentStyle: CSSProperties = {
  background: 'color-mix(in srgb, var(--ink) 9%, transparent)',
  color: 'var(--ink)',
};

interface MapViewSettings {
  showLegend: boolean;
}

function propertyHref(id: string): string {
  return `/properties/${id}`;
}

function parseUnits(location: string): number {
  const match = location.match(/(\d+)\s+units?/i);
  return match ? Number(match[1]) : 1;
}

function parsePlace(location: string): string {
  return location.split('·')[0]?.trim() || location;
}

function getMetric(property: PortfolioProperty, needle: string): StatMetric | null {
  return (
    property.stats.find((stat) =>
      stat.label.toLowerCase().includes(needle.toLowerCase()),
    ) ?? null
  );
}

function propertyKind(property: PortfolioProperty): PropertyKind {
  const units = parseUnits(property.location);
  const name = property.name.toLowerCase();

  if (name.includes('condo')) return 'condo';
  if (name.includes('apt') || name.includes('apartment') || name.includes('flat')) {
    return 'apartment';
  }
  if (name.includes('town') || name.includes('row')) return 'townhouse';
  if (name.includes('house') || name.includes('home')) return 'single-family';
  if (units >= 10) return 'condo';
  if (units >= 5) return 'apartment';
  if (units >= 2) return 'townhouse';

  return 'single-family';
}

function filterLabel(filter: 'all' | PropertyKind): string {
  if (filter === 'all') return 'All';
  return KIND_LABEL[filter];
}

function propertyMetrics(property: PortfolioProperty): {
  occupancy: string;
  collected: string;
} {
  const occupancy = getMetric(property, 'occupancy')?.value
    ?? `${parseUnits(property.location)}/${parseUnits(property.location)}`;
  const collected = getMetric(property, 'collected')?.value
    ?? property.statusLabel;
  return { occupancy, collected };
}

/** Whole-dollar currency, e.g. `$1,650` — mirrors the brief-queries formatter. */
function formatUsd(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString('en-US')}`;
}

/**
 * Labeled rail metrics. Always shows occupancy + collected; appends outstanding
 * dollars, rent-issue count, and open-maintenance count only when those real
 * signals are present, so no zero noise creeps into calm properties.
 */
function railMetricSegments(property: PortfolioProperty): string[] {
  const { occupancy, collected } = propertyMetrics(property);
  const segments = [`${occupancy} occupied`, `${collected} collected`];
  if (property.outstandingCents > 0) {
    segments.push(`${formatUsd(property.outstandingCents / 100)} outstanding`);
  }
  if (property.rentIssueCount > 0) {
    segments.push(
      `${property.rentIssueCount} rent issue${property.rentIssueCount === 1 ? '' : 's'}`,
    );
  }
  if (property.maintenanceOpenCount > 0) {
    segments.push(`${property.maintenanceOpenCount} maintenance`);
  }
  return segments;
}

/** Compact, labeled map-marker metrics, e.g. `5/5 occ · 88% coll`. */
function mapMarkerMetrics(property: PortfolioProperty): string {
  const { occupancy, collected } = propertyMetrics(property);
  return `${occupancy} occ · ${collected} coll`;
}

interface AttentionBreakdown {
  rent: number;
  maintenance: number;
  leasing: number;
  vacant: number;
  total: number;
}

/**
 * Portfolio attention roll-up derived from the per-property signals exposed by
 * the data layer. `rent`/`maintenance` use the exact per-property counts;
 * `leasing`/`vacant` count properties carrying that signal (the unit/lease-level
 * counts are not exposed on `PortfolioProperty`). Fully data-backed — every
 * number traces to a real `property.*` field, nothing fabricated.
 */
function buildAttentionBreakdown(
  properties: PortfolioProperty[],
): AttentionBreakdown {
  return properties.reduce<AttentionBreakdown>(
    (acc, property) => {
      const rent = property.rentIssueCount;
      const maintenance = property.maintenanceOpenCount;
      const leasing = property.signals.leaseEnding ? 1 : 0;
      const vacant = property.signals.vacant ? 1 : 0;
      return {
        rent: acc.rent + rent,
        maintenance: acc.maintenance + maintenance,
        leasing: acc.leasing + leasing,
        vacant: acc.vacant + vacant,
        total: acc.total + rent + maintenance + leasing + vacant,
      };
    },
    { rent: 0, maintenance: 0, leasing: 0, vacant: 0, total: 0 },
  );
}

function toDisplayProperties(properties: PortfolioProperty[]): DisplayProperty[] {
  return properties.map((property) => ({
    ...property,
    href: propertyHref(property.id),
    kind: propertyKind(property),
  }));
}

/**
 * A slightly landscape grid keeps the map legible without assigning properties
 * to fixed coordinates. Container breakpoints cap this further when the map
 * pane is narrower than the desktop canvas.
 */
function mapColumnCount(propertyCount: number): number {
  if (propertyCount <= 1) return 1;
  return Math.min(propertyCount, 6, Math.ceil(Math.sqrt(propertyCount * 1.35)));
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
}

export function PropertyMall({
  properties,
  askPrompts,
  readOnly = false,
  embedded = false,
}: PropertyMallProps) {
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [tool, setTool] = useState<MapTool>('select');
  const [zoom, setZoom] = useState(100);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | PropertyKind>('all');
  const [opFilter, setOpFilter] = useState<OperationalFilter>('all');
  const [settings, setSettings] = useState<MapViewSettings>({
    showLegend: true,
  });
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DisplayProperty | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const mapPaneRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const allProperties = useMemo(() => toDisplayProperties(properties), [properties]);

  const visibleProperties = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allProperties.filter((property) => {
      if (kindFilter !== 'all' && property.kind !== kindFilter) return false;
      if (opFilter !== 'all' && !property.signals[OPERATIONAL_SIGNAL[opFilter]]) {
        return false;
      }
      if (
        needle &&
        !(property.searchText || `${property.name} ${property.location}`.toLowerCase()).includes(needle)
      ) {
        return false;
      }
      return true;
    });
  }, [allProperties, query, kindFilter, opFilter]);

  const activeCount = visibleProperties.reduce(
    (sum, property) => sum + property.activeItems,
    0,
  );
  const mapColumns = mapColumnCount(visibleProperties.length);

  // Portfolio-wide (unfiltered) attention roll-up for the map header line.
  const attention = useMemo(
    () => buildAttentionBreakdown(properties),
    [properties],
  );

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  function stepZoom(direction: 1 | -1) {
    setZoom((current) =>
      Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + direction * ZOOM_STEP)),
    );
  }

  function resetView() {
    setZoom(100);
    setOffset({ x: 0, y: 0 });
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (tool !== 'pan') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
    };
    setIsDragging(true);
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.baseX + (event.clientX - drag.startX),
      y: drag.baseY + (event.clientY - drag.startY),
    });
  }

  function handleCanvasPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
  }

  function handleMarkerClick(
    event: ReactMouseEvent<HTMLAnchorElement>,
    property: DisplayProperty,
  ) {
    if (readOnly || tool === 'select') return;
    event.preventDefault();
    if (tool === 'delete') setDeleteTarget(property);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void mapPaneRef.current?.requestFullscreen?.();
  }

  const canvasCursor =
    tool === 'pan'
      ? isDragging
        ? 'grabbing'
        : 'grab'
      : tool === 'delete'
        ? 'crosshair'
        : undefined;

  return (
    <section aria-label="Properties workspace" style={workspaceStyle}>
      {/* Directory rail. A plain <div> (not <aside>) so it doesn't create a
          `complementary` landmark nested inside the workspace <section>/page
          <main> — that trips axe landmark-complementary-is-top-level. The
          aria-label is retained for the responsive CSS selectors below. */}
      <div aria-label="Property directory" style={railStyle}>
        <div style={railHeaderStyle}>
          <h2 style={railTitleStyle}>Properties</h2>
          {!readOnly && !embedded ? (
            <button
              type="button"
              aria-label="Add property"
              title="Add property"
              style={iconButtonStyle}
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={17} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>

        <div style={searchWrapStyle}>
          <Search size={15} strokeWidth={1.7} aria-hidden="true" />
          <label className="sr-only" htmlFor="property-search">
            Search property, unit, tenant, address
          </label>
          <input
            id="property-search"
            type="search"
            placeholder="Search property, unit, tenant…"
            style={searchInputStyle}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <button
            type="button"
            aria-label="Clear property filters"
            title="Clear property filters"
            className="property-filter-button"
            onClick={() => {
              setQuery('');
              setKindFilter('all');
              setOpFilter('all');
            }}
          >
            <SlidersHorizontal size={15} strokeWidth={1.7} />
          </button>
        </div>

        <div
          aria-label="Operational filters"
          style={{ ...filterBarStyle, borderBottom: 0, paddingBottom: 4 }}
        >
          {OPERATIONAL_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              data-testid={filter.testid}
              aria-pressed={filter.id === opFilter}
              style={{
                ...filterButtonStyle,
                ...(filter.id === opFilter ? activeFilterStyle : null),
              }}
              onClick={() => setOpFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div aria-label="Property type filters" style={filterBarStyle}>
          {KIND_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              aria-pressed={filter === kindFilter}
              style={{
                ...filterButtonStyle,
                ...(filter === kindFilter ? activeFilterStyle : null),
              }}
              onClick={() => setKindFilter(filter)}
            >
              {filterLabel(filter)}
            </button>
          ))}
        </div>

        <div style={railListStyle}>
          {visibleProperties.map((property) => (
            <PropertyRailRow
              key={property.id}
              property={property}
            />
          ))}
          {visibleProperties.length === 0 ? (
            <p style={{ margin: 0, padding: '18px 20px', fontSize: 12.5, color: 'var(--ink-3)' }}>
              No properties match the current search or filter.
            </p>
          ) : null}
        </div>

        {!readOnly && !embedded ? <div style={addPropertyWrapStyle}>
          <button
            type="button"
            style={addPropertyButtonStyle}
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
            Add Property
          </button>
        </div> : null}
      </div>

      <div ref={mapPaneRef} style={mapPaneStyle}>
        <div style={mapTopbarStyle}>
          <div>
            <h2 id="property-map-heading" style={mapTitleStyle}>
              Property map
            </h2>
            <div style={mapSubheadStyle} data-testid="property-map-subhead">
              {tool === 'delete'
                ? 'Delete mode — click a property to remove it'
                : `${properties.length} properties / ${visibleProperties.length} displayed / ${activeCount} active items`}
            </div>
            {attention.total > 0 ? (
              <div
                style={attentionBreakdownStyle}
                data-testid="portfolio-attention-breakdown"
              >
                <span className="num" style={attentionCountStyle}>
                  {attention.total}
                </span>{' '}
                active item{attention.total === 1 ? '' : 's'}:{' '}
                <span className="num" style={attentionCountStyle}>
                  {attention.rent}
                </span>{' '}
                rent ·{' '}
                <span className="num" style={attentionCountStyle}>
                  {attention.maintenance}
                </span>{' '}
                maintenance ·{' '}
                <span className="num" style={attentionCountStyle}>
                  {attention.leasing}
                </span>{' '}
                leasing ·{' '}
                <span className="num" style={attentionCountStyle}>
                  {attention.vacant}
                </span>{' '}
                vacant
              </div>
            ) : null}
          </div>

          <div aria-label="Map tools" style={segmentedToolStyle}>
            <button
              type="button"
              aria-label="Select property"
              title="Select property"
              aria-pressed={tool === 'select'}
              style={{
                ...segmentButtonStyle,
                ...(tool === 'select' ? activeSegmentStyle : null),
              }}
              onClick={() => setTool('select')}
            >
              <MousePointer2 size={16} strokeWidth={1.7} />
            </button>
            <button
              type="button"
              aria-label="Pan map"
              title="Pan map"
              aria-pressed={tool === 'pan'}
              style={{
                ...segmentButtonStyle,
                ...(tool === 'pan' ? activeSegmentStyle : null),
              }}
              onClick={() => setTool('pan')}
            >
              <Hand size={16} strokeWidth={1.7} />
            </button>
            {!readOnly ? (
              <button
                type="button"
                aria-label="Delete property"
                title="Delete property"
                aria-pressed={tool === 'delete'}
                style={{
                  ...segmentButtonStyle,
                  borderRight: 0,
                  ...(tool === 'delete' ? activeSegmentStyle : null),
                }}
                onClick={() =>
                  setTool((current) =>
                    current === 'delete' ? 'select' : 'delete',
                  )
                }
              >
                <Trash2 size={16} strokeWidth={1.7} />
              </button>
            ) : null}
          </div>

          <div style={mapControlClusterStyle}>
            <div aria-label="Map zoom" style={zoomGroupStyle}>
              <button
                type="button"
                aria-label="Zoom out"
                title="Zoom out"
                style={zoomButtonStyle}
                disabled={zoom <= ZOOM_MIN}
                onClick={() => stepZoom(-1)}
              >
                <Minus size={15} strokeWidth={1.8} />
              </button>
              <span className="num" style={zoomValueStyle} data-testid="property-map-zoom">
                {zoom}%
              </span>
              <button
                type="button"
                aria-label="Zoom in"
                title="Zoom in"
                style={zoomButtonStyle}
                disabled={zoom >= ZOOM_MAX}
                onClick={() => stepZoom(1)}
              >
                <Plus size={15} strokeWidth={1.8} />
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                aria-label="Map settings"
                title="Map settings"
                aria-expanded={isSettingsOpen}
                style={{
                  ...iconButtonStyle,
                  ...(isSettingsOpen ? activeSegmentStyle : null),
                }}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <Settings size={16} strokeWidth={1.7} />
              </button>
              {isSettingsOpen ? (
                <MapSettingsPopover
                  settings={settings}
                  onChange={setSettings}
                  onResetView={resetView}
                  onClose={() => setSettingsOpen(false)}
                />
              ) : null}
            </div>
          </div>
        </div>

        <div
          aria-labelledby="property-map-heading"
          className="property-map-canvas"
          style={{ ...mapCanvasStyle, cursor: canvasCursor, touchAction: tool === 'pan' ? 'none' : undefined }}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerEnd}
          onPointerCancel={handleCanvasPointerEnd}
        >
          <div
            className="property-map-stage"
            data-density={visibleProperties.length > 12 ? 'dense' : 'regular'}
            data-testid="property-map-stage"
            style={
              {
                '--map-columns': mapColumns,
                '--map-columns-narrow': Math.min(mapColumns, 4),
                '--map-columns-mobile': Math.min(mapColumns, 3),
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom / 100})`,
              } as CSSProperties
            }
          >
            {visibleProperties.map((property) => (
              <PropertyMapMarker
                key={property.id}
                property={property}
                tool={tool}
                zoom={zoom}
                onMarkerClick={handleMarkerClick}
              />
            ))}
          </div>
          {settings.showLegend ? <MapLegend /> : null}

          <div className="property-map-floating-controls">
            <button
              type="button"
              aria-label={isFullscreen ? 'Exit fullscreen map' : 'Fullscreen map'}
              title={isFullscreen ? 'Exit fullscreen map' : 'Fullscreen map'}
              style={iconButtonStyle}
              onClick={toggleFullscreen}
            >
              <Maximize2 size={16} strokeWidth={1.7} />
            </button>
          </div>
        </div>

        {!embedded ? (
          <div style={mapFooterStyle}>
            <AskOdesaPanel
              prompts={askPrompts}
              variant="map"
              placeholder="Ask Odesa anything about your properties..."
            />
          </div>
        ) : null}
      </div>

      <PropertyMallStyles />
      {!readOnly && !embedded && isCreateOpen ? (
        <AddPropertyModal onClose={() => setCreateOpen(false)} />
      ) : null}
      {!readOnly && deleteTarget ? (
        <DeletePropertyModal
          property={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => setTool('select')}
        />
      ) : null}
    </section>
  );
}

function PropertyRailRow({
  property,
}: {
  property: DisplayProperty;
}) {
  const theme = STATUS_THEME[property.status];
  const metricSegments = railMetricSegments(property);

  return (
    <Link
      href={property.href}
      aria-label={`${property.name}, ${KIND_LABEL[property.kind]} in ${parsePlace(
        property.location,
      )}`}
      className="property-rail-row"
      style={
        {
          '--marker-accent': theme.accent,
          '--marker-soft': theme.soft,
          '--marker-ink': theme.ink,
        } as CSSProperties
      }
    >
      <span className="property-rail-art" aria-hidden="true">
        <BuildingArtwork kind={property.kind} size="rail" />
      </span>
      <span className="property-rail-copy">
        <span className="property-name-line">
          <span className="property-status-dot" aria-hidden="true" />
          <span>{property.name}</span>
        </span>
        <span className="property-kind-label">{KIND_LABEL[property.kind]}</span>
        <span className="property-metric-line num">
          {metricSegments.join(' · ')}
        </span>
      </span>
      <span className="property-grip" aria-hidden="true">
        ⋮
      </span>
    </Link>
  );
}

function PropertyMapMarker({
  property,
  tool,
  zoom,
  onMarkerClick,
}: {
  property: DisplayProperty;
  tool: MapTool;
  zoom: number;
  onMarkerClick: (
    event: ReactMouseEvent<HTMLAnchorElement>,
    property: DisplayProperty,
  ) => void;
}) {
  const theme = STATUS_THEME[property.status];
  const markerMetrics = mapMarkerMetrics(property);

  return (
    <Link
      href={property.href}
      aria-label={`Enter ${property.name}, ${KIND_LABEL[property.kind]} in ${parsePlace(
        property.location,
      )}`}
      className="property-map-marker"
      onClick={(event) => onMarkerClick(event, property)}
      style={
        {
          ...markerStyle,
          // Zooming in spreads the map without turning its markers into giant
          // illustrations. Zooming out still scales them down with the canvas.
          '--marker-counter-scale': Math.min(1, 100 / zoom),
          // While panning, marker links must not swallow the drag gesture.
          pointerEvents: tool === 'pan' ? 'none' : undefined,
          '--marker-accent': theme.accent,
          '--marker-soft': theme.soft,
          '--marker-ink': theme.ink,
        } as CSSProperties
      }
    >
      <BuildingArtwork kind={property.kind} size="map" />
      <span className="map-marker-label">
        <span className="property-status-dot" aria-hidden="true" />
        <span className="map-marker-name">{property.name}</span>
      </span>
      <span className="map-marker-kind">{KIND_LABEL[property.kind]}</span>
      <span className="map-marker-metrics num">{markerMetrics}</span>
    </Link>
  );
}

function MapLegend() {
  return (
    <div aria-hidden="true" style={legendStyle}>
      <span className="legend-item">
        <Home size={14} strokeWidth={1.6} />
        Single Family
      </span>
      <span className="legend-item">
        <span className="legend-dot legend-dot-calm" />
        Calm
      </span>
      <span className="legend-item">
        <Home size={14} strokeWidth={1.6} />
        Townhouse
      </span>
      <span className="legend-item">
        <span className="legend-dot legend-dot-watching" />
        Watching
      </span>
      <span className="legend-item">
        <Building2 size={14} strokeWidth={1.6} />
        Apartment
      </span>
      <span className="legend-item">
        <span className="legend-dot legend-dot-leasing" />
        Leasing
      </span>
      <span className="legend-item">
        <Building2 size={14} strokeWidth={1.6} />
        Condo
      </span>
      <span className="legend-item">
        <span className="legend-dot legend-dot-risk" />
        Needs Eyes
      </span>
    </div>
  );
}

function BuildingArtwork({
  kind,
  size,
}: {
  kind: PropertyKind;
  size: 'rail' | 'map';
}) {
  return (
    <span className={`building-art building-art-${kind} building-art-${size}`}>
      <Image
        src={KIND_IMAGE_SRC[kind]}
        alt=""
        width={240}
        height={170}
        className="building-art-image"
        sizes={size === 'map' ? '220px' : '120px'}
        priority={size === 'map'}
      />
    </span>
  );
}

function AddPropertyModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [propertyType, setPropertyType] = useState<PropertyKind>('single-family');
  const [unitCount, setUnitCount] = useState(DEFAULT_UNITS_BY_KIND['single-family']);

  function handleTypeChange(nextType: PropertyKind) {
    setPropertyType(nextType);
    setUnitCount(DEFAULT_UNITS_BY_KIND[nextType]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    const formData = new FormData(event.currentTarget);
    const input: CreatePortfolioPropertyInput = {
      name: String(formData.get('name') ?? ''),
      propertyType,
      addressStreet: String(formData.get('addressStreet') ?? ''),
      addressCity: String(formData.get('addressCity') ?? ''),
      addressState: String(formData.get('addressState') ?? ''),
      addressZip: String(formData.get('addressZip') ?? ''),
      unitCount,
    };

    startTransition(async () => {
      const result = await createPortfolioProperty(input);
      if (!result.success) {
        setError(result.error);
        return;
      }

      router.refresh();
      onClose();
    });
  }

  return (
    <div
      role="presentation"
      style={modalBackdropStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-property-title"
        style={modalStyle}
      >
        <div style={modalHeaderStyle}>
          <h3 id="add-property-title" style={modalTitleStyle}>
            Add property
          </h3>
          <button
            type="button"
            aria-label="Close add property"
            style={iconButtonStyle}
            onClick={onClose}
            disabled={pending}
          >
            <Minus size={16} strokeWidth={1.8} />
          </button>
        </div>

        <form data-testid="add-property-form" style={modalFormStyle} onSubmit={handleSubmit}>
          <label style={fieldStyle}>
            <span style={labelTextStyle}>Name</span>
            <input
              name="name"
              required
              maxLength={200}
              style={inputBoxStyle}
              placeholder="Maple View House"
              autoFocus
            />
          </label>

          <div style={fieldGridStyle}>
            <label style={fieldStyle}>
              <span style={labelTextStyle}>Type</span>
              <select
                name="propertyType"
                value={propertyType}
                style={inputBoxStyle}
                onChange={(event) =>
                  handleTypeChange(event.currentTarget.value as PropertyKind)
                }
              >
                {KIND_FILTERS.filter((kind) => kind !== 'all').map((kind) => (
                  <option key={kind} value={kind}>
                    {filterLabel(kind)}
                  </option>
                ))}
              </select>
            </label>

            <label style={fieldStyle}>
              <span style={labelTextStyle}>Units</span>
              <input
                name="unitCount"
                type="number"
                min={1}
                max={200}
                required
                value={unitCount}
                style={inputBoxStyle}
                onChange={(event) => setUnitCount(Number(event.currentTarget.value))}
              />
            </label>
          </div>

          <label style={fieldStyle}>
            <span style={labelTextStyle}>Street</span>
            <input
              name="addressStreet"
              required
              maxLength={200}
              style={inputBoxStyle}
              placeholder="120 Maple View Dr"
            />
          </label>

          <div style={addressGridStyle}>
            <label style={fieldStyle}>
              <span style={labelTextStyle}>City</span>
              <input
                name="addressCity"
                required
                maxLength={100}
                style={inputBoxStyle}
                placeholder="Aldie"
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelTextStyle}>State</span>
              <input
                name="addressState"
                required
                maxLength={2}
                autoCapitalize="characters"
                style={{ ...inputBoxStyle, textTransform: 'uppercase' }}
                placeholder="VA"
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelTextStyle}>ZIP</span>
              <input
                name="addressZip"
                required
                maxLength={10}
                inputMode="numeric"
                style={inputBoxStyle}
                placeholder="20105"
              />
            </label>
          </div>

          {error ? (
            <div role="status" aria-live="polite" style={formErrorStyle}>
              {error}
            </div>
          ) : (
            <div role="status" aria-live="polite" className="sr-only" />
          )}

          <div style={modalFooterStyle}>
            <div style={modalActionGroupStyle}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={onClose}
                disabled={pending}
              >
                Cancel
              </button>
              <button type="submit" style={primaryButtonStyle} disabled={pending}>
                {pending ? 'Creating…' : 'Create property'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

const settingsPopoverStyle: CSSProperties = {
  position: 'absolute',
  top: 46,
  right: 0,
  zIndex: 60,
  width: 224,
  display: 'grid',
  gap: 12,
  padding: '14px 16px',
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  background: 'var(--panel)',
  boxShadow: '0 16px 44px rgba(35, 29, 22, 0.16)',
};

const settingsRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  fontSize: 12.5,
  color: 'var(--ink-2)',
  cursor: 'pointer',
};

function MapSettingsPopover({
  settings,
  onChange,
  onResetView,
  onClose,
}: {
  settings: MapViewSettings;
  onChange: (next: MapViewSettings) => void;
  onResetView: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div
        role="presentation"
        style={{ position: 'fixed', inset: 0, zIndex: 50 }}
        onMouseDown={onClose}
      />
      <div
        role="dialog"
        aria-label="Map settings"
        data-testid="property-map-settings"
        style={settingsPopoverStyle}
      >
        <label style={settingsRowStyle}>
          <input
            type="checkbox"
            checked={settings.showLegend}
            onChange={(event) =>
              onChange({ ...settings, showLegend: event.currentTarget.checked })
            }
          />
          Show legend
        </label>
        <button
          type="button"
          style={{ ...secondaryButtonStyle, height: 34 }}
          onClick={() => {
            onResetView();
            onClose();
          }}
        >
          Reset view
        </button>
      </div>
    </>
  );
}

function DeletePropertyModal({
  property,
  onClose,
  onDeleted,
}: {
  property: DisplayProperty;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');

  function handleConfirm() {
    setError('');
    startTransition(async () => {
      const result = await deletePortfolioProperty({ propertyId: property.id });
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
      onDeleted();
      onClose();
    });
  }

  return (
    <div
      role="presentation"
      style={modalBackdropStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-property-title"
        data-testid="delete-property-modal"
        style={modalStyle}
      >
        <div style={modalHeaderStyle}>
          <h3 id="delete-property-title" style={modalTitleStyle}>
            Delete property
          </h3>
        </div>

        <div style={{ display: 'grid', gap: 14, padding: 22 }}>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-2)' }}>
            {`This permanently deletes “${property.name}” — including its units, leases, tenant history, and work orders. This cannot be undone.`}
          </p>

          <div style={modalFooterStyle}>
            <div role="status" aria-live="polite" style={formErrorStyle}>
              {error}
            </div>
            <div style={modalActionGroupStyle}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={onClose}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="delete-property-confirm"
                style={{
                  ...primaryButtonStyle,
                  border: '1px solid var(--clay)',
                  background: 'var(--clay)',
                }}
                onClick={handleConfirm}
                disabled={pending}
              >
                {pending ? 'Deleting...' : 'Delete property'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PropertyMallStyles() {
  return (
    <style>{`
      .property-filter-button {
        width: 28px;
        height: 28px;
        border: 0;
        background: transparent;
        color: var(--ink-3);
        display: inline-grid;
        place-items: center;
        cursor: pointer;
      }

      .property-rail-row {
        display: grid;
        grid-template-columns: 118px minmax(0, 1fr) 20px;
        gap: 12px;
        align-items: center;
        min-height: 112px;
        padding: 16px 14px 16px 20px;
        color: var(--ink);
        text-decoration: none;
        border-bottom: 1px solid var(--hairline);
      }

      .property-rail-row:hover,
      .property-rail-row:focus-visible {
        background: color-mix(in srgb, var(--panel) 72%, transparent);
      }

      .property-rail-art {
        display: grid;
        place-items: center;
        min-width: 0;
      }

      .property-rail-copy {
        display: grid;
        gap: 5px;
        min-width: 0;
      }

      .property-name-line,
      .map-marker-label,
      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .property-name-line {
        font-size: 14px;
        font-weight: 520;
      }

      .property-name-line span:last-child,
      .map-marker-name {
        /* With a small portfolio we favor showing full names: wrap to two
           lines, then fall back to a graceful ellipsis only for genuinely
           long names. */
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: normal;
        overflow-wrap: anywhere;
      }

      .property-status-dot,
      .legend-dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        flex: 0 0 auto;
        background: var(--marker-accent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--marker-accent) 16%, transparent);
      }

      .property-kind-label,
      .map-marker-kind {
        font-size: 12px;
        color: var(--ink-3);
      }

      .property-metric-line,
      .map-marker-metrics {
        font-size: 12px;
        color: var(--ink-2);
      }

      .property-grip {
        color: var(--ink-4);
        font-size: 22px;
        line-height: 1;
        transform: rotate(90deg);
      }

      .property-map-stage {
        position: absolute;
        inset: 0;
        box-sizing: border-box;
        display: grid;
        grid-template-columns: repeat(var(--map-columns), minmax(0, 1fr));
        grid-auto-rows: minmax(0, 1fr);
        place-items: center;
        gap: 8px 12px;
        padding: 20px 24px 104px;
        transform-origin: 50% 50%;
      }

      .property-map-stage::before {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        background-image: url('/property-icons/property-map-background.png');
        background-repeat: no-repeat;
        background-size: 100% 100%;
        background-position: center;
        opacity: 0.96;
      }

      .property-map-marker {
        border-radius: 12px;
        transition: transform 160ms ease, filter 160ms ease;
      }

      [aria-label="Map zoom"] button:disabled {
        opacity: 0.35;
        cursor: default;
      }

      .property-map-marker:hover,
      .property-map-marker:focus-visible {
        transform: translateY(-4px) scale(var(--marker-counter-scale, 1));
        filter: drop-shadow(0 18px 22px rgba(35, 29, 22, 0.12));
      }

      .property-map-marker:focus-visible,
      .property-rail-row:focus-visible,
      button:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 3px;
      }

      .map-marker-label {
        justify-content: center;
        width: 100%;
        max-width: 156px;
        font-size: 13px;
        font-weight: 520;
        line-height: 1.2;
        text-align: center;
      }

      .map-marker-kind,
      .map-marker-metrics {
        text-align: center;
      }

      .property-map-floating-controls {
        position: absolute;
        right: 30px;
        bottom: 26px;
        z-index: 4;
        display: inline-flex;
        gap: 10px;
      }

      .legend-item {
        white-space: nowrap;
      }

      .legend-dot-calm { background: var(--green); }
      .legend-dot-watching { background: var(--amber); }
      .legend-dot-leasing { background: var(--gold); }
      .legend-dot-risk { background: var(--clay); }

      .building-art {
        display: block;
        position: relative;
      }

      .building-art-image {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      .building-art-map {
        width: 118px;
        height: 84px;
      }

      .property-map-stage[data-density="dense"] .building-art-map {
        width: 104px;
        height: 74px;
      }

      .property-map-stage[data-density="dense"] .property-map-marker {
        width: min(100%, 146px) !important;
        gap: 3px !important;
      }

      .property-map-canvas {
        container-type: inline-size;
      }

      @container (max-width: 900px) {
        .property-map-stage {
          grid-template-columns: repeat(var(--map-columns-narrow), minmax(0, 1fr));
          gap: 4px 8px;
          padding-inline: 16px;
        }

        .building-art-map {
          width: 88px;
          height: 62px;
        }

        .map-marker-label {
          font-size: 12px;
        }

        .map-marker-kind,
        .map-marker-metrics {
          font-size: 10.5px;
        }
      }

      @container (max-width: 600px) {
        .property-map-stage {
          grid-template-columns: repeat(var(--map-columns-mobile), minmax(0, 1fr));
          gap: 2px 5px;
          padding: 12px 10px 88px;
        }

        .property-map-marker {
          width: min(100%, 112px) !important;
          gap: 2px !important;
        }

        .building-art-map,
        .property-map-stage[data-density="dense"] .building-art-map {
          width: 64px;
          height: 44px;
        }

        .map-marker-kind {
          display: none;
        }

        .map-marker-metrics {
          font-size: 9.5px;
          white-space: nowrap;
        }
      }

      .building-art-rail {
        width: 112px;
        height: 82px;
      }

      @media (max-width: 1100px) {
        [aria-label="Properties workspace"] {
          grid-template-columns: 260px minmax(0, 1fr) !important;
        }

        .property-rail-row {
          grid-template-columns: 92px minmax(0, 1fr) 18px;
        }

        .building-art-rail {
          width: 82px;
          height: 64px;
        }
      }

      @media (max-width: 860px) {
        [aria-label="Properties workspace"] {
          display: flex !important;
          flex-direction: column;
          min-height: 0 !important;
        }

        [aria-label="Property directory"] {
          border-right: 0 !important;
          border-bottom: 1px solid var(--hairline);
        }

        .property-map-canvas {
          min-height: 580px !important;
        }

        [aria-label="Property directory"] > div:nth-child(4) {
          max-height: 330px;
        }

        [aria-label="Property map"] {
          overflow-x: auto;
        }
      }

      @media (max-width: 720px) {
        [aria-label="Map tools"],
        [aria-label="Map zoom"] {
          display: none !important;
        }

        [aria-label="Properties workspace"] > div > div:first-child {
          grid-template-columns: 1fr auto !important;
        }

        .property-map-floating-controls {
          right: 18px;
          bottom: 18px;
        }
      }
    `}</style>
  );
}
