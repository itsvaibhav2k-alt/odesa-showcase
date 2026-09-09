/**
 * Tests for AddTenantDialog + TenantsEmptyState (property "Add tenant" flow).
 *
 * Covers the three acceptance behaviors:
 *   - the property page surfaces an "Add tenant" action,
 *   - submitting the form calls `addTenantAction` with the current
 *     property id and the entered tenant/unit fields,
 *   - the empty state renders its copy + a reachable CTA.
 *
 * The server action is mocked (`vi.mock('../../actions')`) so the test
 * never pulls the Supabase/worker chain — the dialog only calls it from
 * the form action.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const mockAddTenant = vi.fn();

vi.mock('../../actions', () => ({
  addTenantAction: (ctx: unknown, form: FormData) => mockAddTenant(ctx, form),
}));

import { AddTenantDialog, TenantsEmptyState } from '../add-tenant-dialog';

const PROPERTY_ID = '11111111-1111-1111-1111-111111111111';
const UNITS = [
  { id: '22222222-2222-2222-2222-222222222222', label: 'Unit 1A' },
  { id: '33333333-3333-3333-3333-333333333333', label: 'Unit 2B' },
];

beforeEach(() => {
  mockAddTenant.mockReset();
  mockAddTenant.mockResolvedValue({ success: true, data: { tenantId: 't-1' } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AddTenantDialog', () => {
  it('should render an Add tenant trigger and keep the form closed initially', () => {
    render(<AddTenantDialog propertyId={PROPERTY_ID} units={UNITS} />);

    expect(screen.getByTestId('add-tenant-trigger')).toHaveTextContent(
      'Add tenant',
    );
    expect(screen.queryByTestId('add-tenant-form')).not.toBeInTheDocument();
    expect(mockAddTenant).not.toHaveBeenCalled();
  });

  it('should reveal the tenant form when the trigger is clicked', () => {
    render(<AddTenantDialog propertyId={PROPERTY_ID} units={UNITS} />);

    fireEvent.click(screen.getByTestId('add-tenant-trigger'));

    expect(screen.getByTestId('add-tenant-form')).toBeInTheDocument();
    expect(screen.getByTestId('add-tenant-submit')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Jordan Rivera')).toBeInTheDocument();
  });

  it('should call addTenantAction with the current property id and entered fields', async () => {
    render(<AddTenantDialog propertyId={PROPERTY_ID} units={UNITS} />);

    fireEvent.click(screen.getByTestId('add-tenant-trigger'));
    fireEvent.change(screen.getByPlaceholderText('Jordan Rivera'), {
      target: { value: 'Jordan Rivera' },
    });
    fireEvent.change(screen.getByPlaceholderText('(571) 555-0134'), {
      target: { value: '5715550134' },
    });
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: UNITS[1].id },
    });

    fireEvent.submit(screen.getByTestId('add-tenant-form'));
    await flushMicrotasks();

    expect(mockAddTenant).toHaveBeenCalledTimes(1);
    const [ctx, form] = mockAddTenant.mock.calls[0] as [
      { propertyId: string },
      FormData,
    ];
    expect(ctx).toEqual({ propertyId: PROPERTY_ID });
    expect(form.get('fullName')).toBe('Jordan Rivera');
    expect(form.get('phone')).toBe('5715550134');
    expect(form.get('unitId')).toBe(UNITS[1].id);
    expect(form.get('requestId')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('should retain one idempotency key while a failed form is retried', async () => {
    mockAddTenant.mockResolvedValue({ success: false, error: 'Try again' });
    render(<AddTenantDialog propertyId={PROPERTY_ID} units={UNITS} />);

    fireEvent.click(screen.getByTestId('add-tenant-trigger'));
    fireEvent.submit(screen.getByTestId('add-tenant-form'));
    await flushMicrotasks();
    fireEvent.submit(screen.getByTestId('add-tenant-form'));
    await flushMicrotasks();

    const first = mockAddTenant.mock.calls[0]?.[1] as FormData;
    const second = mockAddTenant.mock.calls[1]?.[1] as FormData;
    expect(first.get('requestId')).toBe(second.get('requestId'));
  });

  it('should surface the action error and keep the dialog open on failure', async () => {
    mockAddTenant.mockResolvedValue({
      success: false,
      error: 'That unit could not be found on this property.',
    });
    render(<AddTenantDialog propertyId={PROPERTY_ID} units={UNITS} />);

    fireEvent.click(screen.getByTestId('add-tenant-trigger'));
    fireEvent.submit(screen.getByTestId('add-tenant-form'));
    await flushMicrotasks();

    expect(screen.getByTestId('add-tenant-error')).toHaveTextContent(
      'That unit could not be found on this property.',
    );
    expect(screen.getByTestId('add-tenant-form')).toBeInTheDocument();
  });

  it('should guide the owner when the property has no units yet', () => {
    render(<AddTenantDialog propertyId={PROPERTY_ID} units={[]} />);

    fireEvent.click(screen.getByTestId('add-tenant-trigger'));

    expect(screen.getByTestId('add-tenant-no-units')).toBeInTheDocument();
    expect(screen.queryByTestId('add-tenant-form')).not.toBeInTheDocument();
  });
});

describe('TenantsEmptyState', () => {
  it('should render the empty-state copy with an Add tenant CTA', () => {
    render(<TenantsEmptyState propertyId={PROPERTY_ID} units={UNITS} />);

    expect(screen.getByTestId('tenants-empty-state')).toHaveTextContent(
      'No tenants added yet',
    );
    expect(screen.getByTestId('tenants-empty-state')).toHaveTextContent(
      'Add the first tenant to start tracking occupancy, rent, and communication.',
    );
    expect(screen.getByTestId('add-tenant-trigger')).toBeInTheDocument();
  });
});
