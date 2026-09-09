import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  ManagerOperationsDashboard,
  type ManagerOperationsDashboardProps,
} from '@/components/today/manager-operations-dashboard';
import type { QueueItem } from '@/types/today';

function queueItem(id: string, overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id,
    status: 'review',
    title: `Operational item ${id}`,
    property: '',
    meta: [`Context ${id}`],
    recommendation: 'Review the returned record and its current boundary.',
    timestamp: '12m ago',
    channel: 'inbox',
    contextLabel: `item ${id}`,
    contextSuggestions: [],
    contextPlaceholder: 'Ask about this item',
    primaryAction: {
      label: 'Approve dispatch',
      handler: `/review/conversation/${id}`,
    },
    nextStep: 'The current owner boundary remains in place.',
    ifIgnored: 'The item remains open in the current queue.',
    ownerRule: 'Owner review required',
    reason: 'The source record is open and returned by the priority query.',
    sourceLabel: 'View thread',
    sourceHref: `/review/conversation/${id}`,
    ...overrides,
  };
}

const activeItems: QueueItem[] = [
  queueItem('wo-1', {
    title: 'Emergency repair',
    channel: 'maintenance',
    sourceLabel: 'View work order',
    sourceHref: '/review/work_order/wo-1',
  }),
  queueItem('rent-1', {
    title: 'Late rent',
    status: 'draft',
    channel: 'rent',
    sourceLabel: 'View ledger',
    sourceHref: '/review/rent/rent-1',
  }),
  queueItem('thread-1', { title: 'Tenant message' }),
  queueItem('wo-2', {
    title: 'Open work order',
    channel: 'maintenance',
    sourceLabel: 'View work order',
    sourceHref: '/review/work_order/wo-2',
  }),
  queueItem('thread-2', {
    title: 'Escalated thread',
    status: 'escalated',
  }),
  queueItem('hidden-1'),
  queueItem('hidden-2'),
];

function props(
  overrides: Partial<ManagerOperationsDashboardProps> = {},
): ManagerOperationsDashboardProps {
  return {
    dateLabel: 'Thursday, August 6',
    propertiesCount: 2,
    tenantsCount: 9,
    checkedAgoLabel: 'just now',
    queueItems: activeItems,
    ...overrides,
  };
}

