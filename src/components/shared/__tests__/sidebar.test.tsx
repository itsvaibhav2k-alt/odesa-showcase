import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Sidebar, type SidebarUser } from '@/components/shared/sidebar';
import type { NavCounts } from '@/lib/shell/nav-counts';
import { capabilitiesFor } from '@/lib/authz/access-policy';

let currentPathname = '/today';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    auth: { signOut: vi.fn(async () => undefined) },
  }),
}));

const counts: NavCounts = {
  todayUrgent: 4,
  inboxDraftsAwaitingReview: 3,
  ownerReview: 2,
  properties: 7,
  tenants: 11,
  vendors: 5,
  rentMonthLabel: 'Aug',
};

const org = { id: 'org-1', name: 'Galaxy Estates', propertyCount: 7 };

function user(role: SidebarUser['role']): SidebarUser {
  return {
    id: `${role}-1`,
    fullName: role === 'va' ? 'Vera Assistant' : 'Olivia Owner',
    email: `${role}@example.test`,
    avatarUrl: null,
    initials: role === 'va' ? 'VA' : 'OO',
    role,
    capabilities: [...capabilitiesFor(role)],
  };
}

afterEach(() => {
  currentPathname = '/today';
  window.history.replaceState({}, '', '/today');
});

describe('Sidebar role presentation', () => {
  it('renders the exact owner operating loop in canonical order', () => {
    render(<Sidebar counts={counts} user={user('owner')} org={org} />);

    expect(screen.getByText('Owner')).toBeInTheDocument();
    const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(nav.getAllByRole('link').map((link) => link.textContent?.trim())).toEqual([
      'Today4',
      'Ask Odesa',
      'Owner Queue2',
      'Inbox3',
      'Calls',
      'Properties7',
      'RentAug',
      'Settings',
    ]);
    expect(
      screen.getByLabelText('4 operational items summarized today'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-link-ask-odesa')).toHaveAttribute(
      'href',
      '/assistant',
    );
    expect(screen.queryByTestId('sidebar-link-tenants')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-vendors')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-documents')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-financials')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-command-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('user-role-label')).not.toBeInTheDocument();
  });

  it('keeps manager navigation capability-truthful without owner-only routes', () => {
    render(<Sidebar counts={counts} user={user('manager')} org={org} />);

    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.getByText('Context')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-link-today')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-link-inbox')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-link-calls')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-link-properties')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-link-rent')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-link-settings')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-link-tenants')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-link-vendors')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-link-documents')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-owner-queue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-financials')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-command-hint')).not.toBeInTheDocument();
  });

  it('renders a bounded VA shift with one canonical burden count', () => {
    render(<Sidebar counts={counts} user={user('va')} org={org} />);

    expect(screen.getByText('Shift')).toBeInTheDocument();
    expect(screen.getByText('Context')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-link-my-shift')).toHaveAttribute(
      'href',
      '/today',
    );
    expect(screen.getByTestId('sidebar-link-work-inbox')).toHaveAttribute(
      'href',
      '/inbox',
    );
    expect(screen.getByTestId('sidebar-link-escalations')).toHaveAttribute(
      'href',
      '/escalations',
    );
    expect(
      screen.getByLabelText('4 items needing attention'),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/drafts awaiting review/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/pending owner decisions/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('sidebar-link-owner-queue'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-rent')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('sidebar-link-financials'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('user-role-label')).toHaveTextContent(
      'Operations Assistant',
    );
    expect(screen.queryByTestId('sidebar-command-hint')).not.toBeInTheDocument();
  });

  it('renders only the Accountant close and evidence routes', () => {
    render(<Sidebar counts={counts} user={user('accountant')} org={org} />);

    expect(screen.getByText('Close')).toBeInTheDocument();
    expect(screen.getByText('Evidence')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-link-reconciliation')).toHaveAttribute(
      'href',
      '/today',
    );
    expect(screen.getByTestId('sidebar-link-rent')).toHaveAttribute(
      'href',
      '/rent',
    );
    expect(screen.getByTestId('sidebar-link-financials')).toHaveAttribute(
      'href',
      '/financials',
    );
    expect(screen.getByTestId('sidebar-link-documents')).toHaveAttribute(
      'href',
      '/documents',
    );
    expect(screen.getByTestId('user-role-label')).toHaveTextContent(
      'Accountant',
    );
    expect(screen.queryByTestId('sidebar-command-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-properties')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-inbox')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-calls')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-owner-queue')).not.toBeInTheDocument();
  });

  it('removes a denied Accountant capability from navigation', () => {
    const accountant = user('accountant');
    accountant.capabilities = ['view_financials'];
    render(<Sidebar counts={counts} user={accountant} org={org} />);

    expect(screen.getByTestId('sidebar-link-financials')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-reconciliation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-rent')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-documents')).not.toBeInTheDocument();
  });

  it('does not expose the owner-reserved assistant on a VA route', () => {
    currentPathname = '/assistant';
    render(<Sidebar counts={counts} user={user('va')} org={org} />);

    expect(screen.queryByTestId('sidebar-command-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-link-ask-odesa')).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page'),
    ).toHaveLength(0);
  });

  it('keeps Escalations active while a VA inspects a review source', () => {
    currentPathname = '/review/work_order/work-order-1';
    render(<Sidebar counts={counts} user={user('va')} org={org} />);

    expect(screen.getByTestId('sidebar-link-escalations')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page'),
    ).toHaveLength(1);
  });

});
