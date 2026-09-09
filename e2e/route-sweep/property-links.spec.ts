/**
 * Link-integrity crawl over the /properties subtree.
 *
 * Loads every properties page + sub-page, collects every internal `<a href>`
 * (and flags `#`/empty placeholder links), then visits each unique target and
 * fails on any that 404 — i.e. a button or link that leads to a not-yet-created
 * page. Complements route-smoke (which proves the 39 known routes render) by
 * catching links OUT of the subtree that point at routes that don't exist.
 *
 * Run: `npx playwright test e2e/route-sweep/property-links`
 */

import { test, expect, type Page } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  OAKWOOD_PROPERTY_ID,
  UNIT_101_ID,
  type SeededOwner,
} from '../properties/helpers';

const STORAGE_STATE = 'test-results/route-sweep/property-links-storage.json';
const OAK = OAKWOOD_PROPERTY_ID;

const SUBTREE_PAGES = [
  '/properties',
  `/properties/${OAK}`,
  // The former tab sub-pages are now `?room=` drawers on the overview; crawl
  // each so links inside the drawers are still link-integrity checked.
  `/properties/${OAK}?room=units`,
  `/properties/${OAK}?room=appliances`,
  `/properties/${OAK}?room=maintenance`,
  `/properties/${OAK}?room=payments`,
  `/properties/${OAK}?room=rulebook`,
  `/properties/${OAK}?room=vendors`,
  `/properties/${OAK}/units/${UNIT_101_ID}`,
  `/properties/${OAK}/chat`,
];

function isInternal(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

async function collectLinks(page: Page, from: string) {
  const hrefs = await page.$$eval('a[href]', (as) =>
    as.map((a) => a.getAttribute('href') ?? ''),
  );
  const internal = new Set<string>();
  const placeholders: string[] = [];
  for (const h of hrefs) {
    if (h === '#' || h === '' || h === '#!') placeholders.push(`${from} → "${h}"`);
    else if (isInternal(h)) internal.add(h.split('#')[0].split('?')[0]);
  }
  return { internal, placeholders };
}

test.describe('property subtree: link integrity', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );
  test.describe.configure({ mode: 'default', timeout: 180_000 });
  test.use({ storageState: STORAGE_STATE });

  let owner: SeededOwner | undefined;

  test.beforeAll(async ({ browser }) => {
    if (!HAVE_SUPABASE) return;
    owner = await provisionGalaxyOwner();
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();
    await signIn(page, { email: owner.email, password: owner.password });
    await ctx.storageState({ path: STORAGE_STATE });
    await ctx.close();
  });

  test.afterAll(async () => {
    if (owner) await owner.teardown();
  });

  test('no links lead to a not-yet-created (404) page', async ({ page }) => {
    const targets = new Set<string>();
    const placeholders: string[] = [];

    // 1. Crawl the subtree, collect outgoing links.
    for (const p of SUBTREE_PAGES) {
      await page.goto(p, { waitUntil: 'domcontentloaded' });
      const { internal, placeholders: ph } = await collectLinks(page, p);
      internal.forEach((h) => targets.add(h));
      placeholders.push(...ph);
    }

    // 2. Visit each unique target; record any non-existent (>=400) ones.
    //    Skip /api and /embed (handled elsewhere / key-gated).
    const dead: string[] = [];
    for (const href of [...targets].sort()) {
      if (href.startsWith('/api') || href.startsWith('/embed')) continue;
      const resp = await page.goto(href, { waitUntil: 'domcontentloaded' });
      const status = resp?.status() ?? 0;
      const notFound = await page
        .getByText(/This page could not be found/i)
        .count();
      if (status >= 400 || notFound > 0) dead.push(`${href} → ${status}${notFound ? ' (not-found)' : ''}`);
    }

    console.log(`\n[property-links] crawled ${SUBTREE_PAGES.length} pages, ${targets.size} unique internal links.`);
    console.log(`[property-links] placeholder (#/empty) links: ${placeholders.length}`);
    placeholders.forEach((p) => console.log(`   · ${p}`));
    if (dead.length) {
      console.log(`[property-links] DEAD links (lead to a missing page):`);
      dead.forEach((d) => console.log(`   ✗ ${d}`));
    }

    expect(dead, 'links that lead to a not-yet-created page').toEqual([]);
  });
});
