# Agents Area Redesign — Design Spec

## Problem

The Agents page displays all agents in a flat 3-column grid with no organizational structure. With 5-50 agents, the page becomes cluttered and unusable. Interior agent pages (Studio, Soul, Chat, Embed) have inconsistent headers, navigation, and visual quality.

## Goals

1. Organize agents via Smart Groups, user-created Groups, and Tags
2. Add search, filtering, and sorting to the agents list
3. Unify interior agent pages under a consistent header + tab navigation shell
4. Polish the Soul editor, Studio canvas, and Embed pages

## Non-Goals

- Bulk operations (select multiple agents)
- Drag-and-drop reordering of agents
- Agent templates in the main list
- Pagination (not needed for 5-50 agents)

---

## Data Model

### New Tables

#### `agent_groups`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| business_id | UUID | FK to businesses |
| name | TEXT | e.g., "Sales", "Support" |
| icon | TEXT | Emoji string, e.g., "📧" |
| color | TEXT | Optional hex color |
| sort_order | INTEGER | User-defined ordering |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Constraints: `UNIQUE(business_id, name)`. Max 20 groups per business.

#### `agent_tags`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| business_id | UUID | FK to businesses |
| name | TEXT | e.g., "email", "crm" |
| color | TEXT | Hex color for the pill |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Constraints: `UNIQUE(business_id, name)`. Max 50 tags per business. Max 10 tags per agent.

#### `agent_tag_assignments`

| Column | Type | Notes |
|--------|------|-------|
| agent_id | UUID | FK to agents |
| tag_id | UUID | FK to agent_tags |
| PRIMARY KEY | (agent_id, tag_id) | Composite |

### RLS Policies

All three new tables require RLS policies scoped to `business_id`:

- `agent_groups`: SELECT/INSERT/UPDATE/DELETE where `business_id` matches authenticated user's business
- `agent_tags`: SELECT/INSERT/UPDATE/DELETE where `business_id` matches authenticated user's business
- `agent_tag_assignments`: SELECT/INSERT/DELETE where the referenced `agent_id` belongs to the user's business

### Schema Changes to `agents`

- Add `group_id UUID REFERENCES agent_groups(id) ON DELETE SET NULL` (nullable)
- `description` column already exists (nullable TEXT) — no migration needed
- Add `last_action_at TIMESTAMPTZ` (nullable) — updated when agent executes an action, used for "Last active" sorting

### Migration Order

1. Create `agent_groups` table + RLS policies
2. Create `agent_tags` table + RLS policies
3. Create `agent_tag_assignments` table + RLS policies
4. ALTER `agents` to add `group_id` FK and `last_action_at` column
5. Regenerate `database.ts` types via Supabase CLI

### Status Reconciliation

The database uses `'active' | 'paused' | 'learning' | 'error' | 'draft'` while the TypeScript enum has `ARCHIVED`. This spec standardizes on the following statuses and adds a migration to align:

- `active`, `paused`, `draft`, `error`, `archived` (rename `learning` → `archived` in DB)
- Update the `AgentStatus` enum to include `ERROR = 'error'`

### Smart Groups (Computed, No Storage)

- **All Agents**: No filter
- **Active**: `status = 'active'`
- **Drafts**: `status = 'draft'`
- **Needs Attention**: `status = 'error'` OR has pending approvals (computed via `approval_counts` API, cached in `useFleetAgents` hook)

---

## Agents List Page

### Layout: Three-Panel

#### Left Sidebar (~220px)

- **Smart Groups** section (auto-populated, read-only):
  - All Agents (count)
  - Active (count)
  - Drafts (count)
  - Needs Attention (count, red badge if > 0)
- **My Groups** section (user-created):
  - Each group shows emoji icon + name + agent count
  - "+" button to create new group (name + emoji picker)
  - Right-click/kebab: rename, change icon, reorder, delete
  - "New Group" dashed button at bottom
- **Stats summary** at bottom: total agents, active count, avg success rate

#### Main Content Area

