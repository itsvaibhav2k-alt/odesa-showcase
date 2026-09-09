/**
 * Unit tests for the `/properties` route error boundaries.
 *
 * Each boundary is a Next.js `error.tsx` client component that receives an
 * `error` and a `reset` callback. We assert it renders a safe, route-specific
 * message via the shared `ErrorState` and that clicking the retry control
 * invokes `reset` (Next.js re-attempts the failed render).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import PropertiesError from '../error';
import PropertyDetailError from '../[id]/error';

describe('PropertiesError boundary', () => {
  it('should render the properties-level message and the boundary testid', () => {
    const error = new Error('boom');
    render(<PropertiesError error={error} reset={vi.fn()} />);

    expect(
      screen.getByTestId('properties-error-boundary'),
    ).toBeInTheDocument();
    expect(screen.getByText("Couldn't load properties")).toBeInTheDocument();
  });

  it('should call reset when the retry control is clicked', () => {
    const reset = vi.fn();
    render(<PropertiesError error={new Error('boom')} reset={reset} />);

    fireEvent.click(screen.getByTestId('retry-btn'));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('PropertyDetailError boundary', () => {
  it('should render the detail-level message and the boundary testid', () => {
    const error = new Error('boom');
    render(<PropertyDetailError error={error} reset={vi.fn()} />);

    expect(
      screen.getByTestId('property-detail-error-boundary'),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Couldn't load this property"),
    ).toBeInTheDocument();
  });

  it('should call reset when the retry control is clicked', () => {
    const reset = vi.fn();
    render(<PropertyDetailError error={new Error('boom')} reset={reset} />);

    fireEvent.click(screen.getByTestId('retry-btn'));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
