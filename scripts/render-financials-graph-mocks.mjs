import { chromium } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const dir = path.resolve('design/financials-graph-reference-pack-2026-07-02/mocks');
const files = [
  'mock-01-collection-intelligence.html',
  'mock-02-cashflow-pnl.html',
  'mock-03-property-performance.html',
];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
for (const file of files) {
  const url = pathToFileURL(path.join(dir, file)).href;
  await page.goto(url, { waitUntil: 'load' });
  await page.screenshot({ path: path.join(dir, file.replace('.html', '.png')), fullPage: true });
}
await browser.close();
console.log((await fs.readdir(dir)).filter((f) => f.endsWith('.png')).sort().join('\n'));
