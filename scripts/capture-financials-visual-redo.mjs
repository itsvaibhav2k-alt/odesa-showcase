import * as fs from 'node:fs';
import { chromium } from '@playwright/test';

if (fs.existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

const { provisionGalaxyOwner, signIn } = await import('../e2e/properties/helpers.ts');

const baseURL = process.env.BASE_URL || 'http://localhost:3100';
const outDir = 'design/financials-visual-redo-implemented-2026-07-05';
fs.mkdirSync(outDir, { recursive: true });

const SHOTS = [
  { name: 'redo-financials-viewport.png', testId: null },
  { name: 'redo-collection-trend.png', testId: 'collection-trend' },
  { name: 'redo-aging.png', testId: 'aging-row' },
  { name: 'redo-property-board.png', testId: 'property-performance-board' },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, baseURL });
let owner;
try {
  owner = await provisionGalaxyOwner();
  await signIn(page, { email: owner.email, password: owner.password });
  await page.goto('/financials', { waitUntil: 'networkidle' });
  await page.getByTestId('financial-command-center').waitFor({ state: 'visible', timeout: 30000 });

  const paths = [];
  for (const shot of SHOTS) {
    const path = `${outDir}/${shot.name}`;
    if (shot.testId === null) {
      await page.screenshot({ path, fullPage: false });
    } else {
      const card = page.getByTestId(shot.testId);
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path });
    }
    paths.push(path);
  }
  console.log(JSON.stringify({ ok: true, paths }, null, 2));
} finally {
  if (owner) await owner.teardown().catch(() => {});
  await browser.close();
}
