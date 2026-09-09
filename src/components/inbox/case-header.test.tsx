import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConversationDetail } from '@/lib/inbox/conversation-queries';

const conversationActions = {
  snoozeConversation: vi.fn(),
  muteConversation: vi.fn(),
  snoozing: false,
  muting: false,
};

vi.mock('@/components/inbox/conversations-context', () => ({
  useConversations: () => conversationActions,
}));

import { CaseHeader } from './case-header';

const detail = {
  id: 'conversation-1',
  tenant: {
    id: 'tenant-1',
    name: 'Galaxy Test Tenant',
    phoneE164: '+15555550101',
    badge: 'TENANT SINCE 2024',
    propertyName: 'Galaxy Apartments',
    unitLabel: 'Unit 1A',
    bedBath: '2 bed · 1 bath',
    currentRent: '$1,900',
  },
  messages: [],
  pendingDraft: null,
  caseContext: {},
  snoozedUntil: null,
  snoozedActive: false,
  muted: false,
} as unknown as ConversationDetail;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CaseHeader role controls', () => {
  it('keeps owner queue controls available in the normal case file', () => {
    render(
      <CaseHeader
        detail={detail}
        status={{ kind: 'review', label: 'Needs review' }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Snooze' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Mute' })).toBeVisible();
  });

  it('removes owner queue controls from the Operations Assistant case file', () => {
    render(
      <CaseHeader
        detail={detail}
        status={{ kind: 'review', label: 'Owner review' }}
        readOnly
      />,
    );

    expect(screen.queryByRole('button', { name: 'Snooze' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mute' })).toBeNull();
  });
});
