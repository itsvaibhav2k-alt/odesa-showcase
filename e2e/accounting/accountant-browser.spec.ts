import { promises as fs } from 'node:fs';
import path from 'node:path';

import { expect, test, type BrowserContext, type Download, type Page } from '@playwright/test';

import {
  ACCOUNTANT_ARCHIVED_PROPERTY_ID,
  ACCOUNTANT_QA_EMAIL,
  ACCOUNTANT_QA_MEMBERSHIP_ID,
  ACCOUNTANT_QA_PASSWORD,
  DOCUMENT_ARCHIVED,
  DOCUMENT_LEASE,
  PAYMENT_UNMATCHED,
  provisionAccountantBrowserFixture,
  type AccountantBrowserFixture,
} from './accountant-fixture';
import {
  OAKWOOD_PROPERTY_ID,
  SEVENTEENTH_PROPERTY_ID,
} from '../fixtures/manifest';

const EVIDENCE_DIR = path.join(
  process.cwd(),
  'qa-output/2026-08-05-accountant-finish-loop',
);

interface ErrorGuard {
  errors: string[];
  externalRequests: string[];
}

async function installErrorGuard(context: BrowserContext): Promise<ErrorGuard> {
  const guard: ErrorGuard = { errors: [], externalRequests: [] };
  context.on('page', (page) => {
    page.on('pageerror', (error) => guard.errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') guard.errors.push(`console: ${message.text()}`);
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? '';
      const hostname = new URL(request.url()).hostname;
      if (
        failure === 'net::ERR_ABORTED' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(hostname)
      ) {
        return;
      }
      guard.errors.push(
        `requestfailed: ${request.method()} ${request.url()} ${failure}`,
      );
    });
  });
  await context.route('**/*', async (route) => {
    const raw = route.request().url();
    if (raw.startsWith('data:') || raw.startsWith('blob:')) {
      await route.continue();
      return;
    }
    const url = new URL(raw);
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      await route.continue();
      return;
    }
    guard.externalRequests.push(raw);
    await route.abort('blockedbyclient');
  });
  return guard;
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(ACCOUNTANT_QA_EMAIL);
  await page.getByTestId('login-password').fill(ACCOUNTANT_QA_PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/today(?:\?|$)/);
  await expect(page.getByTestId('accountant-page')).toBeVisible();
}

async function fontsReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const offenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => {
        if (element.closest('.accounting-route-table-wrap')) return false;
        const rect = element.getBoundingClientRect();
        return rect.right > window.innerWidth + 1 || rect.left < -1;
      })
      .slice(0, 10)
      .map((element) => ({
        tag: element.tagName,
        testid: element.dataset.testid ?? '',
        className: element.className,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
      }));
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      offenders,
    };
  });
  expect(result, JSON.stringify(result.offenders)).toMatchObject({
    documentWidth: expect.any(Number),
    viewportWidth: expect.any(Number),
    offenders: [],
  });
  expect(result.documentWidth).toBeLessThanOrEqual(result.viewportWidth + 1);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fontsReady(page);
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, name),
    fullPage: true,
  });
}

async function readDownload(download: Download): Promise<string> {
  expect(await download.failure()).toBeNull();
  const file = await download.path();
  if (!file) throw new Error('download path unavailable');
  return fs.readFile(file, 'utf8');
}

function assertSafeCsv(csv: string, exactHeader: string): void {
  expect(csv.split(/\r?\n/, 1)[0]).toBe(exactHeader);
  for (const forbidden of [
    '17th Street Row',
    'Excluded property private evidence',
    'pi_fictional',
    'cus_private',
    'private/browser',
    '@tenant.invalid',
    '+120255',
    'stripe_',
    'receipt_url',
    'file_key',
    'organization_id',
  ]) {
    expect(csv).not.toContain(forbidden);
  }
}

async function clickDownload(page: Page, label: RegExp): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: label }).click(),
  ]);
  return readDownload(download);
}

