import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VaEmptyShift } from '@/components/today/va-empty-shift';

describe('VaEmptyShift', () => {
  it('keeps an unconfigured VA in a bounded, non-executable shift state', () => {
    render(<VaEmptyShift dateLabel="Monday, August 3" />);

    expect(screen.getByRole('heading', { name: 'My shift' })).toBeInTheDocument();
    expect(screen.getByTestId('va-empty-shift')).toHaveTextContent(
      'An owner needs to assign property access or complete portfolio setup',
    );
    expect(screen.getByTestId('va-empty-shift')).not.toHaveTextContent(
      'This organization has no property records',
    );
    expect(screen.getByTestId('va-empty-shift')).toHaveTextContent(
      'No setup controls are available',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
