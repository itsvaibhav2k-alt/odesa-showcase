# Agents Area Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the Agents area with Smart Groups, user-created Groups, Tags, search/filter/sort, a unified detail page shell, and polished interior pages.

**Architecture:** Database-first approach — add tables and migrations, then API routes, then hooks, then UI components. The detail shell is a Next.js App Router layout at `agents/[id]/layout.tsx`. The list page becomes a three-panel layout with group sidebar, filterable agent grid, and collapsible Fleet sidebar.

**Tech Stack:** Next.js 16 (App Router), Supabase (PostgreSQL + RLS), TypeScript, Tailwind CSS v4, shadcn/ui, Recharts (new dependency for analytics), Zod validation.

**Spec:** `docs/superpowers/specs/2026-03-21-agents-area-redesign-design.md`

---

## Wave 1: Database & Types (Foundation)

### Task 1: Database Migration — Groups, Tags, Status Reconciliation

**Files:**
- Create: `supabase/migrations/00013_agent_groups_tags.sql`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/00013_agent_groups_tags.sql`:

```sql
-- 1. Create agent_groups table
CREATE TABLE IF NOT EXISTS agent_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📁',
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, name)
);

ALTER TABLE agent_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their business groups"
  ON agent_groups FOR ALL
  USING (business_id = get_user_business_id());

-- 2. Create agent_tags table
CREATE TABLE IF NOT EXISTS agent_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6C72FF',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, name)
);

ALTER TABLE agent_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their business tags"
  ON agent_tags FOR ALL
  USING (business_id = get_user_business_id());

-- 3. Create agent_tag_assignments junction table
CREATE TABLE IF NOT EXISTS agent_tag_assignments (
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES agent_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, tag_id)
);

ALTER TABLE agent_tag_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage tag assignments for their agents"
  ON agent_tag_assignments FOR ALL
  USING (agent_id IN (
    SELECT id FROM agents WHERE business_id = get_user_business_id()
  ));

-- 4. Add group_id and last_action_at to agents
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES agent_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_action_at TIMESTAMPTZ;

