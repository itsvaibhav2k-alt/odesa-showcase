// Mock-data scanner. Reports two levels of dependency on the mock modules
// so we can tell a real production risk from harmless cleanup debt:
//
//   A) VALUE import / call of a mock module  -> SHIP RISK (renders mock data)
//   B) type-only import of a mock module     -> cleanup debt (shared types)
//
// Usage:
//   node scripts/scan-mock-data.mjs          (report, exit 0)
//   node scripts/scan-mock-data.mjs --strict (exit 1 if any PAGE has a value import)
import { readdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pageFileToPattern } from './lib/routes.mjs';

const SRC = path.resolve('src');
const STRICT = process.argv.includes('--strict');

// A mock module is risky when imported for its values. queue-adapter is
// special: only the demo helpers are a risk, not urgentItemToQueueItem.
const MOCK_MODULE = /mock-(portfolio|portfolio-views|detail|decisions)/;
const QUEUE_ADAPTER = /today\/queue-adapter/;
const QUEUE_DEMO = /getMockQueueItems|ROW_CONTEXT|getRowContextTable/;

const IMPORT_RE = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function isTypeOnly(clause) {
  const c = clause.trim();
  if (c.startsWith('type ')) return true;
  const braces = c.match(/\{([\s\S]*)\}/);
  if (braces) {
    const specs = braces[1].split(',').map((s) => s.trim()).filter(Boolean);
    return specs.length > 0 && specs.every((s) => s.startsWith('type '));
  }
  return false;
}

const valueHits = []; // { file, module }
const typeHits = [];

for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT_RE)) {
    const [, clause, mod] = m;
    let isMock = MOCK_MODULE.test(mod);
    if (!isMock && QUEUE_ADAPTER.test(mod) && QUEUE_DEMO.test(clause)) isMock = true;
    if (!isMock) continue;
    const rel = path.relative(process.cwd(), file);
    (isTypeOnly(clause) ? typeHits : valueHits).push({ file: rel, module: mod });
  }
}

const valuePages = valueHits.filter((h) => /\/page\.tsx?$/.test(h.file));

console.log('=== Mock-data scan ===\n');
console.log(`SHIP RISK — value imports (render mock data): ${valueHits.length}`);
for (const h of valueHits.sort((a, b) => a.file.localeCompare(b.file))) {
  const tag = /\/page\.tsx?$/.test(h.file) ? `  [route ${pageFileToPattern(path.resolve(h.file))}]` : '';
  console.log(`   ⚠ ${h.file}  ← ${h.module}${tag}`);
}
console.log(`\nCLEANUP DEBT — type-only imports: ${typeHits.length}`);
for (const h of typeHits.sort((a, b) => a.file.localeCompare(b.file))) {
  console.log(`   · ${h.file}  ← ${h.module}`);
}

console.log(`\nSummary: ${valuePages.length} page route(s) still render mock data, ${valueHits.length - valuePages.length} other value import(s), ${typeHits.length} type-only import(s).`);

if (STRICT && valuePages.length > 0) {
  console.error('\n❌ --strict: page routes still import mock values.');
  process.exit(1);
}
