/**
 * Tenant brief — `/tenants/[tenantId]`.
 *
 * Drill-down detail page reproduced verbatim from the approved
 * `tenant-detail.html` mockup. NOT added to the sidebar — reached only by
 * drilling in from a property/unit brief.
 *
 * Composition (mockup order):
 *   global bar (breadcrumb + freshness)
 *   title block (badge + meta)
 *   "What matters with Maya" attention brief
 *   metrics strip (5)
 *   "Payment timeline"
 *   two-up: Communication (thread + draft + actions) | Lease & rules
 *   two-up: Related property and unit | Sources
 *   Ask Odesa bar
 *
 * Server component (force-dynamic). Content is wrapped in the warm
 * `.today-theme` scope so the mockup tokens resolve 1:1 to today-theme vars.
 */

import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';

import { propertyHref, unitHref } from '@/lib/properties/hrefs';
import type { ActionLink } from '@/lib/properties/mock-detail';
import { getTenantDetail } from '@/lib/tenants/queries';
import { ComposeMessageModal } from '@/components/inbox/compose-message-modal';
import { RecordPaymentModal } from '@/components/rent/record-payment-modal';
import { DetailGlobalBar } from '@/components/properties/detail/detail-global-bar';
import { DetailTitleBlock } from '@/components/properties/detail/detail-title-block';
import { AttentionBrief } from '@/components/properties/detail/attention-brief';
import { MetricsStrip } from '@/components/properties/detail/metrics-strip';
import { DetailSection } from '@/components/properties/detail/detail-section';
import { DetailPanel } from '@/components/properties/detail/detail-panel';
import { DetailTimeline } from '@/components/properties/detail/detail-timeline';
import { MessageThread } from '@/components/properties/detail/message-thread';
import { KvGrid } from '@/components/properties/detail/kv-grid';
import { SourcesList } from '@/components/properties/detail/sources-list';
import { AskOdesaBar } from '@/components/properties/detail/ask-odesa-bar';
import { DetailButton } from '@/components/properties/detail/detail-button';
import { createServerClient } from '@/lib/supabase/server';

import { TenantRelatedCard } from './tenant-related-card';

export const dynamic = 'force-dynamic';

interface TenantDetailPageProps {
  params: Promise<{ tenantId: string }>;
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

const threadActionsStyle: CSSProperties = {
  marginTop: '12px',
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
};

export default async function TenantDetailPage({ params }: TenantDetailPageProps) {
  const { tenantId } = await params;
  const supabase = await createServerClient();
  const { data: currentRole } = await supabase.rpc('current_user_role');
  const isVa = currentRole === 'va';
  // `tenantId` is a real tenant UUID; the query returns null when the row is
  // missing or RLS hides it (other orgs) — render the 404 in that case.
  const tenant = await getTenantDetail(tenantId);

  if (!tenant) {
    notFound();
  }

  const propLink = propertyHref(tenant.propSlug);
  const unitLink = unitHref(tenant.propSlug, tenant.unitSlug);

  const crumbs = [
    { label: 'Portfolio' },
    { label: 'Properties', href: '/properties' },
    { label: tenant.meta[0] ?? tenant.propSlug, href: propLink },
    { label: tenant.meta[1] ?? tenant.unitSlug, href: unitLink },
    { label: tenant.name },
  ];

  return (
    <div
      data-testid="tenant-detail-page"
      data-tenant-slug={tenant.slug}
      className="today-theme"
      style={pageStyle}
    >
      <DetailGlobalBar
        crumbs={crumbs}
        freshnessText="Data current · refreshed on open"
      />

      <main style={contentStyle}>
        <div style={wrapStyle}>
          <DetailTitleBlock
            eyebrow="Tenant brief"
            title={tenant.name}
            badge={tenant.badge}
            meta={tenant.meta}
          />

          <DetailSection>
            <AttentionBrief
              heading={tenant.attentionLabel}
              count={tenant.attentionCount}
              rows={
                isVa
                  ? tenant.attention.map((row) => ({ ...row, actions: [] }))
                  : tenant.attention
              }
              odesaNote={tenant.odesaNote}
            />
          </DetailSection>

          <DetailSection>
            <MetricsStrip cells={tenant.metrics} />
          </DetailSection>

          <DetailSection label="Payment timeline" sub={tenant.timelineSub}>
            <DetailPanel>
              <DetailTimeline events={tenant.timeline} />
            </DetailPanel>
          </DetailSection>

          <div style={twoUpStyle}>
            <DetailSection label="Communication">
              <DetailPanel>
                <MessageThread messages={tenant.thread} />
                <div style={threadActionsStyle}>
                  {!isVa ? (
                    <ComposeMessageModal
                      tenants={[{ id: tenantId, name: tenant.name }]}
                      initialTenantId={tenantId}
                      triggerLabel='Message'
                    />
                  ) : null}
                  {!isVa && tenant.rentEventId &&
                  tenant.leaseId &&
                  (tenant.outstandingDollars ?? 0) > 0 ? (
                    <RecordPaymentModal
                      rentEventId={tenant.rentEventId}
                      leaseId={tenant.leaseId}
                      outstandingDollars={tenant.outstandingDollars ?? 0}
                      tenantName={tenant.name}
                      unitLabel={`${tenant.meta[0]} · ${tenant.meta[1]}`}
                      cycleLabel={tenant.timelineSub}
                    />
                  ) : null}
                  {!isVa
                    ? tenant.threadActions.map((action: ActionLink) => (
                    <DetailButton
                      key={action.label}
                      variant={action.variant}
                      href={action.href}
                    >
                      {action.label}
                    </DetailButton>
                      ))
                    : null}
                  {isVa ? (
                    <span
                      data-testid="tenant-va-boundary"
                      className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground"
                    >
                      View context · owner sends and records payments
                    </span>
                  ) : null}
                </div>
              </DetailPanel>
            </DetailSection>

            <DetailSection label="Lease · rules">
              <DetailPanel>
                <KvGrid cells={tenant.leaseRules} />
              </DetailPanel>
            </DetailSection>
          </div>

          <div style={twoUpStyle}>
            <DetailSection label="Related">
              <DetailPanel>
                <TenantRelatedCard
                  card={tenant.related}
                  propertyHref={propLink}
                  unitHref={unitLink}
                />
              </DetailPanel>
            </DetailSection>

            <DetailSection label="Sources">
              <DetailPanel>
                <SourcesList items={tenant.sources} />
              </DetailPanel>
            </DetailSection>
          </div>

          <AskOdesaBar
            scopeLabel={tenant.ask.contextLabel}
            placeholder={`Ask Odesa about ${tenant.ask.subject}…`}
            prompts={
              isVa
                ? [
                    'Summarize this tenant record',
                    'What needs owner follow-up?',
                    'Draft an owner handoff',
                  ]
                : tenant.ask.prompts
            }
          />
        </div>
      </main>

      <TenantDetailFocusStyles />
    </div>
  );
}

function TenantDetailFocusStyles() {
  return (
    <style precedence="tenant-detail">{`
      .today-theme *:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
        border-radius: 3px;
      }
    `}</style>
  );
}
