/**
 * Vendors directory — `/vendors`, the Trades Index instrument.
 *
 * Art direction: a museum material library / architect's sample index. Vendors
 * are grouped by trade (the primary organizing signal, drawn from real
 * `category` data) inside a ruled index sheet, with a coverage margin that
 * reads trade coverage, open work, and readiness to call. Never invents
 * compliance, insurance, availability, or quality data — the only surfaced
 * signals are trade, the recorded acceptance rate, open-work count, and the
 * honestly-derived lifecycle pill for VA; owner presentation remains stable.
 *
 * Reached from the sidebar Properties section + the command-center tab bar;
 * each row drills into the vendor brief at `/vendors/<id>`. Server component
 * (force-dynamic); content is wrapped in `.today-theme` by ListPageShell.
 */

import type { CSSProperties } from 'react';

import {
  listVendorsDirectory,
  type VendorDirectoryRowView,
} from '@/lib/vendors/queries';
import { ListPageShell } from '@/components/properties/list/list-page-shell';
import { VendorRow } from '@/components/properties/list/vendor-row';
import {
  ColumnHead,
  OfficeRail,
  RailFigure,
  SectionBand,
  WorkspaceGrid,
  instrumentSheetStyle,
} from '@/components/properties/list/office-primitives';
import { AskOdesaBar } from '@/components/properties/detail/ask-odesa-bar';
import type { VendorDirectoryRow } from '@/lib/properties/mock-portfolio-views';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Matches VendorRow's grid so the column head aligns to the row columns. */
const INDEX_GRID = '1fr 74px 96px 132px 16px';

const emptyStyle: CSSProperties = {
  padding: '30px 18px',
  textAlign: 'center',
  fontSize: '13px',
  lineHeight: 1.55,
  color: 'var(--ink-2)',
  maxWidth: 460,
  margin: '0 auto',
};

/** Data-backed prompts for when the directory has vendor rows. */
const ASK_PROMPTS: string[] = [
  'Who has open work orders?',
  'Which vendors are awaiting a reply?',
  'Show plumbing coverage',
  'Summarize vendor performance',
];

/** Zero-state prompts — onboarding-shaped, since there is no data to query. */
const EMPTY_ASK_PROMPTS: string[] = [
  'Add my preferred plumber',
  'What vendor info should I collect?',
  'How does Odesa use vendors?',
];

const EMPTY_COPY =
  'No vendors in the index yet. Add your go-to plumber, electrician, or HVAC contact and Odesa will propose them for dispatches — nothing is dispatched without your say-so.';

const VA_EMPTY_ASK_PROMPTS: string[] = [
  'What vendor info should I collect?',
  'How does Odesa use vendors?',
  'Draft a vendor roster checklist',
];

const VA_EMPTY_COPY =
  'No vendors are on file yet. Use this shift context to collect the known vendor details for an owner handoff.';

/** Parse the leading integer out of an "N open" label. */
function openCount(label: string): number {
  const n = parseInt(label, 10);
  return Number.isFinite(n) ? n : 0;
}

interface TradeGroup {
  trade: string;
  rows: VendorDirectoryRowView[];
}

/** Group vendors by trade for the index's catalog rhythm (trades A→Z). */
function groupByTrade(rows: readonly VendorDirectoryRowView[]): TradeGroup[] {
  const byTrade = new Map<string, VendorDirectoryRowView[]>();
  for (const row of rows) {
    const list = byTrade.get(row.trade) ?? [];
    list.push(row);
    byTrade.set(row.trade, list);
  }
  return Array.from(byTrade.entries())
    .map(([trade, groupRows]) => ({ trade, rows: groupRows }))
    .sort((a, b) => a.trade.localeCompare(b.trade));
}

/** Coverage figures for the margin — all honest counts derived from the rows. */
interface Coverage {
  vendors: number;
  trades: number;
  open: number;
  attention: number;
  available: number;
}

