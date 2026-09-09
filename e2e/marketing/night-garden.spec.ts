import { expect, test } from '@playwright/test';

const routes = ['/', '/work', '/method', '/demo', '/owners', '/pilot'];

for (const route of routes) {
  test(`${route} renders without asset, console, overflow, or copy regressions`, async ({ page }) => {
    const errors: string[] = [];
    const failed: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
        failed.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto(route, { waitUntil: 'networkidle' });
    await expect(page.locator('.ng-site')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

    const dashedCopy = await page.evaluate(() => {
      const found: string[] = [];
      const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        if (!parent || ['SCRIPT', 'STYLE'].includes(parent.tagName)) continue;
        const value = walker.currentNode.textContent?.trim() ?? '';
        if (/[-–—]/.test(value)) found.push(value);
      }
      document.querySelectorAll('[alt], [title], [aria-label], [placeholder]').forEach((node) => {
        for (const attr of ['alt', 'title', 'aria-label', 'placeholder']) {
          const value = node.getAttribute(attr);
          if (value && /[-–—]/.test(value)) found.push(`${attr}: ${value}`);
        }
      });
      return found;
    });
    expect(dashedCopy).toEqual([]);
    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
  });
}

test.describe('mobile marketing routes', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const route of routes) {
    test(`${route} remains readable without horizontal overflow on mobile`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(route, { waitUntil: 'networkidle' });
      await expect(page.locator('.ng-site')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    });
  }
});

test('shared navigation reaches every marketing route and real sign in', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const expected = ['/work', '/method', '/demo', '/owners', '/pilot'];
  for (const href of expected) {
    expect(await page.locator(`.masthead a[href="${href}"]`).count()).toBeGreaterThanOrEqual(1);
  }
  await expect(page.locator('.masthead a[href="/login"]')).toHaveText('Sign in');
});

test('sample night reveals the call, reaches the owner boundary, and builds the briefing', async ({ page }) => {
  await page.goto('/demo', { waitUntil: 'networkidle' });
  const next = page.locator('#demo-next');
  await expect(next).toHaveText('Start sample night');
  await expect(page.locator('.demo-transcript__line:visible')).toHaveCount(0);
  for (let index = 1; index <= 4; index += 1) {
    await next.click();
    await expect(page.locator('.demo-transcript__line:visible')).toHaveCount(index);
  }
  await expect(page.locator('#demo-decision')).toBeVisible();
  await page.locator('[data-choice="context"]').click();
  await expect(page.locator('#demo-choice-result')).toContainText('Context reopened');
  await next.click();
  await expect(page.locator('#demo-brief')).toBeVisible();
  await expect(page.locator('#brief-choice')).toContainText('More context requested');
  await page.locator('#demo-reset').click();
  await expect(page.locator('.demo-transcript__line:visible')).toHaveCount(0);
});

test('pilot form submits to the real waitlist contract without a live write in QA', async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  let releaseResponse: (() => void) | undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route('**/api/waitlist', async (route) => {
    payload = route.request().postDataJSON() as Record<string, unknown>;
    await responseGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.goto('/pilot', { waitUntil: 'networkidle' });
  const form = page.locator('.access__form');
  const button = form.locator('button[type="submit"]');
  await expect(form).toHaveAttribute('action', '/api/waitlist');
  await expect(form).toHaveAttribute('method', 'post');
  await expect(page.locator('#f-email')).toHaveAttribute('required', '');
  await expect(page.locator('#f-units')).toHaveAttribute('type', 'number');
  await page.locator('#f-name').fill('Sample Owner');
  await page.locator('#f-email').fill('sample@example.com');
  await page.locator('#f-units').fill('24');
  await page.locator('#f-note').fill('Uses a spreadsheet today');
  const click = button.click();
  await expect(button).toBeDisabled();
  await expect(button).toHaveText('Requesting access…');
  await expect(form).toHaveAttribute('aria-busy', 'true');
  releaseResponse?.();
  await click;
  await expect(page.locator('.access__sent')).toBeVisible();
  await expect(page.locator('.access__sent')).toHaveAttribute('data-state', 'success');
  expect(payload).toMatchObject({
    email: 'sample@example.com',
    fullName: 'Sample Owner',
    unitCount: 24,
    currentStack: 'Uses a spreadsheet today',
    source: 'night-garden-pilot',
  });
});

test('pilot form handles duplicate and failed API responses without fake confirmation', async ({ page }) => {
  let attempt = 0;
  await page.route('**/api/waitlist', async (route) => {
    attempt += 1;
    await route.fulfill({
      status: attempt === 1 ? 500 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        attempt === 1
          ? { ok: false, error: 'provider detail that must not leak' }
          : { ok: true, id: null, duplicate: true },
      ),
    });
  });
  await page.goto('/pilot', { waitUntil: 'networkidle' });
  await page.locator('#f-email').fill('repeat@example.com');
  const form = page.locator('.access__form');
  const button = form.locator('button[type="submit"]');

  await button.click();
  const status = page.locator('.access__sent');
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute('data-state', 'error');
  await expect(status).toContainText('could not save your request');
  await expect(status).not.toContainText('provider detail');
  await expect(form).toBeVisible();
  await expect(button).toBeEnabled();

  await button.click();
  await expect(status).toHaveAttribute('data-state', 'success');
  await expect(status).toContainText('already on the pilot list');
  await expect(form).toBeHidden();
});

test('reduced motion makes opening and reveal transitions effectively immediate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'networkidle' });
  const durations = await page.locator('.motion-load, .motion-reveal').evaluateAll((nodes) =>
    nodes.map((node) => Number.parseFloat(getComputedStyle(node).transitionDuration))
  );
  expect(durations.length).toBeGreaterThan(0);
  expect(Math.max(...durations)).toBeLessThanOrEqual(0.001);
});
