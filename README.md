# Odesa

AI property operator for small landlords (5-50 units). Answers every tenant
call and text, runs rent collection, dispatches maintenance, sends a weekly
briefing. Voice-first with augmentation-before-autonomy.

## Stack

Next.js 16 · React 19 · TypeScript strict · Supabase (Postgres + RLS + Auth
+ Storage) · Inngest · Stripe · Plaid · Retell AI · Anthropic Claude · Linq
primary / Twilio standby · Sentry · Tailwind v4 + shadcn/ui · Playwright ·
Vitest.

## Getting started

```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev                  # http://localhost:3000
```

## Commands

```bash
npm run dev                         # dev server
npm run build                       # production build
npm run lint                        # eslint
npm run typecheck                   # tsc --noEmit
npm test                            # vitest unit
npm run test:coverage               # vitest + coverage
npm run test:e2e                    # playwright (builds + starts + runs)
npm run test:e2e:update-snapshots   # refresh visual-regression baselines
```

Pass `ALL_BROWSERS=1` to the e2e command to include firefox + webkit
projects (default on CI is chromium-only for speed).

## CI

Three GitHub Actions workflows run on every PR against `main`:

| Workflow | What it runs | Why |
|---|---|---|
| `.github/workflows/ci.yml` | `npm run lint`, `tsc --noEmit`, `npm test` | fast guardrail on every push |
| `.github/workflows/e2e.yml` | Playwright full suite, sharded 4 ways, chromium only | correctness gate |
| `.github/workflows/deploy-preview.yml` | `vercel deploy --prebuilt` + PR comment | deploy preview URL |

Dependabot (`.github/dependabot.yml`) opens grouped weekly bumps for the
Next/React, testing, and Sentry stacks + monthly GitHub Actions bumps.

### Required GitHub secrets

- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` — deploy-preview
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` — source map upload
  in `next.config.ts` (optional; build degrades gracefully when missing)

## Sentry

Client + server + edge configs live at the repo root
(`sentry.client.config.ts`, `sentry.server.config.ts`,
`sentry.edge.config.ts`). The Next 16 instrumentation hook
(`instrumentation.ts`) wires the server/edge configs into the runtime;
`next.config.ts` wraps exports with `withSentryConfig` for source-map
upload.

- **DSN**: `NEXT_PUBLIC_SENTRY_DSN` (client) + `SENTRY_DSN` (server/edge)
- **Sampling**: 100% errors; 10% transactions in production; 100% in
  preview/development.
- **Session Replay**: scoped to authenticated app routes only (`/today`,
  `/inbox`, `/properties`, `/settings`; 10% sessions, 100% on error) so
  we don't record marketing traffic.
- **Source maps**: uploaded when `SENTRY_AUTH_TOKEN` is set. Local
  builds without the token succeed silently.

A `.sentryclirc` is **not checked in** — use the env vars above. For
local one-off releases, create `~/.sentryclirc` with `[auth] token=…`
(see https://docs.sentry.io/cli/configuration/).

## Structure

```
src/
  app/
    (auth)/          # login, signup
    (dashboard)/     # today, inbox, properties, settings
    api/             # route handlers (inngest, billing, webhooks, ...)
  components/ui/     # shadcn/ui primitives
  lib/
    supabase/        # clients (browser, server, admin)
    inngest/         # client + cron functions
    stripe/          # Stripe + Plaid helpers
    security/        # sanitize, PII redaction
    messaging/       # MessagingProvider abstraction (Linq + Twilio)
    agent/           # whitelist evaluator + emergency matcher
    briefing/        # metrics + generator
  types/             # shared types + generated Supabase types
supabase/migrations/ # timestamped SQL migrations
e2e/                 # Playwright specs + fixtures + mocks
tests/unit/          # Vitest unit tests
```

## Key references

- Design spec: `/Users/vaibhav/testofgithubrepo/docs/superpowers/specs/2026-04-21-odesa-property-operator-design.md`
- Implementation plan: `/Users/vaibhav/.claude/plans/reactive-launching-parrot.md`
- See `CLAUDE.md` for critical rules, code style, and conventions.