- **Page header**: "Agents" title + subtitle + Export CSV + Create Agent buttons
- **Tag filter bar**: horizontal row of pill-shaped tag toggles, search input on left
- **Sort/view controls**: sort dropdown (Name, Last active, Success rate, Created) + Grid/List toggle
- **Agent cards** (2-column grid in grid view):
  - Trigger-type icon (colored gradient background, 40x40)
  - Agent name (bold)
  - Status badge (Active/Draft/Paused/Error with semantic colors)
  - Description line (truncated)
  - Tag pills
  - Metrics line: success rate, action count, last run time
  - Hover: border accent in Axon purple (#6C72FF), subtle shadow
  - Error agents: red left border accent
- **List view** (alternative): compact table rows with same data
- **Empty state**: illustration + "Create your first agent" CTA when group has no agents

#### Right Sidebar (~190px, Collapsible)

- Fleet status panel (existing, slimmed down)
- Collapse toggle arrow
- Mini filter tabs: All / Active / Needs Attention
- Scrollable list of agents with status dots and pending approval badges

### API Changes

- `GET /api/agents` — add query params: `group_id`, `tag_ids[]`, `search`, `sort_by`, `sort_order`
- `GET /api/agent-groups` — list groups for business
- `POST /api/agent-groups` — create group
- `PATCH /api/agent-groups/[id]` — update group
- `DELETE /api/agent-groups/[id]` — delete group (agents become ungrouped)
- `GET /api/agent-tags` — list tags for business
- `POST /api/agent-tags` — create tag. Body: `{ name: string, color: string }`
- `PATCH /api/agent-tags/[id]` — update tag. Body: `{ name?: string, color?: string }`
- `DELETE /api/agent-tags/[id]` — delete tag (removes all assignments)
- `PUT /api/agents/[id]/tags` — set tags on agent (replaces all). Body: `{ tag_ids: string[] }`
- `DELETE /api/agents/[id]/tags/[tagId]` — remove single tag from agent

All mutation endpoints validate with Zod and return `ApiResponse<T>`.

---

## Agent Detail Shell

### Unified Header (Sticky)

All agent sub-pages share one header component:

- **Back arrow** → returns to agents list
- **Separator**
- **Agent icon** (trigger-type emoji, 38x38, gradient background)
- **Agent name** (inline-editable text, 17px, bold)
- **Status badge** (semantic color)
- **Group pill** (emoji + group name)
- **Tag pills** (with "+ tag" button for inline adding)
- **Right side**: last-saved timestamp, success rate, Save button, Deploy/Pause button, kebab menu (Delete, Duplicate, Archive, Version History)

### Tab Bar (Below Header)

Horizontal tabs with emoji icons and bottom-border accent:
1. ⚡ Studio
2. 🧠 Soul
3. 💬 Chat
4. 🔗 Embed & API
5. 📊 Analytics (new)

Active tab: Axon purple (#6C72FF) text + 2px bottom border.

Implemented as a Next.js App Router `layout.tsx` at `app/(dashboard)/agents/[id]/layout.tsx`. Each tab corresponds to a nested route segment (`/agents/[id]` for Studio, `/agents/[id]/soul`, `/agents/[id]/chat`, `/agents/[id]/embed`, `/agents/[id]/analytics`). The layout fetches agent data and renders the header + tab bar, with `{children}` for tab content. This preserves URL-based routing, back-button behavior, and deep-linking.

Agent name editing: debounced auto-save (500ms) via `PATCH /api/agents/[id]` with `{ name: string }`. Name validation: 1-100 characters, non-empty after trim.

All existing per-page headers (back buttons, name, status) are removed from individual page components — the shell handles this.

---

## Studio Tab Improvements

- **Toolbar**: icon + text labels on buttons (Trigger, Brain, Action)
- **Canvas nodes**: subtle box-shadow, better spacing, selected state with purple outline
- **Right panels** (Permissions, Schedule, Fine-tune): slide-in animation
- **Empty state**: illustrated placeholder with "Design your first workflow" CTA
- **Test sandbox**: moved from modal to a slide-out drawer from the toolbar

---

## Soul Tab Improvements

### Vertical Section Nav (Left, ~180px)

Replaces 8 ALL-CAPS horizontal tabs. Two groups:

**Configuration:**
- 🧠 Soul
- 👤 Identity
- 🎯 User Context
- 🤖 Agents
- 🔧 Tools

**Behavior:**
- 💓 Heartbeat
- 🧠 Memory
- 🛡 Governance

Active section: Axon purple background, white text.

### Editor Area (Center, max-w-720px)

- Section title + description
- Full-width monospace textarea for soul prompt
- 2-column grid for secondary fields (Greeting, Output Format, Isolation Rules, Intake Questions)
- Better label styling: above fields, 12px, medium weight

### Right Sidebar (~260px)

- **Quick Test card**: input + "Run Test" button + result display (pass/fail + response + duration)
- **Suggestions card**: "Get Improvement Ideas" button + AI suggestions display
- **Gatekeeper Reviews**: pass/fail badges with scores

---

## Chat Tab

No major changes. Already well-structured.

---

## Embed & API Tab Improvements

- Improved card layout with better visual hierarchy
- Copy buttons with "Copied!" toast feedback
- Widget preview with device frame mockup
- API key masking with reveal toggle

---

## Analytics Tab (New)

Uses Recharts (add as dependency) for charts. Data sourced from `agent_actions` and `agent_metrics` tables.

### Components

- `AgentAnalyticsDashboard` — main container
- `SuccessRateChart` — line chart, Recharts `LineChart`
- `ActionsByTypeChart` — bar chart, Recharts `BarChart`
- `ErrorLogTable` — scrollable table of recent errors
- `MetricCards` — summary cards (total actions, avg response time, uptime)

### Layout

- **Time range selector** at top: 7d / 30d / 90d / All time (default: 30d)
- **4 metric cards** in a row: Total Actions, Success Rate, Avg Response Time, Error Count
- **2-column grid** below: Success Rate chart (left), Actions by Type chart (right)
- **Error log table** full-width below charts

### Empty State

When agent has no execution data: illustration + "This agent hasn't run yet. Deploy it to start seeing analytics."

### Data Fetching

- `GET /api/agents/[id]/analytics?range=30d` — returns aggregated metrics, time-series data, and recent errors

---

## Component Architecture

### New Components

- `AgentGroupSidebar` — left sidebar with smart groups + user groups
- `AgentTagFilter` — horizontal tag pill filter bar
- `AgentCard` — enriched card with icon, tags, metrics
- `AgentDetailShell` — unified header + tab bar wrapper (lives at `app/(dashboard)/agents/[id]/layout.tsx`)
- `AgentListRow` — compact table row for list view
- `AgentAnalyticsDashboard` — analytics tab container
- `SuccessRateChart` — line chart component (Recharts)
- `ActionsByTypeChart` — bar chart component (Recharts)
- `ErrorLogTable` — error log table
- `GroupDeleteDialog` — confirmation dialog for group deletion
- `SoulVerticalNav` — vertical section nav for soul editor
- `QuickTestCard` — test panel card component
- `GroupCreateDialog` — create/edit group dialog
- `TagManager` — inline tag assignment component

### Modified Components

- `agents/page.tsx` → three-panel layout with sidebar + grid
- `fleet-sidebar.tsx` → slimmer, collapsible
- `agent-editor.tsx` → remove header (moved to shell)
- `agents/[id]/page.tsx` → renders inside AgentDetailShell
- `agents/[id]/soul/page.tsx` → vertical nav layout, renders inside shell
- `agents/[id]/chat/page.tsx` → remove header (moved to shell)
- `agents/[id]/embed/page.tsx` → remove header (moved to shell)

### New Hooks

- `useAgentGroups()` — fetch/mutate groups
- `useAgentTags()` — fetch/mutate tags
- `useAgentFilters()` — search, sort, filter state

---

## Design Tokens

Using existing Axon design system:

- Primary accent: `#6C72FF`
- Text primary: `#1A1D26`
- Text secondary: `#6B7280`
- Text tertiary: `#9CA3AF`
- Border: `#E5E7EB`
- Background subtle: `#F8F9FB`
- Success: `#22C55E` / `#DCFCE7`
- Error: `#EF4444` / `#FEE2E2`
- Warning: `#F59E0B` / `#FEF3C7`
- Draft: `#854D0E` / `#FEF9C3`

---

## Responsive Behavior

- **< 768px (mobile)**: Left sidebar hidden behind hamburger toggle. Right Fleet sidebar hidden. Agent cards stack to single column. Tab bar scrolls horizontally.
- **768–1024px (tablet)**: Left sidebar collapsed to icons-only (48px). Fleet sidebar hidden. Agent cards 2-column.
- **> 1024px (desktop)**: Full three-panel layout as designed.

---

## Loading & Error States

- **Left sidebar**: Skeleton loaders for group list (5 placeholder rows) while groups/counts load
- **Tag filter bar**: Skeleton pills while tags load
- **Agent cards**: Existing skeleton card pattern (already in codebase)
- **Group deletion**: Confirmation dialog: "Delete [group name]? [N] agents will become ungrouped."
- **API errors**: Toast notifications for mutation failures

---

## Testing Strategy

### Unit Tests (`src/__tests__/hooks/`)
- `useAgentGroups` — fetch, create, update, delete, error handling
- `useAgentTags` — fetch, create, update, delete, error handling
- `useAgentFilters` — search debounce, sort state, tag filter toggle

### Component Tests (`src/__tests__/components/`)
- `AgentCard` — renders name, status, tags, metrics; hover state
- `AgentListRow` — compact row rendering
- `AgentGroupSidebar` — group list, active group highlighting, create dialog
- `AgentTagFilter` — tag pill toggle, active filter state
- `AgentDetailShell` — header rendering, tab active state
- `SoulVerticalNav` — section navigation, active section highlight
- `GroupDeleteDialog` — confirmation flow

### Integration Tests (`src/__tests__/api/`)
- CRUD `agent-groups` — create, list, update, delete, validation errors
- CRUD `agent-tags` — create, list, update, delete, duplicate name rejection
- `agent-tag-assignments` — set tags, remove tag, tag limit enforcement
- `GET /api/agents` — filtering by group, tags, search, sorting

### E2E Tests (`e2e/`)
- Create a group, assign agents, verify group count updates
- Filter agents by tag, verify grid updates
- Search agents by name
- Navigate between detail tabs, verify URL updates
- Soul vertical nav section switching
- Analytics tab with empty state and with data
