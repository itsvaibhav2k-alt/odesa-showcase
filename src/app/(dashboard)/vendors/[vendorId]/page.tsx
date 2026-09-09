/**
 * Vendor brief — `/vendors/[vendorId]`.
 *
 * Drill-down detail page reproduced faithfully from the approved
 * `vendor-detail.html` mockup. Reached from the `/vendors` directory; each
 * work-order row drills into `/work-orders/<woId>`.
 *
 * Composition (mockup order):
 *   global bar (breadcrumb Portfolio / Vendors / <name>)
 *   title block (eyebrow "Vendor brief" + status badge + meta)
 *   "What's active" operating brief (active rows + Odesa note)
 *   metrics strip (5)
 *   "Work orders" panel (overlay-link rows -> /work-orders/<woId>)
 *   two-up: Contact · terms (KV) | Sources
 *   Ask Odesa bar
 *
 * Server component (force-dynamic). Content wrapped in `.today-theme` so the
 * mockup tokens resolve 1:1 to today-theme vars.
 */

import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';

import type {
  VendorActiveRow,
  VendorDetailMock,
} from '@/lib/properties/mock-portfolio-views';
import type { AttentionItem, BadgeVariant, Tone } from '@/lib/properties/mock-detail';
import { getVendorDetail } from '@/lib/vendors/queries';
import { DetailGlobalBar } from '@/components/properties/detail/detail-global-bar';
import { DetailTitleBlock } from '@/components/properties/detail/detail-title-block';
import { AttentionBrief } from '@/components/properties/detail/attention-brief';
import { MetricsStrip } from '@/components/properties/detail/metrics-strip';
import { DetailSection } from '@/components/properties/detail/detail-section';
import { DetailPanel } from '@/components/properties/detail/detail-panel';
import { KvGrid } from '@/components/properties/detail/kv-grid';
import { SourcesList } from '@/components/properties/detail/sources-list';
import { AskOdesaBar } from '@/components/properties/detail/ask-odesa-bar';
import { createServerClient } from '@/lib/supabase/server';

import { VendorWorkOrderList } from './vendor-work-order-list';

export const dynamic = 'force-dynamic';

interface VendorDetailPageProps {
  params: Promise<{ vendorId: string }>;
}

const pageStyle: CSSProperties = {
  background: 'var(--panel-clean)',
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
};

const contentStyle: CSSProperties = {
  background: 'var(--panel-clean)',
  flex: 1,
  padding: '28px 0 30px',
};

const wrapStyle: CSSProperties = {
  maxWidth: '1000px',
  margin: '0 auto',
  padding: '0 36px',
};

const twoUpStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))',
  gap: '15px',
};

/** Title status badge variant from the directory pill variant. */
function titleBadgeVariant(vendor: VendorDetailMock): BadgeVariant {
  return vendor.statusPill.variant === 'switch' ? 'watching' : 'current';
}

/** Map a "What's active" row to an AttentionItem for the shared brief panel. */
function toAttentionItem(
  row: VendorActiveRow,
  idx: number,
  vendor: VendorDetailMock,
): AttentionItem {
  // First row tracks the live thread (clay when switching/overdue, else amber);
  // subsequent rows are the steady "reliability" line (green).
  const dot: Tone =
    idx === 0 ? (vendor.statusPill.variant === 'switch' ? 'clay' : 'amber') : 'green';
  return {
    dot,
    kind: row.kind,
    detail: row.detail,
    ariaLabel: `${row.kind}. ${row.detail}`,
    actions: [row.action],
  };
}

