/**
 * Draft queries for the redesigned `/inbox` surface — wave 3.
 *
 * RLS-aware reads: every call uses the SSR (auth-cookie-bound)
 * supabase client passed in by the caller. The caller MUST pass the
 * client returned from `createServerClient()`, never the admin one,
 * so RLS scopes results to the signed-in user's org.
 *
 * Three buckets feed the list column:
 *
 *   - **Needs your judgment**  ← `action_proposals`
 *     `status='proposed' AND gate_decision='review'`
 *
 *   - **Ready to send**  ← `messages`
 *     `draft_status='pending_review' AND direction='outbound'`,
 *     joined to conversations → tenants → leases → units → properties
 *
 *   - **Sent today**  ← tenant-facing `messages` with durable send timestamps.
 *     Proposal commits are decisions, not a second message count.
 *
 * The detail panel (`getDraftDetail`) is a discriminated union by
 * `source`: 'message' for the messages-table flow, 'proposal' for the
 * action-proposals flow. Both return the same `DraftDetail` shape the
 * UI expects (see `src/components/inbox/mock-data.ts`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { proposalArtifactKeyForMessage } from '@/lib/messaging/canonical-draft';

import type {
  DraftDetail,
  FeedTag,
  NeedsJudgmentItem,
  ReadyToSendItem,
  SentTodayRollup,
  TouchpointEntry,
} from '@/components/inbox/types';

type ServerSupabase = SupabaseClient<Database>;

export type DraftSource = 'message' | 'proposal';

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
// Action-type → tag mapping
// ---------------------------------------------------------------------------
//
// Drives the FeedTag chip on each proposal card. The current `FeedTag`
// union exposed by `mock-data.ts` has only three members; v1 commits
// only `draft_sms_reply` so the other entries are forward-looking
// stubs and fall back to AMBIGUOUS until the type is widened in
// Stage 2 (when types are extracted to `components/inbox/types.ts`).

export const PROPOSAL_TAG_MAP: Record<string, FeedTag> = {
  draft_sms_reply: 'AMBIGUOUS',
  schedule_repair: 'AMBIGUOUS',
  draft_lease_renewal: 'LEASE_RENEWAL',
  schedule_move_out: 'MOVE_OUT',
};

const TOUCHPOINT_DAYS = 14;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the three inbox buckets + a summary envelope. RLS scopes
 * results to the caller's org via the auth-aware supabase client.
 */
export async function listInboxBuckets(
  supabase: ServerSupabase,
): Promise<InboxBuckets> {
  const organizationId = await resolveOrganizationId(supabase);

  const [needsJudgment, readyToSend, sentToday] = await Promise.all([
    fetchNeedsJudgment(supabase),
    fetchReadyToSend(supabase),
    fetchSentToday(supabase),
  ]);

  return {
    needsJudgment,
    readyToSend,
    sentToday,
    summary: {
      organizationId,
      needsCount: needsJudgment.length,
      readyCount: readyToSend.length,
      sentTodayCount: sentToday.count,
    },
  };
}

/**
 * Loads the detail panel for a given draft. `source` disambiguates
 * which table to read from. Returns `null` if the row is not visible
 * (RLS) or has been removed.
 */
export async function getDraftDetail(
  supabase: ServerSupabase,
  source: DraftSource,
  id: string,
): Promise<DraftDetail | null> {
  if (source === 'message') {
    return fetchMessageDetail(supabase, id);
  }
  return fetchProposalDetail(supabase, id);
}

// ---------------------------------------------------------------------------
// Org resolution
// ---------------------------------------------------------------------------

async function resolveOrganizationId(
  supabase: ServerSupabase,
): Promise<string> {
  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) return '';

  const { data: row } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', userId)
    .maybeSingle();

  return row?.organization_id ?? '';
}

// ---------------------------------------------------------------------------
// Needs-your-judgment bucket
// ---------------------------------------------------------------------------

