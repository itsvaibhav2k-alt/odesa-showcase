import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VendorRow } from './vendor-row';

const row = {
  slug: 'vendor-1',
  initial: 'V',
  name: 'Verified Plumbing',
  trade: 'Plumbing',
  rating: '5.0',
  openLabel: '0 open',
  statusPill: { variant: 'alternative' as const, label: 'No open jobs' },
  href: '/vendors/vendor-1',
};

describe('VendorRow', () => {
  it('supports a truthful nullable acceptance presentation for VA context', () => {
    render(
      <VendorRow
        row={row}
        metric={{ text: 'Unknown', ariaLabel: 'acceptance not recorded' }}
      />,
    );

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAccessibleName(
      /acceptance not recorded/i,
    );
    expect(screen.queryByText('5.0★')).not.toBeInTheDocument();
  });
});
