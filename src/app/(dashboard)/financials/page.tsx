/**
 * /financials — the portfolio Financial Command Center.
 *
 * Async server component (force-dynamic). The outer page awaits ONLY the
 * `?period=` search param (mtd | last | qtd | ytd, invalid → mtd) and
 * renders the ListPageShell chrome synchronously with a static period
 * meta line. The expensive data fetch lives in an inner async component
 * wrapped in `<Suspense key={periodKey}>` — App Router does NOT re-show
 * `loading.tsx` for same-segment searchParams navigations (period chips),
 * so without this boundary a chip click could never commit until the full
 * RSC payload resolved, hanging `?period=last` navs indefinitely.
 *
 * Layout mirrors `/rent`: ListPageShell chrome (breadcrumb, serif title,
 * mono meta line) wrapping page-specific content. No tab is highlighted —
 * Financials sits in the sidebar's Portfolio group, not the list tab bar.
 *
 * Honest-data invariant: rent / collection figures are real integer
 * cents; maintenance / vendor spend and NOI are NOT fabricated. No money
 * is moved — every action is draft / queue / review.
 */

import { Suspense } from 'react';

import { AccountantFinancialRegister } from '@/components/accounting/accountant-financials';
import { AccountantPageFrame } from '@/components/accounting/page-frame';
import { AccountantUnavailableState } from '@/components/accounting/unavailable-state';
import { CardSkeleton, StatSkeleton } from '@/components/shared';
import { ListPageShell } from '@/components/properties/list/list-page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { FinancialCommandCenter } from '@/components/financials/financial-command-center';
import { getFinancialsConsole } from '@/lib/financials/queries';
import { parsePeriodKey, type PeriodKey } from '@/lib/financials/trend';
import { getReliabilityStatus } from '@/lib/reliability/queries';
import { createServerClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import {
  resolveAccountantRouteDecision,
  type AccountantRawSearch,
} from '@/lib/accounting/canonical-search';
import {
  loadAccountantFinancials,
  type AccountantProjectionClient,
} from '@/lib/accounting/repository';
import {
  buildFinancialRegisterParams,
  normalizeFinancialRegister,
} from '@/lib/accounting/register-state';
import { normalizeAccountantCycle } from '@/lib/accounting/view-state';
import { requireAccessContext } from '@/lib/authz/context';

export const dynamic = 'force-dynamic';

/** Static period labels — the shell meta must not depend on fetched data. */
const PERIOD_META: Record<PeriodKey, string> = {
  mtd: 'Month to date',
  last: 'Last month',
  qtd: 'Quarter to date',
  ytd: 'Year to date',
};

interface FinancialsPageProps {
  // Param contract: `?period=` selects the reporting window (mtd | last |
  // qtd | ytd). Invalid values fall back to 'mtd' — the period chips in
  // the collection hero rely on this.
  searchParams: Promise<AccountantRawSearch>;
}

/** Streamed Suspense fallback — body-only, the shell chrome stays put. */
function FinancialsBodySkeleton() {
  return (
    <div data-testid="financials-body-skeleton">
      {/* Collection hero + period chips */}
      <CardSkeleton />
      <div className="mt-4 flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-7 w-24 rounded-full" />
        ))}
      </div>

      {/* KPI row */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <StatSkeleton key={index} />
        ))}
      </div>

      {/* Flagship + lists */}
      <div className="mt-6 rounded-xl border p-4">
        <Skeleton className="h-40 w-full" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4">
        {Array.from({ length: 2 }).map((_, index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}

/** Inner async body — the ONLY place the slow console queries are awaited. */
async function FinancialsBody({ periodKey }: { periodKey: PeriodKey }) {
  const [financialsConsole, reliability] = await Promise.all([
    getFinancialsConsole(periodKey),
    getReliabilityStatus(),
  ]);
  return <FinancialCommandCenter console={financialsConsole} reliability={reliability} />;
}

export default async function FinancialsPage({
  searchParams,
}: FinancialsPageProps): Promise<React.JSX.Element> {
  const supabase = await createServerClient();
  const access = await requireAccessContext({ auth: supabase, db: supabase });
  if (!access.ok) notFound();
  const raw = await searchParams;
  const rawPeriod = Array.isArray(raw.period) ? raw.period[0] : raw.period;
  const periodKey = parsePeriodKey(rawPeriod);
  if (access.context.role === 'accountant') {
    const currentCycleMonth = normalizeAccountantCycle(undefined, new Date());
    let model: Awaited<ReturnType<typeof loadAccountantFinancials>>;
    try {
      model = await loadAccountantFinancials(
        supabase as unknown as AccountantProjectionClient,
        {
          periodKey,
          currentCycleMonth,
          capabilities: access.context.capabilities,
        },
      );
    } catch {
      if (raw.property !== undefined) notFound();
      return (
        <AccountantPageFrame
          eyebrow="Payment evidence"
          title="Financial evidence register"
          subtitle="Expense imports and the authorized payment projection are unavailable; no financial totals have been inferred."
        >
          <AccountantUnavailableState label="Payment evidence is unavailable" />
        </AccountantPageFrame>
      );
    }
    const register = normalizeFinancialRegister(
      raw,
      model.payments,
      40,
      new Set(model.properties.map((property) => property.propertyId)),
    );
    const decision = resolveAccountantRouteDecision(
      '/financials',
      raw,
      buildFinancialRegisterParams(register.state),
      register.unknownPropertyRequested,
    );
    if (decision.kind === 'not_found') notFound();
    if (decision.kind === 'redirect') redirect(decision.href);

    return (
      <AccountantPageFrame
        eyebrow="Payment evidence"
        title="Financial evidence register"
        subtitle="Reconcile actual payment rows for the selected period. Expense imports, NOI, and money movement are not connected."
        periodLabel={model.periodLabel}
      >
        <AccountantFinancialRegister model={model} register={register} />
      </AccountantPageFrame>
    );
  }
  if (access.context.role === 'va') redirect('/today');

  return (
    <ListPageShell
      breadcrumb={[{ label: 'Portfolio', href: '/properties' }, { label: 'Financials' }]}
      eyebrow="Portfolio"
      title="Financial command center"
      titleMeta={[PERIOD_META[periodKey], 'Rent ledger']}
    >
      <Suspense key={periodKey} fallback={<FinancialsBodySkeleton />}>
        <FinancialsBody periodKey={periodKey} />
      </Suspense>
    </ListPageShell>
  );
}