async function fetchNeedsJudgment(
  supabase: ServerSupabase,
): Promise<NeedsJudgmentItem[]> {
  const { data } = await supabase
    .from('action_proposals')
    .select(
      'id, action_type, payload, reasoning, created_at, routing, property_id',
    )
    .eq('status', 'proposed')
    .eq('gate_decision', 'review')
    .order('created_at', { ascending: false });

  if (!data || data.length === 0) return [];

  // Resolve tenant names where routing.tenantId is set, so the card
  // title can show "Lee — Maintenance" rather than just "Maintenance".
  const tenantIds = uniqStrings(
    data
      .map((p) => readJsonString(p.routing as Record<string, unknown>, 'tenantId'))
      .filter((v): v is string => Boolean(v)),
  );
  const tenantMap = await fetchTenantMap(supabase, tenantIds);

  return data.map((p): NeedsJudgmentItem => {
    const tag = PROPOSAL_TAG_MAP[p.action_type] ?? 'AMBIGUOUS';
    const tenantId = readJsonString(
      p.routing as Record<string, unknown>,
      'tenantId',
    );
    const tenantName = tenantId ? tenantMap.get(tenantId)?.name ?? null : null;
    const previewBody =
      readJsonString(p.payload as Record<string, unknown>, 'body') ??
      readJsonString(p.payload as Record<string, unknown>, 'sms_body') ??
      '';
    const summary = (p.reasoning ?? '').slice(0, 120);

    return {
      id: p.id,
      title: tenantName
        ? `${tenantName} — ${humaniseActionType(p.action_type)}`
        : humaniseActionType(p.action_type),
      tag,
      timestamp: relativeTimestamp(p.created_at),
      summary,
      preview: previewBody || (p.reasoning ?? ''),
    };
  });
}

// ---------------------------------------------------------------------------
// Ready-to-send bucket
// ---------------------------------------------------------------------------

async function fetchReadyToSend(
  supabase: ServerSupabase,
): Promise<ReadyToSendItem[]> {
  const { data: messages } = await supabase
    .from('messages')
    .select('id, conversation_id, body, created_at, retell_artifact_key')
    .eq('draft_status', 'pending_review')
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false });

  if (!messages || messages.length === 0) return [];

  // A voice-origin message may be preserved as evidence alongside a canonical
  // Owner Queue proposal. Hide that evidence row from the separate Ready to
  // send bucket so there is only one commitment ledger.
  const proposalKeys = uniqStrings(
    messages.map((message) =>
      proposalArtifactKeyForMessage(message.retell_artifact_key),
    ),
  );
  const { data: linkedProposals, error: linkedProposalError } = proposalKeys.length
    ? await supabase
        .from('action_proposals')
        .select('retell_artifact_key')
        .in('retell_artifact_key', proposalKeys)
    : {
        data: [] as Array<{ retell_artifact_key: string | null }>,
        error: null,
      };
  const linkedKeys = new Set(
    (linkedProposals ?? [])
      .map((proposal) => proposal.retell_artifact_key)
      .filter((key): key is string => Boolean(key)),
  );
  const actionableMessages = messages.filter((message) => {
    const proposalKey = proposalArtifactKeyForMessage(
      message.retell_artifact_key,
    );
    // When linkage cannot be verified, keyed voice evidence stays hidden.
    // Unkeyed legacy drafts remain usable; no lookup is needed for them.
    return (
      proposalKey === null ||
      (linkedProposalError === null && !linkedKeys.has(proposalKey))
    );
  });
  if (actionableMessages.length === 0) return [];

  const conversationIds = uniqStrings(
    actionableMessages.map((message) => message.conversation_id),
  );
  const { data: conversations } = await supabase
    .from('conversations')
    .select('id, tenant_id')
    .in('id', conversationIds);

  const tenantIds = uniqStrings(
    (conversations ?? []).map((c) => c.tenant_id),
  );

  const tenantMap = await fetchTenantMap(supabase, tenantIds);

  return actionableMessages.map((m): ReadyToSendItem => {
    const conv = (conversations ?? []).find((c) => c.id === m.conversation_id);
    const tenant = conv?.tenant_id ? tenantMap.get(conv.tenant_id) : undefined;
    const tenantName = tenant?.name ?? 'Unknown tenant';
    const unitLine = tenant?.unitLabel ? tenant.unitLabel : undefined;
    return {
      id: m.id,
      tenant: tenantName,
      tag: 'AMBIGUOUS',
      timestamp: relativeTimestamp(m.created_at),
      unitLine,
      preview: (m.body ?? '').slice(0, 160),
    };
  });
}

