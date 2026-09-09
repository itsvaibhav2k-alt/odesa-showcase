import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploadAction = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('./actions', () => ({
  uploadDocumentAction: (form: FormData) => uploadAction(form),
}));

import { UploadDocumentButton } from './upload-document-button';

const LEASES = [
  {
    id: '66666666-6666-6666-6666-666666666666',
    label: 'Truth House · Unit 2A · Maya Chen · Active through Jul 2027',
  },
];

function openAndAttach(): void {
  fireEvent.click(screen.getByTestId('upload-document-button'));
  fireEvent.change(screen.getByLabelText('File'), {
    target: {
      files: [new File(['lease'], 'lease.pdf', { type: 'application/pdf' })],
    },
  });
}

beforeEach(() => {
  uploadAction.mockReset();
  refresh.mockReset();
  uploadAction.mockResolvedValue({
    success: true,
    data: { id: 'doc-1', storagePath: 'org/lease.pdf' },
  });
});

describe('UploadDocumentButton lease association', () => {
  it('requires an explicit exact current lease for a lease document', async () => {
    render(<UploadDocumentButton leaseOptions={LEASES} />);
    openAndAttach();

    expect(screen.getByLabelText('Current lease')).toBeRequired();
    fireEvent.submit(screen.getByTestId('upload-document-form'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Select the exact current lease this document belongs to.',
    );
    expect(uploadAction).not.toHaveBeenCalled();
  });

  it('submits the selected lease id through the normal operator action', async () => {
    render(<UploadDocumentButton leaseOptions={LEASES} />);
    openAndAttach();
    fireEvent.change(screen.getByLabelText('Current lease'), {
      target: { value: LEASES[0]!.id },
    });
    fireEvent.submit(screen.getByTestId('upload-document-form'));

    await waitFor(() => expect(uploadAction).toHaveBeenCalledTimes(1));
    const form = uploadAction.mock.calls[0]![0] as FormData;
    expect(form.get('kind')).toBe('lease');
    expect(form.get('leaseId')).toBe(LEASES[0]!.id);
  });

  it('hides lease association for a non-lease document', () => {
    render(<UploadDocumentButton leaseOptions={LEASES} />);
    fireEvent.click(screen.getByTestId('upload-document-button'));
    fireEvent.change(screen.getByLabelText('Type'), {
      target: { value: 'insurance' },
    });

    expect(screen.queryByLabelText('Current lease')).not.toBeInTheDocument();
  });
});
