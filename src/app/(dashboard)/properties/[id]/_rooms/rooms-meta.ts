/**
 * Room metadata + URL helpers for the Property Interior room drawers.
 *
 * CLIENT-SAFE: this module imports nothing server-only so it can be pulled
 * into the client `RoomDrawerMount` shell without dragging server code into
 * the client graph. The server-only room-component switch lives in `page.tsx`.
 */

export type RoomKey =
  | 'units'
  | 'appliances'
  | 'vendors'
  | 'maintenance'
  | 'payments'
  | 'rulebook';

/** Canonical room order; also the set of valid `?room=` values. */
export const ROOM_KEYS: readonly RoomKey[] = [
  'units',
  'appliances',
  'vendors',
  'maintenance',
  'payments',
  'rulebook',
];

/**
 * Parse a raw `?room=` search param into a `RoomKey`.
 *
 * @param raw - The value from `searchParams.room` (string, array, or undefined).
 * @returns The matching `RoomKey`, or `null` for missing/garbage input.
 */
export function parseRoomParam(
  raw: string | string[] | undefined,
): RoomKey | null {
  if (raw == null) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value != null && (ROOM_KEYS as readonly string[]).includes(value)) {
    return value as RoomKey;
  }
  return null;
}

/**
 * Header copy for a room drawer.
 *
 * `title` leads with a plain functional noun (Units, Rent, …) so the operator
 * reads what the room *is* first. The room metaphor (Unit room, Rent desk, …)
 * is demoted into the `eyebrow` — the small mono label above the title — so the
 * Odesa personality survives without competing with the functional label.
 */
export interface RoomMeta {
  key: RoomKey;
  /** Small mono label above the title; carries the room metaphor. */
  eyebrow: string;
  /** Primary serif title; a plain functional noun. */
  title: string;
  description: string;
}

export const ROOM_META: Record<RoomKey, RoomMeta> = {
  units: {
    key: 'units',
    eyebrow: 'Unit room',
    title: 'Units',
    description: 'Occupancy, leases, tenants, and unit-level activity.',
  },
  appliances: {
    key: 'appliances',
    eyebrow: 'Appliance shelf',
    title: 'Appliances',
    description: 'Serials, warranties, maintenance notes, and replacement history.',
  },
  vendors: {
    key: 'vendors',
    eyebrow: 'Service bench',
    title: 'Vendors',
    description:
      'Preferred vendors, open assignments, response history, and approval limits.',
  },
  maintenance: {
    key: 'maintenance',
    eyebrow: 'Maintenance closet',
    title: 'Maintenance',
    description:
      'Open work orders, stalled repairs, vendor handoffs, and owner escalation.',
  },
  payments: {
    key: 'payments',
    eyebrow: 'Rent desk',
    title: 'Rent',
    description: 'Collection state, balances, reminders, and payment links.',
  },
  rulebook: {
    key: 'rulebook',
    eyebrow: 'Rulebook binder',
    title: 'Rulebook',
    description: 'House rules, quiet hours, escalation paths, and owner policies.',
  },
};

/**
 * Build the canonical URL that opens a given room drawer.
 *
 * @param propertyId - The property whose interior page hosts the drawer.
 * @param room - The room to open.
 * @returns A relative href, e.g. `/properties/abc?room=payments`.
 */
export function roomHref(propertyId: string, room: RoomKey): string {
  return `/properties/${propertyId}?room=${room}`;
}
