# Voice Tab Phase 1: Architecture Refactor + UI Overhaul

**Date:** 2026-03-24
**Scope:** Phase 1 of 4 in the voice tab rebuild
**Approach:** Service layer extraction + full UI redesign (Approach B)

## Context

The voice tab was built quickly and doesn't match the quality bar of the rest of Odesa. It has architectural problems (Retell coupling, fat page components, inconsistent API routes), UI/UX problems (doesn't match the Odesa design system), and is missing functionality that will be added in later phases.

### Phase Roadmap

1. **Phase 1 (this spec):** Architecture refactor + UI overhaul
2. **Phase 2:** Visual agent builder (flow editor replaces textarea)
3. **Phase 3:** Multi-channel — SMS, WhatsApp, iMessage Business Chat
4. **Phase 4:** Real-time monitoring + Analytics dashboard

## 1. Service Layer Architecture

### Provider Abstraction

```
src/lib/voice/providers/
  types.ts              # VoiceProvider interface
  retell.provider.ts    # RetellProvider implements VoiceProvider
  index.ts              # getVoiceProvider() factory
```

`VoiceProvider` interface:

```typescript
interface VoiceProvider {
  createAgent(config: CreateAgentConfig): Promise<ProviderAgent>;
  updateAgent(id: string, config: UpdateAgentConfig): Promise<ProviderAgent>;
  deleteAgent(id: string): Promise<void>;
  makeCall(agentId: string, toNumber: string): Promise<ProviderCall>;
  getCall(callId: string): Promise<ProviderCallDetail>;
  listCalls(agentId: string, options?: ListCallsOptions): Promise<ProviderCall[]>;
  parseWebhookEvent(payload: unknown): NormalizedWebhookEvent;
}
```

`RetellProvider` wraps the existing `RetellClient`, mapping Retell-specific types to normalized domain types. The factory reads provider config from environment variables.

**Key principle:** Retell-specific types (`RetellAgent`, `RetellCall`, etc.) stay internal to `RetellProvider`. Services and UI only see domain types (`VoiceAgent`, `CallLog`, `VoiceConfig`).

### Business Logic Services

```
src/lib/voice/services/
  agent.service.ts      # CRUD + business rules for voice agents
  call.service.ts       # Call management, log queries, export
  webhook.service.ts    # Webhook event processing
```

Services accept a `VoiceProvider` instance + Supabase client. They own:
- Input validation
- Database reads/writes
- Provider API calls
- Mapping between provider responses and DB schema

API routes become thin wrappers: auth check → service call → format response.

## 2. Data Hooks Layer

### SWR-Based Hooks

```
src/hooks/voice/
  use-voice-agents.ts     # List all agents for the business
  use-voice-agent.ts      # Single agent by ID (config, status)
  use-call-log.ts         # Paginated, filtered, sorted calls (refactored)
  use-call-detail.ts      # Single call with transcript + metadata
  use-voice-stats.ts      # Aggregated stats for the header
```

**Why SWR:** Lighter than React Query, aligns with Next.js patterns, auto-revalidation on focus, built-in cache deduplication. We don't need React Query's heavier mutation API since writes go through API routes.

Each hook returns `{ data, error, isLoading, mutate }`. Mutations are direct `fetch` calls followed by `mutate()` to revalidate the relevant SWR cache.

### New API Endpoint

`GET /api/voice/stats` — aggregates from `voice_agents` (count active) and `call_logs` (count today, avg sentiment, success rate). Single query, no joins.

## 3. Component Architecture

### Directory Structure

```
src/components/voice/
  layout/
    voice-header.tsx        # Title + inline stats + tab bar
    voice-tabs.tsx          # Tab state management
  agents/
    agent-list.tsx          # Left sidebar agent list with search
    agent-list-item.tsx     # Single agent row (name, status dot, call count)
    agent-editor.tsx        # Container: script + config + recent calls
    script-editor.tsx       # Presentational — script textarea with line numbers
    voice-config.tsx        # Presentational — voice/speed/tone controls
    agent-recent-calls.tsx  # Compact call list for agent sidebar
    template-picker.tsx     # Agent creation dialog
  calls/
    call-list.tsx           # Left panel: filtered table rows
    call-list-row.tsx       # Single call row
    call-list-filters.tsx   # Filter bar
    call-detail-panel.tsx   # Right panel: metadata + transcript
    call-metadata.tsx       # 2x2 metadata cards
    transcript-viewer.tsx   # Chat bubble transcript
  shared/
    status-badge.tsx        # Completed/Missed/Failed/In Progress
    sentiment-dot.tsx       # Green/amber/red dot + label
    stat-item.tsx           # Inline "47 calls today" stat
```

### Component Principles

- **Presentational components** receive data via props, emit events via callbacks. No fetching, no hooks.
- **Container components** (`agent-editor.tsx`, `call-detail-panel.tsx`) wire hooks to presentational components.
- **No component exceeds 200 lines.**
- Components follow the Odesa design system: `#1B3A6B` primary, `#C9A55C` gold accent, `#F5F1E9` background, `#FEFDFB` card surfaces, `#E4E2DC` borders, Plus Jakarta Sans for text, JetBrains Mono for metrics.

## 4. UI Layout Design

### Hybrid: Dashboard + Workspace

Single `/voice` page with three layers:

1. **Header row** — "Voice Studio" title on the left, inline stats on the right (agent count, calls today, avg sentiment, success rate) with thin dividers between metrics. JetBrains Mono for numbers, 11px labels. No separate stat cards — everything flows in one line.

