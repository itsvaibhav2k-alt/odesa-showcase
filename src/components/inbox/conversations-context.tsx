"use client";

/**
 * Client-side state for the wave-4 inbox surface.
 *
 * The wave-3 InboxStateProvider owned an approval-queue view-model
 * (3 buckets, one selection, edit state). Inbox is now the conversation
 * evidence surface; pending tenant-facing drafts remain owner-reviewed and
 * Owner Queue is the commitment ledger. This provider owns the mutable state
 * that view needs:
 *
 *   - The list of conversations (seeded from the server, refreshed on
 *     `router.refresh()`).
 *   - The currently selected conversation id.
 *   - The lazily-loaded thread for the open conversation.
 *   - Optimistic compose state so the owner's outbound bubble appears
 *     instantly while `sendOwnerMessageAction` is in flight.
 *   - The realtime push wiring (debounced via `useInboxRealtime`).
 *
 * Approve / Edit / Reject for the pending draft delegate to the
 * existing wave-3 server actions so the auth gates and DB writes are
 * unchanged.
 */

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import {
  approveDraftAction,
  editDraftAction,
  loadConversationAction,
  muteConversationAction,
  regenerateDraftAction,
  rejectDraftAction,
  sendOwnerMessageAction,
  snoozeConversationAction,
} from "@/app/(dashboard)/inbox/actions";
import type {
  ActivitySummary,
  ConversationDetail,
  ConversationListItem,
  ThreadMessage,
} from "@/lib/inbox/conversation-queries";
import { useInboxRealtime } from "@/components/inbox/use-inbox-realtime";

interface ConversationsValue {
  conversations: readonly ConversationListItem[];
  activity: ActivitySummary;

  /**
   * `Map<conversationId, workOrderSlaBreached>` — computed once at the
   * server (`getBreachedTenantIds`) and refreshed via realtime, so
   * queue chips can paint the `escalated` variant without firing a
   * per-row case-context fetch. Wave 5 plumbing.
   */
  slaMap: Map<string, boolean>;

  selectedConversationId: string | null;
  selectConversation: (id: string | null) => void;

  selectedDetail: ConversationDetail | null;
  isLoadingDetail: boolean;

  composeBody: string;
  setComposeBody: (body: string) => void;

  sending: boolean;
  sendOwner: () => Promise<void>;

  approvingDraft: boolean;
  approvePendingDraft: () => Promise<void>;

  rejectingDraft: boolean;
  rejectPendingDraft: () => Promise<void>;

  editingDraft: boolean;
  editPendingDraft: (body: string) => Promise<void>;

  /**
   * Wave 7 — regenerate the pending-review draft with a free-form
   * operator instruction (e.g. "soften the reminder"). Server action
   * calls the synthesizer and updates the draft in place. The caller
   * does not need to refetch — the provider reloads the open
   * conversation on success and pushes a toast.
   */
  regeneratingDraft: boolean;
  regenerateDraft: (instruction: string) => Promise<void>;

  /**
   * Wave 7 — pre-fill the manual-override textarea with text (e.g.
   * from an Ask Odesa chip template) and focus the input. No-op when
   * no textarea has registered itself yet.
   */
  prefillOverride: (text: string) => void;
  /**
   * Wave 7 — `<ManualOverride />` registers its textarea ref on mount
   * so `prefillOverride` can focus it. Returns an unregister fn so the
   * component can clean up on unmount.
   */
  registerComposeRef: (
    ref: RefObject<HTMLTextAreaElement | null>,
  ) => () => void;

  /**
   * Wave 7 — a monotonically-increasing counter that pulses when the
   * "Edit draft" chip is clicked. `<DraftHeroCard />` subscribes via
   * an effect on this value and flips into edit mode whenever it
   * advances (so successive clicks re-trigger the affordance).
   */
  editDraftRequestKey: number;
  openEditDraft: () => void;

