/**
 * Unit tests for `<UnitDetailDrawer>`. Covers:
 *   - closed when `data === null`
 *   - open lifecycle (open prop → tabs render → close triggers onClose)
 *   - tab switching renders the right child
 *   - empty/vacant unit renders the "no tenant / no lease" placeholders
 *
 * Heavy children (TenantPreferencesEditor) are stubbed to keep this
 * test scope focused on drawer composition rather than re-testing
 * downstream component behavior.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock(
  '@/app/(dashboard)/properties/[id]/units/[unitId]/_components/tenant-preferences',
  () => ({
    TenantPreferencesEditor: (props: { tenantId: string }) => (
      <div data-testid='tenant-preferences-stub' data-tenant={props.tenantId} />
    ),
  }),
);

import { UnitDetailDrawer } from '@/components/properties/unit-detail-drawer';
import type { UnitDetail } from '@/lib/properties/queries';

const FULL_DETAIL: UnitDetail = {
  occupancy: 'occupied',
  unit: {
    id: 'unit-1',
    label: 'Apt 1A',
    bedrooms: 2,
    bathrooms: 1,
    squareFeet: 850,
    propertyId: 'prop-1',
    propertyName: 'Vaba',
  },
  tenant: {
    id: 'tenant-1',
    fullName: 'Marcus Lee',
    phoneE164: '+15715550201',
    email: 'marcus@example.com',
    preferences: {
      preferredChannel: 'sms',
      language: 'en',
      emergencyContactName: null,
      emergencyContactPhone: null,
      parkingSpace: null,
      pets: [],
      confidence: 0.95,
      source: 'owner',
    },
  },
  lease: {
    id: 'lease-1',
    rentAmountCents: 240000,
    rentDueDay: 1,
    startDate: '2025-01-01',
    endDate: '2027-01-01',
    depositCents: null,
  },
  payments: [],
  rentPayments: [
    {
      id: 'rp-1',
      amountCents: 240000,
      status: 'succeeded',
      createdAt: '2026-05-01T00:00:00.000Z',
      paidAt: '2026-05-01T00:00:00.000Z',
      paymentLinkUrl: null,
      receiptUrl: null,
    },
  ],
  conversations: [],
};

const VACANT_DETAIL: UnitDetail = {
  occupancy: 'vacant',
  unit: { ...FULL_DETAIL.unit, id: 'unit-2', label: 'Apt 2B' },
  tenant: null,
  lease: null,
  payments: [],
  rentPayments: [],
  conversations: [],
};

const PENDING_DETAIL: UnitDetail = {
  ...VACANT_DETAIL,
  occupancy: 'pending_move_in',
  unit: { ...FULL_DETAIL.unit, id: 'unit-3', label: 'Apt 3C' },
};

describe('UnitDetailDrawer', () => {
  describe('closed states', () => {
    it('renders nothing when data is null', () => {
      const { container } = render(
        <UnitDetailDrawer open data={null} onClose={() => {}} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing in the document body when open is false', () => {
      render(
        <UnitDetailDrawer open={false} data={FULL_DETAIL} onClose={() => {}} />,
      );
      expect(
        screen.queryByTestId('unit-detail-drawer'),
      ).not.toBeInTheDocument();
    });
  });

  describe('open with full detail', () => {
    it('renders the drawer title with property + unit label', () => {
      render(
        <UnitDetailDrawer open data={FULL_DETAIL} onClose={() => {}} />,
      );
      expect(
        screen.getByTestId('unit-detail-drawer-title'),
      ).toHaveTextContent('Vaba · Apt 1A');
    });

    it('defaults to the Tenant tab and renders TenantBlock + preferences editor', () => {
      render(
        <UnitDetailDrawer open data={FULL_DETAIL} onClose={() => {}} />,
      );
      expect(screen.getByTestId('unit-detail-tenant')).toBeInTheDocument();
      expect(
        screen.getByTestId('tenant-preferences-stub'),
      ).toHaveAttribute('data-tenant', 'tenant-1');
    });

    it('switches to Lease tab and renders LeaseBlock', () => {
      render(
        <UnitDetailDrawer open data={FULL_DETAIL} onClose={() => {}} />,
      );
      fireEvent.click(screen.getByTestId('unit-detail-tab-lease'));
      // LeaseBlock renders a unit-detail-lease-term row.
      expect(screen.getByTestId('unit-detail-lease-term')).toBeInTheDocument();
    });

    it('switches to Payments tab and renders the rent payment history', () => {
      render(
        <UnitDetailDrawer open data={FULL_DETAIL} onClose={() => {}} />,
      );
      fireEvent.click(screen.getByTestId('unit-detail-tab-payments'));
      expect(screen.getByTestId('rent-payment-history')).toBeInTheDocument();
    });

    it('switches to Conversations tab and renders the conversations rail', () => {
      render(
        <UnitDetailDrawer open data={FULL_DETAIL} onClose={() => {}} />,
      );
      fireEvent.click(screen.getByTestId('unit-detail-tab-conversations'));
      expect(
        screen.getByTestId('unit-detail-conversations'),
      ).toBeInTheDocument();
    });

    it('does not render an Activity tab', () => {
      render(
        <UnitDetailDrawer open data={FULL_DETAIL} onClose={() => {}} />,
      );
      expect(
        screen.queryByTestId('unit-detail-tab-activity'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('unit-detail-drawer-activity-empty'),
      ).not.toBeInTheDocument();
    });

    it('keeps tenant context visible but hides VA preference editing', () => {
      render(
        <UnitDetailDrawer
          open
          data={FULL_DETAIL}
          onClose={() => {}}
          readOnly
        />,
      );

      expect(screen.getByTestId('unit-detail-tenant')).toBeInTheDocument();
      expect(
        screen.queryByTestId('tenant-preferences-stub'),
      ).not.toBeInTheDocument();
    });
  });

  describe('open with vacant unit', () => {
    it('renders the tenant-empty placeholder on the Tenant tab', () => {
      render(
        <UnitDetailDrawer open data={VACANT_DETAIL} onClose={() => {}} />,
      );
      expect(
        screen.getByTestId('unit-detail-drawer-tenant-empty'),
      ).toBeInTheDocument();
      expect(screen.getByText('Vacant unit')).toBeInTheDocument();
    });

    it('renders the lease-empty placeholder on the Lease tab', () => {
      render(
        <UnitDetailDrawer open data={VACANT_DETAIL} onClose={() => {}} />,
      );
      fireEvent.click(screen.getByTestId('unit-detail-tab-lease'));
      expect(
        screen.getByTestId('unit-detail-drawer-lease-empty'),
      ).toBeInTheDocument();
    });
  });

  describe('open with pending-move-in unit', () => {
    it('describes the unit as lease pending, never vacant', () => {
      render(
        <UnitDetailDrawer open data={PENDING_DETAIL} onClose={() => {}} />,
      );
      expect(
        screen.getByText('Lease pending — move-in being set up'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Vacant unit')).not.toBeInTheDocument();
    });

    it('renders lease-pending placeholders on the Tenant and Lease tabs', () => {
      render(
        <UnitDetailDrawer open data={PENDING_DETAIL} onClose={() => {}} />,
      );
      expect(
        screen.getByTestId('unit-detail-drawer-tenant-empty'),
      ).toHaveTextContent('Finish lease terms to populate tenant info.');
      fireEvent.click(screen.getByTestId('unit-detail-tab-lease'));
      expect(
        screen.getByTestId('unit-detail-drawer-lease-empty'),
      ).toHaveTextContent('Finish lease terms to start tracking rent.');
    });

    it('frames a pending VA unit as owner approval, not an executable setup task', () => {
      render(
        <UnitDetailDrawer
          open
          data={PENDING_DETAIL}
          onClose={() => {}}
          readOnly
        />,
      );

      expect(
        screen.getByTestId('unit-detail-drawer-tenant-empty'),
      ).toHaveTextContent('Owner approval is required');
      expect(screen.queryByText(/Finish lease terms/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('unit-detail-tab-lease'));
      expect(
        screen.getByTestId('unit-detail-drawer-lease-empty'),
      ).toHaveTextContent('Owner approval is required');
    });
  });

  describe('onClose', () => {
    it('fires onClose when the user presses Escape', () => {
      const onClose = vi.fn();
      render(
        <UnitDetailDrawer open data={FULL_DETAIL} onClose={onClose} />,
      );

      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });
  });
});
