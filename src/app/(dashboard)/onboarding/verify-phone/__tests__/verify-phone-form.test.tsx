/**
 * Unit tests for the onboarding `VerifyPhoneForm`.
 *
 * Covers:
 *   - Initial render shows the E.164 phone input pre-filled with `+1`.
 *   - Send-code transitions to the 6-digit code input on success.
 *   - Confirm calls `router.push('/today')` and `router.refresh()` on
 *     success.
 *   - Errors from `requestPhoneVerification` surface inline.
 *   - Errors from `confirmPhoneVerification` surface inline.
 *
 * Server actions are mocked via `vi.mock('.../settings/integrations/actions')`
 * to keep the spec pure unit. We don't need `userEvent` — the existing
 * RTL specs in this repo all use `fireEvent` (no `@testing-library/user-event`
 * is installed).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks (declare before component import — see chat-panel.test.tsx pattern)
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const mockRequestPhoneVerification = vi.fn();
const mockConfirmPhoneVerification = vi.fn();

vi.mock('@/app/(dashboard)/settings/integrations/actions', () => ({
  requestPhoneVerification: (
    payload: { phoneE164: string },
  ) => mockRequestPhoneVerification(payload),
  confirmPhoneVerification: (
    payload: { phoneE164: string; code: string },
  ) => mockConfirmPhoneVerification(payload),
}));

import { VerifyPhoneForm } from '../verify-phone-form';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockPush.mockReset();
  mockRefresh.mockReset();
  mockRequestPhoneVerification.mockReset();
  mockConfirmPhoneVerification.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// Initial render
// ---------------------------------------------------------------------------

describe('VerifyPhoneForm', () => {
  describe('initial render', () => {
    it('renders the E.164 phone input pre-filled with +1 by default', () => {
      render(
        <VerifyPhoneForm initialPhone={null} alreadyVerified={false} />,
      );

      const input = screen.getByTestId(
        'verify-phone-input',
      ) as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.value).toBe('+1');
      expect(screen.getByTestId('verify-phone-send')).toBeInTheDocument();
      expect(
        screen.queryByTestId('verify-phone-confirm-btn'),
      ).not.toBeInTheDocument();
    });

    it('uses the existing phone when initialPhone is provided', () => {
      render(
        <VerifyPhoneForm
          initialPhone='+15555550100'
          alreadyVerified={false}
        />,
      );

      const input = screen.getByTestId(
        'verify-phone-input',
      ) as HTMLInputElement;
      expect(input.value).toBe('+15555550100');
    });
  });

  // -------------------------------------------------------------------------
  // Request → Confirm transition
  // -------------------------------------------------------------------------

  describe('send code', () => {
    it('transitions to the code input after requestPhoneVerification succeeds', async () => {
      mockRequestPhoneVerification.mockResolvedValueOnce({
        success: true,
        data: { phoneE164: '+15555550100' },
      });

      render(
        <VerifyPhoneForm initialPhone={null} alreadyVerified={false} />,
      );

      const input = screen.getByTestId('verify-phone-input');
      fireEvent.change(input, { target: { value: '+15555550100' } });

      await act(async () => {
        fireEvent.submit(screen.getByTestId('verify-phone-request'));
      });
      await flushMicrotasks();

      expect(mockRequestPhoneVerification).toHaveBeenCalledWith({
        phoneE164: '+15555550100',
      });
      expect(
        screen.getByTestId('verify-phone-code-input'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('verify-phone-confirm-btn'),
      ).toBeInTheDocument();
    });

    it('rejects malformed E.164 input client-side without calling the action', async () => {
      render(
        <VerifyPhoneForm initialPhone={null} alreadyVerified={false} />,
      );

      const input = screen.getByTestId('verify-phone-input');
      fireEvent.change(input, { target: { value: 'not-a-phone' } });

      await act(async () => {
        fireEvent.submit(screen.getByTestId('verify-phone-request'));
      });
      await flushMicrotasks();

      expect(mockRequestPhoneVerification).not.toHaveBeenCalled();
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/E\.164/i);
    });

    it('surfaces requestPhoneVerification errors inline', async () => {
      mockRequestPhoneVerification.mockResolvedValueOnce({
        success: false,
        error: 'No Odesa phone number provisioned for this org yet.',
      });

      render(
        <VerifyPhoneForm initialPhone={null} alreadyVerified={false} />,
      );

      fireEvent.change(screen.getByTestId('verify-phone-input'), {
        target: { value: '+15555550100' },
      });
      await act(async () => {
        fireEvent.submit(screen.getByTestId('verify-phone-request'));
      });
      await flushMicrotasks();

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/No Odesa phone number/);
      expect(
        screen.queryByTestId('verify-phone-code-input'),
      ).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Confirm → /today
  // -------------------------------------------------------------------------

  describe('confirm', () => {
    async function advanceToConfirmStep() {
      mockRequestPhoneVerification.mockResolvedValueOnce({
        success: true,
        data: { phoneE164: '+15555550100' },
      });

      render(
        <VerifyPhoneForm initialPhone={null} alreadyVerified={false} />,
      );

      fireEvent.change(screen.getByTestId('verify-phone-input'), {
        target: { value: '+15555550100' },
      });
      await act(async () => {
        fireEvent.submit(screen.getByTestId('verify-phone-request'));
      });
      await flushMicrotasks();
    }

    it('pushes /today and refreshes after confirmPhoneVerification succeeds', async () => {
      await advanceToConfirmStep();

      mockConfirmPhoneVerification.mockResolvedValueOnce({
        success: true,
        data: { phoneE164: '+15555550100' },
      });

      fireEvent.change(screen.getByTestId('verify-phone-code-input'), {
        target: { value: '123456' },
      });
      await act(async () => {
        fireEvent.submit(screen.getByTestId('verify-phone-confirm'));
      });
      await flushMicrotasks();

      expect(mockConfirmPhoneVerification).toHaveBeenCalledWith({
        phoneE164: '+15555550100',
        code: '123456',
      });
      expect(mockPush).toHaveBeenCalledWith('/today');
      expect(mockRefresh).toHaveBeenCalled();
    });

    it('surfaces confirmPhoneVerification errors inline', async () => {
      await advanceToConfirmStep();

      mockConfirmPhoneVerification.mockResolvedValueOnce({
        success: false,
        error: 'Code is invalid or has expired. Send a new one.',
      });

      fireEvent.change(screen.getByTestId('verify-phone-code-input'), {
        target: { value: '999999' },
      });
      await act(async () => {
        fireEvent.submit(screen.getByTestId('verify-phone-confirm'));
      });
      await flushMicrotasks();

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/invalid or has expired/);
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it('returns to the request step when "Resend code" is clicked', async () => {
      await advanceToConfirmStep();

      fireEvent.click(screen.getByTestId('verify-phone-resend'));

      expect(screen.getByTestId('verify-phone-request')).toBeInTheDocument();
      expect(
        screen.queryByTestId('verify-phone-confirm'),
      ).not.toBeInTheDocument();
    });
  });
});
