#!/usr/bin/env node
/**
 * assert-no-unexpected-playwright-skips — turn Playwright skips into a gate.
 *
 * Playwright's JSON report lists skipped tests as "not failed", so a CI
 * shard that skips everything still reports green. This script reads that
 * report and FAILS when a test skipped for a reason we did not explicitly
 * allow, or when a suite we require to run executed zero tests.
 *
 * Usage:
 *   node scripts/assert-no-unexpected-playwright-skips.mjs <report.json> \
 *     [--allow <regex> ...] [--require-executed <pattern>=<min> ...]
 *
 *   --allow <regex>            A skip whose recorded reason OR full title
 *                              matches any --allow regex is expected (e.g.
 *                              env-gated RUN_LIVE_AI opt-in tests). Repeatable.
 *   --require-executed <p>=<n> Fail unless at least <n> tests whose file/title
 *                              matches regex <p> actually executed (ran, not
 *                              skipped). Repeatable. Catches "collected nothing".
 *   --self-test                Run built-in fixtures proving both failure modes,
 *                              print a summary, exit 0/1. Wires nothing else.
 *
 * Exit 1 with a clear listing on any violation; exit 0 when clean.
 * Dependency-free (node: builtins only).
 */

import { readFileSync } from 'node:fs';

/**
 * Flatten a Playwright JSON report into a list of test entries.
 * Walks `report.suites` recursively — each suite carries `.specs[]`
 * (tests declared at that level) and `.suites[]` (nested describe blocks).
 *
 * @returns {{ file: string, title: string, project: string,
 *             skipped: boolean, executed: boolean, reason: string }[]}
 */
