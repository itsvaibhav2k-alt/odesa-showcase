// Fail if the route-sweep manifest has drifted from the app's actual
// routes. Derives every `src/app/**\/page.tsx` route pattern and diffs it
// against the `pattern:` values declared in e2e/route-sweep/manifest.ts.
//
// Usage: node scripts/check-route-manifest.mjs   (exit 1 on drift)
import { readFileSync } from 'node:fs';
import { appRoutePatterns } from './lib/routes.mjs';

const MANIFEST = 'e2e/route-sweep/manifest.ts';

const manifestSrc = readFileSync(MANIFEST, 'utf8');
const declared = new Set(
  [...manifestSrc.matchAll(/pattern:\s*'([^']+)'/g)].map((m) => m[1]),
);
const actual = new Set(appRoutePatterns());

const missing = [...actual].filter((p) => !declared.has(p)).sort();
const extra = [...declared].filter((p) => !actual.has(p)).sort();

console.log(`app routes: ${actual.size}  |  manifest entries: ${declared.size}`);

if (missing.length) {
  console.error(`\n❌ ${missing.length} app route(s) missing from the manifest:`);
  for (const p of missing) console.error(`   + ${p}`);
}
if (extra.length) {
  console.error(`\n❌ ${extra.length} manifest pattern(s) with no app route:`);
  for (const p of extra) console.error(`   - ${p}`);
}

if (missing.length || extra.length) {
  console.error('\nFix e2e/route-sweep/manifest.ts so it lists exactly the app routes.');
  process.exit(1);
}
console.log('✅ manifest is in sync with app routes');
