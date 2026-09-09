import * as fs from 'node:fs';
import { chromium } from '@playwright/test';

if (fs.existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

const { provisionGalaxyOwner, signIn } = await import('../e2e/properties/helpers.ts');

const baseURL = process.env.BASE_URL || 'http://localhost:3000';
const outDir = 'design/financials-graph-reference-pack-2026-07-02/current';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 }, baseURL });
let owner;
try {
  owner = await provisionGalaxyOwner();
  await signIn(page, { email: owner.email, password: owner.password });
  await page.goto('/financials', { waitUntil: 'networkidle' });
  await page.getByTestId('financial-command-center').waitFor({ state: 'visible', timeout: 30000 });
  await page.screenshot({ path: `${outDir}/current-financials-full.png`, fullPage: true });
  await page.screenshot({ path: `${outDir}/current-financials-viewport.png`, fullPage: false });
  const text = await page.locator('body').innerText();
  console.log(JSON.stringify({ ok: true, url: page.url(), full: `${outDir}/current-financials-full.png`, viewport: `${outDir}/current-financials-viewport.png`, text: text.slice(0, 2000) }, null, 2));
} finally {
  if (owner) await owner.teardown().catch(() => {});
  await browser.close();
}
