/**
 * Tests for DraftHeroCard — Wave 6.
 *
 * `useConversations` is mocked at the module level so we can return a
 * spy-controlled context value per test. The component should never
 * call into the real `loadConversationAction` / `approveDraftAction`
 * pipeline; the provider abstraction is the boundary.
 *
 * Test plan (mirrors `06-draft-hero.md`):
 *   1. Renders body + recipient + drafted timestamp.
 *   2. "Review & send" opens the send-confirm dialog; ONLY the dialog
 *      confirm calls `approvePendingDraft` (exactly once).
 *   3. Reject calls `rejectPendingDraft` exactly once.
 *   4. Edit → textarea pre-filled → Save calls `editPendingDraft(newBody)`.
 *   5. Edit → Cancel restores body without firing the action.
 *   6. Loading flags disable the action buttons.
 *   7. "Why this draft?" keeps raw model reasoning out of customer copy.
 *   8. The popover renders structured source-record context.
 *   9. Test-ids `pending-draft-*` resolve to the expected elements.
 *  10. `formatDraftedMeta` unit boundaries (minutes / hours / days /
 *      future / invalid).
 *  11. Vendor SMS variant renders the channel label.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock useConversations — module-level so the component's `import` sees
// the spy implementation. Each test customises the return via
// `mockConversationsValue` before rendering.
// ---------------------------------------------------------------------------

type MockSelectedDetail = {
  tenant: {
    name: string;
    phoneE164: string | null;
    propertyName: string | null;
    unitLabel: string | null;
  };
  pendingDraft: { id: string; body: string; reasoning: string | null } | null;
  caseContext: {
    payments: { daysLateTier: number | 'escalated' | null };
    workOrder: { category: string; status: string } | null;
  };
} | null;

type MockConversationsValue = {
  approvingDraft: boolean;
  rejectingDraft: boolean;
  editingDraft: boolean;
  regeneratingDraft: boolean;
  selectedDetail: MockSelectedDetail;
  sendConfirmRequestKey: number;
  approvePendingDraft: ReturnType<typeof vi.fn>;
  rejectPendingDraft: ReturnType<typeof vi.fn>;
  editPendingDraft: ReturnType<typeof vi.fn>;
};

const mockConversationsValue: MockConversationsValue = {
  approvingDraft: false,
  rejectingDraft: false,
  editingDraft: false,
  regeneratingDraft: false,
  selectedDetail: null,
  sendConfirmRequestKey: 0,
  approvePendingDraft: vi.fn().mockResolvedValue(undefined),
  rejectPendingDraft: vi.fn().mockResolvedValue(undefined),
  editPendingDraft: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/components/inbox/conversations-context', () => ({
  useConversations: () => mockConversationsValue,
}));

import DraftHeroCard, {
  formatDraftedMeta,
  type DraftHeroCardProps,
} from './draft-hero-card';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function resetConversationsMock(
  overrides: Partial<MockConversationsValue> = {},
) {
  mockConversationsValue.approvingDraft = overrides.approvingDraft ?? false;
  mockConversationsValue.rejectingDraft = overrides.rejectingDraft ?? false;
  mockConversationsValue.editingDraft = overrides.editingDraft ?? false;
  mockConversationsValue.regeneratingDraft =
    overrides.regeneratingDraft ?? false;
  mockConversationsValue.selectedDetail = overrides.selectedDetail ?? null;
  mockConversationsValue.sendConfirmRequestKey =
    overrides.sendConfirmRequestKey ?? 0;
  mockConversationsValue.approvePendingDraft =
    overrides.approvePendingDraft ?? vi.fn().mockResolvedValue(undefined);
  mockConversationsValue.rejectPendingDraft =
    overrides.rejectPendingDraft ?? vi.fn().mockResolvedValue(undefined);
  mockConversationsValue.editPendingDraft =
    overrides.editPendingDraft ?? vi.fn().mockResolvedValue(undefined);
}

function makeSelectedDetail(
  overrides: Partial<NonNullable<MockSelectedDetail>> = {},
): NonNullable<MockSelectedDetail> {
  return {
    tenant: {
      name: 'Jamie Watanabe',
      phoneE164: '+15715551234',
      propertyName: 'Oakwood Commons',
      unitLabel: '2B',
    },
    pendingDraft: {
      id: 'draft_abc',
      body: 'Hi Jamie — confirming the inspector arrives Tuesday 9am.',
      reasoning: null,
    },
    caseContext: {
      payments: { daysLateTier: null },
      workOrder: null,
    },
    ...overrides,
  };
}

function makeProps(
  overrides: Partial<DraftHeroCardProps> = {},
): DraftHeroCardProps {
  return {
    messageId: 'msg_123',
    draft: {
      id: 'draft_abc',
      body: 'Hi Jamie — confirming the inspector arrives Tuesday 9am.',
      reasoning:
        'Tenant asked about inspector timing; lease clause 4.2 requires 24h notice.',
    },
    recipient: { name: 'Jamie Watanabe', channel: 'SMS' },
    draftedAt: '2026-05-28T14:30:00Z',
    // Exercise the retained legacy mutation implementation explicitly. The
    // production case file uses the component's fail-closed default.
    readOnly: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetConversationsMock();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('DraftHeroCard', () => {
  describe('rendering', () => {
    it('should render the card root with the pending-draft-{messageId} test-id', () => {
      render(<DraftHeroCard {...makeProps({ messageId: 'msg_42' })} />);
      expect(screen.getByTestId('pending-draft-msg_42')).toBeInTheDocument();
    });

    it('should render the draft body text', () => {
      const props = makeProps();
      render(<DraftHeroCard {...props} />);
      expect(screen.getByText(props.draft.body)).toBeInTheDocument();
    });

    it('should render the recipient name and channel in the TO line, uppercased', () => {
      render(
        <DraftHeroCard
          {...makeProps({
            recipient: { name: 'Jamie Watanabe', channel: 'SMS' },
          })}
        />,
      );
      expect(screen.getByText(/TO JAMIE WATANABE · SMS/i)).toBeInTheDocument();
    });

    it('should render the review-first message-draft eyebrow', () => {
      render(<DraftHeroCard {...makeProps()} />);
      expect(
        screen.getByText(/Message draft ready for review/i),
      ).toBeInTheDocument();
    });

    it('should render a VA draft as an owner handoff without mutation controls', () => {
      render(<DraftHeroCard {...makeProps()} readOnly />);

      expect(
        screen.getByText(/Message draft · owner review required/i),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('pending-draft-owner-boundary'),
      ).toHaveTextContent('Owner Queue review required');
      expect(
        screen.queryByTestId('pending-draft-approve'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('pending-draft-edit'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('pending-draft-reject'),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('pending-draft-why')).toBeInTheDocument();
      expect(
        screen.queryByTestId('send-confirm-dialog'),
      ).not.toBeInTheDocument();
    });

    it('should render the DRAFTED meta line containing the formatted clock time', () => {
      render(<DraftHeroCard {...makeProps()} />);
      // The exact "Xm AGO" suffix depends on current time, so assert
      // only the static `DRAFTED ` prefix.
      const allMeta = screen.getByText(/DRAFTED /);
      expect(allMeta).toBeInTheDocument();
    });

    it('should render the Vendor SMS channel variant when channel is "Vendor SMS"', () => {
      render(
        <DraftHeroCard
          {...makeProps({
            recipient: { name: 'AcmePlumbing', channel: 'Vendor SMS' },
          })}
        />,
      );
      expect(
        screen.getByText(/TO ACMEPLUMBING · VENDOR SMS/i),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Approve / Reject
  // -------------------------------------------------------------------------

  describe('approve action (send-confirm gate)', () => {
    it('should open the send-confirm dialog — NOT send — when Review & send is clicked', async () => {
      const approve = vi.fn().mockResolvedValue(undefined);
      resetConversationsMock({
        approvePendingDraft: approve,
        selectedDetail: makeSelectedDetail(),
      });

      render(<DraftHeroCard {...makeProps()} />);
      fireEvent.click(screen.getByTestId('pending-draft-approve'));

      await waitFor(() => {
        expect(screen.getByTestId('send-confirm-dialog')).toBeInTheDocument();
      });
      // UI no-bypass guarantee: the button only opens the dialog.
      expect(approve).not.toHaveBeenCalled();
    });

    it('should call approvePendingDraft exactly once when the dialog confirm is clicked', async () => {
      const approve = vi.fn().mockResolvedValue(undefined);
      resetConversationsMock({
        approvePendingDraft: approve,
        selectedDetail: makeSelectedDetail(),
      });

      render(<DraftHeroCard {...makeProps()} />);
      fireEvent.click(screen.getByTestId('pending-draft-approve'));

      await waitFor(() => {
        expect(screen.getByTestId('send-confirm-send')).toBeInTheDocument();
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('send-confirm-send'));
      });

      expect(approve).toHaveBeenCalledTimes(1);
    });

    it('should render real recipient/property/message rows in the dialog', async () => {
      resetConversationsMock({ selectedDetail: makeSelectedDetail() });

      render(<DraftHeroCard {...makeProps()} />);
      fireEvent.click(screen.getByTestId('pending-draft-approve'));

      await waitFor(() => {
        expect(screen.getByTestId('send-confirm-dialog')).toBeInTheDocument();
      });
      expect(screen.getByTestId('send-confirm-to').textContent).toBe(
        'Jamie Watanabe · SMS +15715551234',
      );
      expect(screen.getByTestId('send-confirm-property').textContent).toBe(
        'Oakwood Commons · Unit 2B',
      );
      expect(screen.getByTestId('send-confirm-message').textContent).toBe(
        'Hi Jamie — confirming the inspector arrives Tuesday 9am.',
      );
      expect(
        screen.getByText(
          /This message will be sent now over SMS\. It cannot be unsent\./i,
        ),
      ).toBeInTheDocument();
      expect(screen.getByTestId('send-confirm-send').textContent).toBe(
        'Send SMS to Jamie',
      );
    });

    it('should omit the property and context rows when those fields are absent', async () => {
      resetConversationsMock({
        selectedDetail: makeSelectedDetail({
          tenant: {
            name: 'Jamie Watanabe',
            phoneE164: null,
            propertyName: null,
            unitLabel: null,
          },
        }),
      });

      render(<DraftHeroCard {...makeProps()} />);
      fireEvent.click(screen.getByTestId('pending-draft-approve'));

      await waitFor(() => {
        expect(screen.getByTestId('send-confirm-dialog')).toBeInTheDocument();
      });
      expect(screen.getByTestId('send-confirm-to').textContent).toBe(
        'Jamie Watanabe',
      );
      expect(
        screen.queryByTestId('send-confirm-property'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('send-confirm-context'),
      ).not.toBeInTheDocument();
    });

    it('should render context lines from the real case context when present', async () => {
      resetConversationsMock({
        selectedDetail: makeSelectedDetail({
          caseContext: {
            payments: { daysLateTier: 3 },
            workOrder: { category: 'plumbing', status: 'in_progress' },
          },
        }),
      });

      render(<DraftHeroCard {...makeProps()} />);
      fireEvent.click(screen.getByTestId('pending-draft-approve'));

      await waitFor(() => {
        expect(screen.getByTestId('send-confirm-context')).toBeInTheDocument();
      });
      const context = screen.getByTestId('send-confirm-context');
      expect(context.textContent).toContain(
        'Open work order — plumbing · in progress',
      );
      expect(context.textContent).toContain('Rent 3+ days late');
    });

    it('should open the dialog when the provider sendConfirmRequestKey pulses', async () => {
      resetConversationsMock({ selectedDetail: makeSelectedDetail() });

      const { rerender } = render(<DraftHeroCard {...makeProps()} />);
      expect(
        screen.queryByTestId('send-confirm-dialog'),
      ).not.toBeInTheDocument();

      mockConversationsValue.sendConfirmRequestKey = 1;
      rerender(<DraftHeroCard {...makeProps()} />);

      await waitFor(() => {
        expect(screen.getByTestId('send-confirm-dialog')).toBeInTheDocument();
      });
      expect(mockConversationsValue.approvePendingDraft).not.toHaveBeenCalled();
    });
  });

  describe('reject action', () => {
    it('should call rejectPendingDraft exactly once when the reject button is clicked', () => {
      const reject = vi.fn().mockResolvedValue(undefined);
      resetConversationsMock({ rejectPendingDraft: reject });

      render(<DraftHeroCard {...makeProps()} />);
      fireEvent.click(screen.getByTestId('pending-draft-reject'));

      expect(reject).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Edit flow
  // -------------------------------------------------------------------------

  describe('edit flow', () => {
    it('should mount a textarea pre-filled with the draft body when Edit is clicked', () => {
      const props = makeProps();
      render(<DraftHeroCard {...props} />);
      fireEvent.click(screen.getByTestId('pending-draft-edit'));

      const textarea = screen.getByTestId(
        'pending-draft-edit-textarea',
      ) as HTMLTextAreaElement;
      expect(textarea).toBeInTheDocument();
      expect(textarea.value).toBe(props.draft.body);
    });

    it('should render Cancel + Save action buttons while editing', () => {
      render(<DraftHeroCard {...makeProps()} />);
      fireEvent.click(screen.getByTestId('pending-draft-edit'));

      expect(
        screen.getByTestId('pending-draft-edit-cancel'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('pending-draft-edit-save')).toBeInTheDocument();
    });

    it('should call editPendingDraft with the textarea value when Save is clicked', async () => {
      const editAction = vi.fn().mockResolvedValue(undefined);
      resetConversationsMock({ editPendingDraft: editAction });

      render(<DraftHeroCard {...makeProps()} />);
      fireEvent.click(screen.getByTestId('pending-draft-edit'));

      const textarea = screen.getByTestId('pending-draft-edit-textarea');
      fireEvent.change(textarea, {
        target: { value: 'Updated reply text' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('pending-draft-edit-save'));
      });

      expect(editAction).toHaveBeenCalledTimes(1);
      expect(editAction).toHaveBeenCalledWith('Updated reply text');
    });

    it('should disable Save when the textarea is empty or whitespace', () => {
      const editAction = vi.fn().mockResolvedValue(undefined);
      resetConversationsMock({ editPendingDraft: editAction });

      render(<DraftHeroCard {...makeProps()} />);
      fireEvent.click(screen.getByTestId('pending-draft-edit'));

      fireEvent.change(screen.getByTestId('pending-draft-edit-textarea'), {
        target: { value: '   ' },
      });

      const saveBtn = screen.getByTestId(
        'pending-draft-edit-save',
      ) as HTMLButtonElement;
      expect(saveBtn).toBeDisabled();
    });

    it('should exit edit mode and not call the action when Cancel is clicked', () => {
      const editAction = vi.fn().mockResolvedValue(undefined);
      resetConversationsMock({ editPendingDraft: editAction });

      const props = makeProps();
      render(<DraftHeroCard {...props} />);
      fireEvent.click(screen.getByTestId('pending-draft-edit'));

      fireEvent.change(screen.getByTestId('pending-draft-edit-textarea'), {
        target: { value: 'Different text the user types but discards' },
      });

      fireEvent.click(screen.getByTestId('pending-draft-edit-cancel'));

      expect(editAction).not.toHaveBeenCalled();
      // After Cancel the textarea is gone and the original body is back.
      expect(
        screen.queryByTestId('pending-draft-edit-textarea'),
      ).not.toBeInTheDocument();
      expect(screen.getByText(props.draft.body)).toBeInTheDocument();
    });

    it('should exit edit mode after a successful Save', async () => {
      const editAction = vi.fn().mockResolvedValue(undefined);
      resetConversationsMock({ editPendingDraft: editAction });

      render(<DraftHeroCard {...makeProps()} />);
      fireEvent.click(screen.getByTestId('pending-draft-edit'));
      fireEvent.change(screen.getByTestId('pending-draft-edit-textarea'), {
        target: { value: 'New body' },
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('pending-draft-edit-save'));
      });

      await waitFor(() =>
        expect(
          screen.queryByTestId('pending-draft-edit-textarea'),
        ).not.toBeInTheDocument(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  describe('loading state', () => {
    it('should disable Approve/Edit/Reject when approvingDraft is true', () => {
      resetConversationsMock({ approvingDraft: true });
      render(<DraftHeroCard {...makeProps()} />);

      expect(screen.getByTestId('pending-draft-approve')).toBeDisabled();
      expect(screen.getByTestId('pending-draft-edit')).toBeDisabled();
      expect(screen.getByTestId('pending-draft-reject')).toBeDisabled();
    });

    it('should disable Approve/Edit/Reject when rejectingDraft is true', () => {
      resetConversationsMock({ rejectingDraft: true });
      render(<DraftHeroCard {...makeProps()} />);

      expect(screen.getByTestId('pending-draft-approve')).toBeDisabled();
      expect(screen.getByTestId('pending-draft-edit')).toBeDisabled();
      expect(screen.getByTestId('pending-draft-reject')).toBeDisabled();
    });

    it('should disable Approve/Edit/Reject when editingDraft is true', () => {
      resetConversationsMock({ editingDraft: true });
      render(<DraftHeroCard {...makeProps()} />);

      expect(screen.getByTestId('pending-draft-approve')).toBeDisabled();
      expect(screen.getByTestId('pending-draft-edit')).toBeDisabled();
      expect(screen.getByTestId('pending-draft-reject')).toBeDisabled();
    });

    it('should disable Approve/Edit/Reject when regeneratingDraft is true', () => {
      resetConversationsMock({ regeneratingDraft: true });
      render(<DraftHeroCard {...makeProps()} />);

      expect(screen.getByTestId('pending-draft-approve')).toBeDisabled();
      expect(screen.getByTestId('pending-draft-edit')).toBeDisabled();
      expect(screen.getByTestId('pending-draft-reject')).toBeDisabled();
    });

    it('should show the rewriting note when a regenerate lands mid-edit', () => {
      resetConversationsMock();
      const { rerender } = render(<DraftHeroCard {...makeProps()} />);
      fireEvent.click(screen.getByTestId('pending-draft-edit'));
      expect(
        screen.queryByTestId('pending-draft-regenerating-note'),
      ).not.toBeInTheDocument();

      mockConversationsValue.regeneratingDraft = true;
      rerender(<DraftHeroCard {...makeProps()} />);

      expect(
        screen.getByTestId('pending-draft-regenerating-note').textContent,
      ).toMatch(
        /Odesa is rewriting this draft — your unsaved edits will be replaced\./,
      );
    });

    it('should not show the rewriting note while regenerating outside edit mode', () => {
      resetConversationsMock({ regeneratingDraft: true });
      render(<DraftHeroCard {...makeProps()} />);
      expect(
        screen.queryByTestId('pending-draft-regenerating-note'),
      ).not.toBeInTheDocument();
    });

    it('should render an inline spinner inside the active action while approving', () => {
      resetConversationsMock({ approvingDraft: true });
      render(<DraftHeroCard {...makeProps()} />);
      // Spinner is a `role="status"` span scoped inside the action.
      const spinner = screen.getByRole('status', { name: /approving draft/i });
      expect(spinner).toBeInTheDocument();
    });

    it('should not render the spinner when no action is in-flight', () => {
      resetConversationsMock();
      render(<DraftHeroCard {...makeProps()} />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Why-this-draft popover
  // -------------------------------------------------------------------------

  describe('why this draft popover', () => {
    it('should keep raw reasoning out of customer copy', async () => {
      const props = makeProps({
        draft: {
          id: 'd1',
          body: 'hello',
          reasoning: 'Reasoned: late-rent reminder is the second touch today.',
        },
      });
      render(<DraftHeroCard {...props} />);

      fireEvent.click(screen.getByTestId('pending-draft-why'));

      await waitFor(() => {
        expect(
          screen.getByTestId('pending-draft-why-fallback'),
        ).toBeInTheDocument();
      });
      expect(
        screen.queryByText(/Reasoned: late-rent reminder/i),
      ).not.toBeInTheDocument();
    });

    it('should show the structured known-context fallback when reasoning is null', async () => {
      resetConversationsMock({
        selectedDetail: makeSelectedDetail({
          caseContext: {
            payments: { daysLateTier: 7 },
            workOrder: { category: 'heating', status: 'open' },
          },
        }),
      });
      const props = makeProps({
        draft: { id: 'd1', body: 'hello', reasoning: null },
      });
      render(<DraftHeroCard {...props} />);

      fireEvent.click(screen.getByTestId('pending-draft-why'));

      await waitFor(() => {
        expect(
          screen.getByTestId('pending-draft-why-fallback'),
        ).toBeInTheDocument();
      });
      const fallback = screen.getByTestId('pending-draft-why-fallback');
      expect(fallback.textContent).toContain('No stored reasoning trace');
      expect(fallback.textContent).toContain('DRAFTED');
      expect(fallback.textContent).toContain('To Jamie Watanabe · SMS');
      expect(fallback.textContent).toContain('Oakwood Commons · Unit 2B');
      expect(fallback.textContent).toContain(
        'Open work order — heating · open',
      );
      expect(fallback.textContent).toContain('Rent 7+ days late');
      expect(fallback.textContent).toContain(
        'No message sends until owner review is complete.',
      );
    });

    it('should omit unavailable fields from the fallback (no fabrication)', async () => {
      // No selectedDetail at all — only the prop-derived lines render.
      resetConversationsMock({ selectedDetail: null });
      const props = makeProps({
        draft: { id: 'd1', body: 'hello', reasoning: null },
      });
      render(<DraftHeroCard {...props} />);

      fireEvent.click(screen.getByTestId('pending-draft-why'));

      await waitFor(() => {
        expect(
          screen.getByTestId('pending-draft-why-fallback'),
        ).toBeInTheDocument();
      });
      const fallback = screen.getByTestId('pending-draft-why-fallback');
      expect(fallback.textContent).not.toContain('Open work order');
      expect(fallback.textContent).not.toContain('days late');
      expect(fallback.textContent).toContain(
        'No message sends until owner review is complete.',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// formatDraftedMeta unit tests
// ---------------------------------------------------------------------------

describe('formatDraftedMeta', () => {
  it('should return "JUST NOW" when the draft is less than a minute old', () => {
    const now = new Date('2026-05-28T14:30:00Z');
    const iso = '2026-05-28T14:29:30Z'; // 30s ago
    expect(formatDraftedMeta(iso, now)).toMatch(/^DRAFTED .+ · JUST NOW$/);
  });

  it('should format minutes ago when under an hour', () => {
    const now = new Date('2026-05-28T14:30:00Z');
    const iso = '2026-05-28T14:18:00Z'; // 12m ago
    expect(formatDraftedMeta(iso, now)).toMatch(/· 12M AGO$/);
  });

  it('should format hours ago between 1 and 24', () => {
    const now = new Date('2026-05-28T14:30:00Z');
    const iso = '2026-05-28T11:30:00Z'; // 3h ago
    expect(formatDraftedMeta(iso, now)).toMatch(/· 3H AGO$/);
  });

  it('should format days ago when older than 24h', () => {
    const now = new Date('2026-05-28T14:30:00Z');
    const iso = '2026-05-26T14:30:00Z'; // 2d ago
    expect(formatDraftedMeta(iso, now)).toMatch(/· 2D AGO$/);
  });

  it('should drop the ago suffix when the timestamp is in the future', () => {
    const now = new Date('2026-05-28T14:30:00Z');
    const iso = '2026-05-28T15:00:00Z';
    const out = formatDraftedMeta(iso, now);
    expect(out).toMatch(/^DRAFTED /);
    expect(out).not.toMatch(/AGO/);
  });

  it('should return "DRAFTED —" for an invalid ISO', () => {
    expect(formatDraftedMeta('not-a-date')).toBe('DRAFTED —');
  });
});
