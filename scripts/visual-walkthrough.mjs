import { chromium } from 'playwright';

const EMAIL = process.env.DEMO_EMAIL || 'wave2-demo@odesa.app';
const PASSWORD = process.env.DEMO_PASSWORD || 'wave2demo!2026';
const FULL_NAME = 'Wave 2 Demo';
const ORG_NAME = 'Wave 2 Demo Estates';

const VIEWPORT = { width: 1280, height: 900 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT });
const page = await ctx.newPage();

async function shot(name) {
  await page.waitForTimeout(700);
  const file = `/tmp/odesa-walk-${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`captured ${page.url()} -> ${file}`);
}

// Try signup first; fall back to login if user already exists.
await page.goto('http://localhost:3000/signup', { waitUntil: 'networkidle' });
await page.fill('[data-testid="signup-fullname"]', FULL_NAME);
await page.fill('[data-testid="signup-email"]', EMAIL);
await page.fill('[data-testid="signup-password"]', PASSWORD);
await page.fill('[data-testid="signup-organization"]', ORG_NAME);
await page.click('[data-testid="signup-submit"]');

// Wait for either success redirect or an error to appear.
try {
  await page.waitForURL((url) => !url.pathname.startsWith('/signup'), {
    timeout: 8000,
  });
  console.log(`signup ok, landed on ${page.url()}`);
} catch {
  const err = await page
    .locator('[data-testid="signup-error"]')
    .textContent()
    .catch(() => null);
  console.log(`signup did not redirect (error="${err}"), trying login`);
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 8000,
  });
  console.log(`login ok, landed on ${page.url()}`);
}

const startUrl = page.url();
await shot('00-after-auth');

// Walk through every authenticated page and screenshot it. If we land on
// /onboarding, the dashboard pages will redirect back to onboarding —
// that's fine, we just capture whatever each route renders.
const ROUTES = [
  '/onboarding/property',
  '/onboarding/unit',
  '/onboarding/tenant',
  '/onboarding/lease',
  '/onboarding/messaging',
  '/today',
  '/inbox',
  '/properties',
  '/settings',
  '/settings/integrations',
];

for (const r of ROUTES) {
  try {
    await page.goto(`http://localhost:3000${r}`, {
      waitUntil: 'networkidle',
      timeout: 12000,
    });
    const slug = r.replace(/\//g, '-').replace(/^-/, '');
    await shot(slug);
  } catch (e) {
    console.log(`failed ${r}: ${e.message}`);
  }
}

console.log(`\nDONE. Final URL: ${page.url()}`);
console.log(`Email: ${EMAIL}`);
console.log(`Password: ${PASSWORD}`);
await browser.close();
