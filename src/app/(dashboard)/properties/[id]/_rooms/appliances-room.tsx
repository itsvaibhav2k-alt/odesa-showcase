/**
 * Appliance shelf — the `?room=appliances` drawer interior.
 *
 * One async server component rendered as `children` of `RoomDrawerMount`.
 * The shell (`room-drawer-mount.tsx`) owns the eyebrow / serif title /
 * description from `ROOM_META`, so this file renders only the body: an
 * action row + the main hairline card.
 *
 * Body is lifted from the legacy `/properties/[id]/appliances` page
 * (queries, `groupByUnit`, `ApplianceGroup`, `SourceCell`) minus the
 * `PageHeader` / `PropertyTabs` chrome, restyled to the shared room
 * chrome (`./room-chrome`) and the Quiet Operator tokens.
 *
 * RLS: queries go through `createServerClient()` so the supabase session
 * token auto-scopes to the caller's organization — we never pass
 * `organization_id`.
 *
 * Note: `+ Add appliance` reuses the real `AddApplianceDialog`; its built-in
 * trigger is restyled to read as the primary dark pill via a scoped style
 * override (the dialog component itself is shared and not edited here).
 */

import * as React from 'react';
import type { CSSProperties } from 'react';

import { ConfidenceBadge, type ConfidenceSource } from '@/components/shared';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { createServerClient } from '@/lib/supabase/server';

import { confirmApplianceAction } from '../appliances/actions';
import { AddApplianceDialog } from '../appliances/add-appliance-dialog';
import { RoomActions, RoomCard, RoomEmptyState } from './room-chrome';

interface ApplianceRow {
  id: string;
  type: string;
  make: string | null;
  model: string | null;
  installDate: string | null;
  warrantyExpiresAt: string | null;
  notes: string | null;
  unitId: string | null;
  unitLabel: string | null;
  confidence: number;
  source: ConfidenceSource;
  propertyId: string;
}

interface UnitGroup {
  key: string;
  label: string;
  rows: ApplianceRow[];
}

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
  minWidth: 0,
};

const groupsWrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  minWidth: 0,
};

export async function AppliancesRoom({
  propertyId,
}: {
  propertyId: string;
}): Promise<React.ReactElement> {
  const supabase = await createServerClient();

  // All appliances for this property + unit labels for grouping. RLS scopes
  // both to the caller's org.
  const [appliancesResult, unitsResult] = await Promise.all([
    supabase
      .from('appliances')
      .select(
        'id, type, make, model, install_date, warranty_expires_at, notes, unit_id, confidence, source',
      )
      .eq('property_id', propertyId)
      .order('type', { ascending: true }),
    supabase.from('units').select('id, label').eq('property_id', propertyId),
  ]);

  const unitMap = new Map<string, string>();
  for (const u of unitsResult.data ?? []) {
    unitMap.set(u.id, u.label);
  }

  const rows: ApplianceRow[] = (appliancesResult.data ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    make: r.make,
    model: r.model,
    installDate: r.install_date,
    warrantyExpiresAt: r.warranty_expires_at,
    notes: r.notes,
    unitId: r.unit_id,
    unitLabel: r.unit_id ? unitMap.get(r.unit_id) ?? null : null,
    confidence: Number(r.confidence),
    source: (r.source as ConfidenceSource) ?? 'agent',
    propertyId,
  }));

  const groups = groupByUnit(rows, unitMap);
  const unitOptions = Array.from(unitMap.entries()).map(([id, label]) => ({
    id,
    label,
  }));

  return (
    <div style={rootStyle}>
      <ApplianceTriggerStyles />

      <RoomActions>
        {/* The real AddApplianceDialog; its trigger is restyled to the dark
        pill via the scoped override above. After submit the action revalidates
        the property page and the dialog closes — the drawer stays open. */}
        <div className='appliances-add-trigger'>
          <AddApplianceDialog propertyId={propertyId} units={unitOptions} />
        </div>
      </RoomActions>

      {groups.length === 0 ? (
        <RoomCard flush>
          <RoomEmptyState
            illustration={<ApplianceShelfIllustration />}
            headline='No appliances logged yet.'
            body='Odesa can build this shelf from inspection notes, receipts, or tenant messages.'
          />
        </RoomCard>
      ) : (
        <RoomCard scrollX>
          <div style={groupsWrapStyle}>
            {groups.map((group, i) => (
              <ApplianceGroup key={group.key} group={group} divided={i > 0} />
            ))}
          </div>
        </RoomCard>
      )}
    </div>
  );
}

function groupByUnit(
  rows: ApplianceRow[],
  unitMap: Map<string, string>,
): UnitGroup[] {
  const groups = new Map<string, UnitGroup>();
  // Stable order: property-wide first, then units alphabetical by label.
  groups.set('__property_wide__', {
    key: '__property_wide__',
    label: 'Property-wide',
    rows: [],
  });
  // Pre-seed unit groups so empty units don't collapse silently.
  const unitEntries = Array.from(unitMap.entries()).sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  for (const [id, label] of unitEntries) {
    groups.set(id, { key: id, label: `Unit ${label}`, rows: [] });
  }
  for (const row of rows) {
    const key = row.unitId ?? '__property_wide__';
    const g = groups.get(key);
    if (g) g.rows.push(row);
  }
  // Drop empty groups (the "nothing at all" case is handled by the caller).
  return Array.from(groups.values()).filter((g) => g.rows.length > 0);
}

const groupSectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minWidth: 0,
};

const groupDividedStyle: CSSProperties = {
  paddingTop: 20,
  borderTop: '1px solid var(--hairline-faint)',
};

const groupHeadingStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontSize: 16,
  fontWeight: 600,
  letterSpacing: '-0.005em',
  color: 'var(--ink)',
};

function ApplianceGroup({
  group,
  divided,
}: {
  group: UnitGroup;
  divided: boolean;
}): React.ReactElement {
  return (
    <section
      data-testid='appliance-group'
      data-group-key={group.key}
      style={divided ? { ...groupSectionStyle, ...groupDividedStyle } : groupSectionStyle}
    >
      <h3 style={groupHeadingStyle}>{group.label}</h3>
      <DataTable<ApplianceRow>
        rows={group.rows}
        columns={APPLIANCE_COLUMNS}
        getRowKey={(r) => r.id}
        // Reduced chrome: drop the table's own box so the RoomCard is the only
        // surface (row separators + header band survive for legibility).
        className='border-0 rounded-none bg-transparent'
        data-testid={`appliance-table-${group.key}`}
      />
    </section>
  );
}

const APPLIANCE_COLUMNS: ReadonlyArray<DataTableColumn<ApplianceRow>> = [
  { key: 'type', header: 'Type', render: (row) => row.type },
  {
    key: 'make_model',
    header: 'Make / Model',
    render: (row) => [row.make, row.model].filter(Boolean).join(' ') || '—',
  },
  { key: 'installDate', header: 'Installed', render: (row) => row.installDate ?? '—' },
  {
    key: 'warrantyExpiresAt',
    header: 'Warranty',
    render: (row) => row.warrantyExpiresAt ?? '—',
  },
  { key: 'source', header: 'Source', render: (row) => <SourceCell row={row} /> },
];

function SourceCell({ row }: { row: ApplianceRow }): React.ReactElement {
  if (row.source === 'owner') {
    return (
      <span data-testid='appliance-row' data-appliance-id={row.id}>
        <ConfidenceBadge source='owner' confidence={row.confidence} />
      </span>
    );
  }
  return (
    <span data-testid='appliance-row' data-appliance-id={row.id}>
      <form
        action={confirmApplianceAction.bind(null, {
          propertyId: row.propertyId,
          applianceId: row.id,
        })}
      >
        <ConfidenceBadge source={row.source} confidence={row.confidence} asButton />
      </form>
    </span>
  );
}

/**
 * Spot illustration — appliances on a shelf (fridge / oven / washer), warm
 * sepia line-art. Aria-hidden via the empty-state wrapper; strokes inherit the
 * low-contrast `--ink-3` so it stays subordinate to the headline.
 */
function ApplianceShelfIllustration(): React.ReactElement {
  return (
    <svg
      width='148'
      height='108'
      viewBox='0 0 148 108'
      fill='none'
      stroke='var(--ink-3)'
      strokeWidth='1.4'
      strokeLinecap='round'
      strokeLinejoin='round'
      role='presentation'
      aria-hidden='true'
    >
      {/* shelf plank + brackets */}
      <rect x='8' y='84' width='132' height='6' rx='1.5' fill='var(--amber-bg-soft)' />
      <path d='M22 90v8M126 90v8' />

      {/* fridge */}
      <rect x='18' y='22' width='30' height='62' rx='3' fill='var(--panel-lift)' />
      <path d='M18 45h30' />
      <path d='M42 28v11M42 51v24' />

      {/* oven */}
      <rect x='58' y='34' width='34' height='50' rx='3' fill='var(--panel-lift)' />
      <path d='M58 46h34' />
      <circle cx='65' cy='40' r='1.8' fill='var(--ink-4)' stroke='none' />
      <circle cx='73' cy='40' r='1.8' fill='var(--ink-4)' stroke='none' />
      <path d='M63 52h24' />
      <rect x='65' y='57' width='20' height='21' rx='2' fill='var(--amber-bg-soft)' />

      {/* washer */}
      <rect x='102' y='38' width='30' height='46' rx='3' fill='var(--panel-lift)' />
      <path d='M102 48h30' />
      <circle cx='126' cy='43' r='1.8' fill='var(--ink-4)' stroke='none' />
      <circle cx='117' cy='64' r='11' fill='var(--amber-bg-soft)' />
      <circle cx='117' cy='64' r='6' />
    </svg>
  );
}

/**
 * Scoped override that promotes the shared `AddApplianceDialog` trigger to the
 * primary dark pill (matching `roomPrimaryButtonStyle`). The compound selector
 * outranks the dialog's single-class button utilities, so no `!important` is
 * needed. Deduped across mounts by `href`, like `page.tsx` / `room-chrome.tsx`.
 */
function ApplianceTriggerStyles(): React.ReactElement {
  return (
    <style href='appliances-room-trigger' precedence='room-chrome'>{`
      .appliances-add-trigger [data-testid='add-appliance-trigger'] {
        height: 38px;
        min-height: 38px;
        padding: 0 16px;
        border: 1px solid var(--ink);
        border-radius: 999px;
        background: var(--ink);
        color: var(--panel-clean);
        font-family: var(--font-sans-operator), system-ui, sans-serif;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0.005em;
      }
      .appliances-add-trigger [data-testid='add-appliance-trigger']:hover {
        background: color-mix(in srgb, var(--ink) 90%, var(--panel-clean));
        color: var(--panel-clean);
      }
    `}</style>
  );
}