test.describe.serial('seeded Accountant production browser matrix', () => {
  let fixture: AccountantBrowserFixture;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    await fs.mkdir(EVIDENCE_DIR, { recursive: true });
    fixture = await provisionAccountantBrowserFixture();
    console.log(`ACCOUNTANT_BROWSER_BEFORE ${JSON.stringify(fixture.before)}`);
    console.log(`ACCOUNTANT_BROWSER_SEEDED ${JSON.stringify(fixture.seeded)}`);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    if (!fixture) return;
    const proof = await fixture.cleanup();
    console.log(`ACCOUNTANT_BROWSER_AFTER ${JSON.stringify(proof.after)}`);
    expect(proof.after).toEqual(proof.before);
  });

  test('desktop and mobile rendered/interacted/security proof is clean', async ({ browser }) => {
    test.setTimeout(240_000);
    const desktop = await browser.newContext({
      baseURL: 'http://127.0.0.1:3300',
      viewport: { width: 1440, height: 900 },
      acceptDownloads: true,
    });
    const desktopGuard = await installErrorGuard(desktop);
    const page = await desktop.newPage();
    await login(page);

    await expect(page.getByTestId('user-role-label')).toHaveText('Accountant');
    for (const id of ['reconciliation', 'rent', 'financials', 'documents']) {
      await expect(page.getByTestId(`sidebar-link-${id}`)).toBeVisible();
    }
    for (const id of ['inbox', 'calls', 'properties', 'tenants', 'vendors', 'settings']) {
      await expect(page.getByTestId(`sidebar-link-${id}`)).toHaveCount(0);
    }
    await expect(page.getByTestId('notifications')).toHaveCount(0);

    const unknownPropertyPage = await desktop.request.get(
      '/documents?property=00000000-0000-4000-8000-000000000000',
      { maxRedirects: 0 },
    );
    const unknownPropertyBody = await unknownPropertyPage.text();
    expect([200, 404]).toContain(unknownPropertyPage.status());
    expect(unknownPropertyBody).toContain('This page could not be found');
    expect(unknownPropertyBody).toContain('noindex');
    for (const absent of [
      'Executed Oakwood lease evidence',
      'Archived property accounting packet',
      'Withheld owner-only insurance file',
      'Excluded property accounting file',
      '17th Street Row',
    ]) {
      expect(unknownPropertyBody).not.toContain(absent);
    }
    console.log(
      `ACCOUNTANT_UNKNOWN_PROPERTY_DENIAL ${JSON.stringify({
        httpStatus: unknownPropertyPage.status(),
        semanticNotFound: true,
        noindex: true,
      })}`,
    );

    await page.goto('/today?cycle=2026-08');
    await expect(page.getByTestId('accounting-workspace')).toBeVisible();
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.body)
          .getPropertyValue('--font-plus-jakarta')
          .trim(),
      ),
    ).not.toBe('');
    await expect(page.getByTestId('accounting-dossier')).toHaveCount(0);
    const unselectedWidths = await page.evaluate(() => {
      const layout = document.querySelector<HTMLElement>('.accounting-register-layout');
      const register = document.querySelector<HTMLElement>('.accounting-register');
      return {
        layout: layout?.getBoundingClientRect().width ?? 0,
        register: register?.getBoundingClientRect().width ?? 0,
      };
    });
    expect(unselectedWidths.register / unselectedWidths.layout).toBeGreaterThan(0.95);
    await expect(page.getByText('Expense imports are not connected', { exact: false }).first()).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: /Rent cycle is missing — Galaxy Archive Ledger/,
      }),
    ).toBeVisible();
    await screenshot(page, 'desktop-today-register.png');

    const issueRow = page.getByRole('button', { name: /Payment needs a rent-cycle match/ }).first();
    await issueRow.click();
    await expect(page.getByTestId('accounting-dossier')).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.has('selected')).toBe(true);
    const selectedTodayUrl = page.url();
    await screenshot(page, 'desktop-today-dossier.png');
    await page.reload();
    await expect(page).toHaveURL(selectedTodayUrl);
    await expect(page.getByTestId('accounting-dossier')).toBeVisible();
    await page.getByRole('button', { name: 'Documents', exact: true }).click();
    await expect(page.getByTestId('accounting-dossier')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.has('selected')).toBe(false);
    await page.goBack();
    await expect(page.getByTestId('accounting-dossier')).toBeVisible();
    await page.goForward();
    await expect(page.getByTestId('accounting-dossier')).toHaveCount(0);

    await page.goto(
      `/today?cycle=2026-08&property=${ACCOUNTANT_ARCHIVED_PROPERTY_ID}`,
    );
    const filteredPosition = page.getByRole('region', {
      name: 'Close position',
    });
    await expect(filteredPosition.getByText('Evidence gaps remain')).toBeVisible();
    await expect(filteredPosition.locator('dt', { hasText: 'Scoped' }).locator('xpath=following-sibling::dd')).toHaveText('1');
    await expect(filteredPosition.locator('dt', { hasText: 'Net due' }).locator('xpath=following-sibling::dd')).toHaveText('$2,600.00');
    await expect(filteredPosition.locator('dt', { hasText: 'Ledger collected' }).locator('xpath=following-sibling::dd')).toHaveText('$800.00');
    await expect(filteredPosition.locator('dt', { hasText: 'Open' }).locator('xpath=following-sibling::dd')).toHaveText('$1,800.00');
    await screenshot(page, 'desktop-today-property-filtered.png');

    await page.goto('/today?cycle=2026-07&issue=matching');
    await page
      .getByRole('button', { name: /Payment needs a rent-cycle match/ })
      .first()
      .click();
    const historicalHandoff = page.getByRole('link', {
      name: 'Open Financials →',
    });
    await expect(historicalHandoff).toHaveAttribute(
      'href',
      new RegExp(`^/financials\\?period=last&.*payment=`),
    );
    await historicalHandoff.click();
    await expect(page).toHaveURL(/\/financials\?period=last&/);
    await expect(page.getByLabel('Payment evidence dossier')).toBeVisible();

    await page.goto('/today?cycle=2026-08&issue=matching');
    const reconciliationCsv = await clickDownload(page, /Export filtered register/);
    assertSafeCsv(
      reconciliationCsv,
      'Discrepancy,Priority,Finding,Property,Archived property,Unit,Amount under review,Canonical payment time',
    );
    expect(reconciliationCsv).toContain('Payment matching');

    await page.goto('/rent?cycle=2026-08&state=outstanding');
    await expect(page.getByTestId('accountant-rent-ledger')).toBeVisible();
    const archivedOutstandingRow = page.locator(
      `#accountant-rent-row-${encodeURIComponent('acca1400-0000-4000-8000-000000000001')}`,
    );
    await expect(archivedOutstandingRow).toBeVisible();
    await archivedOutstandingRow.click();
    await expect(page.getByLabel('Rent evidence dossier')).toBeVisible();
    await screenshot(page, 'desktop-rent-outstanding-dossier.png');
    const selectedRentUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(selectedRentUrl);
    await page.getByRole('link', { name: 'Settled', exact: true }).click();
    await expect(page.getByLabel('Rent evidence dossier')).toHaveCount(0);
    await page.goBack();
    await expect(page.getByLabel('Rent evidence dossier')).toBeVisible();
    await page.goForward();
    await expect(page.getByLabel('Rent evidence dossier')).toHaveCount(0);
    await page.goto('/rent?cycle=2026-08&state=outstanding');
    const rentCsv = await clickDownload(page, /Export filtered rent rows/);
    assertSafeCsv(
      rentCsv,
      'Property,Archived property,Unit,Due date,Current obligation,Collected in ledger,Open balance,Waived amount,Evidence state',
    );
    expect(rentCsv).toContain('Galaxy Archive Ledger');
    expect(rentCsv).not.toContain('Oakwood Commons');

    await page.goto('/financials?period=mtd&state=unmatched');
    await expect(page.getByTestId('accountant-financials')).toBeVisible();
    await page.locator(`#accountant-payment-row-${PAYMENT_UNMATCHED}`).click();
    await expect(page.getByLabel('Payment evidence dossier')).toBeVisible();
    await expect(page.getByText('Canonical payment time', { exact: false }).first()).toBeVisible();
    await screenshot(page, 'desktop-financials-unmatched-dossier.png');
    const paymentCsv = await clickDownload(page, /Export filtered payment rows/);
    assertSafeCsv(
      paymentCsv,
      'Property,Archived property,Unit,Amount,Currency,Status,Payment time,Period inclusion,Evidence state,Matched to rent event,Receipt present',
    );
    expect(paymentCsv.split('\n')[1]).toContain(',Unmatched,false,false');
    await page.getByRole('link', { name: 'Quarter to date' }).click();
    await expect.poll(() => new URL(page.url()).searchParams.has('payment')).toBe(false);
    await page.goBack();
    await expect(page.getByLabel('Payment evidence dossier')).toBeVisible();
    await page.goForward();
    await expect(page.getByLabel('Payment evidence dossier')).toHaveCount(0);

    await page.goto('/documents?type=lease&q=Oakwood');
    await expect(page.getByTestId('accountant-documents')).toBeVisible();
    await expect(page.getByText('Withheld owner-only insurance file')).toHaveCount(0);
    await page.locator(`#accountant-document-row-${DOCUMENT_LEASE}`).click();
    await expect(page.getByLabel('Document evidence dossier')).toBeVisible();
    await screenshot(page, 'desktop-documents-lease-dossier.png');
    const documentCsv = await clickDownload(page, /Export filtered document rows/);
    assertSafeCsv(
      documentCsv,
      'Document,Property,Archived property,Unit,Evidence class,Type,Expires,Indexed',
    );
    expect(documentCsv).toContain('Executed Oakwood lease evidence');
    await page.getByLabel('Document evidence dossier').getByRole('link', { name: 'Close dossier' }).click();
    await expect(page.getByLabel('Document evidence dossier')).toHaveCount(0);
    await expect(page.locator(`#accountant-document-row-${DOCUMENT_LEASE}`)).toBeFocused();

    const unknownExport = await desktop.request.get(
      `/api/accounting/export?kind=rent-ledger&cycle=2026-08&property=${SEVENTEENTH_PROPERTY_ID}&state=all&q=`,
    );
    expect(unknownExport.status()).toBe(200);
    expect(unknownExport.headers()['x-accounting-row-count']).toBe('0');
    assertSafeCsv(
      await unknownExport.text(),
      'Property,Archived property,Unit,Due date,Current obligation,Collected in ledger,Open balance,Waived amount,Evidence state',
    );

    for (const route of [
      '/inbox',
      '/calls',
      '/calls/settings',
      `/properties/${OAKWOOD_PROPERTY_ID}`,
      '/tenants',
      '/vendors',
      '/work-orders/77777777-7777-7777-7777-777777777701',
      '/owner-queue',
      '/review/message/dddddddd-dddd-dddd-dddd-dddddddddd01',
      '/settings',
      '/assistant',
      '/onboarding',
    ]) {
      const response = await desktop.request.get(route);
      expect(response.status(), route).toBe(404);
    }
    const outOfScopePage = await desktop.request.get(
      `/rent?cycle=2026-08&property=${SEVENTEENTH_PROPERTY_ID}`,
    );
    expect(outOfScopePage.status()).toBe(404);
    for (const api of [
      '/api/retell/test-call',
      '/api/chat/inbox',
      '/api/action-proposals/dddddddd-dddd-dddd-dddd-dddddddddd01/commit',
      '/api/import/commit',
    ]) {
      const response = await desktop.request.post(api, { data: {} });
      expect(response.status(), api).toBe(403);
      expect(await response.json()).toEqual({ error: 'Forbidden' });
    }
    await assertNoHorizontalOverflow(page);
    expect(desktopGuard.externalRequests).toEqual([]);
    expect(desktopGuard.errors).toEqual([]);
    await desktop.close();

    const mobile = await browser.newContext({
      baseURL: 'http://127.0.0.1:3300',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      acceptDownloads: true,
    });
    const mobileGuard = await installErrorGuard(mobile);
    const mobilePage = await mobile.newPage();
    await login(mobilePage);
    await mobilePage.getByTestId('mobile-menu-toggle').click();
    const navigation = mobilePage.getByRole('dialog', { name: 'Navigation' });
    await expect(navigation).toBeVisible();
    await expect
      .poll(async () => Math.round((await navigation.boundingBox())?.x ?? -999))
      .toBe(0);
    for (const label of ['Reconciliation', 'Rent', 'Financials', 'Documents']) {
      await expect(navigation.getByRole('link', { name: new RegExp(label) })).toBeVisible();
    }
    await screenshot(mobilePage, 'mobile-navigation.png');
    await navigation.getByRole('link', { name: /Reconciliation/ }).click();
    await expect(navigation).toHaveCount(0);

    await mobilePage.goto('/today?cycle=2026-08');
    const mobileIssue = mobilePage.getByRole('button', { name: /Payment needs a rent-cycle match/ }).first();
    await mobileIssue.click();
    const todayDialog = mobilePage.getByRole('dialog', { name: /Payment needs a rent-cycle match/ });
    await expect(todayDialog).toBeVisible();
    const todayClose = todayDialog.getByRole('button', { name: 'Close evidence dossier' });
    await expect(todayClose).toBeFocused();
    expect(await mobilePage.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await todayClose.press('Shift+Tab');
    expect(await todayDialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    await screenshot(mobilePage, 'mobile-today-dossier.png');
    await mobilePage.keyboard.press('Escape');
    await expect(todayDialog).toHaveCount(0);
    expect(await mobilePage.evaluate(() => document.body.style.overflow)).toBe('');
    await expect(mobileIssue).toBeFocused();

    await mobilePage.goto('/rent?cycle=2026-08&state=outstanding');
    await mobilePage.locator('#accountant-rent-row-acca1400-0000-4000-8000-000000000001').click();
    const rentDialog = mobilePage.getByRole('dialog', { name: 'Rent evidence dossier' });
    await expect(rentDialog.getByRole('link', { name: 'Close dossier' })).toBeFocused();
    await screenshot(mobilePage, 'mobile-rent-dossier.png');
    await mobilePage.keyboard.press('Escape');
    await expect(rentDialog).toHaveCount(0);

    await mobilePage.goto('/financials?period=mtd&state=timestamp_missing');
    await expect(mobilePage.getByText('Payment time unavailable', { exact: false }).first()).toBeVisible();
    await assertNoHorizontalOverflow(mobilePage);
    await screenshot(mobilePage, 'mobile-financials-timestamp-missing.png');

    await mobilePage.goto(`/documents?property=${ACCOUNTANT_ARCHIVED_PROPERTY_ID}&type=property`);
    const archivedDocumentRow = mobilePage.locator(
      `#accountant-document-row-${DOCUMENT_ARCHIVED}`,
    );
    await expect(archivedDocumentRow).toBeVisible();
    await archivedDocumentRow.click();
    const documentDialog = mobilePage.getByRole('dialog', { name: 'Document evidence dossier' });
    await expect(documentDialog).toBeVisible();
    await screenshot(mobilePage, 'mobile-documents-archived-dossier.png');
    await mobilePage.keyboard.press('Escape');
    await expect(documentDialog).toHaveCount(0);

    expect(mobileGuard.externalRequests).toEqual([]);
    expect(mobileGuard.errors).toEqual([]);
    await mobile.close();

    const dashboardDeny = await fixture.admin
      .from('membership_capability_overrides')
      .insert({
        membership_id: ACCOUNTANT_QA_MEMBERSHIP_ID,
        capability: 'view_dashboard',
        effect: 'deny',
      });
    expect(dashboardDeny.error).toBeNull();
    const narrowed = await browser.newContext({
      baseURL: 'http://127.0.0.1:3300',
      viewport: { width: 1024, height: 768 },
    });
    const narrowedGuard = await installErrorGuard(narrowed);
    try {
      const narrowedPage = await narrowed.newPage();
      await narrowedPage.goto('/login');
      await narrowedPage.getByTestId('login-email').fill(ACCOUNTANT_QA_EMAIL);
      await narrowedPage
        .getByTestId('login-password')
        .fill(ACCOUNTANT_QA_PASSWORD);
      await narrowedPage.getByTestId('login-submit').click();
      await narrowedPage.waitForURL(/\/rent(?:\?|$)/);
      await expect(
        narrowedPage.getByTestId('accountant-rent-ledger'),
      ).toBeVisible();
      expect(narrowedGuard.externalRequests).toEqual([]);
      expect(narrowedGuard.errors).toEqual([]);
    } finally {
      await narrowed.close();
      const removed = await fixture.admin
        .from('membership_capability_overrides')
        .delete()
        .eq('membership_id', ACCOUNTANT_QA_MEMBERSHIP_ID)
        .eq('capability', 'view_dashboard');
      expect(removed.error).toBeNull();
    }
  });
});
