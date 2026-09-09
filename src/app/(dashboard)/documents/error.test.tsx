import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DocumentsError from './error';
import DocumentsLoading from './loading';

describe('DocumentsError', () => {
  it('renders a safe ledger error and retries the route', () => {
    const reset = vi.fn();
    render(<DocumentsError reset={reset} />);

    expect(screen.getByTestId('documents-error-boundary')).toBeInTheDocument();
    expect(screen.getByText("Couldn't load documents")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('retry-btn'));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('renders a document-shaped loading state', () => {
    render(<DocumentsLoading />);

    expect(screen.getByTestId('documents-loading')).toBeInTheDocument();
  });
});
