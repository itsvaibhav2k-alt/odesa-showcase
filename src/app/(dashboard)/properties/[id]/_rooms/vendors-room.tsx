/**
 * Vendors room — "Service bench" interior for the Property Interior drawer.
 *
 * Async server component rendered INSIDE the room drawer shell (the shell
 * renders the eyebrow/title/description from `ROOM_META`, so this file does
 * NOT repeat them). It owns its own data fetch (lifted verbatim from the old
 * `/properties/[id]/vendors` page) and presentation.
 *
 * Layout (mockup, adapted to the ~720px drawer):
 *   - action row: `Manage vendors →` link (to /vendors) + `…` overflow stub
 *   - stat rail: Active assignments · Stalled follow-ups · Approval limit
 *   - main card: one row per vendor category (mockup set + any extra category
 *     that actually has an assignment), each showing the assigned vendor +
 *     phone (or "No vendor assigned") and the real `AssignVendorDialog`
 *     trigger, plus the agent/owner confidence badge + confirm form.
 *
 * Shared chrome (`./room-chrome`) keeps the drawer visually consistent with
 * the other room interiors; assignment/confirmation behavior is the existing
 * `AssignVendorDialog` / `confirmVendorAction` flow, unchanged.
 */

import * as React from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';

import { ConfidenceBadge, type ConfidenceSource } from '@/components/shared';
import { createServerClient } from '@/lib/supabase/server';

import { confirmVendorAction } from '../vendors/actions';
import { AssignVendorDialog } from '../vendors/assign-vendor-dialog';
import { VENDOR_CATEGORIES, type VendorCategory } from '../vendors/shared-types';
import {
  RoomActions,
  RoomCard,
  RoomEmptyState,
  RoomStatCell,
  RoomStatGrid,
  roomPrimaryButtonStyle,
} from './room-chrome';

interface VendorOption {
  id: string;
  name: string;
  category: string | null;
  phone: string | null;
}

interface VendorRow {
  category: VendorCategory;
  vendorId: string | null;
  vendorName: string | null;
  vendorPhone: string | null;
  notes: string | null;
  confidence: number;
  source: ConfidenceSource | null;
  hasAssignment: boolean;
}

/** Mockup's category set, in mockup order. Always shown (even when empty). */
const MOCKUP_CATEGORIES: readonly VendorCategory[] = [
  'plumbing',
  'hvac',
  'electrical',
  'general',
  'cleaning',
];

/** Display labels for every category the data layer can surface. */
const CATEGORY_LABELS: Record<VendorCategory, string> = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  hvac: 'HVAC',
  landscaping: 'Landscaping',
  general: 'General repair',
  pest: 'Pest control',
  roof: 'Roofing',
  cleaning: 'Cleaning',
  locksmith: 'Locksmith',
};

export async function VendorsRoom({
  propertyId,
}: {
  propertyId: string;
}): Promise<React.ReactElement> {
  const supabase = await createServerClient();

  // Lifted from the old vendors page: existing assignments + the org's
  // vendor roster, fetched in parallel.
  const [assignmentsResult, vendorsResult] = await Promise.all([
    supabase
      .from('property_vendors')
      .select('category, vendor_id, notes, confidence, source')
      .eq('property_id', propertyId),
    supabase
      .from('vendors')
      .select('id, name, category, phone_e164')
      .order('name', { ascending: true }),
  ]);

  const vendorsById = new Map<string, VendorOption>();
  for (const v of vendorsResult.data ?? []) {
    vendorsById.set(v.id, {
      id: v.id,
      name: v.name,
      category: v.category,
      phone: v.phone_e164,
    });
  }

  const assignmentsByCategory = new Map<
    string,
    {
      vendorId: string | null;
      notes: string | null;
      confidence: number;
      source: ConfidenceSource;
    }
  >();
  for (const a of assignmentsResult.data ?? []) {
    assignmentsByCategory.set(a.category, {
      vendorId: a.vendor_id,
      notes: a.notes,
      confidence: Number(a.confidence),
      source: (a.source as ConfidenceSource) ?? 'agent',
    });
  }

  const vendorOptions: VendorOption[] = Array.from(vendorsById.values());
  const hasRoster = vendorOptions.length > 0;

  // Show the mockup categories, plus any extra category that actually has a
  // vendor assigned so real data is never hidden behind the fixed list.
  const extraAssigned = VENDOR_CATEGORIES.filter(
    (cat) =>
      !MOCKUP_CATEGORIES.includes(cat) &&
      Boolean(assignmentsByCategory.get(cat)?.vendorId),
  );
  const displayCategories: VendorCategory[] = [
    ...MOCKUP_CATEGORIES,
    ...extraAssigned,
  ];

  const rows: VendorRow[] = displayCategories.map((cat) => {
    const a = assignmentsByCategory.get(cat);
    const vendor = a?.vendorId ? vendorsById.get(a.vendorId) ?? null : null;
    return {
      category: cat,
      vendorId: a?.vendorId ?? null,
      vendorName: vendor?.name ?? null,
      vendorPhone: vendor?.phone ?? null,
      notes: a?.notes ?? null,
      confidence: a?.confidence ?? 0,
      source: a?.source ?? null,
      hasAssignment: Boolean(a),
    };
  });

  // "Active assignments" = categories with a vendor actually set.
  let activeCount = 0;
  for (const a of assignmentsByCategory.values()) {
    if (a.vendorId) activeCount += 1;
  }

  return (
    <div style={containerStyle} data-testid="vendors-room">
      <RoomActions>
        <Link
          href="/vendors"
          style={roomPrimaryButtonStyle}
          data-testid="manage-vendors-link"
        >
          Manage vendors →
        </Link>
      </RoomActions>

      <RoomStatGrid>
        <RoomStatCell label="Active assignments" value={activeCount} />
        <RoomStatCell
          label="Stalled follow-ups"
          value={0}
          hint="No stalled follow-ups"
        />
        <RoomStatCell label="Approval limit" value="—" hint="Not configured" />
      </RoomStatGrid>

      {hasRoster ? (
        <RoomCard>
          <ul style={listStyle}>
            {rows.map((row, index) => (
              <li
                key={row.category}
                style={index === 0 ? firstRowStyle : rowStyle}
              >
                <div style={rowMainStyle}>
                  <div style={categoryNameStyle}>
                    {CATEGORY_LABELS[row.category]}
                  </div>
                  <div style={vendorLineStyle}>
                    {row.vendorName ? (
                      <>
                        <span style={vendorNameStyle}>{row.vendorName}</span>
                        {row.vendorPhone ? (
                          <a href={`tel:${row.vendorPhone}`} style={phoneStyle}>
                            {row.vendorPhone}
                          </a>
                        ) : null}
                      </>
                    ) : (
                      <span style={noVendorStyle}>No vendor assigned</span>
                    )}
                    {row.hasAssignment && row.source ? (
                      row.source === 'owner' ? (
                        <ConfidenceBadge
                          source="owner"
                          confidence={row.confidence}
                        />
                      ) : (
                        <form
                          action={confirmVendorAction.bind(null, {
                            propertyId,
                            category: row.category,
                          })}
                          style={confirmFormStyle}
                        >
                          <ConfidenceBadge
                            source={row.source}
                            confidence={row.confidence}
                            asButton
                          />
                        </form>
                      )
                    ) : null}
                  </div>
                  {row.notes ? <div style={notesStyle}>{row.notes}</div> : null}
                </div>
                <div style={rowActionStyle}>
                  <AssignVendorDialog
                    propertyId={propertyId}
                    category={row.category}
                    currentVendorId={row.vendorId}
                    vendors={vendorOptions}
                  />
                </div>
              </li>
            ))}
          </ul>
        </RoomCard>
      ) : (
        <RoomCard>
          <RoomEmptyState
            illustration={<ServiceBenchMark />}
            headline="No vendors on the bench yet"
            body="Odesa builds your service bench from chats, invoices, and onboarding. Add vendors to your roster, then assign one to each category here."
          />
        </RoomCard>
      )}
    </div>
  );
}