describe('ManagerOperationsDashboard', () => {
  it('renders a finite honest queue and summary from the supplied rows only', () => {
    render(<ManagerOperationsDashboard {...props()} />);

    const dashboard = screen.getByTestId('manager-operations-dashboard');
    const summary = screen.getByTestId('manager-operations-summary');
    const rows = screen.getAllByTestId('manager-queue-row');

    expect(rows).toHaveLength(5);
    expect(dashboard).toHaveTextContent('5 current rows');
    expect(dashboard).not.toHaveTextContent('Operational item hidden-1');
    expect(
      within(summary).getByText('CURRENT QUEUE').closest('[data-summary-value]'),
    ).toHaveAttribute('data-summary-value', '5');
    expect(
      within(summary)
        .getByText('WORK ORDER ROWS')
        .closest('[data-summary-value]'),
    ).toHaveAttribute('data-summary-value', '2');
    expect(
      within(summary).getByText('RENT ROWS').closest('[data-summary-value]'),
    ).toHaveAttribute('data-summary-value', '1');
    expect(
      within(summary).getByText('OTHER ROWS').closest('[data-summary-value]'),
    ).toHaveAttribute('data-summary-value', '2');
    expect(dashboard).toHaveTextContent('2 properties · 9 tenants');
    expect(dashboard).toHaveTextContent('Refreshed just now');
  });

  it('keeps the queue and detail as equal-height siblings with internal scroll contracts', () => {
    render(<ManagerOperationsDashboard {...props()} />);

    const workspace = screen.getByTestId('manager-operations-workspace');
    const queue = screen.getByTestId('manager-priority-queue');
    const detail = screen.getByTestId('manager-operation-detail');

    expect(workspace).toHaveAttribute('data-equal-height-desktop', 'true');
    expect(queue.parentElement).toBe(workspace);
    expect(detail.parentElement).toBe(workspace);
    expect(queue).toHaveAttribute('data-equal-height-panel', 'true');
    expect(detail).toHaveAttribute('data-equal-height-panel', 'true');
    expect(screen.getByTestId('manager-queue-scroll')).toBeInTheDocument();
    expect(screen.getByTestId('manager-detail-scroll')).toBeInTheDocument();

    const css = readFileSync(
      resolve(
        process.cwd(),
        'src/components/today/manager-operations-dashboard.module.css',
      ),
      'utf8',
    );
    expect(css).toMatch(
      /\.workspace\s*\{[\s\S]*?align-items:\s*stretch;[\s\S]*?height:\s*clamp\(/,
    );
    expect(css).toMatch(
      /\.panel,\s*\.equalHeightPanel\s*\{[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*0;/,
    );
    expect(css).toMatch(
      /\.queueScroll,\s*\.detailScroll\s*\{[\s\S]*?overflow-y:\s*auto;/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*900px\)[\s\S]*?\.workspace\s*\{[\s\S]*?height:\s*auto;[\s\S]*?\.panel,\s*\.equalHeightPanel\s*\{[\s\S]*?height:\s*auto;/,
    );
  });

  it('selects truthful rent and generic operational details without exposing owner action labels', () => {
    render(<ManagerOperationsDashboard {...props()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Select Late rent' }));
    const rentDetail = screen.getByTestId('manager-operation-detail');
    expect(rentDetail).toHaveAttribute('data-detail-kind', 'rent');
    expect(within(rentDetail).getByText('RENT OPERATIONAL DETAIL')).toBeVisible();
    expect(rentDetail).not.toHaveTextContent('WORK ORDER DOSSIER');
    expect(
      within(rentDetail).getByRole('link', { name: /Inspect source record/ }),
    ).toHaveAttribute('href', '/review/rent/rent-1');
    expect(within(rentDetail).getAllByTestId('manager-remaining-item')).toHaveLength(4);
    expect(screen.getByTestId('manager-priority-queue')).toHaveTextContent(
      'Review the returned record and its current boundary.',
    );
    expect(screen.getByTestId('manager-priority-queue')).toHaveTextContent(
      'Owner review required',
    );

    fireEvent.click(
      within(rentDetail).getByRole('button', {
        name: 'Select Emergency repair from remaining shift',
      }),
    );
    expect(screen.getByTestId('manager-operation-detail')).toHaveAttribute(
      'data-detail-kind',
      'work-order',
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Select Tenant message' }),
    );
    const genericDetail = screen.getByTestId('manager-operation-detail');
    expect(genericDetail).toHaveAttribute('data-detail-kind', 'operational');
    expect(within(genericDetail).getByText('OPERATIONAL DETAIL')).toBeVisible();
    expect(genericDetail).not.toHaveTextContent('WORK ORDER DOSSIER');

    const dashboard = screen.getByTestId('manager-operations-dashboard');
    expect(dashboard).not.toHaveTextContent('Approve dispatch');
    expect(dashboard).not.toHaveTextContent(
      /vendor assignment|next scheduled step|SLA|Odesa trace|payment received/i,
    );
  });

  it('renders quiet zero states without fabricated activity or detail', () => {
    render(
      <ManagerOperationsDashboard
        {...props({ queueItems: [], propertiesCount: 1, tenantsCount: 0 })}
      />,
    );

    const summary = screen.getByTestId('manager-operations-summary');
    const zeroMetrics = summary.querySelectorAll('[data-summary-value="0"]');

    expect(zeroMetrics).toHaveLength(4);
    expect(screen.queryByTestId('manager-queue-row')).not.toBeInTheDocument();
    expect(screen.getByTestId('manager-queue-empty')).toHaveTextContent(
      'No priority rows were returned for this shift.',
    );
    expect(screen.getByTestId('manager-operation-detail')).toHaveTextContent(
      'No selected item',
    );
    expect(screen.getByTestId('manager-operations-dashboard')).not.toHaveTextContent(
      /vendor|schedule|timestamp|SLA|payment received|AI history/i,
    );
  });

  it('wires the component only inside the explicit manager role branch', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/(dashboard)/today/page.tsx'),
      'utf8',
    );
    const vaBranch = source.indexOf('const vaQueueItems');
    const managerBranch = source.indexOf("if (role === 'manager')", vaBranch);
    const ownerBranch = source.indexOf(
      'const attentionChannel',
      managerBranch,
    );

    expect(vaBranch).toBeGreaterThan(-1);
    expect(managerBranch).toBeGreaterThan(vaBranch);
    expect(ownerBranch).toBeGreaterThan(managerBranch);
    expect(source.slice(vaBranch, managerBranch)).toContain('<VaHomeDashboard');
    expect(source.slice(managerBranch, ownerBranch)).toContain(
      '<ManagerOperationsDashboard',
    );
    expect(source.slice(managerBranch, ownerBranch)).toContain(
      'queueItems={queueItems}',
    );
    expect(source.slice(ownerBranch)).toContain('<TodayInteractions');
    expect(source.slice(ownerBranch)).not.toContain(
      '<ManagerOperationsDashboard',
    );
  });
});
