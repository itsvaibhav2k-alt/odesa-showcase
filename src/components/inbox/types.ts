/**
 * Shared types for the redesigned `/inbox` surface.
 *
 * Lives here (and not in `mock-data.ts`, which previously owned them)
 * so production code can depend on the type contract without pulling
 * in fixtures. Wave 3 stage 2 extracted these out of `mock-data.ts`
 * as part of wiring the surface to live data via `listInboxBuckets()`
 * and the server actions in `app/(dashboard)/inbox/actions.ts`.
 *
 * `InboxBuckets` is re-exported from here so callers don't have to
 * reach into `@/lib/inbox/draft-queries` for the envelope shape.
 */

// ---------------------------------------------------------------------------
// Tag taxonomy
// ---------------------------------------------------------------------------
//
// `WORK_ORDER` was added in stage 2 because the Stage-1 query layer
// maps `action_type='schedule_repair' → 'WORK_ORDER'` (see PROPOSAL_TAG_MAP
// in `draft-queries.ts`). Until the union was widened the query layer
// fell back to `AMBIGUOUS` for that action type.

export type FeedTag = 'AMBIGUOUS' | 'LEASE_RENEWAL' | 'MOVE_OUT' | 'WORK_ORDER';

export type Touchpoint = 'inbound' | 'outbound' | 'today' | null;

// Backwards-compatible alias — Stage 1 (`draft-queries.ts`) imports
// the type under this name. Keep the alias so the Stage-1 module's
// existing imports keep resolving without modification.
export type TouchpointEntry = Touchpoint;

export type DraftSource = 'message' | 'proposal';

// ---------------------------------------------------------------------------
// List items
// ---------------------------------------------------------------------------

export interface NeedsJudgmentItem {
  id: string;
  title: string;
  tag: FeedTag;
  timestamp: string;
  summary: string;
  preview: string;
}

export interface ReadyToSendItem {
  id: string;
  tenant: string;
  tag: FeedTag;
  timestamp: string;
  unitLine?: string;
  preview: string;
  selected?: boolean;
}

export interface SentTodayRollup {
  count: number;
  preview: readonly string[];
  remainder: number;
}

// Items as carried inside the client-side state. Each one is annotated
// with its `source` so `selectItem(id, source)` can dispatch correctly
// without re-deriving the bucket.

export type NeedsJudgmentEntry = NeedsJudgmentItem & { source: 'proposal' };
export type ReadyToSendEntry = ReadyToSendItem & { source: 'message' };

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

interface DraftDetailBase {
  id: string;
  draftType: string;
  draftedBy: string;
  draftedAt: string;
  recipient: string;
  shortcuts: { reject: string; edit: string; approveSend: string };
  reasoning: string;
  smsBody: string;
  smsPhone: string;
  tenant: {
    name: string;
    badge: string;
    property: string;
    unit: string;
    bedBath: string;
    currentRent: string;
  };
  touchpoints: {
    days: number;
    entries: readonly Touchpoint[];
  };
}

// `source` discriminates the two paths: messages-drafts vs.
// action_proposals. The Stage-1 query layer (`getDraftDetail`)
// populates the field at construction time so the client doesn't
// need to re-derive it.

export type DraftDetail =
  | (DraftDetailBase & { source: 'message' })
  | (DraftDetailBase & { source: 'proposal' });

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface InboxBuckets {
  needsJudgment: NeedsJudgmentItem[];
  readyToSend: ReadyToSendItem[];
  sentToday: SentTodayRollup;
  summary: {
    organizationId: string;
    needsCount: number;
    readyCount: number;
    sentTodayCount: number;
  };
}

// ---------------------------------------------------------------------------
// Tag display labels (presentational; lives with the type because
// every consumer that imports `FeedTag` also needs the human label).
// ---------------------------------------------------------------------------

export const TAG_LABELS: Record<FeedTag, string> = {
  AMBIGUOUS: 'Ambiguous',
  LEASE_RENEWAL: 'Lease Renewal',
  MOVE_OUT: 'Move-out',
  WORK_ORDER: 'Work Order',
};
