/**
 * Property interior — `/properties/[id]`.
 *
 * This route keeps the existing real-data `getPropertyBrief(id)` contract and
 * re-composes the detail page into the "enter the property" view from the
 * portfolio map direction: property artwork/header, a spatial interior map,
 * unit-aware navigation, Odesa brief, owner update, and operational activity.
 *
 * The interior map is a fixed-coordinate canvas (560×600) so the room cards and
 * the SVG connector overlay share one coordinate system and can never desync;
 * a container query collapses it to a single column on narrow panels.
 */

import type { CSSProperties, ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ClipboardList,
  DoorOpen,
  ExternalLink,
  FileText,
  Home,
  ReceiptText,
  Wrench,
} from 'lucide-react';

import { getPropertyBrief } from '@/lib/properties/brief-queries';
import {
  getProperty,
  getPropertyProposalSummary,
  getUnitDetail,
  listUnitsForProperty,
  listUnitsTableRowsForProperty,
  type UnitGridCard,
  type UnitTableRow,
} from '@/lib/properties/queries';
import { unitHref } from '@/lib/properties/hrefs';
import { RecordPaymentModal } from '@/components/rent/record-payment-modal';
import type {
  AttentionItem,
  MetricCell,
  PillVariant,
  PropertyDetailMock,
  Tone,
  UnitRow,
} from '@/lib/properties/mock-detail';
import { AskOdesaBar } from '@/components/properties/detail/ask-odesa-bar';
import { DetailBadge } from '@/components/properties/detail/detail-badge';
import { DetailGlobalBar } from '@/components/properties/detail/detail-global-bar';
import { OperationsSection } from './_components/operations-section';
import { AddTenantDialog, TenantsEmptyState } from './_components/add-tenant-dialog';
import { EditPropertyDialog } from './_components/edit-property-dialog';
import { UnitDrawerMount } from './_components/unit-drawer-mount';
import { RoomDrawerMount } from './_rooms/room-drawer-mount';
import { parseRoomParam, roomHref, type RoomKey } from './_rooms/rooms-meta';
import { UnitsRoom } from './_rooms/units-room';
import { AppliancesRoom } from './_rooms/appliances-room';
import { VendorsRoom } from './_rooms/vendors-room';
import { MaintenanceRoom } from './_rooms/maintenance-room';
import { PaymentsRoom } from './_rooms/payments-room';
import { RulebookRoom } from './_rooms/rulebook-room';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface PropertyDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    room?: string | string[];
    unit?: string | string[];
  }>;
}

type PropertyKind = 'single-family' | 'townhouse' | 'apartment' | 'condo';

const KIND_IMAGE_SRC: Record<PropertyKind, string> = {
  'single-family': '/property-icons/single-family-cutout.png',
  townhouse: '/property-icons/townhouse-cutout.png',
  apartment: '/property-icons/apartment-cutout.png',
  condo: '/property-icons/condo-cutout.png',
};

const TONE_ACCENT: Record<Tone, string> = {
  clay: 'var(--clay)',
  amber: 'var(--amber)',
  green: 'var(--green)',
  gold: 'var(--gold)',
  neutral: 'var(--ink-4)',
  ink: 'var(--ink)',
};

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--panel-clean)',
  color: 'var(--ink)',
};

const heroStyle: CSSProperties = {
  minHeight: 190,
  display: 'grid',
  gridTemplateColumns: '210px minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 28,
  padding: '28px 30px 30px',
  borderBottom: '1px solid var(--hairline)',
  background: 'linear-gradient(180deg, #fffefa 0%, var(--panel-clean) 100%)',
};

const artworkStyle: CSSProperties = {
  position: 'relative',
  height: 128,
  display: 'grid',
  placeItems: 'end center',
};

const headerCopyStyle: CSSProperties = {
  minWidth: 0,
};

const eyebrowStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono-operator)',
  color: 'var(--ink-3)',
  fontSize: 10.5,
  fontWeight: 500,
  letterSpacing: '0.23em',
  textTransform: 'uppercase',
};

const titleStyle: CSSProperties = {
  margin: '12px 0 0',
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 'clamp(36px, 5vw, 56px)',
  lineHeight: 0.95,
  letterSpacing: 0,
  color: 'var(--ink)',
};

const heroMetaStyle: CSSProperties = {
  marginTop: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  fontFamily: 'var(--font-mono-operator)',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-2)',
};

const actionGroupStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 10,
  flexWrap: 'wrap',
};

const contentStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(560px, 1fr) 330px',
  gap: 18,
  padding: '22px 30px 28px',
};

const primaryGridStyle: CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: 16,
};

const workbenchStyle: CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(420px, 1fr) minmax(255px, 290px)',
  gap: 16,
};

const panelStyle: CSSProperties = {
  minWidth: 0,
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--panel-lift) 76%, transparent)',
};

const panelHeaderStyle: CSSProperties = {
  padding: '17px 18px',
  borderBottom: '1px solid var(--hairline-faint)',
};

const panelTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono-operator)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'var(--ink-2)',
};

const serifPanelTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontSize: 29,
  lineHeight: 1,
  fontWeight: 400,
  letterSpacing: 0,
  color: 'var(--ink)',
};

const interiorMapStyle: CSSProperties = {
  ...panelStyle,
  padding: 17,
};

const mapColumnStyle: CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: 16,
  alignContent: 'start',
};

const sideStackStyle: CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: 16,
};

const rightRailStyle: CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: 16,
  alignContent: 'start',
};

const metricsGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
};

const metricCellStyle: CSSProperties = {
  minHeight: 110,
  padding: '21px 19px',
  borderRight: '1px solid var(--hairline-faint)',
  borderBottom: '1px solid var(--hairline-faint)',
};

const metricLabelStyle: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono-operator)',
  color: 'var(--ink-3)',
  fontSize: 10.5,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
};

const metricValueStyle: CSSProperties = {
  display: 'block',
  marginTop: 16,
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  color: 'var(--ink)',
  fontSize: 34,
  lineHeight: 1,
  letterSpacing: 0,
};

const railBodyStyle: CSSProperties = {
  padding: 18,
};

const paragraphStyle: CSSProperties = {
  margin: '15px 0 0',
  color: 'var(--ink-2)',
  fontSize: 14,
  lineHeight: 1.55,
};

const attentionListStyle: CSSProperties = {
  display: 'grid',
  gap: 10,
  marginTop: 18,
};

const updateButtonStyle: CSSProperties = {
  minHeight: 38,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '0 13px',
  border: '1px solid var(--hairline)',
  borderRadius: 7,
  background: 'var(--panel-clean)',
  color: 'var(--ink-2)',
  fontSize: 12.5,
  fontFamily: 'var(--font-sans-operator)',
  textDecoration: 'none',
  cursor: 'pointer',
};

const activityGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 12,
};

