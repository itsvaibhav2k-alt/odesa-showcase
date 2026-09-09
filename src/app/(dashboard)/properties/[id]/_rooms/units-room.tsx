/**
 * Unit room — the `?room=units` drawer interior.
 *
 * First-pass styling (no mockup supplied): the existing `UnitsTable` dropped
 * into the shared room pattern — a compact Units / Occupied / Vacant stat rail
 * above the main hairline card. The drawer shell (`RoomDrawerMount`) renders
 * the eyebrow/title/description from `ROOM_META`, so this component owns only
 * the body: its own data fetch + presentation. No primary action.
 *
 * Drawer-fit: the 6-column units table lives inside `RoomCard` with horizontal
 * scroll (and a minimum inner width) so it stays usable at 720px and 92vw
 * instead of squishing into unreadable columns on narrow viewports.
 */

import * as React from 'react';
import type { CSSProperties } from 'react';

import { listUnitsTableRowsForProperty } from '@/lib/properties/queries';
import { UnitsTable } from '@/components/properties/units-table';

import { RoomCard, RoomStatGrid, RoomStatCell } from './room-chrome';

const bodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
  minWidth: 0,
};

// Minimum width so the 6-column table scrolls horizontally inside the card
// rather than collapsing into cramped, wrapping columns at 92vw.
const tableScrollInnerStyle: CSSProperties = {
  minWidth: 560,
};

export interface UnitsRoomProps {
  propertyId: string;
}

/** Async server component: fetches the units feed and renders the room body. */
export async function UnitsRoom({
  propertyId,
}: UnitsRoomProps): Promise<React.ReactElement> {
  const units = await listUnitsTableRowsForProperty(propertyId);

  const total = units.length;
  // `notice` is an occupied unit needing attention (late / ending soon) and
  // `pending` is a lease being set up — neither counts as vacant.
  const occupied = units.filter(
    (u) => u.status === 'occupied' || u.status === 'notice',
  ).length;
  const pending = units.filter((u) => u.status === 'pending').length;
  const vacant = units.filter((u) => u.status === 'vacant').length;
  const hasUnits = total > 0;

  return (
    <div style={bodyStyle}>
      <RoomStatGrid>
        <RoomStatCell label='Units' value={total} />
        <RoomStatCell label='Occupied' value={occupied} />
        {pending > 0 ? (
          <RoomStatCell label='Lease pending' value={pending} />
        ) : null}
        <RoomStatCell label='Vacant' value={vacant} />
      </RoomStatGrid>

      <RoomCard flush scrollX={hasUnits}>
        <div style={hasUnits ? tableScrollInnerStyle : undefined}>
          <UnitsTable propertyId={propertyId} units={units} />
        </div>
      </RoomCard>
    </div>
  );
}
