# Odesa Agent Repo Map

Last updated: 2026-07-05

Use this as a navigation aid. It is not a replacement for reading exact files before editing.

## Mission

Odesa is a Next.js 16 AI property-operator for small landlords. It answers tenant calls/texts, follows rent, coordinates maintenance, drafts owner actions, and provides a warm operator-console dashboard.

## Stack

- App: Next.js 16 App Router, React 19, TypeScript.
- Data: Supabase/Postgres types in `src/types/database.ts`.
- Tests: Vitest for unit tests, Playwright for e2e.
- Messaging/voice: messaging abstractions under `src/lib/messaging`; Retell tool endpoints under `src/app/api/retell/tools`.
- AI/operator work: `src/lib/agent`, `src/components/operator`, action proposals, owner queue.

## Core routes

Dashboard routes live under `src/app/(dashboard)`:

- `/today` — daily briefing/operator surface.
- `/inbox` — tenant/message conversations and drafts.
- `/owner-queue` — owner decisions/action proposals.
- `/properties` and `/properties/[id]` — portfolio/property detail.
- `/rent` — rent ledger.
- `/financials` — financial command center.
- `/settings` and `/settings/integrations` — account/integration/reliability surfaces.
- `/work-orders/[woId]` — work order detail.

API routes:

- `src/app/api/retell/tools/*` — Retell tool endpoints.
- `src/app/api/messaging/*` — messaging inbound/drafts/test hooks.
- `src/app/api/agent/*` — agent/trust/meta-learning/test hooks.
- `src/app/api/action-proposals/*` — proposal commit/edit/reject.

## Important source areas

Financials:
- `src/app/(dashboard)/financials/page.tsx`
- `src/components/financials/*`
- `src/lib/financials/*`
- `e2e/financials/console.spec.ts`

Retell/voice:
- `src/app/api/retell/tools/*/route.ts`
- `src/lib/agent/retell-auth.ts`
- `e2e/retell/tool-endpoints.spec.ts`
- `e2e/mocks/retell-mock.ts`

Messaging:
- `src/lib/messaging/*`
- `src/app/api/messaging/*`
- `e2e/messaging/*`

Owner queue/action proposals:
- `src/app/(dashboard)/owner-queue/*`
- `src/components/operator/*`
- `src/app/api/action-proposals/*`
- `e2e/owner-queue/*`

Inbox:
- `src/app/(dashboard)/inbox/*`
- `e2e/inbox/*`

Properties/work orders:
- `src/app/(dashboard)/properties/*`
- `src/app/(dashboard)/work-orders/*`
- `src/lib/properties/*`
- `e2e/properties/*`

## Verification commands

General:

```bash
npm run typecheck
npm run lint
npm run build
```

Unit tests:

```bash
npm test -- src/lib/financials
npm test -- src/lib/messaging
npm test -- src/lib/agent
```

E2E examples:

```bash
BASE_URL=http://localhost:3100 npx playwright test e2e/financials/console.spec.ts --project=chromium --workers=1
BASE_URL=http://localhost:3100 npx playwright test e2e/retell/tool-endpoints.spec.ts --project=chromium --workers=1
BASE_URL=http://localhost:3100 npx playwright test e2e/inbox/redesign.spec.ts --project=chromium --workers=1
BASE_URL=http://localhost:3100 npx playwright test e2e/owner-queue/decisions-desk.spec.ts --project=chromium --workers=1
```

Common full local command sequence:

```bash
npm run typecheck && npm run lint && npm run build
```

## Local app

The user often runs a production server at `http://localhost:3100`. Use `BASE_URL=http://localhost:3100` for Playwright against it.

For browser QA, use existing e2e helper patterns for authenticated Galaxy owner state when possible. Do not stop at `/login` and call that a UI review.

## Screenshot conventions

Design/debug screenshots usually go under:

```text
design/<topic>-YYYY-MM-DD/
```

For Odesa UI reviews, capture at least:
- full page,
- top viewport,
- key component close-up,
- bottom/secondary state if relevant.

## Product/design invariants

- Warm paper/operator-console look.
- One obvious thesis per page/section.
- CTAs must go to real routes.
- No fake data or fake integrations.
- Money and financial states must be honest.
- Dashboard should answer “what changed, why it matters, what to do next.”
- For graph work: charts must occupy space, use direct labels, respect available data granularity, and avoid fake precision.

## Retell/voice invariants

- Build deterministic Odesa policy around LLM/Retell, not freeform prompt-only autonomy.
- Safe autonomous actions: record calls, create work orders, create owner queue/inbox items, send safe acknowledgements, request photos/payment proof.
- Draft/approval required: rent pressure, legal, payment plans, fee waivers, vendor dispatch, entry/access scheduling, lease interpretation.
- Never in V1: legal threats, payment processing, lease changes, fake payment timestamps, emergency dispatch promises, private info to unknown callers.

## Repo hygiene

- Do not commit/push without explicit approval.
- Before reporting done: `git status --short`, `git diff --stat`, and relevant gates.
- Treat Claude/Codex self-reports as untrusted until independently verified.
- Keep generated evidence/screenshots organized; mention whether they should be committed or left as local artifacts.
