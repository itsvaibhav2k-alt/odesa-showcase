import { chromium } from '@playwright/test';
import * as fs from 'node:fs/promises';

const outDir = 'design/financials-graph-reference-pack-2026-07-02/references';
await fs.mkdir(outDir, { recursive: true });

const refs = [
  { slug: 'baselane-online-rent-collection', url: 'https://www.baselane.com/features/online-rent-collection/', name: 'Baselane Online Rent Collection', useFor: 'landlord rent-collection workflow language and payment-state framing' },
  { slug: 'nivo-line', url: 'https://nivo.rocks/line/', name: 'Nivo Line Chart', useFor: 'interactive line chart anatomy, tooltip/axis/legend treatment' },
  { slug: 'nivo-bar', url: 'https://nivo.rocks/bar/', name: 'Nivo Bar Chart', useFor: 'bar chart proportions, grouped/stacked comparison patterns' },
  { slug: 'highcharts-combo', url: 'https://www.highcharts.com/demo/highcharts/combo', name: 'Highcharts Combination Chart', useFor: 'bars + line for billed/collected/rate in one readable chart' },
  { slug: 'chartjs-line-sample', url: 'https://www.chartjs.org/docs/latest/samples/line/line.html', name: 'Chart.js Line Sample', useFor: 'practical chart defaults and hover affordances' },
  { slug: 'visx-gallery', url: 'https://airbnb.io/visx/gallery', name: 'visx Gallery', useFor: 'React/SVG chart composition and small multiples' },
  { slug: 'observable-plot-home', url: 'https://observablehq.com/plot/', name: 'Observable Plot', useFor: 'clean grammar-of-graphics examples and annotation discipline' },
  { slug: 'plaid-transactions', url: 'https://plaid.com/products/transactions/', name: 'Plaid Transactions', useFor: 'finance data credibility, categorization, bank-connected status language' },
];

const existing = JSON.parse(await fs.readFile(`${outDir}/capture-results.json`, 'utf8').catch(() => '[]'));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const results = [];
for (const ref of refs) {
  try {
    const resp = await page.goto(ref.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3500);
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
await fs.writeFile(`${outDir}/capture-results.json`, JSON.stringify([...existing, ...results], null, 2));
console.log(JSON.stringify(results.map(({ slug, status, error, screenshot }) => ({ slug, status, error, screenshot })), null, 2));