  /**
   * Stage 7 (send safety) — a monotonically-increasing counter that
   * pulses when a chip (or any non-dialog surface) asks for the
   * send-confirmation dialog. `<DraftHeroCard />` (the dialog owner)
   * subscribes via an effect on this value and opens the confirm
   * dialog whenever it advances. The chip path never sends directly.
   */
  sendConfirmRequestKey: number;
  requestSendConfirm: () => void;

  /** Snooze (or, with `null`, un-snooze) the open conversation. */
  snoozing: boolean;
  snoozeConversation: (untilIso: string | null) => Promise<void>;

  /** Mute / unmute the open conversation. */
  muting: boolean;
  muteConversation: (muted: boolean) => Promise<void>;

  searchQuery: string;
  setSearchQuery: (q: string) => void;

  toast: { message: string; key: number } | null;
}

const ConversationsContext = createContext<ConversationsValue | null>(null);

export function useConversations(): ConversationsValue {
  const ctx = useContext(ConversationsContext);
  if (!ctx) {
    throw new Error(
      "useConversations must be used inside <ConversationsProvider>",
    );
  }
  return ctx;
}

interface ConversationsProviderProps {
  initialConversations: readonly ConversationListItem[];
  initialActivity: ActivitySummary;
  /** Undefined selects the first row; null preserves an unavailable drilldown. */
  initialSelectedConversationId?: string | null;
  /**
   * Map of conversation id → `workOrderSlaBreached`. Computed server-side
   * via `getBreachedTenantIds` and refreshed on `router.refresh()`.
   * Optional so existing callers (and tests) that don't plumb SLA data
   * still work — defaults to an empty map.
   */
  initialSlaMap?: ReadonlyMap<string, boolean>;
  children: ReactNode;
}

