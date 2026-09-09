/**
 * Today v2 — operator briefing console.
 *
 * Server component. Fetches the live portfolio state on every render
 * (Promise.all) and threads it through the topbar, the briefing card +
 * orbit, and the interactive queue/rail/AskOdesa island. Per-channel
 * counts drive the orbit dots; the highest-attention channel wears the
 * gold ring and the CSS pulse.
 */

import type React from 'react';
import { notFound, redirect } from 'next/navigation';

import { AccountantPageFrame } from '@/components/accounting/page-frame';
import { ReconciliationWorkspace } from '@/components/accounting/reconciliation-workspace';
import { AccountantUnavailableState } from '@/components/accounting/unavailable-state';
import { TodayPageShell } from '@/components/today/today-page-shell';
import { TodayTopbar } from '@/components/today/today-topbar';
import { VaEmptyShift } from '@/components/today/va-empty-shift';
import { VaHomeDashboard } from '@/components/today/va-home-dashboard';
import { ManagerOperationsDashboard } from '@/components/today/manager-operations-dashboard';
import { TodayBriefing } from '@/components/today/today-briefing';
import { TodayInteractions } from '@/components/today/today-interactions';
import { OdesaHandlingPanel } from '@/components/today/odesa-handling-panel';
import { OvernightCard } from '@/components/today/overnight-card';
import { VoiceCallsCard } from '@/components/today/voice-calls-card';
import { FinancialBriefingCard } from '@/components/today/financial-briefing-card';
import { createServerClient } from '@/lib/supabase/server';
import {
  canonicalAccountantHref,
  resolveAccountantRouteDecision,
  type AccountantRawSearch,
} from '@/lib/accounting/canonical-search';
import {
  loadAccountantReconciliation,
  type AccountantProjectionClient,
} from '@/lib/accounting/repository';
import {
  normalizeAccountantCycleContext,
  normalizeAccountantView,
} from '@/lib/accounting/view-state';
import { requireAccessContext } from '@/lib/authz/context';
import { urgentItemToQueueItem } from '@/lib/today/queue-adapter';
import {
  deriveWatchSignals,
  deriveWatchHeadline,
} from '@/lib/today/watch-signals';
import {
  buildBriefingChanges,
  getChannelCounts,
  pickAttentionChannel,
  synthesizeBriefingHeader,
  type BriefingDeadline,
} from '@/lib/today/briefing-summary';
import {
  getFailedAgentRunCount,
  getLatestDailyDigest,
  getTodayFinancialBriefing,
  getTodayKpis,
  getUpcomingMoveIns,
  getUrgentItems,
  type UpcomingMoveIn,
} from '@/lib/today/queries';
import { getVoiceCallActivity } from '@/lib/voice/queries';
import { fetchLatestBriefingForCurrentUser } from '@/lib/briefing/fetch';
import { listInboxBuckets } from '@/lib/inbox/draft-queries';
import { getDraftsAwaitingReviewCount } from '@/lib/operator/counts';
import {
  adaptQueueItemForVa,
  buildVaHomeDeadlines,
  buildVaHomeMetrics,
} from '@/lib/today/va-presentation';
import type { UserRole } from '@/types/database';

export const dynamic = 'force-dynamic';