export default async function PropertyDetailPage({
  params,
  searchParams,
}: PropertyDetailPageProps) {
  const { id } = await params;
  const { room: rawRoom, unit: rawUnit } = await searchParams;
  const room = parseRoomParam(rawRoom);
  const unitParam = Array.isArray(rawUnit) ? rawUnit[0] : rawUnit;
  const supabase = await createServerClient();
  const { data: currentRole } = await supabase.rpc('current_user_role');
  const isVa = currentRole === 'va';
  const isOwner = currentRole === 'owner';

  const [property, propertyDetail, summary, unitCards, unitDetail, unitTableRows] =
    await Promise.all([
      getPropertyBrief(id),
      getProperty(id),
      getPropertyProposalSummary(id),
      listUnitsForProperty(id),
      unitParam ? getUnitDetail(unitParam) : Promise.resolve(null),
      // Pass 5 — operator row enrichment (balance, days late, action ids).
      // Keyed by unit id, which equals the brief `unitSlug` for real data.
      listUnitsTableRowsForProperty(id),
    ]);

  // `property` (brief) and `propertyDetail` are RLS-scoped views of the same
  // row; if either is hidden the property isn't ours to show. Never read
  // propertyDetail.autonomyLevel before this guard narrows it non-null.
  if (!property || !propertyDetail) {
    notFound();
  }

  const kind = propertyKind(property.name, property.units.length);
  const headerMeta = buildHeaderMeta(property);
  // Operator-row lookup for the UnitsPanel — balance / days-late / lease end
  // and the record-payment action ids, keyed by the unit id (== brief slug).
  const unitRowById = new Map<string, UnitTableRow>(
    unitTableRows.map((row) => [row.id, row] as const),
  );
  // Structured occupancy from the canonical unit query — never derived by
  // string-matching status labels.
  const occupancy = summarizeUnitOccupancy(unitCards);
  const primaryAction = getPrimaryAction(property, id, occupancy, isOwner);

  return (
    <div
      data-testid="property-detail-page"
      data-property-slug={id}
      className="today-theme"
      style={pageStyle}
    >
      <DetailGlobalBar
        crumbs={[
          { label: 'Portfolio' },
          { label: 'Properties', href: '/properties' },
          { label: property.name },
        ]}
        freshnessText="Data current · refreshed on open"
      />

      <main>
        <section style={heroStyle} className="property-interior-hero">
          <div style={artworkStyle} className="property-interior-art" aria-hidden="true">
            <Image
              src={KIND_IMAGE_SRC[kind]}
              alt=""
              width={240}
              height={170}
              sizes="190px"
              priority
              className="property-interior-art-image"
            />
          </div>

          <div style={headerCopyStyle}>
            <p style={eyebrowStyle}>Property interior</p>
            <h1 style={titleStyle}>{property.name}</h1>
            <div style={heroMetaStyle}>
              {headerMeta.map((segment, index) => (
                <span key={segment} className="property-header-meta-item">
                  {index > 0 ? (
                    <span aria-hidden="true" className="property-header-meta-sep">
                      ·
                    </span>
                  ) : null}
                  {segment}
                </span>
              ))}
            </div>
          </div>

          <div style={actionGroupStyle} className="property-hero-actions">
            <div className="property-badge-stack">
              <DetailBadge variant={property.badge.variant} label={property.badge.label} />
              {property.badgeReasons.length > 0 ? (
                <ul data-testid="property-badge-reasons" className="property-badge-reasons">
                  {property.badgeReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            {!isVa ? (
              <EditPropertyDialog
                propertyId={id}
                initial={{
                  name: propertyDetail.name,
                  addressStreet: propertyDetail.addressStreet,
                  addressCity: propertyDetail.addressCity,
                  addressState: propertyDetail.addressState,
                  addressZip: propertyDetail.addressZip,
                }}
              />
            ) : null}
            {!isVa ? (
              <ActionControl
                href={roomHref(id, 'units')}
                icon={<ExternalLink size={14} strokeWidth={1.8} />}
                label="Open details"
              />
            ) : null}
          </div>
        </section>

        <section style={contentStyle} className="property-interior-content">
          <div style={primaryGridStyle}>
            <div style={workbenchStyle} className="property-interior-workbench">
              <div style={mapColumnStyle}>
                <InteriorMap
                  occupancy={occupancy}
                  property={property}
                  propertyId={id}
                  readOnly={isVa}
                />
                {!isVa ? <RoomCabinet propertyId={id} /> : null}
              </div>

              <div style={sideStackStyle}>
                <MetricsPanel metrics={property.metrics} />
                <UnitsPanel
                  propertyId={id}
                  units={property.units}
                  unitRows={unitRowById}
                  readOnly={isVa}
                />
              </div>
            </div>

            {!isVa ? (
              <ActivityStrip
                occupancy={occupancy}
                property={property}
                propertyId={id}
              />
            ) : null}
          </div>

          <aside style={rightRailStyle} aria-label="Property operating rail">
            {isVa ? (
              <VaPropertyBriefPanel occupancy={occupancy} property={property} />
            ) : (
              <>
                <OdesaBriefPanel
                  occupancy={occupancy}
                  property={property}
                  primaryAction={primaryAction}
                />
                <OwnerUpdatePanel
                  occupancy={occupancy}
                  property={property}
                  primaryAction={primaryAction}
                />
              </>
            )}
            {isOwner ? (
              <AskOdesaBar
                scopeLabel={property.ask.contextLabel}
                placeholder={`Ask Odesa about ${property.ask.subject}…`}
                prompts={property.ask.prompts}
              />
            ) : null}
          </aside>
        </section>

        {!isVa ? (
          <OperationsSection
            propertyId={id}
            autonomyLevel={propertyDetail.autonomyLevel}
            privacyMode={propertyDetail.privacyMode}
            ollamaHost={propertyDetail.ollamaHost}
            summary={summary}
          />
        ) : null}

        <RoomDrawerMount propertyId={id} room={unitDetail ? null : room}>
          {room ? (
            isVa ? (
              <VaContextBoundary />
            ) : (
              <RoomContent propertyId={id} room={room} />
            )
          ) : null}
        </RoomDrawerMount>
        <UnitDrawerMount
          propertyId={id}
          data={unitDetail}
          closeHref={`/properties/${id}?room=units`}
          readOnly={isVa}
        />
      </main>

      <PropertyInteriorStyles />
    </div>
  );
}

function VaContextBoundary() {
  return (
    <div
      data-testid="property-va-context-boundary"
      style={{
        border: '1px solid var(--hairline)',
        borderRadius: 8,
        background: 'var(--panel-lift)',
        padding: '14px 16px',
        fontFamily: 'var(--font-sans-operator)',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--ink-2)',
      }}
    >
      This configuration room is owner-managed. Use the property record for
      context or Escalations to prepare an owner handoff.
    </div>
  );
}

/**
 * Server-only switch that maps a `RoomKey` to its async room component. Kept in
 * the server graph (out of `rooms-meta.ts`) so the client `RoomDrawerMount`
 * shell never pulls server-only room fetches into the client bundle.
 */
function RoomContent({
  propertyId,
  room,
}: {
  propertyId: string;
  room: RoomKey;
}): ReactNode {
  switch (room) {
    case 'units':
      return <UnitsRoom propertyId={propertyId} />;
    case 'appliances':
      return <AppliancesRoom propertyId={propertyId} />;
    case 'vendors':
      return <VendorsRoom propertyId={propertyId} />;
    case 'maintenance':
      return <MaintenanceRoom propertyId={propertyId} />;
    case 'payments':
      return <PaymentsRoom propertyId={propertyId} />;
    case 'rulebook':
      return <RulebookRoom propertyId={propertyId} />;
  }
}

const CABINET_TILES: ReadonlyArray<{
  room: RoomKey;
  eyebrow: string;
  title: string;
  status: string;
}> = [
  {
    room: 'appliances',
    eyebrow: 'Appliance shelf',
    title: 'Appliances',
    status: 'Serials, warranties & notes',
  },
  {
    room: 'vendors',
    eyebrow: 'Service bench',
    title: 'Vendors',
    status: 'Preferred vendors & assignments',
  },
  {
    room: 'rulebook',
    eyebrow: 'Rulebook binder',
    title: 'Rulebook',
    status: 'House rules & owner policies',
  },
];

/**
 * Property cabinet — appliances/vendors/rulebook are property *records*, not
 * operational map rooms, so they live as a quiet hairline strip of drawer
 * triggers under the interior map rather than as nodes on the map canvas.
 */
function RoomCabinet({ propertyId }: { propertyId: string }) {
  return (
    <section
      data-testid="room-cabinet"
      className="property-cabinet"
      aria-label="Property cabinet"
    >
      {CABINET_TILES.map((tile) => (
        <Link
          key={tile.room}
          href={roomHref(propertyId, tile.room)}
          className="cabinet-tile"
        >
          <span className="cabinet-eyebrow">{tile.eyebrow}</span>
          <span className="cabinet-title">{tile.title}</span>
          <span className="cabinet-status">{tile.status}</span>
        </Link>
      ))}
    </section>
  );
}

function ActionControl({
  href,
  icon,
  label,
}: {
  href?: string;
  icon: ReactNode;
  label: string;
}) {
  const content = (
    <>
      {icon}
      <span>{label}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="property-action-control">
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className="property-action-control">
      {content}
    </button>
  );
}

/**
 * The interior map is data-driven: each room's tone, the highlighted "focus"
 * room, and the connector emphasis all derive from the property's live state
 * (rent owed, open work orders, vacancy). Two properties in different states
 * therefore render visibly different maps.
 */
function InteriorMap({
  occupancy,
  property,
  propertyId,
  readOnly = false,
}: {
  occupancy: UnitOccupancySummary;
  property: PropertyDetailMock;
  propertyId: string;
  readOnly?: boolean;
}) {
  const collected = metricValue(property.metrics, 'collected') ?? '0%';
  const outstanding = kvValue(property.rent.cells, 'outstanding') ?? '$0';
  const isVacant = occupancy.vacantCount > 0;
  const isLeasePending = occupancy.pendingCount > 0;
  const noWork = property.vendors.kind.toLowerCase().includes('no open');
  const firstUnit = property.units[0];
  const total = property.units.length;
  const occupied = occupancy.occupiedCount;

  // --- per-room attention: the criteria that drive node + connector emphasis
  const rentAttention = outstanding !== '$0';
  const maintenanceAttention = !noWork;
  const leaseAttention = isVacant || isLeasePending;

  // --- per-room tone (calm green → watch amber → action clay)
  const rentTone: Tone = rentAttention ? 'clay' : 'green';
  const leaseTone: Tone = leaseAttention ? 'amber' : 'green';
  const maintenanceTone: Tone = property.vendors.dot;
  const unitTone: Tone = firstUnit ? toneForPill(firstUnit.status.variant) : 'neutral';

  // --- focus: the single highest-priority room. The vacancy case keeps the
  // focus on the Unit room (it is the thing that is empty); rent/maintenance
  // issues move the highlight onto their own room.
  const focus: 'unit' | 'rent' | 'maintenance' = rentAttention
    ? 'rent'
    : maintenanceAttention
      ? 'maintenance'
      : 'unit';

  const unitLabel = total === 1 && firstUnit ? firstUnit.label : `${total} units`;
  const unitChip =
    total === 1
      ? firstUnit
        ? firstUnit.status.label
        : 'No units'
      : `${occupied}/${total} leased`;
  const unitTarget =
    total === 1 && firstUnit
      ? unitHref(propertyId, firstUnit.unitSlug)
      : roomHref(propertyId, 'units');

  const rentDetail =
    outstanding === '$0'
      ? 'Collected · no balance due.'
      : `${collected} collected · ${outstanding} due.`;
  const leaseDetail = isVacant
    ? readOnly
      ? 'No active lease is recorded. Owner setup required.'
      : 'No active lease. Prepare listing.'
    : isLeasePending
      ? readOnly
        ? 'Lease pending. Owner approval required.'
        : 'Lease pending. Finish lease terms.'
      : 'Lease terms active.';
  const maintDetail = noWork
    ? 'No open work orders. Last visit not recorded.'
    : `${property.vendors.kind}. ${property.vendors.detail}`;

  // Interior map = property operating dependency map.
  // Unit is the root; Rent, Lease, Maintenance, and Documents branch from the
  // unit/property spine. Coordinates are fixed to the 560×600 map canvas and
  // align to card midpoints so connectors stay even. Tone/emphasis come from
  // the same per-room criteria as the cards, so an at-risk room's branch lights
  // up while calm lines stay quiet.
  const anchors = {
    unitRight: [218, 135], // Unit room right-mid, feeds the spine
    unitBottom: [124, 210], // Unit room bottom-mid, feeds Maintenance
    rentLeft: [352, 102], // Rent desk left-mid
    leaseLeft: [352, 319], // Lease bay left-mid (true midpoint)
    maintenanceTop: [124, 312], // Maintenance closet top-mid
    documentsTop: [400, 446], // Documents shelf top-mid
    spineRent: [300, 102], // spine tap → Rent (spine top)
    spineHub: [300, 135], // Unit → spine junction (the hub)
    spineLease: [300, 319], // spine tap → Lease
    spineDocuments: [300, 420], // spine tap → Documents
  } as const;

  const connectors: ConnectorSpec[] = [
    // Spine trunk — the single vertical backbone, rent tap → documents tap.
    {
      d: `M${anchors.spineRent[0]} ${anchors.spineRent[1]} V${anchors.spineDocuments[1]}`,
      tone: 'neutral',
      emphasized: false,
    },
    // Unit → spine: the hub feed. Subtly lights when the unit is vacant /
    // lease-pending, so the Unit reads as the root issue feeding the system.
    {
      d: `M${anchors.unitRight[0]} ${anchors.unitRight[1]} H${anchors.spineHub[0]}`,
      tone: unitTone,
      emphasized: leaseAttention,
    },
    // Rent branches from the top of the spine.
    {
      d: `M${anchors.spineRent[0]} ${anchors.spineRent[1]} H${anchors.rentLeft[0]}`,
      tone: rentTone,
      emphasized: rentAttention,
    },
    // Lease branches from the spine at the card's true left-mid (y=319).
    {
      d: `M${anchors.spineLease[0]} ${anchors.spineLease[1]} H${anchors.leaseLeft[0]}`,
      tone: leaseTone,
      emphasized: leaseAttention,
    },
    // Maintenance drops straight down from the Unit's bottom midpoint.
    {
      d: `M${anchors.unitBottom[0]} ${anchors.unitBottom[1]} V${anchors.maintenanceTop[1]}`,
      tone: maintenanceTone,
      emphasized: maintenanceAttention,
    },
    // Documents branches from the spine with a clean elbow into its top-mid.
    {
      d: `M${anchors.spineDocuments[0]} ${anchors.spineDocuments[1]} H${anchors.documentsTop[0]} V${anchors.documentsTop[1]}`,
      tone: 'neutral',
      emphasized: false,
    },
  ];

  // Dots mark the five real taps/junctions only — no floating card-edge dots.
  const dots: DotSpec[] = [
    { cx: anchors.spineRent[0], cy: anchors.spineRent[1], tone: rentTone, emphasized: rentAttention },
    { cx: anchors.spineHub[0], cy: anchors.spineHub[1], tone: unitTone, emphasized: leaseAttention },
    { cx: anchors.spineLease[0], cy: anchors.spineLease[1], tone: leaseTone, emphasized: leaseAttention },
    { cx: anchors.spineDocuments[0], cy: anchors.spineDocuments[1], tone: 'neutral', emphasized: false },
    { cx: anchors.unitBottom[0], cy: anchors.unitBottom[1], tone: maintenanceTone, emphasized: maintenanceAttention },
  ];

  return (
    <section style={interiorMapStyle} aria-label="Interior map">
      <div style={{ marginBottom: 14 }}>
        <h2 style={panelTitleStyle}>Interior map</h2>
      </div>

      <div className="property-map-stage">
        <div className="property-map-canvas">
          <div className="map-grid-bg" aria-hidden="true" />
          <MapConnectors connectors={connectors} dots={dots} />
          <span className="map-unit-label" aria-hidden="true">
            {unitLabel}
          </span>

          <MapRoom
            className="room-unit"
            active={focus === 'unit'}
            tone={unitTone}
            icon={<DoorOpen size={16} strokeWidth={1.7} />}
            title="Unit room"
            detail="Tenant, lease, rent, inspection state."
            chip={unitChip}
            cardHref={readOnly && total !== 1 ? undefined : unitTarget}
          />
          <MapRoom
            className="room-rent"
            active={focus === 'rent'}
            tone={rentTone}
            icon={<ReceiptText size={16} strokeWidth={1.7} />}
            title="Rent desk"
            detail={rentDetail}
            actionLabel={readOnly ? undefined : rentAttention ? 'Open ledger' : 'View ledger'}
            actionHref={readOnly ? undefined : roomHref(propertyId, 'payments')}
          />
          <MapRoom
            className="room-lease"
            tone={leaseTone}
            icon={<ClipboardList size={16} strokeWidth={1.7} />}
            title="Lease bay"
            detail={leaseDetail}
            actionLabel={
              readOnly
                ? undefined
                : isVacant
                  ? 'Draft lease'
                  : isLeasePending
                    ? 'Finish lease terms'
                    : 'View leases'
            }
            actionHref={readOnly ? undefined : roomHref(propertyId, 'units')}
          />
          <MapRoom
            className="room-maintenance"
            active={focus === 'maintenance'}
            tone={maintenanceTone}
            icon={<Wrench size={16} strokeWidth={1.7} />}
            title="Maintenance closet"
            detail={maintDetail}
            actionLabel={readOnly ? undefined : maintenanceAttention ? 'View work' : 'View'}
            actionHref={readOnly ? undefined : roomHref(propertyId, 'maintenance')}
          />
          <MapRoom
            className="room-documents"
            tone="neutral"
            icon={<FileText size={16} strokeWidth={1.7} />}
            title="Documents shelf"
            detail="Lease terms · owner rules · payment history."
            actionLabel={readOnly ? undefined : 'View'}
            actionHref={readOnly ? undefined : `/documents?propertyId=${propertyId}`}
          />
        </div>
      </div>
    </section>
  );
}

interface ConnectorSpec {
  d: string;
  tone: Tone;
  emphasized: boolean;
}

interface DotSpec {
  cx: number;
  cy: number;
  tone: Tone;
  emphasized: boolean;
}

function MapConnectors({
  connectors,
  dots,
}: {
  connectors: ConnectorSpec[];
  dots: DotSpec[];
}) {
  return (
    <svg
      className="map-connectors"
      viewBox="0 0 560 600"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {connectors.map((connector, index) => (
          <path
            key={index}
            d={connector.d}
            style={{
              stroke: connector.emphasized ? TONE_ACCENT[connector.tone] : 'var(--ink-3)',
              strokeWidth: connector.emphasized ? 2 : 1.5,
              opacity: connector.emphasized ? 0.95 : 0.5,
            }}
          />
        ))}
      </g>
      <g>
        {dots.map((dot, index) => (
          <circle
            key={index}
            cx={dot.cx}
            cy={dot.cy}
            r={dot.emphasized ? 4 : 3.2}
            style={{ fill: dot.emphasized ? TONE_ACCENT[dot.tone] : 'var(--ink-2)' }}
          />
        ))}
      </g>
    </svg>
  );
}

function MapRoom({
  actionHref,
  actionLabel,
  active = false,
  cardHref,
  chip,
  className,
  detail,
  icon,
  title,
  tone = 'neutral',
}: {
  actionHref?: string;
  actionLabel?: string;
  active?: boolean;
  cardHref?: string;
  chip?: string;
  className: string;
  detail: string;
  icon: ReactNode;
  title: string;
  tone?: Tone;
}) {
  return (
    <article
      className={`map-room ${className}${active ? ' map-room-active' : ''}`}
      style={{ '--room-accent': TONE_ACCENT[tone] } as CSSProperties}
    >
      {cardHref ? (
        <Link
          href={cardHref}
          className="map-room-cover"
          aria-label={`${title}: ${detail}`}
        />
      ) : null}
      <div className="map-room-head">
        {icon}
        <strong>{title}</strong>
      </div>
      <p className="map-room-detail">{detail}</p>
      {chip ? (
        <span className="map-room-chip">
          <span className="map-room-dot" aria-hidden="true" />
          {chip}
        </span>
      ) : actionHref ? (
        <Link href={actionHref} className="map-room-action">
          {actionLabel}
        </Link>
      ) : null}
    </article>
  );
}

function MetricsPanel({ metrics }: { metrics: MetricCell[] }) {
  return (
    <section style={panelStyle} aria-label="At a glance">
      <div style={panelHeaderStyle}>
        <h2 style={panelTitleStyle}>At a glance</h2>
      </div>
      <div style={metricsGridStyle} className="property-metrics-grid">
        {metrics.map((metric, index) => (
          <div
            key={`${metric.label}-${index}`}
            style={{
              ...metricCellStyle,
              borderRight: index % 2 === 0 ? '1px solid var(--hairline-faint)' : 'none',
              borderBottom:
                index < metrics.length - (metrics.length % 2 === 0 ? 2 : 1)
                  ? '1px solid var(--hairline-faint)'
                  : 'none',
            }}
          >
            <span style={metricLabelStyle}>{metric.label}</span>
            <span
              style={{
                ...metricValueStyle,
                color: metric.tone === 'warn' ? 'var(--clay)' : 'var(--ink)',
              }}
              className="num"
            >
              {metric.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function UnitsPanel({
  propertyId,
  units,
  unitRows,
  readOnly = false,
}: {
  propertyId: string;
  units: UnitRow[];
  unitRows: Map<string, UnitTableRow>;
  readOnly?: boolean;
}) {
  const unitOptions = units
    .filter((u) => unitRows.get(u.unitSlug)?.status === 'vacant')
    .map((u) => ({ id: u.unitSlug, label: u.label }));
  const hasTenants = units.some((u) => u.tenantName.trim() !== '');
  return (
    <section style={panelStyle} aria-label="Units">
      <div
        style={{
          ...panelHeaderStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <h2 style={serifPanelTitleStyle}>Units</h2>
        {!readOnly ? (
          <AddTenantDialog
            propertyId={propertyId}
            units={unitOptions}
            variant="header"
          />
        ) : null}
      </div>
      {hasTenants || readOnly ? null : (
        <TenantsEmptyState propertyId={propertyId} units={unitOptions} />
      )}
      <div data-testid="property-units" className="interior-units-list">
        {units.map((unit) => {
          // For real data the brief `unitSlug` is the unit id, which keys the
          // operator-row map; an absent row simply degrades to brief-only data.
          const row = unitRows.get(unit.unitSlug);
          const outstanding = row?.outstandingDollars ?? 0;
          const daysLate = row?.daysLate ?? 0;
          const isLate = outstanding > 0;
          const tenantId = row?.tenantId ?? null;
          const leaseId = row?.leaseId ?? null;
          const rentEventId = row?.currentRentEventId ?? null;
          const openMaint = row?.openMaintCount ?? 0;
          // Record payment only when there is a real cycle balance AND the
          // ids the modal needs — never a no-op trigger.
          const canRecordPayment = isLate && Boolean(rentEventId) && Boolean(leaseId);

          const metaParts: string[] = [];
          if (row?.leaseEndDate) {
            metaParts.push(`Lease ends ${formatShortDate(row.leaseEndDate)}`);
          }
          if (openMaint > 0) {
            metaParts.push(`${openMaint} open maintenance`);
          }
          const metaLine = metaParts.join(' · ');

          const balanceLabel =
            daysLate > 0
              ? `${formatDollars(outstanding)} · ${daysLate}d late`
              : `${formatDollars(outstanding)} due`;

          return (
            <article
              key={unit.unitSlug}
              data-testid={`unit-row-${unit.unitSlug}`}
              data-unit-row={unit.unitSlug}
              className="interior-unit-row"
            >
              <Link
                href={unitHref(propertyId, unit.unitSlug)}
                aria-label={unit.ariaLabel}
                className="unit-row-link"
              />
              <div className="interior-unit-main">
                <strong>{unit.label}</strong>
                {unit.tenantName ? <span>{unit.tenantName}</span> : null}
                {metaLine ? (
                  <span className="unit-meta-line">{metaLine}</span>
                ) : unit.sub ? (
                  <span>{unit.sub}</span>
                ) : null}
              </div>
              <div className="interior-unit-side">
                <span className="num">{unit.rent}</span>
                {isLate ? (
                  <span className="unit-balance-late">{balanceLabel}</span>
                ) : (
                  <span className={`unit-status unit-status-${toneForPill(unit.status.variant)}`}>
                    {unit.status.label}
                  </span>
                )}
              </div>
              <div className="interior-unit-actions">
                <div className="unit-action-row">
                  {tenantId ? (
                    <Link href={`/tenants/${tenantId}`} className="unit-action">
                      View tenant
                    </Link>
                  ) : null}
                  {canRecordPayment && !readOnly ? (
                    <RecordPaymentModal
                      rentEventId={rentEventId as string}
                      leaseId={leaseId as string}
                      outstandingDollars={outstanding}
                      triggerLabel="Record payment"
                      tenantName={unit.tenantName || undefined}
                      unitLabel={unit.label}
                    />
                  ) : null}
                </div>
                <span className="unit-enter">Enter</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function VaPropertyBriefPanel({
  occupancy,
  property,
}: {
  occupancy: UnitOccupancySummary;
  property: PropertyDetailMock;
}) {
  const briefItems = buildBriefItems(property, occupancy).map((item) => {
    if (item.kind === 'Vacancy follow-up') {
      return {
        ...item,
        detail: 'No tenant attached · prepare the known context for the owner',
        actions: [],
      };
    }
    if (item.kind === 'Lease pending') {
      return {
        ...item,
        detail: 'Move-in being set up · owner approval required',
        actions: [],
      };
    }
    return { ...item, actions: [] };
  });
  const summary =
    occupancy.total === 0
      ? 'No units are recorded for this property. Use the known property record to prepare an owner handoff.'
      : `${occupancy.occupiedCount} of ${occupancy.total} units have active leases. Review the current evidence below and prepare owner follow-up where needed.`;

  return (
    <section
      style={panelStyle}
      aria-label="Operations assistant property context"
      data-testid="property-va-brief"
    >
      <div style={railBodyStyle}>
        <p style={eyebrowStyle}>Shift context</p>
        <h2 style={{ ...serifPanelTitleStyle, marginTop: 10 }}>
          Prepare the handoff
        </h2>
        <p style={paragraphStyle}>{summary}</p>

        <div style={attentionListStyle}>
          {briefItems.map((item, index) => (
            <AttentionTile key={`${item.kind}-${index}`} item={item} />
          ))}
        </div>

        <p
          style={{
            ...eyebrowStyle,
            marginTop: 16,
            letterSpacing: '0.12em',
            lineHeight: 1.5,
          }}
        >
          View context · owner changes property, lease, and payment records
        </p>
      </div>
    </section>
  );
}

function OdesaBriefPanel({
  occupancy,
  primaryAction,
  property,
}: {
  occupancy: UnitOccupancySummary;
  primaryAction: PrimaryAction;
  property: PropertyDetailMock;
}) {
  const briefItems = buildBriefItems(property, occupancy);

  return (
    <section style={panelStyle} aria-label="Odesa brief">
      <div style={railBodyStyle}>
        <p style={eyebrowStyle}>Odesa brief</p>
        <h2 style={{ ...serifPanelTitleStyle, marginTop: 10 }}>What needs attention</h2>
        <p style={paragraphStyle}>
          <RichText text={buildBriefIntro(property, occupancy)} />
        </p>

        <div style={attentionListStyle}>
          {briefItems.map((item, index) => (
            <AttentionTile key={`${item.kind}-${index}`} item={item} />
          ))}
        </div>

        <Link href={primaryAction.href} style={{ ...updateButtonStyle, marginTop: 16 }}>
          {primaryAction.label}
        </Link>
      </div>
    </section>
  );
}

function AttentionTile({ item }: { item: AttentionItem }) {
  return (
    <article
      className="attention-tile"
      aria-label={item.ariaLabel}
      style={{ '--tile-accent': TONE_ACCENT[item.dot] } as CSSProperties}
    >
      <span className="attention-dot" aria-hidden="true" />
      <div>
        <strong>
          {item.kind}
          {item.loc ? <span> · {item.loc}</span> : null}
        </strong>
        <p>{item.detail}</p>
      </div>
    </article>
  );
}

function OwnerUpdatePanel({
  occupancy,
  primaryAction,
  property,
}: {
  occupancy: UnitOccupancySummary;
  primaryAction: PrimaryAction;
  property: PropertyDetailMock;
}) {
  return (
    <section style={panelStyle} aria-label="Owner update">
      <div style={railBodyStyle}>
        <p style={eyebrowStyle}>Owner update</p>
        <p style={paragraphStyle}>{buildOwnerUpdate(property, occupancy)}</p>
        <Link href={primaryAction.href} style={{ ...updateButtonStyle, marginTop: 18 }}>
          {primaryAction.label}
        </Link>
      </div>
    </section>
  );
}

function ActivityStrip({
  occupancy,
  property,
  propertyId,
}: {
  occupancy: UnitOccupancySummary;
  property: PropertyDetailMock;
  propertyId: string;
}) {
  const outstanding = kvValue(property.rent.cells, 'outstanding') ?? '$0';
  const nextExpected = kvValue(property.rent.cells, 'next expected') ?? 'Next cycle';
  const firstUnit = property.units[0];

  return (
    <section style={activityGridStyle} className="property-activity-grid" aria-label="Property activity">
      <ActivityTile
        href={roomHref(propertyId, 'payments')}
        icon={<ReceiptText size={16} strokeWidth={1.8} />}
        label={property.rent.label}
        title={`${outstanding} outstanding`}
        detail={`Next expected ${nextExpected}`}
      />
      <ActivityTile
        href={roomHref(propertyId, 'maintenance')}
        icon={<Wrench size={16} strokeWidth={1.8} />}
        label="Maintenance"
        title={property.vendors.kind}
        detail={property.vendors.detail}
      />
      <ActivityTile
        href={
          firstUnit
            ? unitHref(propertyId, firstUnit.unitSlug)
            : roomHref(propertyId, 'units')
        }
        icon={<Home size={16} strokeWidth={1.8} />}
        label="Leasing"
        title={buildLeaseSummary(occupancy)}
        detail={firstUnit ? `${firstUnit.label} · ${firstUnit.status.label}` : 'No units yet'}
      />
    </section>
  );
}

function ActivityTile({
  detail,
  href,
  icon,
  label,
  title,
}: {
  detail: string;
  href: string;
  icon: ReactNode;
  label: string;
  title: string;
}) {
  return (
    <Link href={href} className="activity-tile">
      <span className="activity-label">
        {icon}
        {label}
      </span>
      <strong>{title}</strong>
      <span>{detail}</span>
    </Link>
  );
}

function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

interface PrimaryAction {
  href: string;
  label: string;
}

/**
 * Structured occupancy rollup built from the canonical
 * `listUnitsForProperty` statuses — replaces the old
 * `status.label.includes('vacant')` string matching. A pending lease is
 * tracked separately from vacancy on purpose: "prepare listing" copy is
 * only ever shown for true vacancy.
 */
interface UnitOccupancySummary {
  total: number;
  /** Units with an active lease (current / ending soon / late). */
  occupiedCount: number;
  vacantCount: number;
  pendingCount: number;
  lateCount: number;
  vacantLabels: string[];
  pendingLabels: string[];
}

function summarizeUnitOccupancy(cards: ReadonlyArray<UnitGridCard>): UnitOccupancySummary {
  const vacantLabels = cards.filter((c) => c.status === 'vacant').map((c) => c.label);
  const pendingLabels = cards.filter((c) => c.status === 'pending').map((c) => c.label);
  return {
    total: cards.length,
    occupiedCount: cards.length - vacantLabels.length - pendingLabels.length,
    vacantCount: vacantLabels.length,
    pendingCount: pendingLabels.length,
    lateCount: cards.filter((c) => c.status === 'late').length,
    vacantLabels,
    pendingLabels,
  };
}

function getPrimaryAction(
  property: PropertyDetailMock,
  propertyId: string,
  occupancy: UnitOccupancySummary,
  canUseAssistant: boolean,
): PrimaryAction {
  const attentionText = property.attention
    .map((item) => `${item.kind} ${item.detail}`)
    .join(' ')
    .toLowerCase();

  if (
    attentionText.includes('rent late') ||
    attentionText.includes('collection') ||
    attentionText.includes('outstanding')
  ) {
    return { href: roomHref(propertyId, 'payments'), label: 'Open ledger' };
  }

  // "Prepare listing" only for true vacancy; a pending lease needs its
  // terms finished, not a listing.
  if (occupancy.vacantCount > 0) {
    return { href: roomHref(propertyId, 'units'), label: 'Prepare listing' };
  }

  if (occupancy.pendingCount > 0) {
    return { href: roomHref(propertyId, 'units'), label: 'Finish lease terms' };
  }

  if (
    !attentionText.includes('no open work orders') &&
    (attentionText.includes('work order') || attentionText.includes('maintenance'))
  ) {
    return { href: roomHref(propertyId, 'maintenance'), label: 'View work orders' };
  }

  if (canUseAssistant) {
    const query = `Property context — ${property.name}: Draft an owner update grounded in this property record. Do not send it.`;
    return {
      href: `/assistant?q=${encodeURIComponent(query)}`,
      label: 'Draft owner update',
    };
  }

  return { href: roomHref(propertyId, 'units'), label: 'Open details' };
}

function buildHeaderMeta(property: PropertyDetailMock): string[] {
  const location = property.meta.find((segment) => segment.includes(','));
  const unit = property.meta.find((segment) => /\bunit\b/i.test(segment));
  const occupancy = property.meta.find((segment) => /occupied/i.test(segment));
  const monthlyRent = metricValue(property.metrics, 'monthly rent');

  return [
    location,
    unit,
    occupancy,
    monthlyRent ? `${monthlyRent} monthly rent` : undefined,
  ].filter((segment): segment is string => Boolean(segment));
}

function propertyKind(name: string, unitCount: number): PropertyKind {
  const lower = name.toLowerCase();
  if (lower.includes('condo')) return 'condo';
  if (lower.includes('apt') || lower.includes('apartment') || lower.includes('flat')) {
    return 'apartment';
  }
  if (lower.includes('town') || lower.includes('row')) return 'townhouse';
  if (lower.includes('house') || lower.includes('home')) return 'single-family';
  if (unitCount >= 10) return 'condo';
  if (unitCount >= 5) return 'apartment';
  if (unitCount >= 2) return 'townhouse';
  return 'single-family';
}

function metricValue(metrics: MetricCell[], needle: string): string | null {
  return (
    metrics.find((metric) =>
      metric.label.toLowerCase().includes(needle.toLowerCase()),
    )?.value ?? null
  );
}

function kvValue(cells: Array<{ k: string; v: string }>, needle: string): string | null {
  return (
    cells.find((cell) =>
      cell.k.toLowerCase().includes(needle.toLowerCase()),
    )?.v ?? null
  );
}

/** "$1,520" from a dollar amount (operator-row balance line). */
function formatDollars(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString('en-US')}`;
}

/** "Jun 30, 2026" from an ISO `YYYY-MM-DD` lease end date (UTC, no TZ drift). */
function formatShortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function toneForPill(variant: PillVariant): Tone {
  if (variant === 'plan' || variant === 'aging' || variant === 'replace') return 'clay';
  if (variant === 'watching') return 'amber';
  return 'green';
}

function buildLeaseSummary(occupancy: UnitOccupancySummary): string {
  if (occupancy.total === 0) return 'No units yet';
  const { vacantCount, pendingCount, lateCount } = occupancy;
  if (vacantCount > 0) {
    return `${vacantCount} vacant ${vacantCount === 1 ? 'unit' : 'units'}`;
  }
  if (pendingCount > 0) {
    return `${pendingCount} ${pendingCount === 1 ? 'lease' : 'leases'} pending`;
  }
  if (lateCount > 0) {
    return `${lateCount} lease${lateCount === 1 ? ' needs' : 's need'} rent follow-up`;
  }
  return 'Lease terms active';
}

function buildBriefIntro(
  property: PropertyDetailMock,
  occupancy: UnitOccupancySummary,
): string {
  if (occupancy.vacantCount > 0) {
    return 'This property is calm operationally, but at least one unit is vacant. The next best step is to prepare the unit for leasing and confirm tenant setup.';
  }
  if (occupancy.pendingCount > 0) {
    return 'This property has a lease pending — move-in being set up. The next best step is to finish the lease terms so the tenant setup completes.';
  }
  return property.odesaNote.body;
}

function buildBriefItems(
  property: PropertyDetailMock,
  occupancy: UnitOccupancySummary,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const allClearAttention = property.attention.filter(
    (item) => item.kind.toLowerCase() === 'all clear',
  );
  const materialAttention = property.attention.filter(
    (item) => item.kind.toLowerCase() !== 'all clear',
  );
  const outstanding = kvValue(property.rent.cells, 'outstanding') ?? '$0';

  if (occupancy.vacantCount > 0) {
    items.push({
      dot: 'amber',
      kind: 'Vacancy follow-up',
      loc:
        occupancy.vacantCount === 1
          ? occupancy.vacantLabels[0]
          : `${occupancy.vacantCount} units`,
      detail: 'No tenant attached · prepare listing and confirm tenant setup',
      ariaLabel: 'Vacancy follow-up. No tenant attached · prepare listing and confirm tenant setup',
      actions: [{ label: 'Prepare listing', variant: 'default' }],
    });
  }

  if (occupancy.pendingCount > 0) {
    items.push({
      dot: 'gold',
      kind: 'Lease pending',
      loc:
        occupancy.pendingCount === 1
          ? occupancy.pendingLabels[0]
          : `${occupancy.pendingCount} units`,
      detail: 'Move-in being set up · finish lease terms',
      ariaLabel: 'Lease pending. Move-in being set up · finish lease terms',
      actions: [{ label: 'Finish lease terms', variant: 'default' }],
    });
  }

  items.push(...materialAttention);

  if (property.vendors.kind.toLowerCase().includes('no open')) {
    items.push({
      dot: 'green',
      kind: 'Maintenance clear',
      detail: 'No active work orders or vendor visits blocking this property',
      ariaLabel: 'Maintenance clear. No active work orders or vendor visits blocking this property',
      actions: [{ label: 'View', variant: 'default' }],
    });
  }

  if (outstanding === '$0') {
    items.push({
      dot: 'green',
      kind: 'Ledger quiet',
      detail: 'No outstanding balance this cycle',
      ariaLabel: 'Ledger quiet. No outstanding balance this cycle',
      actions: [{ label: 'Open ledger', variant: 'default' }],
    });
  }

  if (items.length === 0) return allClearAttention.length > 0 ? allClearAttention : property.attention;
  return items;
}

function buildOwnerUpdate(
  property: PropertyDetailMock,
  occupancy: UnitOccupancySummary,
): string {
  const leaseSummary = buildLeaseSummary(occupancy);
  const activeItems = metricValue(property.metrics, 'active items') ?? property.attentionCount;
  return `${property.name} is ${property.badge.label.toLowerCase()}. ${leaseSummary}. ${property.vendors.kind}. Active items: ${activeItems}.`;
}

function PropertyInteriorStyles() {
  return (
    <style precedence="property-interior-page">{`
      .today-theme *:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }

      .property-interior-art::after {
        content: "";
        position: absolute;
        left: 32px;
        right: 28px;
        bottom: 7px;
        height: 9px;
        border-radius: 999px;
        background: rgba(59, 49, 36, 0.14);
        filter: blur(6px);
      }

      .property-interior-art-image {
        position: relative;
        z-index: 1;
        width: min(190px, 100%);
        height: auto;
      }

      .property-header-meta-item {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        white-space: nowrap;
      }

      .property-header-meta-sep {
        color: var(--ink-4);
      }

      /* Status badge + its data-backed reasons, stacked under the badge. */
      .property-badge-stack {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 7px;
      }

      .property-badge-reasons {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 3px;
        max-width: 230px;
        text-align: right;
      }

      .property-badge-reasons li {
        font-family: var(--font-sans-operator);
        font-size: 11.5px;
        line-height: 1.35;
        color: var(--ink-3);
      }

      .property-action-control {
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 14px;
        border: 1px solid var(--hairline);
        border-radius: 7px;
        background: var(--panel-clean);
        color: var(--ink-2);
        font: inherit;
        font-size: 12.5px;
        text-decoration: none;
        cursor: pointer;
      }

      .property-action-control:hover {
        border-color: var(--hairline-strong);
        color: var(--ink);
      }

      /* ---------------------------------------------------------------
         Interior map — fixed-coordinate canvas (560×600). Room cards are
         positioned by percentage of this canvas; the SVG connector overlay
         uses a matching 0 0 560 600 viewBox, so cards and connectors share
         one coordinate system and scale together (no measurement / no JS).
      --------------------------------------------------------------- */
      .property-map-stage {
        container-type: inline-size;
        display: flex;
        justify-content: center;
        padding: 18px;
        border: 1px solid var(--hairline-faint);
        border-radius: 6px;
        overflow: hidden;
        background: color-mix(in srgb, var(--panel-clean) 86%, var(--canvas));
      }

      .property-map-canvas {
        position: relative;
        width: 100%;
        max-width: 600px;
        aspect-ratio: 560 / 600;
      }

      .map-grid-bg {
        position: absolute;
        inset: 0;
        z-index: 0;
        background-image:
          linear-gradient(var(--hairline-faint) 1px, transparent 1px),
          linear-gradient(90deg, var(--hairline-faint) 1px, transparent 1px);
        background-size: 40px 40px;
        opacity: 0.55;
        -webkit-mask-image: radial-gradient(circle at 48% 44%, #000 50%, transparent 100%);
        mask-image: radial-gradient(circle at 48% 44%, #000 50%, transparent 100%);
      }

      .map-connectors {
        position: absolute;
        inset: 0;
        z-index: 1;
        width: 100%;
        height: 100%;
        color: var(--ink-3);
        pointer-events: none;
      }

      .map-unit-label {
        position: absolute;
        z-index: 1;
        left: 44.5%;
        top: 42%;
        transform: translate(-50%, -50%);
        font-family: var(--font-serif-display), Georgia, serif;
        font-style: italic;
        font-size: clamp(22px, 5.4cqw, 30px);
        letter-spacing: 0.01em;
        color: var(--ink-4);
        opacity: 0.72;
        pointer-events: none;
        white-space: nowrap;
      }

      .map-room {
        position: absolute;
        z-index: 2;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        padding: 13px 14px;
        border: 1px solid var(--hairline);
        border-radius: 14px;
        background: var(--panel-clean);
        box-shadow: 0 10px 24px rgba(47, 39, 28, 0.05);
        overflow: hidden;
      }

      .map-room-cover {
        position: absolute;
        inset: 0;
        z-index: 2;
        border-radius: inherit;
        text-decoration: none;
      }

      .map-room-active {
        border-color: var(--terracotta);
        box-shadow: 0 10px 26px rgba(178, 102, 71, 0.14);
      }

      .map-room-head {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--ink);
      }

      .map-room-head svg {
        color: var(--ink-3);
        flex: none;
      }

      .map-room-head strong {
        font-size: clamp(13px, 2.7cqw, 14.5px);
        font-weight: 550;
        letter-spacing: -0.01em;
        line-height: 1.1;
      }

      .map-room-detail {
        margin: 9px 0 0;
        color: var(--ink-2);
        font-size: clamp(11.5px, 2.3cqw, 12.5px);
        line-height: 1.42;
      }

      .map-room-action {
        position: relative;
        z-index: 3;
        align-self: flex-start;
        margin-top: auto;
        min-height: 30px;
        display: inline-flex;
        align-items: center;
        padding: 0 12px;
        border: 1px solid var(--hairline);
        border-radius: 8px;
        background: var(--panel-clean);
        color: var(--ink-2);
        font-size: 11.5px;
        text-decoration: none;
        white-space: nowrap;
      }

      .map-room-chip {
        align-self: flex-start;
        margin-top: auto;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-height: 27px;
        padding: 0 11px;
        border: 1px solid var(--hairline);
        border-radius: 999px;
        background: var(--panel-lift);
        font-family: var(--font-mono-operator);
        font-size: 9.5px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-2);
        white-space: nowrap;
      }

      .map-room-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--room-accent, var(--green));
      }

      .room-unit { left: 5.4%; top: 10%; width: 33.6%; height: 25%; }
      .room-rent { left: 62.9%; top: 6%; width: 31.8%; height: 22%; }
      .room-lease { left: 62.9%; top: 41.7%; width: 31.8%; height: 23%; }
      .room-maintenance { left: 4.3%; top: 52%; width: 35.7%; height: 22.3%; }
      .room-documents { left: 53.6%; top: 74.3%; width: 35.7%; height: 23%; }

      .interior-units-list {
        max-height: 370px;
        overflow: auto;
      }

      .interior-unit-row {
        position: relative;
        min-height: 92px;
        display: grid;
        grid-template-columns: minmax(104px, 1fr) minmax(86px, max-content);
        gap: 14px;
        align-items: center;
        padding: 17px 18px;
        border-bottom: 1px solid var(--hairline-faint);
      }

      .interior-unit-row:last-child {
        border-bottom: 0;
      }

      .unit-row-link {
        position: absolute;
        inset: 0;
        z-index: 1;
        text-decoration: none;
      }

      .interior-unit-main,
      .interior-unit-side,
      .unit-enter {
        position: relative;
        z-index: 2;
        pointer-events: none;
      }

      .interior-unit-main {
        min-width: 0;
        display: grid;
        gap: 4px;
      }

      .interior-unit-main strong {
        color: var(--ink);
        font-size: 14px;
      }

      .interior-unit-main span,
      .interior-unit-side span:first-child {
        color: var(--ink-3);
        font-size: 12px;
      }

      .interior-unit-side {
        display: grid;
        justify-items: end;
        gap: 7px;
        min-width: 86px;
      }

      .unit-status,
      .unit-enter {
        min-height: 26px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--hairline);
        border-radius: 999px;
        padding: 0 9px;
        background: var(--panel-clean);
        font-family: var(--font-mono-operator);
        font-size: 9.5px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-2);
        white-space: nowrap;
      }

      .unit-status-green {
        border-color: var(--green-border);
        color: var(--green-ink);
        background: var(--green-bg);
      }

      .unit-status-amber {
        border-color: var(--amber-border);
        color: var(--amber-ink);
        background: var(--amber-bg);
      }

      .unit-status-clay {
        border-color: var(--clay-border);
        color: var(--clay-ink);
        background: var(--clay-bg);
      }

      .interior-unit-row:hover {
        background: var(--panel-clean);
      }

      .interior-unit-row:hover .unit-enter {
        border-color: var(--hairline-strong);
        color: var(--ink);
      }

      .interior-unit-main .unit-meta-line {
        font-size: 11px;
        color: var(--ink-3);
      }

      .unit-balance-late {
        font-family: var(--font-mono-operator);
        font-size: 11px;
        letter-spacing: 0.04em;
        color: var(--clay);
        white-space: nowrap;
      }

      /* Action group sits above the whole-row link (z-index 2). The container
         is click-transparent so gaps fall through to the row link; only the
         real controls (View tenant / Record payment) capture clicks. */
      .interior-unit-actions {
        position: relative;
        z-index: 2;
        pointer-events: none;
        grid-column: 1 / -1;
        display: flex;
        gap: 8px;
        justify-content: space-between;
        align-items: center;
      }

      .interior-unit-actions a,
      .interior-unit-actions button {
        pointer-events: auto;
      }

      .unit-action-row {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-start;
      }

      .unit-action {
        min-height: 26px;
        display: inline-flex;
        align-items: center;
        padding: 0 10px;
        border: 1px solid var(--hairline);
        border-radius: 6px;
        background: var(--panel-clean);
        color: var(--ink-2);
        font-size: 11.5px;
        text-decoration: none;
        white-space: nowrap;
      }

      .unit-action:hover {
        border-color: var(--hairline-strong);
        color: var(--ink);
      }

      .attention-tile {
        display: grid;
        grid-template-columns: 9px minmax(0, 1fr);
        gap: 12px;
        align-items: start;
        padding: 13px;
        border: 1px solid var(--hairline);
        border-radius: 8px;
        background: var(--panel-clean);
      }

      .attention-dot {
        width: 8px;
        height: 8px;
        margin-top: 5px;
        border-radius: 50%;
        background: var(--tile-accent);
      }

      .attention-tile strong {
        display: block;
        color: var(--ink);
        font-size: 13.5px;
      }

      .attention-tile strong span {
        color: var(--ink-3);
        font-weight: 450;
      }

      .attention-tile p {
        margin: 5px 0 0;
        color: var(--ink-3);
        font-size: 12.5px;
        line-height: 1.4;
      }

      .activity-tile {
        min-height: 72px;
        display: grid;
        align-content: start;
        gap: 6px;
        padding: 12px 14px;
        border: 1px solid var(--hairline);
        border-radius: 8px;
        background: color-mix(in srgb, var(--panel-lift) 76%, transparent);
        color: var(--ink);
        text-decoration: none;
      }

      .activity-label {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--ink-3);
        font-family: var(--font-mono-operator);
        font-size: 10.5px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .activity-tile strong {
        font-size: 15px;
        line-height: 1.2;
      }

      .activity-tile > span:last-child {
        color: var(--ink-3);
        font-size: 12.5px;
      }

      .activity-tile:hover,
      .property-action-control:hover,
      .map-room-action:hover,
      .map-room-active:hover {
        border-color: var(--hairline-strong);
      }

      .map-room-action:hover {
        color: var(--ink);
      }

      /* ---------------------------------------------------------------
         Property cabinet — slim record drawers under the interior map.
         Appliances / vendors / rulebook are property records (not map
         rooms): a quiet hairline strip, no color or heavy icons.
      --------------------------------------------------------------- */
      .property-cabinet {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }

      .cabinet-tile {
        min-height: 92px;
        display: grid;
        align-content: start;
        gap: 7px;
        padding: 14px 15px;
        border: 1px solid var(--hairline);
        border-radius: 8px;
        background: color-mix(in srgb, var(--panel-lift) 76%, transparent);
        color: var(--ink);
        text-decoration: none;
      }

      .cabinet-tile:hover {
        border-color: var(--hairline-strong);
      }

      .cabinet-eyebrow {
        font-family: var(--font-mono-operator);
        font-size: 10px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--ink-3);
      }

      .cabinet-title {
        font-family: var(--font-serif-display), Georgia, serif;
        font-style: italic;
        font-size: 18px;
        line-height: 1.05;
        color: var(--ink);
      }

      .cabinet-status {
        font-size: 12px;
        line-height: 1.4;
        color: var(--ink-3);
      }

      [data-ask-bar] {
        margin-top: 0 !important;
      }

      @container (max-width: 430px) {
        .property-map-canvas {
          aspect-ratio: auto;
          max-width: none;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .map-connectors,
        .map-grid-bg,
        .map-unit-label {
          display: none;
        }
        .map-room {
          position: static;
          left: auto;
          top: auto;
          width: auto !important;
          height: auto !important;
          min-height: 92px;
        }
        .map-room-head strong { font-size: 14px; }
        .map-room-detail { font-size: 12.5px; }
      }

      @media (max-width: 1260px) {
        .property-interior-content {
          grid-template-columns: 1fr !important;
        }
        .property-interior-workbench {
          grid-template-columns: minmax(420px, 1fr) minmax(250px, 320px) !important;
        }
      }

      @media (max-width: 980px) {
        .property-interior-hero {
          grid-template-columns: 140px minmax(0, 1fr) !important;
        }
        .property-hero-actions {
          grid-column: 1 / -1;
          justify-content: flex-start !important;
        }
        .property-interior-workbench {
          grid-template-columns: 1fr !important;
        }
        .property-activity-grid {
          grid-template-columns: 1fr !important;
        }
      }

      @media (max-width: 720px) {
        .property-interior-hero {
          grid-template-columns: 1fr !important;
          padding: 22px 18px !important;
        }
        .property-interior-art {
          justify-content: start;
          height: 96px !important;
        }
        .property-interior-art-image {
          width: 135px;
        }
        .property-interior-content {
          padding: 16px !important;
        }
      }

      @media (max-width: 560px) {
        .property-metrics-grid {
          grid-template-columns: 1fr;
        }
        .property-cabinet {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}
