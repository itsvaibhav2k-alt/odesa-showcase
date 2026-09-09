import type { UrgentItemKind } from '@/lib/today/queries';
import type { QueueItem } from '@/types/today';

export type VaHomeMetricTone = 'quiet' | 'clay' | 'gold' | 'green';

export interface VaHomeMetric {
  key: 'attention' | 'work-orders' | 'owner' | 'calls';
  label: string;
  value: number;
  detail: string;
  tone: VaHomeMetricTone;
  active: boolean;
}

export interface VaHomeMetricsInput {
  queueCount: number;
  urgentWorkOrdersCount: number;
  draftsAwaitingOwner: number;
  callsAwaitingOwner: number;
  callsToday: number;
  callsHandledToday: number;
}

export interface VaHomeDeadline {
  id: string;
  kind: 'lease-end' | 'move-in';
  label: 'Lease ends' | 'Move-in';
  title: string;
  context: string | null;
  dateIso: string;
  dateLabel: string;
}

export interface VaHomeDeadlinesInput {
  leases: readonly {
    leaseId: string;
    tenantName: string;
    unitLabel: string | null;
    endDate: string;
  }[];
  moveIns: readonly {
    tenantName: string | null;
    unitLabel: string | null;
    date: string;
  }[];
}

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** Four compact cells derived only from counts fetched by the Today page. */
export function buildVaHomeMetrics(input: VaHomeMetricsInput): VaHomeMetric[] {
  const queueCount = safeCount(input.queueCount);
  const workOrders = safeCount(input.urgentWorkOrdersCount);
  const drafts = safeCount(input.draftsAwaitingOwner);
  const flaggedCalls = safeCount(input.callsAwaitingOwner);
  const callsToday = safeCount(input.callsToday);
  const handledCalls = safeCount(input.callsHandledToday);
  const waitingOnOwner = drafts + flaggedCalls;

  return [
    {
      key: 'attention',
      label: 'Needs attention',
      value: queueCount,
      detail: queueCount > 0 ? 'Current finite queue' : 'Queue is clear',
      tone: queueCount > 0 ? 'clay' : 'quiet',
      active: queueCount > 0,
    },
    {
      key: 'work-orders',
      label: 'Work-order watch',
      value: workOrders,
      detail:
        workOrders > 0
          ? `${workOrders} urgent ${workOrders === 1 ? 'record' : 'records'}`
          : 'No urgent work orders',
      tone: workOrders > 0 ? 'gold' : 'quiet',
      active: workOrders > 0,
    },
    {
      key: 'owner',
      label: 'Waiting on owner',
      value: waitingOnOwner,
      detail:
        waitingOnOwner > 0
          ? `${drafts} ${drafts === 1 ? 'draft' : 'drafts'} · ${flaggedCalls} flagged ${flaggedCalls === 1 ? 'call' : 'calls'}`
          : 'No drafts or flagged calls',
      tone: waitingOnOwner > 0 ? 'gold' : 'quiet',
      active: waitingOnOwner > 0,
    },
    {
      key: 'calls',
      label: 'Calls today',
      value: callsToday,
      detail:
        callsToday > 0
          ? `${handledCalls} resolved without owner review`
          : 'No calls recorded today',
      tone: callsToday > 0 ? 'green' : 'quiet',
      active: callsToday > 0,
    },
  ];
}

/** Lease endings and move-ins from the existing seven-day query window. */
export function buildVaHomeDeadlines({
  leases,
  moveIns,
}: VaHomeDeadlinesInput): VaHomeDeadline[] {
  const deadlines: VaHomeDeadline[] = [
    ...leases.map((lease) => ({
      id: `lease:${lease.leaseId}`,
      kind: 'lease-end' as const,
      label: 'Lease ends' as const,
      title: lease.tenantName.trim() || 'Lease deadline',
      context: lease.unitLabel ? `Unit ${lease.unitLabel}` : null,
      dateIso: lease.endDate,
      dateLabel: shortDate(lease.endDate),
    })),
    ...moveIns.map((moveIn, index) => ({
      id: `move-in:${moveIn.date}:${moveIn.unitLabel ?? 'no-unit'}:${index}`,
      kind: 'move-in' as const,
      label: 'Move-in' as const,
      title: moveIn.tenantName?.trim() || 'Upcoming move-in',
      context: moveIn.unitLabel ? `Unit ${moveIn.unitLabel}` : null,
      dateIso: moveIn.date,
      dateLabel: shortDate(moveIn.date),
    })),
  ];

  return deadlines.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

function shortDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Reframes a real urgent row for VA preparation. The dedicated VA dashboard
 * renders only its evidence link, never the owner's primary/secondary controls.
 */
export function adaptQueueItemForVa(
  item: QueueItem,
  kind: UrgentItemKind,
): QueueItem {
  switch (kind) {
    case 'rent':
      return {
        ...item,
        recommendation:
          'Prepare the payment context and a draft for owner review.',
        nextStep: 'Tenant reminders cannot be sent from this queue.',
        ownerRule: 'Owner approval required',
        contextSuggestions: [
          'Summarize the payment record',
          'Draft a reminder for owner review',
          'List what the owner needs to decide',
          'What is still unverified?',
        ],
      };
    case 'work_order':
      return {
        ...item,
        recommendation: 'Verify the known facts and prepare the owner handoff.',
        nextStep: 'Vendor outreach or dispatch requires the owner.',
        ifIgnored:
          'The work order remains active in the queue until the owner reviews it.',
        ownerRule: 'Owner approval required',
        contextSuggestions: [
          'Summarize this work order',
          'Draft an owner handoff',
          'List the open questions',
          'Draft a tenant update for owner review',
        ],
      };
    case 'conversation':
      return {
        ...item,
        recommendation:
          'Summarize the thread and prepare a reply for owner review.',
        nextStep: 'Tenant replies remain unsent until the owner acts.',
        ownerRule: 'Owner approval required',
        contextSuggestions: [
          'Summarize this thread',
          'Draft a reply for owner review',
          'List what the owner needs to decide',
          'What still needs follow-up?',
        ],
      };
  }
}