// ---------------------------------------------------------------------------
// Sent-today rollup
// ---------------------------------------------------------------------------

async function fetchSentToday(
  supabase: ServerSupabase,
): Promise<SentTodayRollup> {
  const startOfDayIso = startOfTodayIsoUtc();

  const { data: sentMessages } = await supabase
    .from('messages')
    .select('id, conversation_id, sent_at')
    .eq('draft_status', 'sent_by_human')
    .gte('sent_at', startOfDayIso)
    .order('sent_at', { ascending: false });

  const messages = sentMessages ?? [];

  const conversationIds = uniqStrings(messages.map((m) => m.conversation_id));
  const { data: conversations } = conversationIds.length
    ? await supabase
        .from('conversations')
        .select('id, tenant_id')
        .in('id', conversationIds)
    : { data: [] as Array<{ id: string; tenant_id: string | null }> };

  const messageTenantIds = uniqStrings(
    (conversations ?? []).map((c) => c.tenant_id),
  );
  const tenantMap = await fetchTenantMap(
    supabase,
    messageTenantIds,
  );

  const orderedNames: string[] = [];
  for (const m of messages) {
    const conv = (conversations ?? []).find((c) => c.id === m.conversation_id);
    if (conv?.tenant_id) {
      const t = tenantMap.get(conv.tenant_id);
      if (t?.name) orderedNames.push(t.name);
    }
  }
  const count = messages.length;
  const previewNames = orderedNames.slice(0, 3);
  const remainder = Math.max(count - previewNames.length, 0);

  return {
    count,
    preview: previewNames,
    remainder,
  };
}

// ---------------------------------------------------------------------------
// Detail panel (per source)
// ---------------------------------------------------------------------------

async function fetchMessageDetail(
  supabase: ServerSupabase,
  id: string,
): Promise<DraftDetail | null> {
  const { data: msg } = await supabase
    .from('messages')
    .select('id, conversation_id, body, created_at, organization_id')
    .eq('id', id)
    .maybeSingle();
  if (!msg) return null;

  const { data: conv } = await supabase
    .from('conversations')
    .select('id, tenant_id')
    .eq('id', msg.conversation_id)
    .maybeSingle();

  const tenantContext = conv?.tenant_id
    ? await fetchTenantContext(supabase, conv.tenant_id)
    : null;

  const touchpoints = await buildTouchpoints(supabase, msg.conversation_id);

  return {
    source: 'message',
    id: msg.id,
    draftType: 'Drafted Reply',
    draftedBy: 'Odesa',
    draftedAt: relativeTimestamp(msg.created_at),
    recipient: tenantContext?.name ?? 'Tenant',
    shortcuts: { reject: 'r', edit: 'e', approveSend: 'a' },
    reasoning: '',
    smsBody: msg.body ?? '',
    smsPhone: tenantContext?.phone ?? '',
    tenant: {
      name: tenantContext?.name ?? 'Unknown tenant',
      badge: tenantContext?.badge ?? '',
      property: tenantContext?.property ?? '',
      unit: tenantContext?.unit ?? '',
      bedBath: tenantContext?.bedBath ?? '',
      currentRent: tenantContext?.currentRent ?? '',
    },
    touchpoints: { days: TOUCHPOINT_DAYS, entries: touchpoints },
  };
}

