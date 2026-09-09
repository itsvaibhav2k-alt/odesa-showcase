// Shared helpers for the route-sweep tooling: discover app-router page
// routes from the filesystem and normalize a page file into its URL
// pattern (route groups stripped, dynamic segments preserved).
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.resolve('src/app');

/** Recursively collect every `page.tsx`/`page.ts` under src/app. */
export function walkPages(dir = APP_ROOT) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    // Skip Next.js private folders (_components), API route handlers, and slots.
    if (entry.startsWith('_') || entry.startsWith('@') || entry === 'api') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkPages(full));
    } else if (/^page\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Map an absolute page file to its route pattern, e.g. `/properties/[id]/units`. */
export function pageFileToPattern(absPath) {
  let rel = path.relative(APP_ROOT, absPath).replace(/\/?page\.tsx?$/, '');
  const segs = rel
    .split('/')
    .filter(Boolean)
    .filter((s) => !/^\(.*\)$/.test(s)); // drop route groups like (dashboard)
  return '/' + segs.join('/') || '/';
}

/** All route patterns the app currently exposes, sorted. */
export function appRoutePatterns() {
  return [...new Set(walkPages().map(pageFileToPattern))].sort();
}

export { APP_ROOT };