2. **Tab bar** — Agents | Calls | Analytics. Active tab has navy underline + bold text. Analytics tab is a placeholder for Phase 4.

3. **Tab content** — each tab is a split-panel workspace:
   - **Agents tab:** 260px left sidebar (agent list with search, status dots, "+ New Agent" button) + right editor panel (agent name/phone header, script editor, voice config sidebar, recent calls).
   - **Calls tab:** left panel (filter bar + call row list + pagination) + 380px right detail panel (call header, 2x2 metadata cards, chat-bubble transcript).
   - **Analytics tab:** placeholder with empty state for Phase 4.

### Navigation Changes

All 4 current pages collapse into one:

**Removed:**
- `/voice/[id]/page.tsx`
- `/voice/calls/page.tsx`
- `/voice/calls/[id]/page.tsx`

**New:**
- `/voice?tab=agents` (default)
- `/voice?tab=agents&agent=abc-123` (selected agent)
- `/voice?tab=calls` (call list)
- `/voice?tab=calls&call=def-456` (selected call)
- `/voice?tab=analytics` (placeholder)

Tab and selection state in URL search params — shareable, back-button friendly.

### Page File

The page component stays under 30 lines:

```tsx
export default function VoicePage() {
  return (
    <>
      <VoiceHeader />
      <VoiceTabs>
        <AgentsTab />
        <CallsTab />
        <AnalyticsTab />
      </VoiceTabs>
    </>
  );
}
```

## 5. API Route Refactor

### Route Structure (Unchanged URLs)

```
src/app/api/voice/
  agents/
    route.ts              # GET (list), POST (create)
    [id]/
      route.ts            # GET, PATCH, DELETE
      call/route.ts       # POST (test call)
      calls/route.ts      # GET (agent's calls)
  calls/
    route.ts              # GET (all calls, filtered)
    [id]/route.ts         # GET (single call)
    export/route.ts       # GET (CSV export)
  stats/route.ts          # NEW — aggregated stats
  webhook/route.ts        # POST (Retell webhook)
```

### Standardization

1. **Auth wrapper** — `withAuth(handler)` utility extracts auth check + business_id lookup. Every voice route uses it. Scoped to `src/lib/voice/` for now — other routes can adopt later but that's out of scope for Phase 1.

2. **Service calls replace direct DB/Retell calls** — routes call service methods. No raw Supabase queries or RetellClient instantiation in route files.

3. **Consistent error responses** — all routes return `ApiResponse<T>`. Service errors map to HTTP status codes via `handleServiceError()`.

4. **Webhook route** — calls `webhookService.processEvent(payload)` which normalizes events through the provider interface.

### Route Pattern

Every route follows:

```typescript
export const GET = withAuth(async (req, { userId, businessId, supabase }) => {
  const result = await agentService.list(supabase, businessId);
  if (!result.isOk) return handleServiceError(result.error);
  return NextResponse.json({ success: true, data: result.value });
});
```

## 6. Files to Delete

After migration, these files are removed:

**Pages (consolidated into single `/voice` page):**
- `src/app/(dashboard)/voice/[id]/page.tsx`
- `src/app/(dashboard)/voice/calls/page.tsx`
- `src/app/(dashboard)/voice/calls/[id]/page.tsx`

**Old components (replaced by new component structure):**
- `src/components/voice/voice-agent-card.tsx` → replaced by `agents/agent-list-item.tsx`
- `src/components/voice/call-detail.tsx` → replaced by `calls/call-detail-panel.tsx`
- `src/components/voice/call-log-table.tsx` → replaced by `calls/call-list.tsx` + `call-list-row.tsx`
- `src/components/voice/call-log-filters.tsx` → replaced by `calls/call-list-filters.tsx`
- `src/components/voice/call-log-pagination.tsx` → inlined into `calls/call-list.tsx`
- `src/components/voice/call-metadata-sidebar.tsx` → replaced by `calls/call-metadata.tsx`
- `src/components/voice/call-history.tsx` → replaced by `agents/agent-recent-calls.tsx`
- `src/components/voice/index.ts` (barrel export, replaced by direct imports)
- `src/lib/voice/index.ts` (empty stub)

**Kept and refactored in place:**
- `src/components/voice/script-editor.tsx` → moves to `agents/script-editor.tsx`
- `src/components/voice/voice-config.tsx` → moves to `agents/voice-config.tsx`
- `src/components/voice/transcript-viewer.tsx` → moves to `calls/transcript-viewer.tsx`
- `src/components/voice/voice-template-picker.tsx` → moves to `agents/template-picker.tsx`

## 7. New Dependencies

- `swr` — data fetching and caching for hooks

## 8. Testing Strategy

- **Service layer:** Unit tests with mocked VoiceProvider and Supabase client. Test business logic in isolation.
- **Provider:** Unit tests for RetellProvider with mocked HTTP responses. Verify correct Retell API mapping.
- **Hooks:** Test with SWR's test utilities + MSW for API mocking.
- **Components:** Presentational components get snapshot/interaction tests. Container components tested with mocked hooks.
- **API routes:** Integration tests through the service layer.
- **E2E:** Update existing `voice.spec.ts` and `voice-studio.page.ts` for the new single-page layout.

## 9. Out of Scope (Future Phases)

- Visual script/flow editor (Phase 2)
- SMS, WhatsApp, iMessage Business Chat (Phase 3)
- Real-time call monitoring (Phase 4)
- Analytics dashboard (Phase 4)
- Database schema changes beyond the new stats query