export function ConversationsProvider({
  initialConversations,
  initialActivity,
  initialSlaMap,
  initialSelectedConversationId,
  children,
}: ConversationsProviderProps) {
  const router = useRouter();

  const [conversations, setConversations] =
    useState<readonly ConversationListItem[]>(initialConversations);
  const [activity, setActivity] = useState<ActivitySummary>(initialActivity);
  const [slaMap, setSlaMap] = useState<Map<string, boolean>>(
    () => new Map(initialSlaMap ?? []),
  );
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(
    initialSelectedConversationId === undefined
      ? (initialConversations[0]?.id ?? null)
      : initialSelectedConversationId,
  );

  const [selectedDetail, setSelectedDetail] =
    useState<ConversationDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [approvingDraft, setApprovingDraft] = useState(false);
  const [rejectingDraft, setRejectingDraft] = useState(false);
  const [editingDraft, setEditingDraft] = useState(false);
  const [regeneratingDraft, setRegeneratingDraft] = useState(false);
  const [editDraftRequestKey, setEditDraftRequestKey] = useState(0);
  const [sendConfirmRequestKey, setSendConfirmRequestKey] = useState(0);
  const [snoozing, setSnoozing] = useState(false);
  const [muting, setMuting] = useState(false);

  // Held in a ref because `ManualOverride` registers itself once on
  // mount and we don't want a re-render storm when it does.
  const composeRefRef = useRef<RefObject<HTMLTextAreaElement | null> | null>(
    null,
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<ConversationsValue["toast"]>(null);

  // Tracks the latest selection so out-of-order fetch responses don't
  // overwrite a newer selection.
  const latestSelectionRef = useRef<string | null>(selectedConversationId);

  // Server-driven prop sync: when the server hands us a fresh envelope
  // (after `router.refresh()` or a realtime push) re-seed local state.
  // The ref guard skips the first render — `useState` already
  // initialised from the same object — only subsequent prop drift
  // matters.
  const seededConvsRef = useRef(initialConversations);
  useEffect(() => {
    if (seededConvsRef.current === initialConversations) return;
    seededConvsRef.current = initialConversations;
    setConversations(initialConversations);
  }, [initialConversations]);

  const seededActivityRef = useRef(initialActivity);
  useEffect(() => {
    if (seededActivityRef.current === initialActivity) return;
    seededActivityRef.current = initialActivity;
    setActivity(initialActivity);
  }, [initialActivity]);

  const seededSlaMapRef = useRef<ReadonlyMap<string, boolean> | undefined>(
    initialSlaMap,
  );
  useEffect(() => {
    if (seededSlaMapRef.current === initialSlaMap) return;
    seededSlaMapRef.current = initialSlaMap;
    setSlaMap(new Map(initialSlaMap ?? []));
  }, [initialSlaMap]);

  const seededSelectionRef = useRef<string | null | undefined>(
    initialSelectedConversationId,
  );
  useEffect(() => {
    if (seededSelectionRef.current === initialSelectedConversationId) return;
    seededSelectionRef.current = initialSelectedConversationId;
    if (initialSelectedConversationId !== undefined) {
      setSelectedConversationId(initialSelectedConversationId);
      setComposeBody("");
    }
  }, [initialSelectedConversationId]);

  const flashToast = useCallback((message: string) => {
    setToast({ message, key: Date.now() });
    window.setTimeout(() => {
      setToast((current) => (current?.message === message ? null : current));
    }, 2400);
  }, []);

  // Realtime: a debounced router.refresh() re-runs the page's loader,
  // hands us new initialConversations + initialActivity, and we re-sync
  // above. The open conversation also re-fetches via the effect below.
  const refresh = useCallback(() => {
    router.refresh();
    if (selectedConversationId) {
      void reloadOpenConversation(selectedConversationId);
    }
    // We don't include reloadOpenConversation in deps because it's
    // closing over `selectedConversationId` already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, selectedConversationId]);
  useInboxRealtime(activity.organizationId, refresh);

  // Lazy-load the open conversation.
  const reloadOpenConversation = useCallback(
    async (id: string): Promise<void> => {
      setIsLoadingDetail(true);
      try {
        const detail = await loadConversationAction(id);
        if (latestSelectionRef.current !== id) return;
        setSelectedDetail(detail);
      } catch {
        if (latestSelectionRef.current !== id) return;
        flashToast("Failed to load conversation.");
        setSelectedDetail(null);
      } finally {
        if (latestSelectionRef.current === id) {
          setIsLoadingDetail(false);
        }
      }
    },
    [flashToast],
  );

  useEffect(() => {
    latestSelectionRef.current = selectedConversationId;
    if (!selectedConversationId) {
      setSelectedDetail(null);
      return;
    }
    void reloadOpenConversation(selectedConversationId);
  }, [selectedConversationId, reloadOpenConversation]);

  const selectConversation = useCallback(
    (id: string | null) => {
      setSelectedConversationId(id);
      setComposeBody("");
      router.replace(
        id ? `/inbox?conversation=${encodeURIComponent(id)}` : "/inbox",
        { scroll: false },
      );
    },
    [router],
  );

  // ---------------------------------------------------------------------------
  // Owner-side compose
  // ---------------------------------------------------------------------------

  const sendOwner = useCallback(async () => {
    if (!selectedConversationId) return;
    const id = selectedConversationId;
    const body = composeBody.trim();
    if (!body) return;

    setSending(true);
    const optimistic: ThreadMessage = {
      id: `optimistic-${Date.now()}`,
      direction: "outbound",
      body,
      draftStatus: "sent_by_human",
      createdAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      deliveryStatus: "queued",
    };
    setSelectedDetail((prev) =>
      prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev,
    );
    setComposeBody("");

    try {
      const result = await sendOwnerMessageAction(id, body);
      if (!result.ok) {
        flashToast(result.error || "Failed to send message.");
        // Revert the optimistic bubble.
        setSelectedDetail((prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.filter((m) => m.id !== optimistic.id),
              }
            : prev,
        );
        return;
      }
      flashToast("Queued. Delivery confirmation pending.");
      // Re-fetch the thread so the optimistic bubble is replaced with
      // the canonical row (and provider_message_id is reflected).
      await reloadOpenConversation(id);
      router.refresh();
    } catch {
      flashToast("Failed to send message.");
      setSelectedDetail((prev) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.filter((m) => m.id !== optimistic.id),
            }
          : prev,
      );
    } finally {
      setSending(false);
    }
  }, [
    selectedConversationId,
    composeBody,
    flashToast,
    reloadOpenConversation,
    router,
  ]);

  // ---------------------------------------------------------------------------
  // Pending-draft actions (delegate to wave-3 server actions)
  // ---------------------------------------------------------------------------

  const approvePendingDraft = useCallback(async () => {
    const draft = selectedDetail?.pendingDraft;
    const conversationId = selectedConversationId;
    if (!draft || !conversationId) return;
    setApprovingDraft(true);
    try {
      const result = await approveDraftAction("message", draft.id);
      if (!result.ok) {
        flashToast(result.error || "Failed to send draft.");
        return;
      }
      // e2e selector hook
      console.info("approve");
      flashToast("Provider accepted. Delivery confirmation pending.");
      await reloadOpenConversation(conversationId);
      router.refresh();
    } catch {
      flashToast("Failed to send draft.");
    } finally {
      setApprovingDraft(false);
    }
  }, [
    selectedDetail,
    selectedConversationId,
    flashToast,
    reloadOpenConversation,
    router,
  ]);

  const rejectPendingDraft = useCallback(async () => {
    const draft = selectedDetail?.pendingDraft;
    const conversationId = selectedConversationId;
    if (!draft || !conversationId) return;
    setRejectingDraft(true);
    try {
      const result = await rejectDraftAction("message", draft.id);
      if (!result.ok) {
        flashToast(result.error || "Failed to reject draft.");
        return;
      }
      // e2e selector hook
      console.info("reject");
      flashToast("Draft rejected.");
      await reloadOpenConversation(conversationId);
      router.refresh();
    } catch {
      flashToast("Failed to reject draft.");
    } finally {
      setRejectingDraft(false);
    }
  }, [
    selectedDetail,
    selectedConversationId,
    flashToast,
    reloadOpenConversation,
    router,
  ]);

  const editPendingDraft = useCallback(
    async (body: string) => {
      const draft = selectedDetail?.pendingDraft;
      const conversationId = selectedConversationId;
      if (!draft || !conversationId) return;
      setEditingDraft(true);
      try {
        const result = await editDraftAction("message", draft.id, body);
        if (!result.ok) {
          flashToast(result.error || "Failed to update draft.");
          return;
        }
        // e2e selector hook
        console.info("edit");
        flashToast("Draft updated.");
        await reloadOpenConversation(conversationId);
        router.refresh();
      } catch {
        flashToast("Failed to update draft.");
      } finally {
        setEditingDraft(false);
      }
    },
    [
      selectedDetail,
      selectedConversationId,
      flashToast,
      reloadOpenConversation,
      router,
    ],
  );

  // ---------------------------------------------------------------------------
  // Wave 7 — regenerate, prefill-override, openEditDraft signal
  // ---------------------------------------------------------------------------

  const regenerateDraft = useCallback(
    async (instruction: string) => {
      const draft = selectedDetail?.pendingDraft;
      const conversationId = selectedConversationId;
      if (!draft || !conversationId) return;
      setRegeneratingDraft(true);
      try {
        const result = await regenerateDraftAction(draft.id, instruction);
        if (!result.ok) {
          flashToast(result.error || "Failed to regenerate draft.");
          return;
        }
        flashToast("Draft regenerated.");
        await reloadOpenConversation(conversationId);
        router.refresh();
      } catch {
        flashToast("Failed to regenerate draft.");
      } finally {
        setRegeneratingDraft(false);
      }
    },
    [
      selectedDetail,
      selectedConversationId,
      flashToast,
      reloadOpenConversation,
      router,
    ],
  );

  const registerComposeRef = useCallback(
    (ref: RefObject<HTMLTextAreaElement | null>) => {
      composeRefRef.current = ref;
      return () => {
        if (composeRefRef.current === ref) {
          composeRefRef.current = null;
        }
      };
    },
    [],
  );

  const prefillOverride = useCallback((text: string) => {
    setComposeBody(text);
    // Focus on the next tick so React has time to paint the new
    // value into the controlled textarea before we move the cursor.
    Promise.resolve().then(() => {
      composeRefRef.current?.current?.focus();
    });
  }, []);

  const openEditDraft = useCallback(() => {
    setEditDraftRequestKey((k) => k + 1);
  }, []);

  const requestSendConfirm = useCallback(() => {
    setSendConfirmRequestKey((k) => k + 1);
  }, []);

  // ---------------------------------------------------------------------------
  // Snooze / mute the open conversation
  // ---------------------------------------------------------------------------

  const snoozeConversation = useCallback(
    async (untilIso: string | null) => {
      const id = selectedConversationId;
      if (!id) return;
      setSnoozing(true);
      try {
        const result = await snoozeConversationAction(id, untilIso);
        if (!result.ok) {
          flashToast(result.error || "Failed to snooze.");
          return;
        }
        flashToast(untilIso ? "Snoozed." : "Snooze cleared.");
        await reloadOpenConversation(id);
        router.refresh();
      } catch {
        flashToast("Failed to snooze.");
      } finally {
        setSnoozing(false);
      }
    },
    [selectedConversationId, flashToast, reloadOpenConversation, router],
  );

  const muteConversation = useCallback(
    async (muted: boolean) => {
      const id = selectedConversationId;
      if (!id) return;
      setMuting(true);
      try {
        const result = await muteConversationAction(id, muted);
        if (!result.ok) {
          flashToast(result.error || "Failed to update mute.");
          return;
        }
        flashToast(muted ? "Muted." : "Unmuted.");
        await reloadOpenConversation(id);
        router.refresh();
      } catch {
        flashToast("Failed to update mute.");
      } finally {
        setMuting(false);
      }
    },
    [selectedConversationId, flashToast, reloadOpenConversation, router],
  );

  const value = useMemo<ConversationsValue>(
    () => ({
      conversations,
      activity,
      slaMap,
      selectedConversationId,
      selectConversation,
      selectedDetail,
      isLoadingDetail,
      composeBody,
      setComposeBody,
      sending,
      sendOwner,
      approvingDraft,
      approvePendingDraft,
      rejectingDraft,
      rejectPendingDraft,
      editingDraft,
      editPendingDraft,
      regeneratingDraft,
      regenerateDraft,
      prefillOverride,
      registerComposeRef,
      editDraftRequestKey,
      openEditDraft,
      sendConfirmRequestKey,
      requestSendConfirm,
      snoozing,
      snoozeConversation,
      muting,
      muteConversation,
      searchQuery,
      setSearchQuery,
      toast,
    }),
    [
      conversations,
      activity,
      slaMap,
      selectedConversationId,
      selectConversation,
      selectedDetail,
      isLoadingDetail,
      composeBody,
      sending,
      sendOwner,
      approvingDraft,
      approvePendingDraft,
      rejectingDraft,
      rejectPendingDraft,
      editingDraft,
      editPendingDraft,
      regeneratingDraft,
      regenerateDraft,
      prefillOverride,
      registerComposeRef,
      editDraftRequestKey,
      openEditDraft,
      sendConfirmRequestKey,
      requestSendConfirm,
      snoozing,
      snoozeConversation,
      muting,
      muteConversation,
      searchQuery,
      toast,
    ],
  );

  return (
    <ConversationsContext.Provider value={value}>
      {children}
    </ConversationsContext.Provider>
  );
}
