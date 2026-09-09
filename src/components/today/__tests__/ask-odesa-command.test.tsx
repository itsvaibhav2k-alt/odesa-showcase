import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AskOdesaCommand } from '@/components/today/ask-odesa-command';
import type { QueueItem } from '@/types/today';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const selectedItem: QueueItem = {
  id: 'record-1',
  status: 'waiting',
  title: 'Late rent',
  property: 'Galaxy A',
  tenant: 'Dana Reed',
  meta: ['Dana Reed', 'Unit 2A'],
  recommendation: 'Open the Rent record for source evidence.',
  timestamp: 'today',
  channel: 'rent',
  contextLabel: 'Dana Reed rent record',
  contextSuggestions: [
    'Show payment history',
    'Summarize the balance',
    'Draft a reminder',
    'What evidence is missing?',
  ],
  contextPlaceholder: 'Ask about this rent record…',
  primaryAction: { label: 'Open rent record', handler: '/rent' },
};

beforeEach(() => push.mockReset());

describe('AskOdesaCommand contextual handoff', () => {
  it('carries the selected source context into a free-text handoff', () => {
    render(<AskOdesaCommand selectedItem={selectedItem} />);

    fireEvent.change(screen.getByLabelText('Ask Odesa'), {
      target: { value: 'What should I check?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const href = push.mock.calls[0]?.[0] as string;
    expect(decodeURIComponent(href.replace('/assistant?q=', ''))).toBe(
      'Today context — Dana Reed rent record: What should I check?',
    );
    expect(href).not.toContain('record-1');
  });

  it('carries the same context when a suggestion chip is used', () => {
    render(<AskOdesaCommand selectedItem={selectedItem} />);

    fireEvent.click(screen.getByRole('button', { name: /Show payment history/ }));

    const href = push.mock.calls[0]?.[0] as string;
    expect(decodeURIComponent(href.replace('/assistant?q=', ''))).toBe(
      'Today context — Dana Reed rent record: Show payment history',
    );
  });
});