export default async function VendorDetailPage({ params }: VendorDetailPageProps) {
  const { vendorId } = await params;
  const supabase = await createServerClient();
  const [vendor, { data: currentRole }] = await Promise.all([
    getVendorDetail(vendorId),
    supabase.rpc('current_user_role'),
  ]);
  const isVa = currentRole === 'va';

  if (!vendor) {
    notFound();
  }

  const crumbs = [
    { label: 'Portfolio', href: '/properties' },
    { label: 'Vendors', href: '/vendors' },
    { label: vendor.name },
  ];

  const totalJobs = vendor.workOrders.length;
  const openJobs = vendor.workOrders.filter((workOrder) => !workOrder.calm).length;
  const acceptance =
    vendor.acceptanceRate == null
      ? 'not recorded'
      : `${Math.round(vendor.acceptanceRate * 100)}%`;
  const vaActive = [
    ...vendor.active.filter(
      (row) => row.kind !== 'Reliability' && row.kind !== 'No open jobs',
    ),
    {
      index: String(openJobs > 0 ? 2 : 1),
      kind: 'Acceptance record',
      detail:
        vendor.acceptanceRate == null
          ? `No acceptance rate is recorded across ${totalJobs} ${totalJobs === 1 ? 'job' : 'jobs'}.`
          : `${acceptance} acceptance across ${totalJobs} ${totalJobs === 1 ? 'job' : 'jobs'}.`,
      action: {
        label: 'View history',
        variant: 'default' as const,
        href: '#vendor-work-orders',
      },
    },
  ];
  const activeRows = (isVa ? vaActive : vendor.active).map((row, idx) =>
    toAttentionItem(row, idx, vendor),
  );
  const vaMetrics = [
    vendor.metrics.find((metric) => metric.label === 'Jobs')!,
    { label: 'Acceptance', value: acceptance === 'not recorded' ? 'Unknown' : acceptance },
    vendor.metrics.find((metric) => metric.label === 'Open WOs')!,
  ];

  return (
    <div
      data-testid="vendor-detail-page"
      data-vendor-slug={vendor.slug}
      className="today-theme"
      style={pageStyle}
    >
      <DetailGlobalBar
        crumbs={crumbs}
        freshnessText="Data current · refreshed on open"
      />

      {/* Labeled region, not <main> — the dashboard layout owns the sole main landmark. */}
      <section aria-label="Vendor brief" style={contentStyle}>
        <div style={wrapStyle}>
          <DetailTitleBlock
            eyebrow="Vendor brief"
            title={vendor.name}
            badge={{ variant: titleBadgeVariant(vendor), label: vendor.statusPill.label }}
            meta={
              isVa
                ? [
                    ...vendor.meta.filter((item) => !item.endsWith('★')),
                    `Acceptance ${acceptance}`,
                  ]
                : vendor.meta
            }
          />

          <DetailSection>
            <AttentionBrief
              heading="What’s active"
              count={isVa ? `${openJobs} open · recorded context` : vendor.activeSub}
              rows={activeRows}
              odesaNote={
                isVa
                  ? {
                      body: `${vendor.name} has ${openJobs} open work ${openJobs === 1 ? 'order' : 'orders'}. Acceptance is ${acceptance} across ${totalJobs} recorded ${totalJobs === 1 ? 'job' : 'jobs'}.`,
                      basedOn: 'work order log · vendor record',
                    }
                  : vendor.odesaNote
              }
            />
          </DetailSection>

          <DetailSection>
            <MetricsStrip cells={isVa ? vaMetrics : vendor.metrics} />
          </DetailSection>

          <div id="vendor-work-orders">
            <DetailSection label="Work orders" sub={vendor.workOrdersSub}>
              <DetailPanel>
                <VendorWorkOrderList items={vendor.workOrders} />
              </DetailPanel>
            </DetailSection>
          </div>

          <div style={twoUpStyle}>
            <DetailSection label="Contact · terms">
              <DetailPanel>
                <KvGrid cells={vendor.contact} />
              </DetailPanel>
            </DetailSection>

            <DetailSection label="Sources">
              <DetailPanel>
                <SourcesList items={vendor.sources} />
              </DetailPanel>
            </DetailSection>
          </div>

          <AskOdesaBar
            scopeLabel={vendor.ask.contextLabel}
            placeholder={`Ask Odesa about ${vendor.ask.subject}…`}
            prompts={
              isVa
                ? [
                    'Show past jobs',
                    'Check open work orders',
                    'Summarize this vendor record',
                    'Draft an owner handoff',
                  ]
                : vendor.ask.prompts
            }
          />
        </div>
      </section>

      <VendorDetailFocusStyles />
    </div>
  );
}

function VendorDetailFocusStyles() {
  return (
    <style precedence="vendor-detail">{`
      .today-theme *:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
        border-radius: 3px;
      }
    `}</style>
  );
}
