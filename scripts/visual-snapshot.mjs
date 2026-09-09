import { chromium } from 'playwright';

const ROUTES = [
  { path: '/login', name: 'login' },
  { path: '/signup', name: 'signup' },
];

const VARIANT = process.env.VARIANT || 'after';
const VIEWPORT = { width: 1280, height: 900 };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();

for (const r of ROUTES) {
  await page.goto(`http://localhost:3000${r.path}`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(600);
  const file = `/tmp/odesa-${r.name}-${VARIANT}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`captured ${r.path} -> ${file}`);
}

await browser.close();
