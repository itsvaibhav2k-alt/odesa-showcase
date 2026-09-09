/**
 * /rent — current-month rent ledger (portfolio list view).
 *
 * Reached from the sidebar / command-center tab bar. Each ledger row drills
 * into the matching unit detail page via `unitHref(propSlug, unitSlug)`.
 *
 * Layout:
 *   ListPageShell       -> breadcrumb, period title, month/export controls
 *   RentStatementHeader -> six live metrics + account-status distribution
 *   RentLedger          -> searchable account table + collection context rail
 *
 * Server component (force-dynamic): the current ledger and confirmed payment
 * timestamps ship once; the client ledger owns filters and row interactions.
 */

import { AccountantPageFrame } from '@/components/accounting/page-frame';
import { AccountantRentRegister } from '@/components/accounting/accountant-rent';
import { AccountantUnavailableState } from '@/components/accounting/unavailable-state';
import { ListPageShell } from '@/components/properties/list/list-page-shell';
import type {
  RentFacetId,
  RentSummary,
} from '@/lib/properties/mock-portfolio-views';
import { listRecentRentPayments, listRentLedger } from '@/lib/rent/queries';
import { RentLedger } from './rent-ledger';
import { RentHeaderActions } from './rent-header-actions';
import { RentStatementHeader } from './rent-statement-header';
import { createServerClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import {
  resolveAccountantRouteDecision,
  type AccountantRawSearch,
} from '@/lib/accounting/canonical-search';
import {
  loadAccountantRentLedger,
  type AccountantProjectionClient,
} from '@/lib/accounting/repository';
import {
  buildRentRegisterParams,
  normalizeRentRegister,
  type AccountantRegisterSearchInput,
} from '@/lib/accounting/register-state';
import { normalizeAccountantCycle } from '@/lib/accounting/view-state';
import { requireAccessContext } from '@/lib/authz/context';

export const dynamic = 'force-dynamic';

const RENT_FACET_IDS: readonly RentFacetId[] = ['all', 'paid', 'outstanding', 'on-plan'];

/**
 * Normalize `?cycle=` to the 'YYYY-MM-01' shape `listRentLedger` expects.
 * Accepts 'YYYY-MM' (drilldown links) or 'YYYY-MM-01'; anything else →
 * undefined (the query falls back to the current month).
 */
function normalizeCycleParam(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}-\d{2}-01$/.test(raw)) return raw;
  return undefined;
}

/** Validate `?filter=` against the ledger facet ids; invalid → undefined. */
function normalizeFilterParam(raw: string | undefined): RentFacetId | undefined {
  return RENT_FACET_IDS.find((id) => id === raw);
}

function currentCycleValue(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function formatMoneyCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function titleMeta(summary: RentSummary): string[] {
  if (!summary.facts) return summary.summary.split(' · ');
  const facts = summary.facts;
  return [
    `${formatMoneyCents(facts.billedCents)} billed`,
    `${formatMoneyCents(facts.collectedCents)} collected`,
    `${formatMoneyCents(facts.outstandingCents)} outstanding`,
    `${facts.lateCount} overdue`,
    `${facts.onPlanCount} on plan`,
  ];
}

interface RentPageProps {
  // Param contract: `?cycle=YYYY-MM` (or YYYY-MM-01) selects the ledger
  // month; `?filter=` pre-selects a facet. Invalid values fall back to the
  // current month / 'all' — drilldown links from /financials rely on both.
  searchParams: Promise<
    AccountantRawSearch & AccountantRegisterSearchInput & { filter?: string }
  >;
}

export default async function RentPage({ searchParams }: RentPageProps) {
  const supabase = await createServerClient();
  const access = await requireAccessContext({ auth: supabase, db: supabase });
  if (!access.ok) notFound();
  const params = await searchParams;
  if (access.context.role === 'accountant') {
    const now = new Date();
    const cycleMonth = normalizeAccountantCycle(params.cycle, now);
    let model: Awaited<ReturnType<typeof loadAccountantRentLedger>>;
    try {
      model = await loadAccountantRentLedger(
        supabase as unknown as AccountantProjectionClient,
        { cycleMonth, capabilities: access.context.capabilities },
      );
    } catch {
      if (params.property !== undefined) notFound();
      return (
        <AccountantPageFrame
          eyebrow="Rent evidence"
          title="Scoped rent register"
          subtitle="Canonical rent obligations are temporarily unavailable; no amount has been inferred."
        >
          <AccountantUnavailableState label="Rent evidence is unavailable" />
        </AccountantPageFrame>
      );
    }
    const register = normalizeRentRegister(
      params,
      model.rows,
      now,
      40,
      new Set(model.properties.map((property) => property.propertyId)),
    );
    const decision = resolveAccountantRouteDecision(
      '/rent',
      params,
      buildRentRegisterParams(register.state),
      register.unknownPropertyRequested,
    );
    if (decision.kind === 'not_found') notFound();
    if (decision.kind === 'redirect') redirect(decision.href);

    return (
      <AccountantPageFrame
        eyebrow="Rent evidence"
        title="Scoped rent register"
        subtitle="Review finite canonical rent rows and discrepancies. Recording payments, waivers, and lease changes remain unavailable."
        periodLabel={model.periodLabel}
      >
        <AccountantRentRegister model={model} register={register} />
      </AccountantPageFrame>
    );
  }
  if (access.context.role === 'va') redirect('/escalations');

  const cycleIso = normalizeCycleParam(
    Array.isArray(params.cycle) ? params.cycle[0] : params.cycle,
  );
  const initialFacet = normalizeFilterParam(params.filter);
  const [{ summary, facets, rows }, recentPayments] = await Promise.all([
    listRentLedger(cycleIso),
    listRecentRentPayments(3),
  ]);
  const cycleValue = cycleIso?.slice(0, 7) ?? currentCycleValue();

  return (
    <ListPageShell
      breadcrumb={[{ label: 'Portfolio', href: '/properties' }, { label: 'Rent' }]}
      eyebrow="Collection ledger"
      title={`Rent · ${summary.period}`}
      titleMeta={titleMeta(summary)}
      activeTab="rent"
      titleAction={
        <RentHeaderActions
          cycleValue={cycleValue}
          period={summary.period}
          rows={rows}
        />
      }
      maxWidth={1280}
      background="var(--panel)"
    >
      <div data-testid="rent-page">
        <RentStatementHeader summary={summary} facets={facets} rows={rows} />

        <RentLedger
          facets={facets}
          rows={rows}
          summary={summary}
          recentPayments={recentPayments}
          canUseAssistant={access.context.role === 'owner'}
          {...(initialFacet ? { initialFacet } : {})}
        />
      </div>
    </ListPageShell>
  );
}
