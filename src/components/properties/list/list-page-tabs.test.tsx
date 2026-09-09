import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ListPageTabs } from './list-page-tabs';

describe('ListPageTabs role hierarchy', () => {
  it('preserves the Rent tab for an owner', () => {
    render(<ListPageTabs active="tenants" audience="owner" />);

    expect(screen.getByTestId('list-tab-rent')).toHaveAttribute('href', '/rent');
  });

  it('hides the owner-only Rent tab for a VA', () => {
    render(<ListPageTabs active="tenants" audience="va" />);

    expect(screen.queryByTestId('list-tab-rent')).not.toBeInTheDocument();
    expect(screen.getByTestId('list-tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('list-tab-vendors')).toBeInTheDocument();
    expect(screen.getByTestId('list-tab-documents')).toBeInTheDocument();
  });
});
