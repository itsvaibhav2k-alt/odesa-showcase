/**
 * Maintenance closet — `?room=maintenance` drawer interior.
 *
 * One self-contained async server component rendered INSIDE the room-drawer
 * shell (`RoomDrawerMount`). The shell already paints the eyebrow / serif
 * title / description from `ROOM_META`, so this file owns only the body:
 *
 *   1. Action row    — `+ Create ticket` (honest disabled stub, see below)
 *   2. Stat rail     — Open tickets (real) · Stalled · Vendor handoffs ·
 *                      Escalations (no backing data this pass → 0)
 *   3. Main card     — existing `_tabs/maintenance-tab.tsx` when tickets
 *                      exist, else an illustrated `RoomEmptyState`
 *   4. Watching strip — "Odesa is watching" status bullets + Next step
 *
 * Data: org-id auth pattern copied from the old `/maintenance/page.tsx`, then
 * `listMaintenanceTicketsForProperty` for the open count + empty/populated
 * decision (the populated branch hands off to `MaintenanceTab`, which re-runs
 * the same query — an accepted second round-trip, identical to the `?unit=`
 * drawer's server hop).
 *
 * "+ Create ticket": a real property-level intake flow (`CreateTicketDialog`).
 * A work order is always filed against a specific unit, so the dialog requires
 * unit selection and reuses the RLS-scoped `createWorkOrderAction` (tenantId
 * omitted → property-level ticket). When the property has no units yet there is
 * nothing to file against, so we fall back to the disabled `StubButton` with a
 * VISIBLE inline explanation rather than a tooltip-only hint.
 */

import * as React from 'react';
import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';

import {
  listMaintenanceTicketsForProperty,
  listUnitsForProperty,
} from '@/lib/properties/queries';
import { createServerClient } from '@/lib/supabase/server';

import { MaintenanceTab } from '../_tabs/maintenance-tab';
import { CreateTicketDialog } from './create-ticket-dialog';
import {
  RoomActions,
  RoomCard,
  RoomEmptyState,
  RoomStatCell,
  RoomStatGrid,
  StubButton,
} from './room-chrome';

const noUnitsHintStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 12.5,
  lineHeight: 1.4,
  color: 'var(--ink-3)',
};

const layoutStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

export async function MaintenanceRoom({
  propertyId,
}: {
  propertyId: string;
}): Promise<React.ReactElement> {
  const supabase = await createServerClient();

  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser.user) notFound();

  const { data: userRow } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', authUser.user.id)
    .single();

  if (!userRow?.organization_id) notFound();

  const organizationId = userRow.organization_id;
  const [tickets, units] = await Promise.all([
    listMaintenanceTicketsForProperty(organizationId, propertyId),
    listUnitsForProperty(propertyId),
  ]);

  const openCount = tickets.filter((t) => t.status === 'open').length;
  const hasTickets = tickets.length > 0;
  const hasUnits = units.length > 0;
  const ticketUnits = units.map((u) => ({ id: u.id, label: u.label }));

  return (
    <div style={layoutStyle}>
      <RoomActions>
        {hasUnits ? (
          <CreateTicketDialog units={ticketUnits} />
        ) : (
          <>
            <StubButton title="Add a unit to this property before filing a maintenance ticket">
              + Create ticket
            </StubButton>
            <p style={noUnitsHintStyle}>
              Add a unit to this property before filing a maintenance ticket.
            </p>
          </>
        )}
      </RoomActions>

      <RoomStatGrid>
        <RoomStatCell label="Open tickets" value={openCount} />
        <RoomStatCell label="Stalled" value={0} />
        <RoomStatCell label="Vendor handoffs" value={0} />
        <RoomStatCell label="Escalations" value={0} />
      </RoomStatGrid>

      {hasTickets ? (
        <RoomCard scrollX>
          <MaintenanceRoomStyles />
          <div className="maintenance-room-tab">
            <MaintenanceTab
              organizationId={organizationId}
              propertyId={propertyId}
            />
          </div>
        </RoomCard>
      ) : (
        <RoomCard>
          <RoomEmptyState
            illustration={<WrenchDocIllustration />}
            headline="No maintenance tickets yet."
            body="Odesa creates them automatically when a tenant reports an issue in chat."
          />
        </RoomCard>
      )}

      <WatchingStrip openCount={openCount} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Odesa is watching" footer strip
// ---------------------------------------------------------------------------

const watchingPanelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 11,
  padding: '15px 16px 16px',
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--panel-lift) 60%, transparent)',
};

const watchingEyebrowStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const bulletListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
};

const bulletItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 13,
  lineHeight: 1.4,
  color: 'var(--ink-2)',
};

const bulletDotStyle: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  background: 'var(--ink-4)',
  flexShrink: 0,
};

const nextStepStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 12.5,
  lineHeight: 1.5,
  color: 'var(--ink-3)',
};

const nextStepLabelStyle: CSSProperties = {
  color: 'var(--ink-2)',
  fontWeight: 600,
};

interface WatchSignal {
  bullets: readonly string[];
  nextStep: string;
}

/** Derive the watching-strip copy from the live open-ticket count. */
function deriveWatchSignal(openCount: number): WatchSignal {
  if (openCount === 0) {
    return {
      bullets: ['No open issues', 'Property is in good shape'],
      nextStep: 'Continue monitoring for tenant-reported issues.',
    };
  }
  const noun = openCount === 1 ? 'ticket' : 'tickets';
  const verb = openCount === 1 ? 'needs' : 'need';
  return {
    bullets: [
      `${openCount} open ${noun} ${verb} attention`,
      'Awaiting a vendor handoff or resolution',
    ],
    nextStep:
      openCount === 1
        ? 'Review the open ticket and assign a vendor or escalate to the owner.'
        : 'Review the open tickets and assign vendors or escalate to the owner.',
  };
}

function WatchingStrip({
  openCount,
}: {
  openCount: number;
}): React.ReactElement {
  const { bullets, nextStep } = deriveWatchSignal(openCount);
  return (
    <section style={watchingPanelStyle} data-testid="maintenance-watching">
      <p style={watchingEyebrowStyle}>Odesa is watching</p>
      <ul style={bulletListStyle}>
        {bullets.map((bullet) => (
          <li key={bullet} style={bulletItemStyle}>
            <span aria-hidden="true" style={bulletDotStyle} />
            {bullet}
          </li>
        ))}
      </ul>
      <p style={nextStepStyle}>
        <span style={nextStepLabelStyle}>Next step:</span> {nextStep}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Spot illustration — wrench resting on a document (small, sepia, aria-hidden)
// ---------------------------------------------------------------------------

function WrenchDocIllustration(): React.ReactElement {
  return (
    <svg
      width="80"
      height="80"
      viewBox="0 0 80 80"
      fill="none"
      aria-hidden="true"
    >
      {/* Document with a folded corner */}
      <path
        d="M21 13h23l13 13v37a3.5 3.5 0 0 1-3.5 3.5H21A3.5 3.5 0 0 1 17.5 63V16.5A3.5 3.5 0 0 1 21 13Z"
        fill="color-mix(in srgb, var(--panel-lift) 70%, transparent)"
        stroke="var(--ink-3)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M44 13v13h13"
        stroke="var(--ink-3)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* Text lines */}
      <path
        d="M25 33h17M25 40h21M25 47h13"
        stroke="var(--ink-4)"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      {/* Wrench laid diagonally across the lower-right of the page */}
      <g
        transform="rotate(38 47 52)"
        stroke="var(--ink-3)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="color-mix(in srgb, var(--panel-clean) 55%, transparent)"
      >
        <path d="M44 64.5h6V49.5a6 6 0 1 0-6 0Z" />
        <circle cx="47" cy="44" r="2.4" fill="none" />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Scoped styles — reduce the legacy DataTable chrome so it reads as a quiet
// surface inside the room card rather than a competing bordered panel.
// Deduped across drawers by `href`, mirroring `page.tsx` / `room-chrome.tsx`.
// ---------------------------------------------------------------------------

function MaintenanceRoomStyles(): React.ReactElement {
  return (
    <style href="maintenance-room" precedence="maintenance-room">{`
      .maintenance-room-tab [data-slot='data-table'] {
        border-color: transparent;
        border-radius: 0;
        background: transparent;
      }
      .maintenance-room-tab [data-slot='data-table'] table {
        font-size: 12.5px;
      }
      .maintenance-room-tab [data-slot='data-table'] th,
      .maintenance-room-tab [data-slot='data-table'] td {
        padding-top: 8px;
        padding-bottom: 8px;
      }
    `}</style>
  );
}
