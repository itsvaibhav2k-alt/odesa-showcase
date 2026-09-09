/**
 * Work order detail — `/work-orders/[woId]`.
 *
 * Drill-down page (NOT in the sidebar) for a single maintenance work order.
 * Transcribes `maintenance-ticket.html` faithfully into the warm `today-theme`
 * scope, reusing the shared property-detail component kit. Sections follow the
 * mockup order: title block, ticket status stepper, "What's happening" brief,
 * next-action callout, metrics strip, work-order timeline, owner approval,
 * a two-up vendor / access grid, tenant photos, sources, and the Ask-Odesa bar.
 *
 * Async server component, force-dynamic. Looks up the work order via the
 * real Supabase query `getWorkOrderDetail`; unknown or RLS-hidden ids fall
 * through to `notFound()`.
 */

import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';

import { getWorkOrderDetail } from '@/lib/work-orders/queries';
import { DetailGlobalBar } from '@/components/properties/detail/detail-global-bar';
import { DetailTitleBlock } from '@/components/properties/detail/detail-title-block';
import { StatusStepper } from '@/components/properties/detail/status-stepper';
import { AttentionBrief } from '@/components/properties/detail/attention-brief';
import { NextActionCallout } from '@/components/properties/detail/next-action-callout';
import { MetricsStrip } from '@/components/properties/detail/metrics-strip';
import { DetailSection } from '@/components/properties/detail/detail-section';
import { DetailPanel } from '@/components/properties/detail/detail-panel';
import { DetailTimeline } from '@/components/properties/detail/detail-timeline';
import { ApprovalBlock } from '@/components/properties/detail/approval-block';
import { CtxCard } from '@/components/properties/detail/ctx-card';
import { KvGrid } from '@/components/properties/detail/kv-grid';
import { SourcesList } from '@/components/properties/detail/sources-list';
import { AskOdesaBar } from '@/components/properties/detail/ask-odesa-bar';

import { EditableTicketControls } from './editable-ticket-controls';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface WorkOrderPageProps {
  params: Promise<{ woId: string }>;
}

const themeStyle: CSSProperties = {
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

const stepperSectionStyle: CSSProperties = {
  marginBottom: '26px',
  marginTop: '-8px',
};

const twoUpStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))',
  gap: '15px',
};

const photosStyle: CSSProperties = {
  display: 'flex',
  gap: '10px',
  flexWrap: 'wrap',
};

const photoStyle: CSSProperties = {
  width: '104px',
  height: '78px',
  borderRadius: '8px',
  border: '1px solid var(--hairline)',
  background: 'linear-gradient(135deg, var(--canvas-deep), var(--panel))',
  display: 'flex',
  alignItems: 'flex-end',
  padding: '7px',
};

const photoCaptionStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '9px',
  color: 'var(--ink-3)',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
};

