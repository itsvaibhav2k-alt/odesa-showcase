# Odesa Agent Constitution

This repo is worked on by Hermes, Claude Code, Codex, and other AI coding agents. Follow these rules unless Vaibhav explicitly overrides them.

## Product identity

Odesa is an AI property-operator for small landlords. The product should feel like a warm, premium operator briefing console — not cold enterprise SaaS.

Design direction:
- warm paper canvas, cream panels, thin warm borders;
- serif premium headings with IBM Plex/mono operator accents;
- muted terracotta/gold/green, navy CTAs, honest status dots;
- elevated input shells, helper cards, subtle warm illustrations;
- dense enough to be useful, calm enough to feel trustworthy.

## Standing autonomy model

Hermes may autonomously own low- and medium-risk Odesa execution tasks: UI polish, cleanup, QA, bug fixes, handoffs, agent supervision, screenshots, tests, and verification. Hermes may use Claude/Codex as workers, edit local files, run local commands, and iterate until the artifact is ready.

Agents must not commit, push, deploy, contact real users, purchase services, run production-destructive commands, or make irreversible business/legal/product decisions without explicit approval from Vaibhav.

Default Odesa autonomy level is delegated execution: produce working artifacts, gates, screenshots, and a blunt GREEN/YELLOW/RED verdict. Ask Vaibhav only when a real product/taste/business/safety decision is needed.

## Non-negotiable safety / honesty rules

- Do not fake financial, payment, expense, vendor, NOI, Schedule E, call, or telemetry data.
- Do not imply payment timestamps exist unless the database has real payment timestamps. `rent_events.updated_at` is not proof of payment time.
- Do not invent routes or integrations. If a route/integration is absent, show a clear unavailable/not-connected state.
- No money movement is automated.
- No legal threats, eviction threats, fee waivers, lease amendments, payment plans, vendor dispatch/cost commitments, emergency-dispatch promises, or private-data disclosure to unknown callers without explicit owner approval and supported implementation.
- Conservative no-action outcomes are healthy when required evidence or safety inputs are missing.

## Workflow for meaningful changes

1. Inspect before editing.
   - `git status --short --branch`
   - read relevant files/tests/contracts
   - inspect screenshots or run the app for UI work
2. Make the smallest coherent change that satisfies the task.
3. Verify with real commands and evidence.
4. For UI, capture screenshots and judge pixels — green tests are not enough.
5. Report exact files changed, gates run, screenshots, blockers, and deferred items.

## Verification gates

Use the narrowest relevant gate during iteration, then broader gates before declaring done.

Common gates:

```bash
npm run typecheck
npm run lint
npm test -- <target>
npm run build
BASE_URL=http://localhost:3100 npx playwright test <spec> --project=chromium --workers=1
```

For `/financials` work, include:

```bash
npm test -- src/lib/financials
BASE_URL=http://localhost:3100 npx playwright test e2e/financials/console.spec.ts --project=chromium --workers=1
```

For Retell/voice work, include:

```bash
BASE_URL=http://localhost:3100 npx playwright test e2e/retell/tool-endpoints.spec.ts --project=chromium --workers=1
```

## Agent roles

Hermes:
- product operator / gatekeeper / QA lead;
- writes handoffs, launches/monitors workers, verifies artifacts;
- gives GREEN/YELLOW/RED verdicts with evidence.

Claude Code:
- primary builder for ambiguous product/UX/architecture work;
- must follow handoffs, respect no-commit/no-push constraints, and return exact gates.

Codex:
- reviewer, debugger, surgical fixer, safety auditor;
- useful for diff review, test holes, and independent second opinions.

No builder agent self-certifies. Hermes verifies independently.

## Report format

Outcome first. Include:
- verdict: GREEN / YELLOW / RED;
- what changed;
- files changed;
- exact gates and results;
- screenshots or artifact paths for UI;
- blockers vs polish;
- deferred items;
- whether anything was committed/pushed (normally no).