/** Small low-contrast sepia spot illustration (clipboard + tool). */
function ServiceBenchMark(): React.ReactElement {
  return (
    <svg
      width="76"
      height="76"
      viewBox="0 0 76 76"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="16"
        y="14"
        width="34"
        height="44"
        rx="3"
        stroke="var(--ink-3)"
        strokeWidth="1.25"
        fill="color-mix(in srgb, var(--panel-lift) 50%, transparent)"
      />
      <rect
        x="26"
        y="10"
        width="14"
        height="7"
        rx="2.5"
        stroke="var(--ink-3)"
        strokeWidth="1.25"
        fill="color-mix(in srgb, var(--panel-lift) 70%, transparent)"
      />
      <line
        x1="22"
        y1="28"
        x2="44"
        y2="28"
        stroke="var(--ink-4)"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <line
        x1="22"
        y1="35"
        x2="40"
        y2="35"
        stroke="var(--ink-4)"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <line
        x1="22"
        y1="42"
        x2="44"
        y2="42"
        stroke="var(--ink-4)"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <circle
        cx="54"
        cy="50"
        r="6"
        stroke="var(--ink-3)"
        strokeWidth="1.5"
        fill="color-mix(in srgb, var(--panel-lift) 60%, transparent)"
      />
      <line
        x1="58"
        y1="54"
        x2="64"
        y2="60"
        stroke="var(--ink-3)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Styles (Quiet Operator idiom: inline CSSProperties over existing tokens)
// ---------------------------------------------------------------------------

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
};

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
  padding: '14px 0',
  borderTop: '1px solid var(--hairline-faint)',
};

const firstRowStyle: CSSProperties = {
  ...rowStyle,
  paddingTop: 2,
  borderTop: 'none',
};

const rowMainStyle: CSSProperties = {
  minWidth: 0,
  flex: '1 1 220px',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

const categoryNameStyle: CSSProperties = {
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 14.5,
  fontWeight: 600,
  letterSpacing: '-0.005em',
  color: 'var(--ink)',
};

const vendorLineStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
};

const vendorNameStyle: CSSProperties = {
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 13,
  color: 'var(--ink-2)',
};

const phoneStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: 12.5,
  letterSpacing: '0.01em',
  color: 'var(--ink-2)',
  textDecoration: 'none',
  fontVariantNumeric: 'tabular-nums lining-nums',
};

const noVendorStyle: CSSProperties = {
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 13,
  color: 'var(--ink-3)',
};

const notesStyle: CSSProperties = {
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 12,
  fontStyle: 'italic',
  lineHeight: 1.4,
  color: 'var(--ink-3)',
};

const confirmFormStyle: CSSProperties = {
  display: 'inline-flex',
  margin: 0,
};

const rowActionStyle: CSSProperties = {
  marginLeft: 'auto',
  flexShrink: 0,
  paddingTop: 2,
};