const WEEK_AHEAD_DAYS = 7;
type TodaySupabaseClient = Awaited<ReturnType<typeof createServerClient>>;

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<AccountantRawSearch>;
}): Promise<React.ReactElement> {
  const supabase = await createServerClient();
  const access = await requireAccessContext({ auth: supabase, db: supabase });
  if (!access.ok) notFound();
  const role: UserRole = access.context.role;
  if (role === 'accountant') {
    const raw = await searchParams;
    const now = new Date();
    const { selectedCycleMonth: cycleMonth, currentCycleMonth } =
      normalizeAccountantCycleContext(raw.cycle, now);
    let model: Awaited<ReturnType<typeof loadAccountantReconciliation>>;
    try {
      model = await loadAccountantReconciliation(
        supabase as unknown as AccountantProjectionClient,
        { cycleMonth, capabilities: access.context.capabilities },
      );
    } catch {
      const canonical = new URLSearchParams({ cycle: cycleMonth.slice(0, 7) });
      const target = canonicalAccountantHref('/today', raw, canonical);
      if (target.changed) redirect(target.href);
      return (
        <AccountantPageFrame
          eyebrow="Month close"
          title="Reconciliation desk"
          subtitle="Read-only, authorized accounting evidence."
        >
          <AccountantUnavailableState />
        </AccountantPageFrame>
      );
    }
    const normalized = normalizeAccountantView(
      raw,
      model.issues,
      now,
      40,
      new Set(model.properties.map((property) => property.propertyId)),
    );
    const decision = resolveAccountantRouteDecision(
      '/today',
      raw,
      normalized.searchParams,
      normalized.unknownPropertyRequested,
    );
    if (decision.kind === 'not_found') notFound();
    if (decision.kind === 'redirect') redirect(decision.href);

    return (
      <AccountantPageFrame
        eyebrow="Month close"
        title="Reconciliation desk"
        subtitle="Close rent evidence, match actual payment rows, and surface discrepancies without changing property operations or moving money."
        periodLabel={model.periodLabel}
      >
        <ReconciliationWorkspace
          model={model}
          state={normalized.state}
          visibleIssues={normalized.visibleIssues}
          selectedIssue={normalized.selectedIssue}
          filteredIssueCount={normalized.filteredIssueCount}
          issuePage={normalized.issuePage}
          currentCycleMonth={currentCycleMonth}
        />
      </AccountantPageFrame>
    );
  }
  const isVa = role === 'va';

  const { data: firstProperty } = await supabase
    .from('properties')
    .select('id')
    .limit(1)
    .maybeSingle();
  if (!firstProperty) {
    if (isVa) {
      return <VaEmptyShift dateLabel={todayDateLabel()} />;
    }
    redirect('/onboarding');
  }

  const [
    { count: propertiesCount },
    { count: tenantsCount },
    urgentItems,
    briefing,
    drafts,
    moveIns,
    kpisResult,
    overnightDigest,
    failedRunCount,
    financialBriefing,
    voiceActivity,
    draftsAwaitingReview,
    vaUserName,
  ] = await Promise.all([
    supabase.from('properties').select('*', { count: 'exact', head: true }),
    supabase.from('tenants').select('*', { count: 'exact', head: true }),
    getUrgentItems(5),
    fetchLatestBriefingForCurrentUser(),
    listInboxBuckets(supabase),
    getUpcomingMoveIns(WEEK_AHEAD_DAYS),
    getTodayKpis(),
    getLatestDailyDigest(),
    getFailedAgentRunCount(),
    getTodayFinancialBriefing(),
    getVoiceCallActivity(supabase),
    getDraftsAwaitingReviewCount(supabase),
    isVa ? getCurrentUserName(supabase) : Promise.resolve(null),
  ]);

  const now = new Date();
  const dateLabel = todayDateLabel(now);

  const checkedAt = briefing?.generatedAt ?? now.toISOString();
  const checkedAgoLabel = relativeFromNow(checkedAt, now);

  const expiringLeases = briefing?.metrics?.expiringLeases ?? [];
  const upcomingLeasesThisWeek = expiringLeases.filter((lease) =>
    withinDays(lease.endDate, now, WEEK_AHEAD_DAYS),
  );
  const nextDeadline = earliestDeadline(
    upcomingLeasesThisWeek.map((lease) => ({
      label: lease.unitLabel
        ? `Lease ends · Unit ${lease.unitLabel}`
        : 'Lease ends',
      date: lease.endDate,
    })),
    moveIns.map((moveIn) => ({
      label: moveIn.unitLabel
        ? `Move-in · Unit ${moveIn.unitLabel}`
        : 'Move-in',
      date: moveIn.date,
    })),
  );

  const rentCollectedPct =
    kpisResult.kpis.rentDueCents > 0
      ? (kpisResult.kpis.rentCollectedCents / kpisResult.kpis.rentDueCents) *
        100
      : null;

  const channelCounts = getChannelCounts(urgentItems);
  // Real queue: every urgent row maps to a renderable QueueItem (the
  // adapter never returns null, so no filtering is needed).
  const queueItems = urgentItems.map(urgentItemToQueueItem);

  // Real "Watching Quietly" rail: derived entirely from the live data
  // already fetched above (no hand-authored demo copy).
  const watchSignals = deriveWatchSignals({
    urgentItems,
    expiringLeasesCount: upcomingLeasesThisWeek.length,
    nextDeadline: nextDeadline ?? null,
    rentCollectedPct,
    draftsSummary: drafts.summary,
    channelCounts,
  });
  // "Odesa is handling — quietly" cells, derived from the same live data.
  // `statusNote` is a quiet present-state line built ONLY from real counts
  // already in scope — never a future-automation promise or a timestamp.
  // It is omitted (left undefined) when no honest value exists.
  const rentFlaggedCount = channelCounts.rent ?? 0;
  const vendorWaitingCount = channelCounts.vendor ?? 0;
  // Canonical `draftsAwaitingReview` scope (src/lib/operator/counts.ts) so
  // this "drafts ready" number matches the Inbox strip's "N need review" and
  // the sidebar badge exactly. ponytail: the briefing header + watch signals
  // below still read the broader `drafts.summary.readyCount` (all pending
  // drafts, incl. muted/snoozed) — they narrate, they don't reconcile; fold
  // them onto this scope too if that narrative ever needs to match the badge.
  const draftsReadyCount = draftsAwaitingReview;
  const sentTodayCount = drafts.summary.sentTodayCount ?? 0;
  const leaseRenewalCount = upcomingLeasesThisWeek.length;

  if (isVa) {
    const vaQueueItems = queueItems.map((item, index) =>
      adaptQueueItemForVa(item, urgentItems[index].kind),
    );
    const vaWatchSignals = watchSignals.filter(
      (signal) => signal.channel !== 'inbox' && signal.channel !== 'rent',
    );
    const vaMetrics = buildVaHomeMetrics({
      queueCount: vaQueueItems.length,
      urgentWorkOrdersCount: urgentItems.filter(
        (item) => item.kind === 'work_order',
      ).length,
      draftsAwaitingOwner: draftsAwaitingReview,
      callsAwaitingOwner: voiceActivity.needsReview,
      callsToday: voiceActivity.callsToday,
      callsHandledToday: voiceActivity.resolvedAutomatically,
    });
    const vaDeadlines = buildVaHomeDeadlines({
      leases: upcomingLeasesThisWeek,
      moveIns,
    });

    return (
      <TodayPageShell>
        <VaHomeDashboard
          userName={vaUserName}
          dateLabel={dateLabel}
          propertiesCount={propertiesCount ?? 0}
          tenantsCount={tenantsCount ?? 0}
          checkedAgoLabel={checkedAgoLabel}
          metrics={vaMetrics}
          queueItems={vaQueueItems}
          deadlines={vaDeadlines}
          watchSignals={vaWatchSignals}
          draftsSentToday={sentTodayCount}
          callsHandledToday={voiceActivity.resolvedAutomatically}
          callsToday={voiceActivity.callsToday}
        />
      </TodayPageShell>
    );
  }

  if (role === 'manager') {
    return (
      <TodayPageShell>
        <ManagerOperationsDashboard
          dateLabel={dateLabel}
          propertiesCount={propertiesCount ?? 0}
          tenantsCount={tenantsCount ?? 0}
          checkedAgoLabel={checkedAgoLabel}
          queueItems={queueItems}
        />
      </TodayPageShell>
    );
  }

  const attentionChannel = pickAttentionChannel(channelCounts);

  const header = synthesizeBriefingHeader({
    urgentItems,
    draftsCount: drafts.summary.readyCount,
    rentCollectedPct,
    nextDeadline: nextDeadline ?? null,
  });

  // Full current-item list for the briefing disclosure.
  // Length matches header.secondaryLabel's count (urgent items + ready drafts).
  const briefingChanges = buildBriefingChanges(urgentItems, drafts.readyToSend);

  // Honest current-record header — counts real signal tones without implying
  // background monitoring. Failed agent runs override a calm reading.
  const watchHeadline = deriveWatchHeadline(watchSignals, failedRunCount);

  const handlingCells = [
    {
      key: 'rent-follow-ups',
      eyebrow: 'RENT FOLLOW-UPS',
      bigNumber: String(rentFlaggedCount),
      label: 'flagged',
      detail: 'Current unpaid balances surfaced from Rent records',
      statusNote:
        rentFlaggedCount > 0
          ? `${rentFlaggedCount} current rent records need attention`
          : 'Nothing flagged right now',
    },
    {
      key: 'vendor-coordination',
      eyebrow: 'VENDOR COORDINATION',
      bigNumber: String(vendorWaitingCount),
      label: 'threads',
      detail: 'Open vendor-channel records in the attention query',
      statusNote:
        vendorWaitingCount > 0
          ? `${vendorWaitingCount} vendor-channel records open`
          : 'No vendor threads waiting',
    },
    {
      key: 'tenant-inbox',
      eyebrow: 'TENANT INBOX',
      bigNumber: String(draftsReadyCount),
      label: 'drafts ready',
      detail: 'Draft records currently ready in Inbox',
      statusNote:
        sentTodayCount > 0
          ? `${sentTodayCount} sent today`
          : 'None sent yet today',
    },
    {
      key: 'lease-renewal-prep',
      eyebrow: 'LEASE RENEWAL PREP',
      bigNumber: String(leaseRenewalCount),
      label: 'this week',
      detail: 'Lease end dates inside the next seven days',
      statusNote:
        leaseRenewalCount > 0
          ? `${leaseRenewalCount} opening this week`
          : undefined,
    },
  ];

  return (
    <TodayPageShell>
      <TodayTopbar
        dateLabel={dateLabel}
        propertiesCount={propertiesCount ?? 0}
        tenantsCount={tenantsCount ?? 0}
        checkedAgoLabel={checkedAgoLabel}
      />
      <TodayBriefing
        checkedAgoLabel={checkedAgoLabel}
        sentence={header.sentence}
        bullets={header.bullets}
        cta={header.cta}
        secondaryLabel={header.secondaryLabel}
        changes={briefingChanges}
        channelCounts={channelCounts}
        attentionChannel={attentionChannel}
        portfolioCount={propertiesCount ?? 0}
      />
      {overnightDigest ? (
        <div style={{ marginTop: '20px' }}>
          <OvernightCard digest={overnightDigest} />
        </div>
      ) : null}
      {voiceActivity.callsToday > 0 ? (
        <div style={{ marginTop: '20px' }}>
          <VoiceCallsCard
            callsToday={voiceActivity.callsToday}
            resolvedAutomatically={voiceActivity.resolvedAutomatically}
            needsReview={voiceActivity.needsReview}
          />
        </div>
      ) : null}
      <div style={{ marginTop: '20px' }}>
        <FinancialBriefingCard briefing={financialBriefing} />
      </div>
      <div style={{ marginTop: '20px' }}>
        <TodayInteractions
          queueItems={queueItems}
          watchSignals={watchSignals}
          watchHeadline={watchHeadline}
          refreshedLabel={checkedAgoLabel}
          middleSlot={<OdesaHandlingPanel cells={handlingCells} />}
        />
      </div>
    </TodayPageShell>
  );
}

