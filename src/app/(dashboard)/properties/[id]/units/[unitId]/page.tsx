/**
 * Unit detail — `/properties/[id]/units/[unitId]`.
 *
 * Faithful React reproduction of the locked `unit-detail.html` mockup. Renders
 * the unit brief stack for a single unit inside the warm `.today-theme` scope:
 *
 *   DetailGlobalBar (breadcrumb + freshness)
 *   Title block (Unit brief eyebrow · serif title · Watching badge · meta)
 *   AttentionBrief (what needs attention + Odesa note)
 *   NextActionCallout
 *   MetricsStrip (5 cells)
 *   Tenant CtxCard
 *   two-up [ Rent · <Mon> KvGrid | Lease KvGrid ]
 *   AppliancesRegistry (flagged water-heater row links to WO-1031)
 *   Maintenance TicketList + RequestModal trigger ("File a request")
 *   Collapse "Unit details" (Access · utilities + Specs · safety KvGrids)
 *   SourcesList
 *   AskOdesaBar
 *
 * Data comes from real Supabase rows via `getUnitBrief(unitId)` (which maps
 * the live unit/lease/tenant/rent/appliances/work-order data into the same
 * `UnitDetailMock` shape this page renders). The `[unitId]` route segment is
 * a `units.id` UUID; an unknown / cross-org id resolves to `null` (RLS) and
 * renders 404.
 */

import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';

import { propertyHref } from '@/lib/properties/hrefs';
import { getUnitBrief } from '@/lib/properties/unit-detail-queries';
import { DetailGlobalBar } from '@/components/properties/detail/detail-global-bar';
import { DetailTitleBlock } from '@/components/properties/detail/detail-title-block';
import { AttentionBrief } from '@/components/properties/detail/attention-brief';
import { NextActionCallout } from '@/components/properties/detail/next-action-callout';
import { MetricsStrip } from '@/components/properties/detail/metrics-strip';
import { DetailSection } from '@/components/properties/detail/detail-section';
import { DetailPanel } from '@/components/properties/detail/detail-panel';
import { CtxCard } from '@/components/properties/detail/ctx-card';
import { KvGrid } from '@/components/properties/detail/kv-grid';
import { AppliancesRegistry } from '@/components/properties/detail/appliances-registry';
import { TicketList } from '@/components/properties/detail/ticket-list';
import { RequestModal } from '@/components/properties/detail/request-modal';
import { Collapse } from '@/components/properties/detail/collapse';
import { SourcesList } from '@/components/properties/detail/sources-list';
import { AskOdesaBar } from '@/components/properties/detail/ask-odesa-bar';
import { RecordPaymentModal } from '@/components/rent/record-payment-modal';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface UnitDetailPageProps {
  params: Promise<{ id: string; unitId: string }>;
}

const themeStyle: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--canvas)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-sans-operator)',
};

const contentStyle: CSSProperties = {
  background: 'var(--panel-clean)',
  padding: '28px 0 30px',
};

const wrapStyle: CSSProperties = {
  maxWidth: 1000,
  margin: '0 auto',
  padding: '0 36px',
};

const twoUpStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))',
  gap: 15,
};

