import { chromium } from '@playwright/test';
import * as fs from 'node:fs/promises';

const outDir = 'design/financials-graph-reference-pack-2026-07-02/references';
await fs.mkdir(outDir, { recursive: true });

const refs = [
  {
    slug: 'stripe-revenue-recognition',
    url: 'https://stripe.com/revenue-recognition',
    name: 'Stripe Revenue Recognition',
    useFor: 'financial trust, calm product charts, enterprise-grade numbers with explanation copy',
  },
  {
    slug: 'ramp-expense-management',
    url: 'https://ramp.com/expense-management',
    name: 'Ramp Expense Management',
    useFor: 'spend controls and executive finance dashboard density',
  },
  {
    slug: 'mercury-treasury',
    url: 'https://mercury.com/treasury',
    name: 'Mercury Treasury',
    useFor: 'calm finance UI, balance/cash movement visual language, trust-first copy',
  },
  {
    slug: 'baselane-rent-collection',
    url: 'https://www.baselane.com/features/rent-collection/',
    name: 'Baselane Rent Collection',
    useFor: 'landlord-specific money vocabulary and rent collection affordances',
  },
  {
    slug: 'observable-plot-gallery',
    url: 'https://observablehq.com/plot/gallery',
    name: 'Observable Plot Gallery',
    useFor: 'legible chart composition, small multiples, axis/legend discipline',
  },
  {
    slug: 'recharts-examples',
    url: 'https://recharts.org/en-US/examples/ComposedChartWithAxisLabels',
    name: 'Recharts Composed Chart Example',
    useFor: 'practical React chart implementation patterns for bars + lines + axes',
  },
  {
    slug: 'data-to-viz',
    url: 'https://www.data-to-viz.com/',
    name: 'Data-to-Viz',
    useFor: 'chart selection principles; avoid wrong chart types and fake visual precision',
  },
  {
    slug: 'ft-visual-journalism',
    url: 'https://www.ft.com/visual-and-data-journalism',
    name: 'Financial Times Visual Journalism',
    useFor: 'editorial annotations, explain-the-change chart titles, restraint',
  },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const results = [];
for (const ref of refs) {
  try {
    const resp = await page.goto(ref.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3000);
    // Dismiss common cookie buttons if present.
    for (const name of ['Accept all', 'Accept', 'Agree', 'Got it', 'Allow all']) {
      await page.getByRole('button', { name: new RegExp(name, 'i') }).first().click({ timeout: 1000 }).catch(() => {});
    }
    await page.screenshot({ path: `${outDir}/${ref.slug}.png`, fullPage: false });
    const title = await page.title().catch(() => '');
    const text = ((await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')) || '').slice(0, 1200);
    results.push({ ...ref, status: resp?.status() ?? null, title, screenshot: `${outDir}/${ref.slug}.png`, text });
  } catch (error) {
    results.push({ ...ref, error: String(error) });
  }
}
await browser.close();
await fs.writeFile(`${outDir}/capture-results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(({ slug, status, error, screenshot }) => ({ slug, status, error, screenshot })), null, 2));