function collectTests(report) {
  const out = [];
  const walk = (suite, trail) => {
    const nextTrail = suite.title ? [...trail, suite.title] : trail;
    for (const spec of suite.specs ?? []) {
      const file = spec.file ?? suite.file ?? '';
      const title = [...nextTrail, spec.title].join(' › ');
      for (const t of spec.tests ?? []) {
        const skipped = t.status === 'skipped';
        const skipAnnotation = (t.annotations ?? []).find(
          (a) => a && a.type === 'skip',
        );
        out.push({
          file,
          title,
          project: t.projectName ?? '',
          skipped,
          executed: !skipped,
          reason: skipAnnotation?.description ?? '',
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, nextTrail);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return out;
}

/**
 * Evaluate the report against the allow / require-executed rules.
 *
 * @returns {{ tests: object[], violations: { kind: string, message: string }[] }}
 */
function analyze(report, { allow, requireExecuted }) {
  const tests = collectTests(report);
  const violations = [];

  for (const t of tests) {
    if (!t.skipped) continue;
    const allowed = allow.some(
      (re) => re.test(t.reason) || re.test(t.title),
    );
    if (allowed) continue;
    violations.push({
      kind: 'unexpected-skip',
      message: `SKIP not allowed: ${t.title}${
        t.reason ? `  (reason: ${t.reason})` : '  (no reason recorded)'
      }`,
    });
  }

  for (const { pattern, min } of requireExecuted) {
    const re = new RegExp(pattern);
    const count = tests.filter(
      (t) => t.executed && (re.test(t.title) || re.test(t.file)),
    ).length;
    if (count < min) {
      violations.push({
        kind: 'under-executed',
        message: `pattern /${pattern}/ executed ${count} test(s), need >= ${min}`,
      });
    }
  }

  return { tests, violations };
}

function parseArgs(argv) {
  const allow = [];
  const requireExecuted = [];
  let reportPath = null;
  let selfTest = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--self-test') {
      selfTest = true;
    } else if (a === '--allow') {
      allow.push(new RegExp(argv[++i]));
    } else if (a === '--require-executed') {
      const spec = argv[++i] ?? '';
      const eq = spec.lastIndexOf('=');
      if (eq < 0) {
        throw new Error(`--require-executed needs <pattern>=<min>, got: ${spec}`);
      }
      requireExecuted.push({
        pattern: spec.slice(0, eq),
        min: Number(spec.slice(eq + 1)),
      });
    } else if (!a.startsWith('--')) {
      reportPath = a;
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  return { allow, requireExecuted, reportPath, selfTest };
}

function runSelfTest() {
  const fixture = {
    suites: [
      {
        title: 'demo/sample.spec.ts',
        file: 'demo/sample.spec.ts',
        specs: [
          {
            title: 'runs live only',
            file: 'demo/sample.spec.ts',
            tests: [
              {
                status: 'skipped',
                projectName: 'chromium',
                annotations: [
                  { type: 'skip', description: 'Skipped: set RUN_LIVE_AI=1 to opt in' },
                ],
                results: [{ status: 'skipped' }],
              },
            ],
          },
          {
            title: 'accidentally skipped',
            file: 'demo/sample.spec.ts',
            tests: [
              {
                status: 'skipped',
                projectName: 'chromium',
                annotations: [{ type: 'skip', description: 'temporarily disabled' }],
                results: [{ status: 'skipped' }],
              },
            ],
          },
          {
            title: 'renders fine',
            file: 'demo/sample.spec.ts',
            tests: [
              {
                status: 'expected',
                projectName: 'chromium',
                annotations: [],
                results: [{ status: 'passed' }],
              },
            ],
          },
        ],
        suites: [],
      },
    ],
  };

  const assert = (cond, msg) => {
    if (!cond) throw new Error(`self-test FAILED: ${msg}`);
  };

  // Mode A — an un-allowlisted skip must be flagged; the allowed one must not.
  const a = analyze(fixture, { allow: [/RUN_LIVE_AI/], requireExecuted: [] });
  assert(
    a.violations.some(
      (v) => v.kind === 'unexpected-skip' && /accidentally skipped/.test(v.message),
    ),
    'expected the un-allowlisted skip to be reported',
  );
  assert(
    !a.violations.some((v) => /runs live only/.test(v.message)),
    'the RUN_LIVE_AI skip should have been allowed',
  );

  // Mode B — a required pattern that executed 0 tests must be flagged.
  const b = analyze(fixture, {
    allow: [/RUN_LIVE_AI/, /temporarily disabled/],
    requireExecuted: [{ pattern: 'does-not-exist', min: 1 }],
  });
  assert(
    b.violations.length === 1 && b.violations[0].kind === 'under-executed',
    `expected exactly one under-executed violation, got: ${JSON.stringify(b.violations)}`,
  );

  // Happy path — allow covers the stray skip, required pattern met → clean.
  const c = analyze(fixture, {
    allow: [/RUN_LIVE_AI/, /temporarily disabled/],
    requireExecuted: [{ pattern: 'renders fine', min: 1 }],
  });
  assert(
    c.violations.length === 0,
    `expected a clean run, got: ${JSON.stringify(c.violations)}`,
  );

  console.log(
    '✅ self-test passed: unexpected-skip and under-executed both caught; happy path clean',
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.selfTest) {
    runSelfTest();
    return;
  }

  if (!args.reportPath) {
    console.error(
      'usage: assert-no-unexpected-playwright-skips.mjs <report.json> ' +
        '[--allow <regex> ...] [--require-executed <pattern>=<min> ...]',
    );
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(readFileSync(args.reportPath, 'utf8'));
  } catch (err) {
    console.error(
      `cannot read Playwright JSON report at ${args.reportPath}: ${err.message}`,
    );
    process.exit(2);
  }

  const { tests, violations } = analyze(report, args);
  const skipped = tests.filter((t) => t.skipped).length;
  const executed = tests.length - skipped;
  console.log(
    `playwright skip-gate: ${tests.length} test(s) — ${executed} executed, ${skipped} skipped`,
  );

  if (violations.length) {
    console.error(`\n❌ ${violations.length} violation(s):`);
    for (const v of violations) console.error(`   - ${v.message}`);
    process.exit(1);
  }

  console.log('✅ no unexpected skips; required suites executed');
}

try {
  main();
} catch (err) {
  console.error(`skip-gate error: ${err.message}`);
  process.exit(1);
}
