import * as fs from 'node:fs';
import { chromium } from '@playwright/test';

if (fs.existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

const { provisionGalaxyOwner, signIn } = await import('../e2e/properties/helpers.ts');

const baseURL = process.env.BASE_URL || 'http://localhost:3100';
const outDir = 'design/financials-wow-2026-07-05';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, baseURL });
let owner;
try {
  owner = await provisionGalaxyOwner();
  await signIn(page, { email: owner.email, password: owner.password });
  await page.goto('/financials', { waitUntil: 'networkidle' });
  await page.getByTestId('financial-command-center').waitFor({ state: 'visible', timeout: 30000 });

  const paths = [];
  const shoot = async (name, locator) => {
    const path = `${outDir}/${name}`;
    if (locator === null) {
      await page.screenshot({ path, fullPage: false });
    } else if (locator === 'full') {
      await page.screenshot({ path, fullPage: true });
    } else {
      const el = page.getByTestId(locator);
      await el.scrollIntoViewIfNeeded();
      await el.screenshot({ path });
    }
    paths.push(path);
  };

  await shoot('wow-full-page.png', 'full');
  await shoot('wow-top-viewport.png', null);
  await shoot('wow-flagship-pace.png', 'collection-pace');
  await shoot('wow-property-graph.png', 'property-performance-board');
  await shoot('wow-bottom-coverage.png', 'spend-pressure-panel');
  console.log(JSON.stringify({ ok: true, paths }, null, 2));
} finally {
  if (owner) await owner.teardown().catch(() => {});
  await browser.close();
}