async function fetchProposalDetail(
  supabase: ServerSupabase,
  id: string,
): Promise<DraftDetail | null> {
  const { data: proposal } = await supabase
    .from('action_proposals')
    .select(
      'id, action_type, payload, reasoning, created_at, routing, edit_diff',
    )
    .eq('id', id)
    .maybeSingle();
  if (!proposal) return null;

  const tenantId = readJsonString(
    proposal.routing as Record<string, unknown>,
    'tenantId',
  );
  const conversationId = readJsonString(
    proposal.routing as Record<string, unknown>,
    'conversationId',
  );

  const tenantContext = tenantId
    ? await fetchTenantContext(supabase, tenantId)
    : null;

  const touchpoints = conversationId
    ? await buildTouchpoints(supabase, conversationId)
    : (Array.from({ length: TOUCHPOINT_DAYS }, () => null) as TouchpointEntry[]);

  const editedBody = readJsonString(
    proposal.edit_diff as Record<string, unknown>,
    'body_after',
  );
  const draftedBody =
    editedBody ??
    readJsonString(proposal.payload as Record<string, unknown>, 'body') ??
    readJsonString(proposal.payload as Record<string, unknown>, 'sms_body') ??
    '';

  const recipientPhone =
    readJsonString(proposal.payload as Record<string, unknown>, 'recipient_phone') ??
    tenantContext?.phone ??
    '';

  return {
    source: 'proposal',
    id: proposal.id,
    draftType: humaniseActionType(proposal.action_type),
    draftedBy: 'Odesa',
    draftedAt: relativeTimestamp(proposal.created_at),
    recipient: tenantContext?.name ?? 'Tenant',
    shortcuts: { reject: 'r', edit: 'e', approveSend: 'a' },
    reasoning: proposal.reasoning ?? '',
    smsBody: draftedBody,
    smsPhone: recipientPhone,
    tenant: {
      name: tenantContext?.name ?? 'Unknown tenant',
      badge: tenantContext?.badge ?? '',
      property: tenantContext?.property ?? '',
      unit: tenantContext?.unit ?? '',
      bedBath: tenantContext?.bedBath ?? '',
      currentRent: tenantContext?.currentRent ?? '',
    },
    touchpoints: { days: TOUCHPOINT_DAYS, entries: touchpoints },
  };
}

// ---------------------------------------------------------------------------
// Tenant + lease/unit/property lookup
// ---------------------------------------------------------------------------

interface TenantSummary {
  name: string;
  unitLabel: string | null;
}

async function fetchTenantMap(
  supabase: ServerSupabase,
  tenantIds: readonly string[],
): Promise<Map<string, TenantSummary>> {
  if (tenantIds.length === 0) return new Map();

  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, full_name')
    .in('id', tenantIds);

  const { data: leases } = await supabase
    .from('leases')
    .select('tenant_id, unit_id, status')
    .in('tenant_id', tenantIds)
    .eq('status', 'active');

  const unitIds = uniqStrings((leases ?? []).map((l) => l.unit_id));
  const { data: units } = unitIds.length
    ? await supabase.from('units').select('id, label').in('id', unitIds)
    : { data: [] as Array<{ id: string; label: string }> };

  const unitLabelMap = new Map<string, string>();
  (units ?? []).forEach((u) => unitLabelMap.set(u.id, u.label));

  const out = new Map<string, TenantSummary>();
  (tenants ?? []).forEach((t) => {
    const lease = (leases ?? []).find((l) => l.tenant_id === t.id);
    const unitLabel = lease ? unitLabelMap.get(lease.unit_id) ?? null : null;
    out.set(t.id, { name: t.full_name, unitLabel });
  });
  return out;
}

interface TenantContext {
  name: string;
  phone: string;
  badge: string;
  property: string;
  unit: string;
  bedBath: string;
  currentRent: string;
}

