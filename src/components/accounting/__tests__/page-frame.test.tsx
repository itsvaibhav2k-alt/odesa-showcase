import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AccountantPageFrame } from '../page-frame';

describe('Accountant page frame', () => {
  it('renders a distinct, read-only Accountant identity around dense route content', () => {
    render(
      <AccountantPageFrame
        eyebrow="Month close"
        title="Reconciliation desk"
        subtitle="Close the books against real evidence."
        periodLabel="August 2026"
      >
        <div data-testid="register">Register</div>
      </AccountantPageFrame>,
    );

    expect(screen.getByTestId('accountant-page')).toHaveAttribute(
      'data-persona',
      'accountant',
    );
    expect(screen.getByText('Accountant')).toBeInTheDocument();
    expect(screen.getByText('Read-only evidence')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Reconciliation desk',
    );
    expect(screen.getByTestId('register')).toBeVisible();
  });
});