function computeCoverage(rows: readonly VendorDirectoryRow[]): Coverage {
  const attentionLabels = new Set(['Reassign', 'Awaiting reply']);
  return {
    vendors: rows.length,
    trades: new Set(rows.map((r) => r.trade)).size,
    open: rows.reduce((sum, r) => sum + openCount(r.openLabel), 0),
    attention: rows.filter((r) => attentionLabels.has(r.statusPill.label)).length,
    available: rows.filter((r) => r.statusPill.label === 'No open jobs').length,
  };
}

export default async function VendorsPage() {
  const supabase = await createServerClient();
  const [{ header, rows }, { data: currentRole }] = await Promise.all([
    listVendorsDirectory(),
    supabase.rpc('current_user_role'),
  ]);
  const isVa = currentRole === 'va';
  const askPrompts =
    rows.length === 0
      ? isVa
        ? VA_EMPTY_ASK_PROMPTS
        : EMPTY_ASK_PROMPTS
      : ASK_PROMPTS;

  const groups = groupByTrade(rows);
  const coverage = computeCoverage(rows);

  const index = (
    <div style={instrumentSheetStyle}>
      <ColumnHead
        template={INDEX_GRID}
        cells={[
          { label: 'Vendor' },
          { label: isVa ? 'Acceptance' : 'Rating' },
          { label: 'Open' },
          { label: 'Status' },
          { label: '' },
        ]}
      />
      {groups.map((group) => (
        <div key={group.trade} role="list" aria-label={`${group.trade} vendors`}>
          <SectionBand
            title={group.trade}
            note={`${group.rows.length} ${group.rows.length === 1 ? 'vendor' : 'vendors'}`}
          />
          {group.rows.map((row) => (
            <VendorRow
              key={row.slug}
              row={row}
              testId={`vendor-dir-${row.slug}`}
              metric={
                isVa
                  ? {
                      text: acceptanceLabel(row.acceptanceRate),
                      ariaLabel:
                        row.acceptanceRate == null
                          ? 'acceptance not recorded'
                          : `${acceptanceLabel(row.acceptanceRate)} acceptance`,
                    }
                  : undefined
              }
            />
          ))}
        </div>
      ))}
    </div>
  );

  const rail = (
    <OfficeRail
      title="Coverage"
      note={
        isVa
          ? 'Recorded trades and open work orders.'
          : 'Which trades you can call on, and who is free to work.'
      }
    >
      <RailFigure label="Vendors on file" value={String(coverage.vendors)} headline />
      <RailFigure label="Trades covered" value={String(coverage.trades)} />
      <RailFigure
        label="Open work orders"
        value={String(coverage.open)}
        tone={coverage.open > 0 ? 'amber' : undefined}
      />
      <RailFigure
        label="Awaiting / reassign"
        value={String(coverage.attention)}
        tone={coverage.attention > 0 ? 'clay' : undefined}
      />
      <RailFigure
        label={isVa ? 'No open jobs' : 'Free to call'}
        value={String(coverage.available)}
        tone="green"
      />
    </OfficeRail>
  );

  return (
    <ListPageShell
      breadcrumb={[{ label: 'Portfolio', href: '/properties' }, { label: 'Vendors' }]}
      eyebrow="Trades index"
      title="Vendors"
      titleMeta={header.summary.split(' · ')}
      activeTab="vendors"
      audience={isVa ? 'va' : 'owner'}
      maxWidth={1160}
      background="var(--panel)"
    >
      <div data-testid="vendors-page">
        {rows.length === 0 ? (
          <div style={instrumentSheetStyle} role="list" aria-label="Vendors index">
            <div style={emptyStyle} role="listitem">
              {isVa ? VA_EMPTY_COPY : EMPTY_COPY}
            </div>
          </div>
        ) : (
          <WorkspaceGrid main={index} rail={rail} />
        )}

        <div style={{ marginTop: 20 }}>
          <AskOdesaBar
            scopeLabel="all vendors"
            placeholder="Ask Odesa about vendors…"
            prompts={askPrompts}
          />
        </div>
      </div>
    </ListPageShell>
  );
}

function acceptanceLabel(rate: number | null): string {
  return rate == null ? 'Unknown' : `${Math.round(rate * 100)}%`;
}
