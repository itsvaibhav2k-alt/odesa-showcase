import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  createInvitationAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
}));

vi.mock('@/app/(dashboard)/settings/actions', () => actions);

import { TeamCard } from '../team-card';

const PROPERTY = '11111111-1111-4111-8111-111111111111';
const INVITATION = '22222222-2222-4222-8222-222222222222';

describe('TeamCard invitations', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    actions.createInvitationAction.mockResolvedValue({
      success: true,
      data: {
        invitation: {
          id: INVITATION,
          email: 'ledger@galaxy-accountant.test',
          role: 'accountant',
          allProperties: false,
          propertyIds: [PROPERTY],
          expiresAt: '2099-08-13T00:00:00.000Z',
        },
        path: '/invite/fictional-raw-token',
      },
    });
    actions.revokeInvitationAction.mockResolvedValue({
      success: true,
      data: { id: INVITATION },
    });
  });

  it('creates a property-scoped Accountant link without sending email and can revoke it', async () => {
    render(
      <TeamCard
        members={[]}
        initialError={null}
        initialInviteState={{
          canInvite: true,
          invitations: [],
          properties: [{ id: PROPERTY, name: 'Galaxy Ledger House' }],
        }}
      />,
    );

    expect(screen.getByLabelText('Invited role')).toHaveValue('accountant');
    fireEvent.change(screen.getByLabelText('Invite by email'), {
      target: { value: 'ledger@galaxy-accountant.test' },
    });
    fireEvent.click(
      screen.getByTestId(`settings-team-invite-property-${PROPERTY}`),
    );
    fireEvent.click(screen.getByTestId('settings-team-invite-submit'));

    await waitFor(() =>
      expect(actions.createInvitationAction).toHaveBeenCalledWith({
        email: 'ledger@galaxy-accountant.test',
        role: 'accountant',
        allProperties: false,
        propertyIds: [PROPERTY],
      }),
    );
    expect(await screen.findByTestId('settings-team-invite-link')).toHaveValue(
      'http://localhost:3000/invite/fictional-raw-token',
    );
    expect(screen.getByText(/No email is sent/i)).toBeVisible();
    expect(
      screen.getByTestId(`settings-team-invitation-scope-${INVITATION}`),
    ).toHaveTextContent('Galaxy Ledger House');

    fireEvent.click(
      screen.getByTestId(`settings-team-invitation-revoke-${INVITATION}`),
    );
    await waitFor(() =>
      expect(actions.revokeInvitationAction).toHaveBeenCalledWith({
        id: INVITATION,
      }),
    );
    expect(
      screen.queryByTestId(`settings-team-invitation-${INVITATION}`),
    ).not.toBeInTheDocument();
  });
});
