# Odesa

AI property operator for small landlords (5-50 units). Odesa answers every
tenant call and text, runs rent collection, dispatches maintenance, and
delivers a weekly briefing. Voice-first, augmentation-before-autonomy.

## Stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript strict
- **Database / Auth / Storage:** Supabase (Postgres + RLS + Auth + Storage)
- **Jobs:** Inngest
- **Payments:** Stripe (Connect for payouts, Plaid for ACH debit)
- **Voice:** Retell AI (agent "Alex" with 7-tool configuration)
- **Messaging:** Linq primary, Twilio standby (behind `MessagingProvider`)
- **AI:** Anthropic Claude (Sonnet 4.6 default, Opus 4.7 for briefings)
- **Observability:** Sentry
- **Styling:** Tailwind v4 + shadcn/ui
- **Testing:** Vitest (unit) + Playwright (E2E, primary gate)

## Working directories

- `/Users/vaibhav/odesa/` — this repo (fresh, forked from axon Apr 2026)
- `/Users/vaibhav/testofgithubrepo/` — design specs, landing page, docs
- `/Users/vaibhav/smart-calendar-autopilot-mobile/` — Aero (read-only
  reference for schema shape and AI service patterns; do NOT copy code)

## Data model

Twelve tables. See the full design spec for field-level notes:
`/Users/vaibhav/testofgithubrepo/docs/superpowers/specs/2026-04-21-odesa-property-operator-design.md`

Core: `organizations`, `users`, `properties`, `units`, `tenants`, `leases`,
`conversations`, `messages`, `work_orders`, `vendors`, `rent_events`,
`weekly_reports`. Every table carries `organization_id`; RLS gates every
query via `current_user_org_id()`.

## Critical rules

- **No Prisma anywhere.** Raw SQL reads via the Supabase client only.
  Migrations live in `supabase/migrations/` — ordered by timestamp.
- **RLS is mandatory.** Every table has policies gated on
  `organization_id = current_user_org_id()`. No service-role reads
  outside `scripts/` and webhook handlers.
- **Augmentation before autonomy.** Claude drafts; humans review and
  send. Voice "Alex" only acts autonomously on the intent whitelist
  (4 intents initially); everything else escalates.
- **Voice intent whitelist is load-bearing.** New intents graduate
  only after 20+ clean shadow examples + explicit human sign-off.
- **Emergency pattern matcher.** Lexical match + Claude confirmation.
  On hit: immediate landlord SMS + call in parallel, never held in
  queue.
- **Messaging provider abstraction.** All sends go through
  `MessagingProvider`. Linq-primary / Twilio-standby switch is a
  single env var flip.
- **`getUser()` not `getSession()`** for server-side auth checks.
- **Never `select *`.** Always explicit columns.
- **Validate webhook signatures.** Stripe, Retell, Linq, Twilio.

## Code style

- 2-space indent, single quotes, semicolons, trailing commas, 100-char line.
- Files: `kebab-case.ts`. Classes/Interfaces/Types: `PascalCase`.
  Functions/vars: `camelCase`. Constants: `SCREAMING_SNAKE_CASE`.
- Imports in this order: 1) node built-ins, 2) external packages,
  3) internal absolute (`@/...`), 4) relative (`./...`).
- Prefer immutable patterns (const, readonly, spread). Return new
  objects; never mutate inputs.
- Files under 400 lines ideally, 800 max. Extract utilities; small
  cohesive modules.

## Error handling

- API routes: wrap in try/catch, log with context, return
  `{ success: false, error: 'user-friendly message' }` with the right
  status. Never leak internals.
- Use `ApiResponse<T>` (in `src/types/index.ts`) as the envelope for
  every JSON response.
- Validate every request body with Zod via `validateBody()`
  (`src/lib/api-validation.ts`).

## Environment variables

- `NEXT_PUBLIC_*` — client-safe only.
- Secrets never prefixed with `NEXT_PUBLIC_`.
- See `.env.example` for the full list (note: `.env*` is gitignored,
  so `.env.example` lives on disk but is not tracked — copy locally).
- Validate presence at startup.

### v1.6 operator agent

- `MCP_PUBLIC_URL` — public origin for the Poke MCP integration
  (`/api/mcp/sse`). Dev: ngrok tunnel. Prod: Vercel domain.
  Rendered in `/settings/integrations` for the operator to paste
  into Poke.
- `OPERATOR_DISPATCHER_MODEL` — defaults to `claude-sonnet-4-5`.
  Override to swap dispatcher model without code change.

## Testing

- **Playwright-first.** Every feature ships its spec; no phase lands
  until the phase's specs are green.
- **Vitest** covers pure units (messaging abstraction, intent
  classifier, whitelist evaluator, rent state machine, briefing
  metrics, emergency matcher). Target 90%+ on `src/lib/**`.
- Coverage floor 80% overall; 90% on services.
- Pre-commit: lint + typecheck + vitest unit. Playwright runs in CI.