export default async function WorkOrderPage({ params }: WorkOrderPageProps) {
  const { woId } = await params;
  const supabase = await createServerClient();
  const { data: currentRole } = await supabase.rpc('current_user_role');
  const isVa = currentRole === 'va';
  const wo = await getWorkOrderDetail(woId);

  if (!wo) {
    notFound();
  }

  // `propSlug` / `unitSlug` carry real UUIDs from the query; `meta` carries
  // the real property name + unit label for the breadcrumb. The query already
  // wires the vendor CtxCard's "View vendor" href to /vendors/<vendorId>, so
  // we render its actions as-is.
  const propertyHref = `/properties/${wo.propSlug}`;
  const unitHref = `/properties/${wo.propSlug}/units/${wo.unitSlug}`;
  const propertyName = wo.meta[0] ?? 'Property';
  const unitLabel = wo.meta[1] ?? 'Unit';
  const vendorActions = wo.vendor.actions;

  return (
    <div className="today-theme" style={themeStyle} data-testid="work-order-page" data-wo-id={woId}>
      <DetailGlobalBar
        crumbs={[
          { label: 'Portfolio' },
          { label: 'Properties', href: '/properties' },
          { label: propertyName, href: propertyHref },
          { label: unitLabel, href: unitHref },
          { label: woId },
        ]}
        freshnessText="Data current · refreshed on open"
      />

      <main style={contentStyle}>
        <div style={wrapStyle}>
          <DetailTitleBlock
            eyebrow="Maintenance ticket"
            title={wo.title}
            badge={wo.badge}
            meta={wo.meta}
          />

          <section aria-label="Ticket status" style={stepperSectionStyle}>
            <StatusStepper steps={wo.stepper} ariaLabel={wo.stepperAria} />
          </section>

          <section aria-label="What's happening" style={{ marginBottom: '26px' }}>
            <AttentionBrief
              heading="What’s happening"
              count={wo.attentionCount}
              rows={
                isVa
                  ? wo.attention.map((row) => ({ ...row, actions: [] }))
                  : wo.attention
              }
              odesaNote={wo.odesaNote}
            />
          </section>

          <NextActionCallout
            body={
              isVa
                ? 'Verify the known facts and prepare the owner handoff before any vendor-facing step.'
                : wo.nextAction.body
            }
          />

          <section aria-label="Ticket metrics" style={{ marginBottom: '26px' }}>
            <MetricsStrip cells={wo.metrics} />
          </section>

          {!isVa ? (
            <DetailSection
              label="Adjust"
              sub="Correct the priority or move the vendor lifecycle forward"
            >
              <DetailPanel>
                <EditableTicketControls
                  woId={woId}
                  urgency={wo.urgency ?? 'routine'}
                  status={wo.status ?? 'open'}
                  lifecycle={wo.lifecycle}
                />
              </DetailPanel>
            </DetailSection>
          ) : null}

          <DetailSection label="Work order timeline" sub={wo.timelineSub}>
            <DetailPanel>
              <DetailTimeline events={wo.timeline} />
            </DetailPanel>
          </DetailSection>

          <DetailSection label="Recorded outcome" sub={wo.approvalSub}>
            <ApprovalBlock cells={wo.approval} />
          </DetailSection>

          <div style={twoUpStyle} className="wo-two-up">
            <DetailSection label="Vendor">
              <DetailPanel>
                <CtxCard
                  avatar={wo.vendor.avatar}
                  name={wo.vendor.name}
                  pill={wo.vendor.pill}
                  sub={
                    isVa && wo.vendor.name === 'No vendor assigned'
                      ? 'No vendor assignment is recorded. Prepare the known facts for owner follow-up.'
                      : wo.vendor.sub
                  }
                  actions={
                    isVa
                      ? vendorActions.filter((action) =>
                          action.href?.startsWith('/vendors/'),
                        )
                      : vendorActions
                  }
                />
              </DetailPanel>
            </DetailSection>

            <DetailSection label="Access · mitigation">
              <DetailPanel>
                <KvGrid cells={wo.access} />
              </DetailPanel>
            </DetailSection>
          </div>

          <DetailSection label="Tenant photos" sub={`${wo.photos.length} attached`}>
            <DetailPanel>
              <ul
                style={{ ...photosStyle, listStyle: 'none', margin: 0, padding: 0 }}
                aria-label="Tenant-submitted photos"
              >
                {wo.photos.map((photo) => (
                  <li
                    key={photo.caption}
                    style={photoStyle}
                    aria-label={`Tenant photo: ${photo.caption}`}
                  >
                    <span style={photoCaptionStyle} aria-hidden="true">
                      {photo.caption}
                    </span>
                  </li>
                ))}
              </ul>
            </DetailPanel>
          </DetailSection>

          <DetailSection label="Sources · audit trail">
            <DetailPanel>
              <SourcesList items={wo.sources} />
            </DetailPanel>
          </DetailSection>

          <AskOdesaBar
            scopeLabel={wo.ask.contextLabel}
            placeholder={`Ask Odesa about ${wo.ask.subject}…`}
            prompts={
              isVa
                ? [
                    'Summarize this work order',
                    'What needs owner follow-up?',
                    'Draft an owner handoff',
                  ]
                : wo.ask.prompts
            }
          />
        </div>
      </main>

      <WorkOrderPageStyles />
    </div>
  );
}

function WorkOrderPageStyles() {
  return (
    <style precedence="work-order-page">{`
      @media (max-width: 680px) {
        [data-testid='work-order-page'] .wo-two-up {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}