async function fetchTenantContext(
  supabase: ServerSupabase,
  tenantId: string,
): Promise<TenantContext | null> {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, full_name, phone_e164, created_at')
    .eq('id', tenantId)
    .maybeSingle();
  if (!tenant) return null;

  const { data: lease } = await supabase
    .from('leases')
    .select('id, unit_id, rent_amount, status')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('start_date', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  let unitLabel = '';
  let bedBath = '';
  let propertyName = '';
  let currentRent = '';
  if (lease) {
    currentRent = formatRent(lease.rent_amount);
    const { data: unit } = await supabase
      .from('units')
      .select('id, label, bedrooms, bathrooms, property_id')
      .eq('id', lease.unit_id)
      .maybeSingle();
    if (unit) {
      unitLabel = unit.label;
      bedBath = formatBedBath(unit.bedrooms, unit.bathrooms);
      const { data: property } = await supabase
        .from('properties')
        .select('id, name')
        .eq('id', unit.property_id)
        .maybeSingle();
      if (property) {
        propertyName = property.name;
      }
    }
  }

  return {
    name: tenant.full_name,
    phone: tenant.phone_e164 ?? '',
    badge: tenantSinceBadge(tenant.created_at),
    property: propertyName,
    unit: unitLabel,
    bedBath,
    currentRent,
  };
}

// ---------------------------------------------------------------------------
// Touchpoint timeline (last 14 days for a conversation)
// ---------------------------------------------------------------------------

async function buildTouchpoints(
  supabase: ServerSupabase,
  conversationId: string,
): Promise<TouchpointEntry[]> {
  const sinceIso = new Date(
    Date.now() - TOUCHPOINT_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: rows } = await supabase
    .from('messages')
    .select('direction, draft_status, created_at, sent_at')
    .eq('conversation_id', conversationId)
    .gte('created_at', sinceIso);

  const entries: TouchpointEntry[] = Array.from(
    { length: TOUCHPOINT_DAYS },
    () => null,
  );

  const todayUtcMidnight = new Date();
  todayUtcMidnight.setUTCHours(0, 0, 0, 0);
  const todayMs = todayUtcMidnight.getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;

  (rows ?? []).forEach((row) => {
    const ts = row.sent_at ?? row.created_at;
    if (!ts) return;
    const t = new Date(ts);
    t.setUTCHours(0, 0, 0, 0);
    const diffDays = Math.floor((t.getTime() - todayMs) / oneDayMs);
    // diffDays = 0 means today, -1 means yesterday, ... -13 oldest in window.
    const idx = TOUCHPOINT_DAYS - 1 + diffDays;
    if (idx < 0 || idx >= TOUCHPOINT_DAYS) return;

    if (idx === TOUCHPOINT_DAYS - 1) {
      entries[idx] = 'today';
      return;
    }
    if (row.direction === 'inbound') {
      entries[idx] = 'inbound';
      return;
    }
    if (row.direction === 'outbound' && row.draft_status === 'sent_by_human') {
      // Only set outbound if no inbound already claimed this day.
      if (entries[idx] !== 'inbound') {
        entries[idx] = 'outbound';
      }
    }
  });

  return entries;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqStrings(
  values: ReadonlyArray<string | null | undefined>,
): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v))));
}

function readJsonString(
  obj: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!obj) return null;
  const raw = obj[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function startOfTodayIsoUtc(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function relativeTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function humaniseActionType(actionType: string): string {
  return actionType
    .split('_')
    .map((p) => (p.length === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join(' ');
}

function tenantSinceBadge(createdAt: string | null | undefined): string {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  return `TENANT SINCE ${d.getUTCFullYear()}`;
}

function formatRent(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined) return '';
  const num = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(num)) return '';
  const rounded = Math.round(num);
  return `$${rounded.toLocaleString('en-US')}/mo`;
}

function formatBedBath(
  bedrooms: number | null | undefined,
  bathrooms: number | string | null | undefined,
): string {
  if (bedrooms === null || bedrooms === undefined) return '';
  const baths = typeof bathrooms === 'string' ? Number(bathrooms) : bathrooms;
  const bedLabel = `${bedrooms} Bed`;
  if (baths === null || baths === undefined || !Number.isFinite(baths)) {
    return bedLabel;
  }
  const bathStr = Number.isInteger(baths) ? String(baths) : baths.toFixed(1);
  return `${bedLabel}, ${bathStr} Bath`;
}
