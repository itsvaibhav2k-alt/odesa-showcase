// Build the route-sweep report: join the manifest (category / data source /
// spec coverage) with the latest Playwright run and the mock-data scan into
// a single route -> verdict table. Run after `npx playwright test e2e/route-sweep`.
//
// Usage: node scripts/build-sweep-report.mjs
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pageFileToPattern } from './lib/routes.mjs';

const MANIFEST = 'e2e/route-sweep/manifest.ts';
const RESULTS = 'playwright-results.json';

// ---- manifest entries (regex per single-line object) ----
function parseManifest() {
  const src = readFileSync(MANIFEST, 'utf8');
  const rows = [];
  for (const line of src.split('\n')) {
    const pat = line.match(/pattern:\s*'([^']+)'/);
    if (!pat) continue;
    rows.push({
      pattern: pat[1],
      category: (line.match(/category:\s*'([^']+)'/) || [])[1] ?? '?',
      dataSource: (line.match(/dataSource:\s*'([^']+)'/) || [])[1] ?? '?',
      hasExistingSpec: /hasExistingSpec:\s*true/.test(line),
      lenient: /lenient:\s*true/.test(line),
    });
  }
  return rows;
}

// ---- which page routes still import mock VALUES ----
function mockBackedPatterns() {
  const SRC = path.resolve('src');
  const MOCK = /mock-(portfolio|portfolio-views|detail|decisions)/;
  const QUEUE = /today\/queue-adapter/;
  const QUEUE_DEMO = /getMockQueueItems|ROW_CONTEXT|getRowContextTable/;
  const IMPORT_RE = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  const set = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (/^page\.tsx?$/.test(e)) {
        const text = readFileSync(full, 'utf8');
        for (const m of text.matchAll(IMPORT_RE)) {
          const [, clause, mod] = m;
          const typeOnly = clause.trim().startsWith('type ');
          let isMock = MOCK.test(mod);
          if (!isMock && QUEUE.test(mod) && QUEUE_DEMO.test(clause)) isMock = true;
          if (isMock && !typeOnly) set.add(pageFileToPattern(full));
        }
      }
    }
  };
  walk(SRC);
  return set;
}

// ---- playwright results: pattern -> { status, demo } ----
function parseResults() {
  if (!existsSync(RESULTS)) return null;
  const json = JSON.parse(readFileSync(RESULTS, 'utf8'));
  const byPattern = new Map();
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      const m = String(spec.title).match(/^route smoke:\s*(.+)$/);
      if (m) {
        const tests = spec.tests ?? [];
        const statuses = tests.flatMap((t) => (t.results ?? []).map((r) => r.status));
        let status = 'skip';
        if (statuses.includes('failed') || statuses.includes('timedOut')) status = 'fail';
        else if (statuses.includes('passed')) status = 'pass';
        const demo = JSON.stringify(tests).includes('demo-strings');
        byPattern.set(m[1], { status, demo });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const s of json.suites ?? []) visit(s);
  return byPattern;
}

function verdict(row, run, mockSet) {
  if (!run || !run.status) return 'NO-RUN';
  if (run.status === 'fail') return 'FAIL';
  if (run.status === 'skip') return 'SKIP';
  if (row.category !== 'customer-data') return `OK (${row.category})`;
  if (mockSet.has(row.pattern) || row.dataSource === 'mock' || row.dataSource === 'mixed' || run.demo) {
    return 'SHIP-RISK: mock';
  }
  if (!row.hasExistingSpec) return 'NEEDS-SPEC';
  return 'OK';
}

const rows = parseManifest();
const results = parseResults();
const mockSet = mockBackedPatterns();

const pad = (s, n) => String(s).padEnd(n);
console.log('\n# Route-sweep report\n');
if (!results) console.log('_(no playwright-results.json — run `npx playwright test e2e/route-sweep` first)_\n');
console.log(
  `| ${pad('route', 40)} | ${pad('category', 13)} | ${pad('data', 6)} | ${pad('render', 6)} | ${pad('spec', 4)} | verdict |`,
);
console.log(`|${'-'.repeat(42)}|${'-'.repeat(15)}|${'-'.repeat(8)}|${'-'.repeat(8)}|${'-'.repeat(6)}|---------|`);

const tally = {};
for (const row of rows) {
  const run = results?.get(row.pattern);
  const v = verdict(row, run, mockSet);
  tally[v] = (tally[v] ?? 0) + 1;
  console.log(
    `| ${pad(row.pattern, 40)} | ${pad(row.category, 13)} | ${pad(row.dataSource, 6)} | ${pad(run?.status ?? '-', 6)} | ${pad(row.hasExistingSpec ? 'yes' : 'NO', 4)} | ${v} |`,
  );
}

console.log('\n## Tally');
for (const [k, n] of Object.entries(tally).sort()) console.log(`- ${k}: ${n}`);
const blockers = (tally['FAIL'] ?? 0) + (tally['SHIP-RISK: mock'] ?? 0);
console.log(`\n${blockers === 0 ? '✅ no FAIL / SHIP-RISK routes' : `⚠ ${blockers} route(s) need work before production`}`);