-- 5. Reconcile status enum: rename 'learning' to 'archived'
-- The initial schema defines agent_status as a PostgreSQL ENUM type
ALTER TYPE agent_status RENAME VALUE 'learning' TO 'archived';
```

- [ ] **Step 2: Update TypeScript types**

In `src/types/index.ts`, update `AgentStatus` enum:

```typescript
export enum AgentStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  ARCHIVED = 'archived',
  ERROR = 'error',
}
```

Add new interfaces after the existing agent types:

```typescript
export interface AgentGroup {
  readonly id: string;
  readonly businessId: string;
  readonly name: string;
  readonly icon: string;
  readonly color?: string;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentTag {
  readonly id: string;
  readonly businessId: string;
  readonly name: string;
  readonly color: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentWithDetails extends Agent {
  readonly groupId?: string;
  readonly group?: AgentGroup;
  readonly tags: AgentTag[];
  readonly lastActionAt?: string;
}
```

- [ ] **Step 3: Update base Agent interface**

Add the new optional fields to the existing `Agent` interface (or `AgentSummary`) in `src/types/index.ts`:

```typescript
// Add to existing Agent / AgentSummary interfaces:
readonly groupId?: string;
readonly lastActionAt?: string;
```

- [ ] **Step 4: Verify the build compiles**

Run: `cd /Users/vaibhav/testofgithubrepo/axon && npm run build`
Expected: Build succeeds (migration is applied separately, types are additive)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00013_agent_groups_tags.sql src/types/index.ts
git commit -m "feat: add agent_groups, agent_tags tables and status reconciliation"
```

---

## Wave 2: API Routes (Groups, Tags, Enhanced Agents)

### Task 2: Agent Groups CRUD API

**Files:**
- Create: `src/app/api/agent-groups/route.ts`
- Create: `src/app/api/agent-groups/[id]/route.ts`

- [ ] **Step 1: Create GET/POST handler for agent-groups**

Create `src/app/api/agent-groups/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const createGroupSchema = z.object({
  name: z.string().min(1).max(50).trim(),
  icon: z.string().min(1).max(10).default('📁'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { data: userData } = await supabase
    .from('users')
    .select('business_id')
    .eq('id', user.id)
    .single();

  if (!userData) {
    return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
  }

  const { data: groups, error } = await supabase
    .from('agent_groups')
    .select('id, name, icon, color, sort_order, created_at, updated_at')
    .eq('business_id', userData.business_id)
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Get agent counts per group
  const { data: agents } = await supabase
    .from('agents')
    .select('id, group_id')
    .eq('business_id', userData.business_id);

  const countsMap: Record<string, number> = {};
  for (const agent of agents || []) {
    if (agent.group_id) {
      countsMap[agent.group_id] = (countsMap[agent.group_id] || 0) + 1;
    }
  }

  const groupsWithCounts = (groups || []).map((g) => ({
    ...g,
    agentCount: countsMap[g.id] || 0,
  }));

  return NextResponse.json({ success: true, data: groupsWithCounts });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { data: userData } = await supabase
    .from('users')
    .select('business_id')
    .eq('id', user.id)
    .single();

  if (!userData) {
    return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
  }

  const body = await request.json();
  const parsed = createGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  // Check limit
  const { count } = await supabase
    .from('agent_groups')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', userData.business_id);

  if ((count || 0) >= 20) {
    return NextResponse.json({ success: false, error: 'Maximum 20 groups allowed' }, { status: 400 });
  }

  const { data: maxOrder } = await supabase
    .from('agent_groups')
    .select('sort_order')
    .eq('business_id', userData.business_id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single();

  const { data: group, error } = await supabase
    .from('agent_groups')
    .insert({
      business_id: userData.business_id,
      name: parsed.data.name,
      icon: parsed.data.icon,
      color: parsed.data.color,
      sort_order: (maxOrder?.sort_order || 0) + 1,
    })
    .select('id, name, icon, color, sort_order, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ success: false, error: 'Group name already exists' }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { ...group, agentCount: 0 } }, { status: 201 });
}
```

- [ ] **Step 2: Create PATCH/DELETE handler for agent-groups/[id]**

Create `src/app/api/agent-groups/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const updateGroupSchema = z.object({
  name: z.string().min(1).max(50).trim().optional(),
  icon: z.string().min(1).max(10).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  sort_order: z.number().int().min(0).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = updateGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const { data: group, error } = await supabase
    .from('agent_groups')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, name, icon, color, sort_order, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ success: false, error: 'Group name already exists' }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: group });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { error } = await supabase
    .from('agent_groups')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: null });
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/vaibhav/testofgithubrepo/axon && npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/agent-groups/
git commit -m "feat: add agent groups CRUD API routes"
```

### Task 3: Agent Tags CRUD API

**Files:**
- Create: `src/app/api/agent-tags/route.ts`
- Create: `src/app/api/agent-tags/[id]/route.ts`
- Create: `src/app/api/agents/[id]/tags/route.ts`

- [ ] **Step 1: Create GET/POST for agent-tags**

Create `src/app/api/agent-tags/route.ts` — same pattern as groups: list all tags for business, create with Zod validation, enforce 50-tag limit, handle unique constraint.

- [ ] **Step 2: Create PATCH/DELETE for agent-tags/[id]**

Create `src/app/api/agent-tags/[id]/route.ts` — update name/color, delete tag (cascade removes assignments).

- [ ] **Step 3: Create PUT for agents/[id]/tags**

Create `src/app/api/agents/[id]/tags/route.ts`:
- `PUT`: accepts `{ tag_ids: string[] }`, deletes existing assignments, inserts new ones, enforces 10-tag limit

- [ ] **Step 4: Create DELETE for agents/[id]/tags/[tagId]**

Create `src/app/api/agents/[id]/tags/[tagId]/route.ts`:
- `DELETE`: removes single tag assignment by deleting the row from `agent_tag_assignments`

- [ ] **Step 5: Verify build and commit**

```bash
git add src/app/api/agent-tags/ 'src/app/api/agents/[id]/tags/'
git commit -m "feat: add agent tags CRUD and assignment API routes"
```

### Task 4: Enhance GET /api/agents with Filtering

**Files:**
- Modify: `src/app/api/agents/route.ts`

- [ ] **Step 1: Add query params to GET handler**

Modify the existing GET handler in `src/app/api/agents/route.ts` to support:
- `group_id` — filter by group
- `tag_ids` — comma-separated tag IDs, filter agents that have ALL specified tags
- `search` — case-insensitive ILIKE on agent name
- `sort_by` — one of `name`, `created_at`, `last_action_at`, `success_rate` (default: `created_at`)
- `sort_order` — `asc` or `desc` (default: `desc`)

Also join `agent_tag_assignments` + `agent_tags` to include tags in each agent response, and join `agent_groups` for group name/icon.

- [ ] **Step 2: Verify build and commit**

```bash
git add src/app/api/agents/route.ts
git commit -m "feat: add filtering, search, sorting to GET /api/agents"
```

---

## Wave 3: Hooks & State Management

### Task 5: useAgentGroups Hook

**Files:**
- Create: `src/hooks/use-agent-groups.ts`

- [ ] **Step 1: Create the hook**

Fetches groups from `/api/agent-groups`, provides `createGroup`, `updateGroup`, `deleteGroup` mutation functions. Returns `{ groups, isLoading, error, createGroup, updateGroup, deleteGroup }`.

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-agent-groups.ts
git commit -m "feat: add useAgentGroups hook"
```

### Task 6: useAgentTags Hook

**Files:**
- Create: `src/hooks/use-agent-tags.ts`

- [ ] **Step 1: Create the hook**

Same pattern — fetches tags, provides CRUD mutations. Also provides `setAgentTags(agentId, tagIds[])` for the PUT endpoint.

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-agent-tags.ts
git commit -m "feat: add useAgentTags hook"
```

### Task 7: useAgentFilters Hook

**Files:**
- Create: `src/hooks/use-agent-filters.ts`

- [ ] **Step 1: Create the hook**

Manages client-side filter state: `activeGroupId`, `activeTagIds[]`, `searchQuery` (debounced 300ms), `sortBy`, `sortOrder`, `viewMode` ('grid' | 'list'). Constructs query params for the agents API. Returns filter state + setter functions.

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-agent-filters.ts
git commit -m "feat: add useAgentFilters hook for search, sort, filter state"
```

---

## Wave 4: Agents List Page UI

### Task 8: AgentCard Component

**Files:**
- Create: `src/components/agents/agent-card.tsx`

- [ ] **Step 1: Build the component**

Renders: trigger-type emoji icon (40x40 with gradient bg), agent name, status badge, description, tag pills, metrics line. Hover: purple border + shadow. Error agents: red left border. Links to `/agents/[id]`.

Use 21st.dev MCP to generate a polished card component, then adapt to match the spec.

- [ ] **Step 2: Commit**

```bash
git add src/components/agents/agent-card.tsx
git commit -m "feat: add AgentCard component with tags and metrics"
```

### Task 9: AgentListRow Component

**Files:**
- Create: `src/components/agents/agent-list-row.tsx`

- [ ] **Step 1: Build compact list row**

Same data as AgentCard but in a single horizontal row: icon | name | status badge | tags | success rate | last active | actions. Links to `/agents/[id]`.

- [ ] **Step 2: Commit**

```bash
git add src/components/agents/agent-list-row.tsx
git commit -m "feat: add AgentListRow component for list view"
```

### Task 10: AgentGroupSidebar Component

**Files:**
- Create: `src/components/agents/agent-group-sidebar.tsx`
- Create: `src/components/agents/group-create-dialog.tsx`
- Create: `src/components/agents/group-delete-dialog.tsx`

- [ ] **Step 1: Build the sidebar**

Two sections: Smart Groups (All, Active, Drafts, Needs Attention with auto-computed counts) and My Groups (from `useAgentGroups` hook). Active group highlighted in purple. "+ New Group" button opens `GroupCreateDialog`. Kebab menu on each group for rename/delete. Stats summary at bottom.

- [ ] **Step 2: Build GroupCreateDialog**

shadcn Dialog with name input + emoji picker (simple emoji grid or text input). Creates via hook.

- [ ] **Step 3: Build GroupDeleteDialog**

Confirmation dialog: "Delete [name]? [N] agents will become ungrouped."

- [ ] **Step 4: Commit**

```bash
git add src/components/agents/agent-group-sidebar.tsx src/components/agents/group-create-dialog.tsx src/components/agents/group-delete-dialog.tsx
git commit -m "feat: add AgentGroupSidebar with create/delete dialogs"
```

### Task 11: AgentTagFilter Component

**Files:**
- Create: `src/components/agents/agent-tag-filter.tsx`

- [ ] **Step 1: Build the filter bar**

Horizontal row of pill buttons from `useAgentTags`. "All tags" pill is active by default. Click to toggle filter. Search input on the left with magnifying glass icon. Debounced input updates `useAgentFilters`.

- [ ] **Step 2: Commit**

```bash
git add src/components/agents/agent-tag-filter.tsx
git commit -m "feat: add AgentTagFilter horizontal filter bar"
```

### Task 12: Redesign Agents List Page

**Files:**
- Modify: `src/app/(dashboard)/agents/page.tsx` (rewrite)
- Modify: `src/components/agents/fleet-sidebar.tsx`

- [ ] **Step 1: Rewrite agents/page.tsx**

Three-panel layout:
- Left: `<AgentGroupSidebar />`
- Center: page header (title + Export CSV button + Create Agent button) + `<AgentTagFilter />` + sort/view controls + agent grid/list using `AgentCard` or `AgentListRow`. Export CSV calls existing `/api/agents` with `format=csv` param.
- Right: slimmed `<FleetSidebar />` with collapse toggle

Wire up `useAgentFilters` to control which agents display. Fetch agents from enhanced API.

- [ ] **Step 2: Slim down FleetSidebar**

Make it ~190px, add collapse toggle arrow, keep All/Active/Needs Attention tabs and real-time status dots.

- [ ] **Step 3: Verify the page renders**

Run: `cd /Users/vaibhav/testofgithubrepo/axon && npm run dev`
Navigate to `http://localhost:3000/agents` and verify three-panel layout.

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/agents/page.tsx src/components/agents/fleet-sidebar.tsx
git commit -m "feat: redesign agents list page with groups, tags, search, sort"
```

---

## Wave 5: Agent Detail Shell

### Task 13: AgentDetailShell Layout

**Files:**
- Create: `src/app/(dashboard)/agents/[id]/layout.tsx`
- Modify: `src/app/(dashboard)/agents/[id]/page.tsx`
- Modify: `src/components/agent-studio/agent-editor.tsx`

- [ ] **Step 1: Create the layout**

Create `src/app/(dashboard)/agents/[id]/layout.tsx`:
- Fetches agent data (name, status, group, tags, trigger_type, success_rate)
- Renders sticky header: back arrow, agent icon, editable name (debounced 500ms save), status badge, group pill, tag pills with "+ tag", action buttons
- Renders tab bar: Studio | Soul | Chat | Embed & API | Analytics with active state from pathname
- Renders `{children}` below

- [ ] **Step 2: Strip headers from page.tsx**

Remove the header from `agents/[id]/page.tsx` (currently has "Agent Studio" label + "Configure Soul" button). Just render `<AgentEditor>`.

- [ ] **Step 3: Strip header from agent-editor.tsx**

Remove the top header bar from `agent-editor.tsx` (name, status badge, save/deploy/pause buttons). These are now in the shell. Keep the canvas toolbar and everything below it.

- [ ] **Step 4: Verify navigation works**

Run dev server, navigate to an agent detail page. Verify header + tabs render. Click Soul tab — should navigate to `/agents/[id]/soul`.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(dashboard)/agents/[id]/layout.tsx' 'src/app/(dashboard)/agents/[id]/page.tsx' src/components/agent-studio/agent-editor.tsx
git commit -m "feat: add unified AgentDetailShell layout with tab navigation"
```

### Task 14: Strip Headers from Soul, Chat, Embed Pages

**Files:**
- Modify: `src/app/(dashboard)/agents/[id]/soul/page.tsx`
- Modify: `src/app/(dashboard)/agents/[id]/chat/page.tsx`
- Modify: `src/app/(dashboard)/agents/[id]/embed/page.tsx`

- [ ] **Step 1: Strip header from soul/page.tsx**

Remove the header section (back button, agent name, breadcrumb, save button). The shell handles all of that. Keep the soul editor content.

- [ ] **Step 2: Strip header from chat/page.tsx**

Remove back link, separator, bot icon, agent name, status badge from the top.

- [ ] **Step 3: Strip header from embed/page.tsx**

Remove any top header elements that duplicate the shell.

- [ ] **Step 4: Verify all tabs render correctly**

Navigate between all tabs. Verify consistent header, active tab highlighting, and URL updates.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(dashboard)/agents/[id]/soul/page.tsx' 'src/app/(dashboard)/agents/[id]/chat/page.tsx' 'src/app/(dashboard)/agents/[id]/embed/page.tsx'
git commit -m "refactor: strip duplicate headers from agent sub-pages"
```

---

## Wave 6: Soul Tab Redesign

### Task 15: SoulVerticalNav + Soul Page Refactor

**Files:**
- Create: `src/components/agents/soul-vertical-nav.tsx`
- Create: `src/components/agents/quick-test-card.tsx`
- Modify: `src/app/(dashboard)/agents/[id]/soul/page.tsx`

- [ ] **Step 1: Build SoulVerticalNav**

Vertical sidebar (~180px) with two groups:
- **Configuration:** Soul, Identity, User Context, Agents, Tools (with emoji icons)
- **Behavior:** Heartbeat, Memory, Governance

Active section: Axon purple bg, white text. Click changes which section's textarea content is displayed.

- [ ] **Step 2: Refactor soul/page.tsx layout**

Replace the 8 horizontal ALL-CAPS tabs with:
- Left: `<SoulVerticalNav />`
- Center: editor area (section title + description + monospace textarea + 2-column secondary fields)
- Right: `<QuickTestCard />` + Suggestions card + Gatekeeper Reviews (pass/fail badges with scores)

- [ ] **Step 3: Extract QuickTestCard component**

Create `src/components/agents/quick-test-card.tsx`: input field, "Run Test" button, result display (pass/fail icon, response text, duration). Reusable card — extracted from the existing inline test panel code in soul/page.tsx.

- [ ] **Step 4: Commit**

```bash
git add src/components/agents/soul-vertical-nav.tsx src/components/agents/quick-test-card.tsx 'src/app/(dashboard)/agents/[id]/soul/page.tsx'
git commit -m "feat: redesign Soul tab with vertical nav and improved layout"
```

---

## Wave 7: Studio Polish & Analytics Tab

### Task 16: Studio Tab Polish

**Files:**
- Modify: `src/components/agent-studio/agent-editor.tsx`
- Modify: `src/components/agent-studio/canvas.tsx`

- [ ] **Step 1: Polish toolbar**

Add text labels next to icons on toolbar buttons (Trigger, Brain, Action). Add labeled Permissions and Schedule buttons to right side of toolbar.

- [ ] **Step 2: Polish canvas nodes**

Add `shadow-sm` to node cards, increase padding, add purple outline ring on selected state. Better empty state with illustration text.

- [ ] **Step 3: Convert test sandbox from modal to slide-out drawer**

Replace the existing `showTest` modal with a slide-out drawer that opens from the right when the "Test" toolbar button is clicked. Use the same test form content but in a `Sheet` (shadcn) component instead of `Dialog`.

- [ ] **Step 4: Commit**

```bash
git add src/components/agent-studio/agent-editor.tsx src/components/agent-studio/canvas.tsx
git commit -m "fix: polish studio toolbar labels and canvas node styling"
```

### Task 17: Analytics Tab

**Files:**
- Create: `src/app/(dashboard)/agents/[id]/analytics/page.tsx`
- Create: `src/app/api/agents/[id]/analytics/route.ts`
- Create: `src/components/agents/agent-analytics-dashboard.tsx`
- Create: `src/components/agents/success-rate-chart.tsx`
- Create: `src/components/agents/actions-by-type-chart.tsx`
- Create: `src/components/agents/error-log-table.tsx`
- Create: `src/components/agents/metric-cards.tsx`

- [ ] **Step 1: Install recharts**

Run: `cd /Users/vaibhav/testofgithubrepo/axon && npm install recharts`

- [ ] **Step 2: Create analytics API route**

`GET /api/agents/[id]/analytics?range=30d` — queries `agent_actions` table for the agent, aggregates success rate by day, action counts by type, recent errors. Returns `{ metrics, timeSeries, errors }`.

- [ ] **Step 3: Create sub-components**

Create focused files in `src/components/agents/`:
- `metric-cards.tsx` — 4 metric summary cards (Total Actions, Success Rate, Avg Response Time, Error Count)
- `success-rate-chart.tsx` — Recharts `LineChart` wrapper for success rate over time
- `actions-by-type-chart.tsx` — Recharts `BarChart` wrapper for action counts by type
- `error-log-table.tsx` — scrollable table of recent errors with timestamps

- [ ] **Step 4: Create AgentAnalyticsDashboard component**

Container in `src/components/agents/agent-analytics-dashboard.tsx`: Time range selector (7d/30d/90d/All), composes the 4 sub-components above. Empty state when no data: "This agent hasn't run yet. Deploy it to start seeing analytics."

- [ ] **Step 5: Create analytics/page.tsx**

Simple page that renders `<AgentAnalyticsDashboard agentId={id} />`.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/(dashboard)/agents/[id]/analytics/' 'src/app/api/agents/[id]/analytics/' src/components/agents/agent-analytics-dashboard.tsx src/components/agents/success-rate-chart.tsx src/components/agents/actions-by-type-chart.tsx src/components/agents/error-log-table.tsx src/components/agents/metric-cards.tsx package.json package-lock.json
git commit -m "feat: add Analytics tab with charts and metrics"
```

---

## Wave 8: Embed Polish & Final Touches

### Task 18: Embed & API Tab Polish

**Files:**
- Modify: `src/app/(dashboard)/agents/[id]/embed/page.tsx`

- [ ] **Step 1: Improve embed cards**

Add "Copied!" toast feedback on copy buttons (use a brief state toggle). Add API key masking with eye toggle. Improve card visual hierarchy with better spacing and labels. Add device frame mockup around the widget preview (a simple bordered container with rounded corners and a fake browser chrome bar).

- [ ] **Step 2: Commit**

```bash
git add 'src/app/(dashboard)/agents/[id]/embed/page.tsx'
git commit -m "fix: polish Embed & API tab with copy feedback and key masking"
```

### Task 19: TagManager Component (Inline Tag Editing)

**Files:**
- Create: `src/components/agents/tag-manager.tsx`

- [ ] **Step 1: Build inline tag editor**

Used in the detail shell header. Shows tag pills + "+ tag" button. Clicking "+ tag" opens a dropdown of available tags (from `useAgentTags`). Selecting a tag calls `PUT /api/agents/[id]/tags`. Can remove tags by clicking X on a pill.

- [ ] **Step 2: Wire into AgentDetailShell layout**

Import and use `<TagManager>` in the layout header next to the agent name.

- [ ] **Step 3: Commit**

```bash
git add src/components/agents/tag-manager.tsx 'src/app/(dashboard)/agents/[id]/layout.tsx'
git commit -m "feat: add inline TagManager for agent detail header"
```

### Task 20: Responsive Behavior

**Files:**
- Modify: `src/app/(dashboard)/agents/page.tsx`
- Modify: `src/app/(dashboard)/agents/[id]/layout.tsx`

- [ ] **Step 1: Add responsive breakpoints to list page**

- `< 768px`: hide left sidebar + fleet sidebar, single-column cards
- `768-1024px`: left sidebar icons-only (48px), hide fleet, 2-column cards
- `> 1024px`: full three-panel layout

- [ ] **Step 2: Add responsive breakpoints to detail shell**

- Tab bar scrolls horizontally on small screens
- Header wraps action buttons below agent info on mobile

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/agents/page.tsx 'src/app/(dashboard)/agents/[id]/layout.tsx'
git commit -m "fix: add responsive behavior for agents pages"
```

### Task 21: Final Build Verification & Cleanup

- [ ] **Step 1: Run full build**

Run: `cd /Users/vaibhav/testofgithubrepo/axon && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Run lint**

Run: `cd /Users/vaibhav/testofgithubrepo/axon && npm run lint`
Fix any lint errors.

- [ ] **Step 3: Manual smoke test**

Navigate through:
1. `/agents` — verify three-panel layout, groups sidebar, tag filter, search, sort, grid/list toggle
2. Click into an agent — verify unified header + tab bar
3. Click through all tabs: Studio, Soul, Chat, Embed & API, Analytics
4. Create a group, assign an agent, verify count updates
5. Add/remove tags, verify filter works

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and build verification for agents redesign"
```
