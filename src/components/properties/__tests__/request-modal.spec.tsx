/**
 * Unit tests for `<RequestModal>` — the unit-detail "file a request" dialog.
 *
 * The server action is mocked so we exercise only the client behaviour:
 * the pending lock on submit, the dialog closing on success, and the
 * inline error row rendering (dialog stays open) on failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

vi.mock('@/app/(dashboard)/properties/[id]/units/[unitId]/actions', () => ({
  createWorkOrderAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { createWorkOrderAction } from '@/app/(dashboard)/properties/[id]/units/[unitId]/actions';
import { RequestModal } from '@/components/properties/detail/request-modal';

const mockCreateWorkOrderAction = vi.mocked(createWorkOrderAction);

const PROPS = {
  unitId: '11111111-1111-1111-1111-111111111111',
  tenantId: '33333333-3333-3333-3333-333333333333',
  contextLabel: 'Unit 1A · 22 Oak St',
  applianceOptions: ['Water heater · Rheem XE40'],
};

function openModal(): void {
  fireEvent.click(screen.getByTestId('req-modal-trigger'));
}

function fillDescription(text: string): void {
  fireEvent.change(screen.getByLabelText("What's happening?"), {
    target: { value: text },
  });
}

afterEach(() => {
  cleanup();
});

describe('RequestModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the context label instead of a hardcoded subtitle', async () => {
    render(<RequestModal {...PROPS} />);
    openModal();
    expect(await screen.findByText('Unit 1A · 22 Oak St')).toBeInTheDocument();
    expect(screen.queryByText(/Maya R\./)).not.toBeInTheDocument();
  });

  it('should block submit with a field error when description is empty', async () => {
    render(<RequestModal {...PROPS} />);
    openModal();
    fireEvent.click(screen.getByTestId('req-modal-submit'));

    expect(
      await screen.findByTestId('req-modal-desc-error'),
    ).toBeInTheDocument();
    expect(mockCreateWorkOrderAction).not.toHaveBeenCalled();
  });

  it('should show the pending state while the action is in-flight', async () => {
    let resolveAction: (value: { success: true; data: { id: string } }) => void =
      () => {};
    mockCreateWorkOrderAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );

    render(<RequestModal {...PROPS} />);
    openModal();
    fillDescription('Leaking faucet under the sink.');
    fireEvent.click(screen.getByTestId('req-modal-submit'));

    const submit = await screen.findByTestId('req-modal-submit');
    expect(submit).toHaveTextContent('Submitting…');
    expect(submit).toBeDisabled();

    resolveAction({ success: true, data: { id: 'wo-1' } });
    await waitFor(() => {
      expect(screen.queryByTestId('req-modal')).not.toBeInTheDocument();
    });
  });

  it('should close the dialog on success', async () => {
    mockCreateWorkOrderAction.mockResolvedValue({
      success: true,
      data: { id: 'wo-1' },
    });

    render(<RequestModal {...PROPS} />);
    openModal();
    expect(await screen.findByTestId('req-modal')).toBeInTheDocument();
    fillDescription('Leaking faucet under the sink.');
    fireEvent.click(screen.getByTestId('req-modal-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('req-modal')).not.toBeInTheDocument();
    });
    expect(mockCreateWorkOrderAction).toHaveBeenCalledOnce();
    expect(mockCreateWorkOrderAction.mock.calls[0][0]).toMatchObject({
      unitId: PROPS.unitId,
      tenantId: PROPS.tenantId,
      category: 'plumbing',
      urgency: 'urgent',
    });
  });

  it('should render the error row and keep the dialog open on failure', async () => {
    mockCreateWorkOrderAction.mockResolvedValue({
      success: false,
      error: 'Unit not found',
    });

    render(<RequestModal {...PROPS} />);
    openModal();
    fillDescription('Leaking faucet under the sink.');
    fireEvent.click(screen.getByTestId('req-modal-submit'));

    const errorRow = await screen.findByTestId('req-modal-error');
    expect(errorRow).toHaveTextContent('Unit not found');
    expect(screen.getByTestId('req-modal')).toBeInTheDocument();
  });
});
