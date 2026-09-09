#!/usr/bin/env node
/**
 * check-vercel-sdk-leak — deploy guard for the Vercel bundle.
 *
 * The Claude Agent SDK's linux-x64 native binary (~249MB) exceeds
 * Vercel's 250MB function cap, so the operator dispatcher executes in
 * the dedicated worker app (src/worker/inngest-server.ts, Railway).
 * This script fails the build if any Vercel-bundled file statically
 * imports the SDK chain:
 *
 *   - '@anthropic-ai/claude-agent-sdk'         (the SDK itself)
 *   - 'agent/operator/dispatcher'              (dispatcher → SDK)
 *   - 'agent/operator/run-executor'            (executor → dispatcher → SDK)
 *   - 'inngest/functions/run-operator-dispatcher' (Inngest fn → executor)
 *
 * Scanned: every .ts/.tsx under src/app/** (Vercel route entrypoints)
 * PLUS the lib files those routes import that sit on the split chain
 * (the enqueue callers). Tests are skipped — Vercel never bundles them.
 * Dynamic `await import(...)` is allowed: the dev-only inline fallback
 * (NODE_ENV-guarded) and the legacy non-durable chat paths (three SSE
 * chat routes + handle-operator-inbound's flag-off branch) lazy-import
 * the dispatcher so it never lands in the bundle graph.
 *
 * Allowlisted import: '@/lib/inngest/events' — the dependency-free
 * constants module that exists precisely so callers DON'T need the
 * function module.
 *
 * Usage: npm run check:sdk-leak   (exit 1 on violation)
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();

/** Import specifiers that must never be statically imported on Vercel. */
const FORBIDDEN_PATTERNS = [
  '@anthropic-ai/claude-agent-sdk',
  'agent/operator/dispatcher',
  'agent/operator/run-executor',
  'inngest/functions/run-operator-dispatcher',
];

/** Vercel-side lib files on the chain this guard protects. */
const EXTRA_CHAIN_FILES = [
  'src/lib/messaging/handle-operator-inbound.ts',
  'src/lib/mcp/handlers.ts',
  'src/lib/inngest/events.ts',
];

const TEST_PATH_RE = /(__tests__|\.test\.|\.spec\.)/;

/**
 * Match STATIC imports/re-exports only:
 *   import x from '...'; import '...'; export { x } from '...';
 * Dynamic `import('...')` is intentionally not matched.
 */
const STATIC_IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

function collectAppFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectAppFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !TEST_PATH_RE.test(full)) {
      out.push(full);
    }
  }
}

function findViolations(file) {
  const text = fs.readFileSync(file, 'utf8');
  const violations = [];
  let match;
  STATIC_IMPORT_RE.lastIndex = 0;
  while ((match = STATIC_IMPORT_RE.exec(text)) !== null) {
    const spec = match[1] ?? match[2];
    if (!spec) continue;
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (spec.includes(pattern)) {
        violations.push({ spec, pattern });
      }
    }
  }
  return violations;
}

const appDir = path.join(ROOT, 'src', 'app');
if (!fs.existsSync(appDir)) {
  console.error('check-vercel-sdk-leak: src/app not found — run from repo root.');
  process.exit(1);
}

const files = [];
collectAppFiles(appDir, files);
for (const rel of EXTRA_CHAIN_FILES) {
  const full = path.join(ROOT, rel);
  if (fs.existsSync(full)) files.push(full);
}

let failed = false;
for (const file of files) {
  for (const { spec, pattern } of findViolations(file)) {
    failed = true;
    console.error(
      `LEAK: ${path.relative(ROOT, file)} statically imports '${spec}' (forbidden: ${pattern})`,
    );
  }
}

if (failed) {
  console.error(
    '\nThe Claude Agent SDK chain must not be statically imported by Vercel-bundled code.\n' +
      'Its native binary exceeds the 250MB function cap; the dispatcher runs in the\n' +
      'Railway worker (src/worker/inngest-server.ts). Import event constants from\n' +
      "'@/lib/inngest/events' instead, or use a guarded dynamic import for dev-only paths.",
  );
  process.exit(1);
}

console.log(
  `check-vercel-sdk-leak: OK — ${files.length} files scanned, no static Agent SDK chain imports.`,
);
