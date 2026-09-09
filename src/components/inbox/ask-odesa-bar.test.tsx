/**
 * RTL tests for AskOdesaBar — Wave 7.
 *
 * Two test surfaces:
 *
 *   1. Chip-dispatch (mocked `useConversations` + `useRouter`): every
 *      chip kind hands grounded context to the global assistant. Mocks isolate the bar
 *      from the provider so we don't have to seed Supabase fixtures.
 *
 *   2. Legacy local mutation hooks remain untouched by chip clicks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';

// ---------------------------------------------------------------------------
// Router mock
// ---------------------------------------------------------------------------

const pushSpy = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushSpy,
    refresh: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// useConversations mock — mutable so each test can override pieces.
// ---------------------------------------------------------------------------

type MockConversationsValue = {
  selectedConversationId: string | null;
  selectedDetail: {
    id: string;
    tenant: { id: string | null; name: string };
    pendingDraft: { id: string; body: string; reasoning: string | null } | null;
    caseContext: { workOrder: unknown | null };
  } | null;
  conversations: Array<{
    id: string;
    pendingDraftId: string | null;
    lastMessageDirection: 'inbound' | 'outbound';
    lastMessageAt: string;
  }>;
  slaMap: Map<string, boolean>;
  approvePendingDraft: ReturnType<typeof vi.fn>;
  requestSendConfirm: ReturnType<typeof vi.fn>;
  rejectPendingDraft: ReturnType<typeof vi.fn>;
  prefillOverride: (text: string) => void;
  regenerateDraft: ReturnType<typeof vi.fn>;
  regeneratingDraft: boolean;
  openEditDraft: ReturnType<typeof vi.fn>;
};

const mockConv: MockConversationsValue = makeDefaultMockConv();

function makeDefaultMockConv(): MockConversationsValue {
  return {
    selectedConversationId: 'c1',
    selectedDetail: {
      id: 'c1',
      tenant: { id: 't1', name: 'Priya Patel' },
      pendingDraft: {
        id: 'd1',
        body: 'Hi Priya, water shut-off scheduled.',
        reasoning: null,
      },
      caseContext: { workOrder: { id: 'wo1' } },
    },
    conversations: [
      {
        id: 'c1',
        pendingDraftId: 'd1',
        lastMessageDirection: 'inbound',
        lastMessageAt: new Date().toISOString(),
      },
    ],
    slaMap: new Map(),
    approvePendingDraft: vi.fn().mockResolvedValue(undefined),
    requestSendConfirm: vi.fn(),
    rejectPendingDraft: vi.fn().mockResolvedValue(undefined),
    prefillOverride: vi.fn(),
    regenerateDraft: vi.fn().mockResolvedValue(undefined),
    regeneratingDraft: false,
    openEditDraft: vi.fn(),
  };
}

vi.mock('@/components/inbox/conversations-context', () => ({
  useConversations: () => mockConv,
}));

import { AskOdesaBar } from './ask-odesa-bar';

beforeEach(() => {
  pushSpy.mockReset();
  // Reset all fields by mutating the existing object (so the mocked
  // useConversations() return identity is preserved across renders).
  const fresh = makeDefaultMockConv();
  for (const key of Object.keys(mockConv) as Array<keyof MockConversationsValue>) {
    (mockConv as unknown as Record<string, unknown>)[key as string] = (
      fresh as unknown as Record<string, unknown>
    )[key as string];
  }
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Suite 1 — chip dispatch
// ---------------------------------------------------------------------------

describe('AskOdesaBar — chip dispatch', () => {
  it('renders the in-context label with the derived contextLabel', () => {
    render(<AskOdesaBar />);
    const label = screen.getByTestId('ask-odesa-context-label');
    expect(label.textContent).toMatch(/In context — work order draft/);
  });

  it('renders the placeholder built from the chip context', () => {
    render(<AskOdesaBar />);
    const input = screen.getByTestId('ask-odesa-input') as HTMLInputElement;
    expect(input.placeholder).toBe("Ask Odesa about Priya's draft…");
  });

  it('routes Review & send to the global assistant without opening a local send flow', () => {
    render(<AskOdesaBar />);
    fireEvent.click(screen.getByTestId('ask-odesa-chip-approve_draft'));
    const target = pushSpy.mock.calls[0]?.[0] as string;
    expect(decodeURIComponent(target.replace('/assistant?q=', ''))).toContain(
      'prepare the next step for Owner Queue. Do not send it',
    );
    expect(mockConv.requestSendConfirm).not.toHaveBeenCalled();
    expect(mockConv.approvePendingDraft).not.toHaveBeenCalled();
  });

  it('routes a rewrite chip to the global assistant without mutating the draft', () => {
    render(<AskOdesaBar />);
    fireEvent.click(screen.getByTestId('ask-odesa-chip-regenerate_draft'));
    const target = pushSpy.mock.calls[0]?.[0] as string;
    expect(decodeURIComponent(target.replace('/assistant?q=', ''))).toContain(
      'Soften the tone',
    );
    expect(mockConv.regenerateDraft).not.toHaveBeenCalled();
  });

  it('does not couple global handoff chips to a legacy regenerate request', () => {
    mockConv.regeneratingDraft = true;
    render(<AskOdesaBar />);
    const regenChip = screen.getByTestId('ask-odesa-chip-regenerate_draft');
    expect(regenChip).not.toBeDisabled();
    fireEvent.click(regenChip);
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('routes a possible reply to the assistant without populating the local composer', () => {
    render(<AskOdesaBar />);
    fireEvent.click(screen.getByTestId('ask-odesa-chip-prefill_override'));
    const target = pushSpy.mock.calls[0]?.[0] as string;
    expect(decodeURIComponent(target.replace('/assistant?q=', ''))).toContain(
      'Hi Priya, can you send a quick photo of the issue?',
    );
    expect(mockConv.prefillOverride).not.toHaveBeenCalled();
  });

  it('routes to /assistant with the encoded prompt when ask_assistant fires', () => {
    render(<AskOdesaBar />);
    fireEvent.click(screen.getByTestId('ask-odesa-chip-ask_assistant'));
    expect(pushSpy).toHaveBeenCalledTimes(1);
    const target = pushSpy.mock.calls[0]?.[0] as string;
    expect(target).toMatch(/^\/assistant\?q=/);
    expect(decodeURIComponent(target.replace(/^\/assistant\?q=/, ''))).toBe(
      'Inbox case context — work order draft: Why did you draft the pending reply this way?',
    );
  });

  it('routes to /assistant when the user presses Enter in the input', () => {
    render(<AskOdesaBar />);
    const input = screen.getByTestId('ask-odesa-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'why was rent late?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    const target = pushSpy.mock.calls[0]?.[0] as string;
    expect(decodeURIComponent(target.replace('/assistant?q=', ''))).toBe(
      'Inbox case context — work order draft: why was rent late?',
    );
  });

  it('does not route to /assistant when Enter fires on an empty input', () => {
    render(<AskOdesaBar />);
    const input = screen.getByTestId('ask-odesa-input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('renders four chips for the review status', () => {
    render(<AskOdesaBar />);
    expect(screen.getByTestId('ask-odesa-chip-approve_draft')).toBeInTheDocument();
    expect(screen.getByTestId('ask-odesa-chip-regenerate_draft')).toBeInTheDocument();
    expect(screen.getByTestId('ask-odesa-chip-prefill_override')).toBeInTheDocument();
    expect(screen.getByTestId('ask-odesa-chip-ask_assistant')).toBeInTheDocument();
  });

  it('falls back to the handled chip set when no conversation is selected', () => {
    mockConv.selectedConversationId = null;
    mockConv.selectedDetail = null;
    mockConv.conversations = [];
    render(<AskOdesaBar />);
    const label = screen.getByTestId('ask-odesa-context-label');
    expect(label.textContent).toMatch(/quiet thread/);
  });

  it('shows the unknown-sender guardrail (Link tenant chip + unlinked label) when an open thread has no tenant id', () => {
    // An open case file whose tenant_id is null is an unmatched/unknown
    // SMS sender — tenant-specific chips must be suppressed so no
    // tenant-named rent/payment action can fire against "Unknown".
    mockConv.selectedDetail = {
      id: 'c1',
      tenant: { id: null, name: 'Unknown (+1 555-0100)' },
      pendingDraft: null,
      caseContext: { workOrder: null },
    };
    render(<AskOdesaBar />);
    const label = screen.getByTestId('ask-odesa-context-label');
    expect(label.textContent).toMatch(/unlinked thread/);
    // The "Link tenant" affordance leads the suppressed chip set, and no
    // tenant-specific chip ("Show payment history") survives.
    expect(screen.getByText('Link tenant')).toBeInTheDocument();
    expect(screen.queryByText('Show payment history')).not.toBeInTheDocument();
  });

  it('animates the suggestion row when the selected conversation changes', async () => {
    vi.useFakeTimers();
    const { rerender } = render(<AskOdesaBar />);
    const before = screen.getByTestId('ask-odesa-suggestions');
    expect(before.getAttribute('data-swapping')).toBe('false');

    mockConv.selectedConversationId = 'c2';
    mockConv.selectedDetail = {
      id: 'c2',
      tenant: { id: 't2', name: 'Jamie Watanabe' },
      pendingDraft: null,
      caseContext: { workOrder: null },
    };
    mockConv.conversations = [
      {
        id: 'c2',
        pendingDraftId: null,
        lastMessageDirection: 'outbound',
        lastMessageAt: new Date().toISOString(),
      },
    ];
    rerender(<AskOdesaBar />);
    const during = screen.getByTestId('ask-odesa-suggestions');
    expect(during.getAttribute('data-swapping')).toBe('true');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    const after = screen.getByTestId('ask-odesa-suggestions');
    expect(after.getAttribute('data-swapping')).toBe('false');
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — no local mutation bypass
// ---------------------------------------------------------------------------

describe('AskOdesaBar — no local mutation bypass', () => {
  it('keeps every local mutation hook untouched for a contextual chip', () => {
    render(<AskOdesaBar />);
    fireEvent.click(screen.getByTestId('ask-odesa-chip-prefill_override'));
    expect(mockConv.prefillOverride).not.toHaveBeenCalled();
    expect(mockConv.regenerateDraft).not.toHaveBeenCalled();
    expect(mockConv.requestSendConfirm).not.toHaveBeenCalled();
    expect(mockConv.rejectPendingDraft).not.toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });
});
