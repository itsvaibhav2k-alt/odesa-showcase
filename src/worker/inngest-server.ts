/**
 * odesa-operator-worker — dedicated always-on Inngest app.
 *
 * Why this exists: `run-operator-dispatcher` transitively imports the
 * Claude Agent SDK, whose linux-x64 native binary (~249MB) exceeds
 * Vercel's 250MB function cap — it can never execute there. This plain
 * Node server (deployed on Railway) registers ONLY that function with
 * Inngest Cloud; Vercel's /api/inngest keeps every other function.
 * Each service registers as its OWN Inngest app with a distinct id
 * ('odesa-operator-worker' here vs 'odesa' on Vercel) — Inngest keys
 * apps by id, so two services syncing the same id from different URLs
 * overwrite each other (last sync wins, missing functions archived).
 * Events are environment-scoped, not app-scoped, so cross-app delivery
 * works: Vercel sends, this app executes.
 *
 * Endpoints:
 *   GET  /healthz      → 200 when semantic memory is configured; otherwise
 *                        503 with a secret-free degraded reason
 *   *    /api/inngest  → Inngest serve handler (register + execute)
 *
 * Run with `npm run worker:operator` (tsx — resolves the repo's `@/*`
 * tsconfig paths). PORT from env, default 8080.
 *
 * Deploy runbook: `railway up --detach` from a clean worktree of main,
 * then sync the app registration with Inngest Cloud:
 *   curl -X PUT https://<worker-domain>/api/inngest
 * (Vercel's app syncs automatically on deploy; this one is manual.)
 */

import http from 'node:http';

import { serve } from 'inngest/node';

import { inngestOperatorWorker } from '@/lib/inngest/client';
import { RUN_OPERATOR_DISPATCHER_FN_ID } from '@/lib/inngest/events';
import { runOperatorDispatcherFn } from '@/lib/inngest/functions/run-operator-dispatcher';
import { deploymentHealth } from '@/lib/health/readiness';

const DEFAULT_PORT = 8080;
const INNGEST_PATH = '/api/inngest';

function resolvePort(): number {
  const raw = process.env.PORT;
  if (!raw) return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    console.error(`[operator-worker] invalid PORT "${raw}" — using ${DEFAULT_PORT}`);
    return DEFAULT_PORT;
  }
  return parsed;
}

const inngestHandler = serve({
  client: inngestOperatorWorker,
  functions: [runOperatorDispatcherFn],
  servePath: INNGEST_PATH,
});

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const pathname = (req.url ?? '').split('?')[0];

  if (pathname === '/healthz') {
    const health = deploymentHealth(
      'odesa-operator-worker',
      'operator-worker',
    );
    sendJson(res, health.status, health.body);
    return;
  }

  if (pathname === INNGEST_PATH || pathname.startsWith(`${INNGEST_PATH}/`)) {
    inngestHandler(req, res);
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
});

const port = resolvePort();
server.listen(port, () => {
  console.log(
    `[operator-worker] listening on :${port} — serving ${INNGEST_PATH} ` +
      `(functions: ${RUN_OPERATOR_DISPATCHER_FN_ID})`,
  );
});
