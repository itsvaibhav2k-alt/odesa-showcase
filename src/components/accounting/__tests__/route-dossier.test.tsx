import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountantRouteDossier } from '../route-dossier';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

function matchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: '(max-width: 760px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function Fixture({ open }: { open: boolean }) {
  return (
    <>
      <a id="payment-row-1" href="/financials?payment=payment-1">
        Payment row
      </a>
      <AccountantRouteDossier
        open={open}
        ariaLabel="Payment evidence dossier"
        closeHref="/financials?period=mtd"
        triggerId={open ? 'payment-row-1' : null}
      >
        <h2>Selected payment</h2>
        <a href="/rent">Open matching rent</a>
      </AccountantRouteDossier>
    </>
  );
}

describe('AccountantRouteDossier', () => {
  beforeEach(() => {
    push.mockReset();
    matchMedia(true);
    document.body.style.overflow = '';
  });

  it('behaves as a trapped mobile sheet and restores focus after close navigation', async () => {
    const rendered = render(<Fixture open />);
    const dialog = await screen.findByRole('dialog', {
      name: 'Payment evidence dossier',
    });
    const close = screen.getByRole('link', { name: 'Close dossier' });
    await waitFor(() => expect(close).toHaveFocus());
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('link', { name: 'Open matching rent' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(push).toHaveBeenCalledWith('/financials?period=mtd');
    expect(close).toHaveFocus();

    rendered.rerender(<Fixture open={false} />);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Payment row' })).toHaveFocus(),
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('restores the opening row when browser Back closes the selected dossier', async () => {
    const rendered = render(<Fixture open />);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Close dossier' })).toHaveFocus(),
    );

    rendered.rerender(<Fixture open={false} />);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Payment row' })).toHaveFocus(),
    );
  });
});