export default async function UnitDetailPage({ params }: UnitDetailPageProps) {
  const { id, unitId } = await params;
  const supabase = await createServerClient();
  const { data: currentRole } = await supabase.rpc('current_user_role');
  const isVa = currentRole === 'va';
  const isOwner = currentRole === 'owner';

  const unit = await getUnitBrief(unitId);

  if (!unit) {
    notFound();
  }

  // The unit's active tenant id is carried on the tenant card's "View tenant"
  // link (`/tenants/<id>`); absent when the unit is vacant. We never surface
  // this UUID to the model — it only feeds the work-order DB write.
  const tenantViewHref = unit.tenant.actions.find((action) =>
    action.href?.startsWith('/tenants/'),
  )?.href;
  const requestTenantId = tenantViewHref
    ? tenantViewHref.slice('/tenants/'.length) || null
    : null;

  // Subtitle for the request modal: unit label + property name (meta[0]).
  const requestContextLabel = [unit.label, unit.meta[0]]
    .filter(Boolean)
    .join(' · ');

  // Related-appliance choices, mirroring the registry rows ("Name · Model").
  const requestApplianceOptions = unit.appliances.map(
    (appliance) => `${appliance.name} · ${appliance.model}`,
  );

  // Rent section label: short month from the ledger's "Cycle" cell ("Jun 2026"
  // form). Falls back to plain "Rent" when there is no parsable cycle (vacant
  // unit / no rent activity).
  const rentCycle = unit.rent.find((cell) => cell.k === 'Cycle')?.v;
  const rentSectionLabel =
    rentCycle && /^[A-Z][a-z]{2} \d{4}$/.test(rentCycle)
      ? `Rent · ${rentCycle.split(' ')[0]}`
      : 'Rent';

  // Record-payment context (clarity-only): tenant, "property · unit", and the
  // rent cycle, all reused from values already resolved above. Each falls back
  // to undefined so absent values render no context block in the modal.
  const recordPaymentTenantName = unit.tenant.name || undefined;
  const recordPaymentUnitLabel =
    [unit.meta[0], unit.label].filter(Boolean).join(' · ') || undefined;
  const recordPaymentCycleLabel =
    rentCycle && /^[A-Z][a-z]{2} \d{4}$/.test(rentCycle) ? rentCycle : undefined;
  const odesaNote =
    isVa && unit.odesaNote.body.includes('Finish lease terms')
      ? {
          ...unit.odesaNote,
          body: unit.odesaNote.body.replace(
            'Finish lease terms to complete the setup.',
            'Owner approval is required to complete the setup.',
          ),
        }
      : unit.odesaNote;

  return (
    <div
      className="today-theme"
      style={themeStyle}
      data-testid="unit-detail-page"
      data-unit-slug={unit.unitSlug}
    >
      <PageFocusStyles />

      <DetailGlobalBar
        crumbs={[
          { label: 'Portfolio' },
          { label: 'Properties', href: '/properties' },
          { label: unit.meta[0] ?? id, href: propertyHref(id) },
          { label: unit.label },
        ]}
        freshnessText="Data current · refreshed on open"
      />

      <main style={contentStyle}>
        <div style={wrapStyle}>
          <DetailTitleBlock
            eyebrow="Unit brief"
            title={unit.label}
            badge={unit.badge}
            meta={unit.meta}
          />

          <DetailSection label={undefined}>
            <AttentionBrief
              heading="What needs attention"
              count={unit.attentionCount}
              rows={
                isVa
                  ? unit.attention.map((row) => ({ ...row, actions: [] }))
                  : unit.attention
              }
              odesaNote={odesaNote}
            />
          </DetailSection>

          {unit.nextAction && (
            <NextActionCallout
              body={
                isVa
                  ? 'Review the unit record and prepare any needed owner handoff.'
                  : unit.nextAction.body
              }
            />
          )}

          <DetailSection>
            <MetricsStrip cells={unit.metrics} />
          </DetailSection>

          <DetailSection label="Tenant">
            <DetailPanel>
              <CtxCard
                avatar={unit.tenant.avatar}
                name={unit.tenant.name}
                pill={unit.tenant.pill}
                sub={unit.tenant.sub}
                actions={(isVa
                  ? unit.tenant.actions.filter((action) =>
                      action.href?.startsWith('/tenants/'),
                    )
                  : unit.tenant.actions
                ).map((action) =>
                  action.href
                    ? {
                        ...action,
                        // Unique, stable per-action testids: the "View
                        // tenant" navigation link (the only /tenants/ href)
                        // keeps `unit-tenant-link`; any other href action
                        // (e.g. "Draft reminder") gets a distinct id so no
                        // two nodes ever share one testid.
                        'data-testid': action.href.startsWith('/tenants/')
                          ? 'unit-tenant-link'
                          : 'unit-tenant-reminder',
                      }
                    : action,
                )}
              />
            </DetailPanel>
          </DetailSection>

          {/* id="rent" anchors the focused-ledger "Review ledger" actions
              (tenant + unit attention) to this unit's rent section. */}
          <div id="rent" style={twoUpStyle} className="unit-two-up">
            <DetailSection
              label={rentSectionLabel}
              action={
                !isVa &&
                (unit.outstandingDollars ?? 0) > 0 &&
                unit.rentEventId &&
                unit.leaseId ? (
                  <RecordPaymentModal
                    rentEventId={unit.rentEventId}
                    leaseId={unit.leaseId}
                    outstandingDollars={unit.outstandingDollars ?? 0}
                    tenantName={recordPaymentTenantName}
                    unitLabel={recordPaymentUnitLabel}
                    cycleLabel={recordPaymentCycleLabel}
                  />
                ) : undefined
              }
            >
              <DetailPanel>
                <KvGrid cells={unit.rent} />
              </DetailPanel>
            </DetailSection>

            <DetailSection label="Lease">
              <DetailPanel>
                <KvGrid cells={unit.lease} />
              </DetailPanel>
            </DetailSection>
          </div>

          <DetailSection label="Appliances" sub={unit.appliancesSub}>
            <AppliancesRegistry rows={unit.appliances} />
          </DetailSection>

          <DetailSection
            label="Maintenance"
            sub={unit.maintenanceSub}
            action={
              isVa ? undefined : (
              <RequestModal
                unitId={unitId}
                tenantId={requestTenantId}
                contextLabel={requestContextLabel}
                applianceOptions={requestApplianceOptions}
              />
              )
            }
          >
            <DetailPanel>
              <TicketList items={unit.maintenance} />
            </DetailPanel>
          </DetailSection>

          <DetailSection>
            <Collapse
              label="Unit details"
              sub="Access, utilities, specs & safety"
            >
              <div style={twoUpStyle} className="unit-two-up">
                <DetailSection label="Access · utilities">
                  <DetailPanel variant="clean">
                    <KvGrid cells={unit.access} />
                  </DetailPanel>
                </DetailSection>

                <DetailSection label="Specs · safety">
                  <DetailPanel variant="clean">
                    <KvGrid cells={unit.specs} />
                  </DetailPanel>
                </DetailSection>
              </div>
            </Collapse>
          </DetailSection>

          <DetailSection label="Sources · audit trail">
            <DetailPanel>
              <SourcesList items={unit.sources} />
            </DetailPanel>
          </DetailSection>

          {isOwner ? (
            <AskOdesaBar
              scopeLabel={unit.ask.contextLabel}
              placeholder={`Ask about ${unit.ask.subject}…`}
              prompts={unit.ask.prompts}
              submitLabel="Ask Odesa about this unit"
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

function PageFocusStyles() {
  return (
    <style precedence="unit-detail-page">{`
      .today-theme *:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }
      @media (max-width: 1000px) {
        .unit-two-up { grid-template-columns: 1fr; }
      }
      @media (max-width: 680px) {
        [data-testid='unit-detail-page'] main > div { padding: 0 18px; }
      }
    `}</style>
  );
}