// ---------------------------------------------------------------------------
// Local date helpers (kept inline — page is the only consumer)
// ---------------------------------------------------------------------------

async function getCurrentUserName(
  supabase: TodaySupabaseClient,
): Promise<string | null> {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;

  const { data: currentUser } = await supabase
    .from('users')
    .select('full_name')
    .eq('id', authData.user.id)
    .maybeSingle();
  const fullName = currentUser?.full_name?.trim();
  return fullName || null;
}

function earliestDeadline(
  ...buckets: Array<Array<{ label: string; date: string }>>
): BriefingDeadline | undefined {
  const all = buckets.flat();
  if (all.length === 0) return undefined;
  const earliest = all.reduce((a, b) =>
    a.date.localeCompare(b.date) <= 0 ? a : b,
  );
  return { label: earliest.label, date: shortDate(earliest.date) };
}

function todayDateLabel(date = new Date()): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function withinDays(iso: string, now: Date, days: number): boolean {
  const then = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(then.getTime())) return false;
  const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return (
    then.getTime() >= startOfToday.getTime() &&
    then.getTime() <= horizon.getTime()
  );
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date(iso);
    if (Number.isNaN(fallback.getTime())) return iso;
    return fallback.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function relativeFromNow(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'just now';
  const minutes = Math.max(
    0,
    Math.round((now.getTime() - then.getTime()) / 60000),
  );
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

// re-export so unused-import lints don't fire on the type-only import above
export type { UpcomingMoveIn };
