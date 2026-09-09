/**
 * Tenant detail — `/tenants/[tenantId]` E2E (real Supabase data).
 *
 * Exercises the tenant brief at `/tenants/${MARCUS_TENANT_ID}` (Marcus
 * Alvarez, Unit 101 · Oakwood Commons). The page is a force-dynamic server
 * component whose content is derived from live rows via `getTenantDetail`:
 * tenant → active lease → unit/property (header + meta + related card),
 * the latest rent cycle (badge / metrics / attention / timeline), and the
 * newest conversation's messages (communication thread + timeline actors).
 *
 * Marcus is the flagship "current + paid" fixture: his current cycle is
 * fully paid, so the badge reads "Current", the attention brief is "all
 * clear", balance is $0 and days-late is 0. His seed has no conversations,
 * so the thread tests seed a minimal real conversation (one Odesa outbound,
 * one tenant inbound, one pending-review draft) to exercise the live thread
 * rendering, then tear it down.
 *
 * Asserts:
 *   - breadcrumb: Portfolio / Properties / Oakwood Commons / 101 / Marcus Alvarez
 *   - title block: "Marcus Alvarez" + "Current" badge
 *   - attention brief: "What matters with Marcus" + "all clear"
 *   - metrics strip (5 cells, incl. the "Standing" cell)
 *   - payment timeline derived from the paid cycle
 *   - communication thread (seeded) incl. the pending-review draft row
 *   - thread action controls (Message compose + derived Draft/Review links)
 *   - cross-links: "View property" → /properties/${OAKWOOD_PROPERTY_ID}
 *                  "View unit"     → /properties/${OAKWOOD_PROPERTY_ID}/units/${UNIT_101_ID}
 *   - ask chip hands off to /assistant with the chip text
 *   - lease · rules KV rows
 *   - no console errors during load
 *
 * Skipped when the local Supabase stack is unavailable.
 */

import { expect, test, type ConsoleMessage } from '@playwright/test';

import {
  HAVE_SUPABASE,
  GALAXY_ORG_ID,
  OAKWOOD_PROPERTY_ID,
  UNIT_101_ID,
  MARCUS_TENANT_ID,
  createAdmin,
  provisionGalaxyOwner,
  seedConversation,
  signIn,
  type SeededOwner,
} from './helpers';

/** Canonical route for the flagship tenant brief. */
const MARCUS_ROUTE = `/tenants/${MARCUS_TENANT_ID}`;

/** Real UUID-keyed cross-link targets rendered by propertyHref()/unitHref(). */
const OAKWOOD_ROUTE = `/properties/${OAKWOOD_PROPERTY_ID}`;
const UNIT_101_ROUTE = `/properties/${OAKWOOD_PROPERTY_ID}/units/${UNIT_101_ID}`;

/**
 * Benign Next.js / dev-overlay console noise that must not fail the
 * zero-console-errors assertion.
 */
function isBenignConsoleError(text: string): boolean {
  if (text.trim() === '') return true;
  return (
    text.includes('Download the React DevTools') ||
    text.includes('[Fast Refresh]')
  );
}

interface SeededThread {
  teardown: () => Promise<void>;
}

/**
 * Seeds a minimal real thread for Marcus so `fetchTenantThread` has live
 * rows to map: one outbound (renders as "Odesa"), one inbound (renders under
 * the tenant name), and one pending-review outbound draft (renders serif-
 * italic with a "Draft" timestamp). Caller MUST await teardown (try/finally).
 */
async function seedMarcusThread(): Promise<SeededThread> {
  const convo = await seedConversation(MARCUS_TENANT_ID, {
    summary: 'Rent timing — catch-up payment set for Friday.',
  });

  const admin = createAdmin();
  const base = Date.now();
  const iso = (offsetMs: number) => new Date(base + offsetMs).toISOString();

  const rows = [
    {
      organization_id: GALAXY_ORG_ID,
      conversation_id: convo.id,
      provider: 'linq' as const,
      direction: 'outbound' as const,
      draft_status: 'auto_sent' as const,
      body: 'Reminder: rent is past the grace period. Reply here if the timing is tight.',
      sent_at: iso(0),
      created_at: iso(0),
    },
    {
      organization_id: GALAXY_ORG_ID,
      conversation_id: convo.id,
      provider: 'linq' as const,
      direction: 'inbound' as const,
      draft_status: 'auto_sent' as const,
      body: 'Sorry, my paycheck landed late this month. Can I pay Friday?',
      sent_at: iso(1000),
      created_at: iso(1000),
    },
    {
      organization_id: GALAXY_ORG_ID,
      conversation_id: convo.id,
      provider: 'linq' as const,
      direction: 'outbound' as const,
      draft_status: 'pending_review' as const,
      body: 'Hi Marcus, a friendly reminder your catch-up payment is set for Friday. Thanks!',
      created_at: iso(2000),
    },
  ];

  const { error } = await admin.from('messages').insert(rows);
  if (error) {
    await convo.teardown();
    throw new Error(`Failed to seed Marcus messages: ${error.message}`);
  }

  const teardown = async () => {
    await admin.from('messages').delete().eq('conversation_id', convo.id);
    await convo.teardown();
  };

  return { teardown };
}

test.describe('tenant detail: Marcus Alvarez at /tenants/[tenantId]', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;

  test.beforeEach(async ({ page }) => {
    owner = await provisionGalaxyOwner();
    await signIn(page, { email: owner.email, password: owner.password });
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  // ---------------------------------------------------------------------------
  // Breadcrumb
  // ---------------------------------------------------------------------------

  test('breadcrumb renders … / Oakwood Commons / 101 / Marcus Alvarez', async ({
    page,
  }) => {
    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    // Scope to the breadcrumb <nav aria-label="Breadcrumb">; the sidebar also
    // renders a "Properties" link, so a page-wide query would be ambiguous.
    const nav = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(nav).toContainText('Oakwood Commons');
    await expect(nav).toContainText('101');
    await expect(nav).toContainText('Marcus Alvarez');

    // The final crumb is the current page (rendered as <span aria-current>).
    await expect(nav.getByText('Marcus Alvarez', { exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // "Properties" crumb links to /properties.
    await expect(nav.getByRole('link', { name: 'Properties' })).toHaveAttribute(
      'href',
      '/properties',
    );

    // "Oakwood Commons" crumb links to the real UUID-keyed property route.
    await expect(
      nav.getByRole('link', { name: 'Oakwood Commons' }),
    ).toHaveAttribute('href', OAKWOOD_ROUTE);

    // "101" crumb links to the real UUID-keyed unit route.
    await expect(nav.getByRole('link', { name: '101' })).toHaveAttribute(
      'href',
      UNIT_101_ROUTE,
    );
  });

  // ---------------------------------------------------------------------------
  // Title block
  // ---------------------------------------------------------------------------

  test('title block shows "Marcus Alvarez" and the "Current" badge', async ({
    page,
  }) => {
    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    await expect(
      page.getByRole('heading', { name: 'Marcus Alvarez' }),
    ).toBeVisible();

    // Paid + current cycle → "Current" badge (text-visible, never color-only).
    await expect(page.getByTestId('tenant-detail-page')).toContainText('Current');
  });

  // ---------------------------------------------------------------------------
  // Attention brief
  // ---------------------------------------------------------------------------

  test('attention section heading reads "What matters with Marcus"', async ({
    page,
  }) => {
    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    await expect(page.getByText('What matters with Marcus')).toBeVisible();
  });

  test('attention count renders "all clear" for a paid tenant', async ({
    page,
  }) => {
    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    // Rendered verbatim as the AttentionBrief count span.
    await expect(page.getByText('all clear', { exact: true })).toBeVisible();
  });

  test('attention brief surfaces the "All clear" standing row', async ({
    page,
  }) => {
    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    // Marcus is paid with no open items → the single derived "All clear" row.
    await expect(page.getByText('All clear', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Rent current · no open items · strong standing'),
    ).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Metrics strip
  // ---------------------------------------------------------------------------

  test('metrics strip renders 5 cells with correct labels', async ({ page }) => {
    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    // Real labels: the last cell is "Standing" (the mock's "History" is gone).
    const METRIC_LABELS = ['Balance', 'Days late', 'Rent', 'Lease end', 'Standing'];
    for (const label of METRIC_LABELS) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test('metrics strip shows the paid-tenant values', async ({ page }) => {
    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    // Rent is stable from the seed (rent_amount 1450 → "$1,450/mo").
    await expect(page.getByText('$1,450/mo').first()).toBeVisible();
    // Paid cycle → $0 balance, 0 days late.
    await expect(page.getByText('$0', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('0', { exact: true }).first()).toBeVisible();
    // Lease end is an evergreen relative date in the seed — assert the
    // rendered "Mon YYYY" shape rather than a drifting literal month.
    await expect(page.getByText(/^[A-Z][a-z]{2} \d{4}$/).first()).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Payment timeline
  // ---------------------------------------------------------------------------

  test('payment timeline section and panel render', async ({ page }) => {
    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    await expect(page.getByText('Payment timeline', { exact: true })).toBeVisible();
    await expect(page.locator('[data-detail-timeline]')).toBeVisible();
  });

  test('timeline renders the paid-cycle events in order', async ({ page }) => {
    // Derive the paid-cycle timeline LIVE. The seed's rent_events are
    // CURRENT_DATE-relative (evergreen), so a hardcoded month/amount drifts;
    // read Marcus's newest cycle exactly as getTenantDetail does
    // (fetchLatestRentCycle → cycle_month desc, limit 1) and rebuild the two
    // rent-cycle events buildTimeline emits: "Rent due", then (paid)
    // "Payment received".
    const admin = createAdmin();

    const { data: lease } = await admin
      .from('leases')
      .select('id')
      .eq('tenant_id', MARCUS_TENANT_ID)
      .eq('status', 'active')
      .order('start_date', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    expect(lease, 'Marcus should have an active lease').not.toBeNull();

    const { data: cycle } = await admin
      .from('rent_events')
      .select('amount_due, amount_paid')
      .eq('lease_id', lease!.id)
      .order('cycle_month', { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(cycle, 'Marcus should have a current rent cycle').not.toBeNull();

    const amountDue = Number(cycle!.amount_due ?? 0);
    const amountPaid = Number(cycle!.amount_paid ?? 0);
    const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

    // Flagship "current + paid" invariant: the newest cycle is fully paid, so
    // the derived timeline is exactly [Rent due, Payment received]. Asserting
    // it keeps the order check meaningful — an unpaid cycle would drop the
    // "Payment received" event and let a one-line timeline pass trivially.
    expect(amountPaid, 'Marcus latest cycle is fully paid').toBe(amountDue);
    expect(amountPaid).toBeGreaterThan(0);

    const EXPECTED = [
      `Rent due — ${dollars(amountDue)}.`,
      `Payment received — ${dollars(amountPaid)}.`,
    ];

    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    const timeline = page.locator('[data-detail-timeline]');
    await expect(timeline).toBeVisible();

    for (const line of EXPECTED) {
      await expect(timeline.getByText(line)).toBeVisible();
    }

    // Compare against the rent-cycle events specifically. Scoping to the cycle
    // lines keeps the count + order deterministic even if a sibling spec
    // transiently seeds a conversation for Marcus (which appends thread events
    // buildTimeline places after the cycle events).
    const eventTexts = await timeline.locator('[data-tl-event]').allTextContents();
    const cycleEvents = eventTexts.filter(
      (t) => t.includes('Rent due — ') || t.includes('Payment received — '),
    );
    expect(cycleEvents.length).toBe(EXPECTED.length);

    const combined = cycleEvents.join(' ');
    let lastIdx = -1;
    for (const line of EXPECTED) {
      const idx = combined.indexOf(line);
      expect(idx, `Expected "${line}" after the previous event`).toBeGreaterThan(
        lastIdx,
      );
      lastIdx = idx;
    }
  });

  // ---------------------------------------------------------------------------
  // Communication thread (seeded live data)
  // ---------------------------------------------------------------------------

  test('communication thread renders Odesa + tenant messages from live data', async ({
    page,
  }) => {
    const seed = await seedMarcusThread();
    try {
      await page.goto(MARCUS_ROUTE);
      await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

      await expect(page.getByText('Communication')).toBeVisible();

      const thread = page.locator('[data-message-thread]');
      await expect(thread).toBeVisible();

      // Outbound → "Odesa"; inbound → the tenant's full name.
      await expect(thread.getByText('Odesa').first()).toBeVisible();
      await expect(thread.getByText('Marcus Alvarez').first()).toBeVisible();

      // Both non-draft bodies render.
      await expect(
        thread.getByText(/Reminder: rent is past the grace period/),
      ).toBeVisible();
      await expect(thread.getByText(/paycheck landed late/)).toBeVisible();
    } finally {
      await seed.teardown();
    }
  });

  test('pending-review draft renders with a "Draft" timestamp', async ({
    page,
  }) => {
    const seed = await seedMarcusThread();
    try {
      await page.goto(MARCUS_ROUTE);
      await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

      const thread = page.locator('[data-message-thread]');

      // The pending_review outbound message renders its body...
      await expect(
        thread.getByText(/your catch-up payment is set for Friday/),
      ).toBeVisible();

      // ...and its timestamp reads "Draft" (drafts have no sent time).
      await expect(thread.getByText('Draft', { exact: true })).toBeVisible();
    } finally {
      await seed.teardown();
    }
  });

  // ---------------------------------------------------------------------------
  // Thread action controls
  // ---------------------------------------------------------------------------

  test('thread action controls render (Message compose + derived links)', async ({
    page,
  }) => {
    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    // The always-present compose trigger (opens the ComposeMessageModal).
    const compose = page.getByTestId('compose-modal-trigger');
    await expect(compose).toBeVisible();
    await expect(compose).toContainText('Message');

    // A paid (not late / not on-plan) cycle derives a "Draft message" primary
    // action plus a "Review ledger" link — both render as DetailButton links.
    await expect(page.getByRole('link', { name: 'Draft message' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review ledger' })).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Cross-links — "View property" and "View unit"
  // ---------------------------------------------------------------------------

  test('"View property" link navigates to the real property route', async ({
    page,
  }) => {
    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    // tenant-property-link is on the <span> wrapper; the <a> is nested inside.
    const viewPropertySpan = page.getByTestId('tenant-property-link');
    await expect(viewPropertySpan).toBeVisible();

    const viewPropertyAnchor = viewPropertySpan.locator('a').first();
    await expect(viewPropertyAnchor).toHaveAttribute('href', OAKWOOD_ROUTE);

    await viewPropertyAnchor.click();
    await page.waitForURL(new RegExp(`${OAKWOOD_ROUTE}$`), { timeout: 15_000 });
    await expect(page.getByTestId('property-detail-page')).toBeVisible();
  });

  test('"View unit" link navigates to the real unit route', async ({ page }) => {
    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    const viewUnitSpan = page.getByTestId('tenant-unit-link');
    await expect(viewUnitSpan).toBeVisible();

    const viewUnitAnchor = viewUnitSpan.locator('a').first();
    await expect(viewUnitAnchor).toHaveAttribute('href', UNIT_101_ROUTE);

    await viewUnitAnchor.click();
    await page.waitForURL(
      new RegExp(`${OAKWOOD_PROPERTY_ID}/units/${UNIT_101_ID}$`),
      { timeout: 15_000 },
    );
    await expect(page.getByTestId('unit-detail-page')).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Ask Odesa bar
  // ---------------------------------------------------------------------------

  test('clicking an ask chip hands off to /assistant with the chip text', async ({
    page,
  }) => {
    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    const firstChip = page.getByTestId('ask-bar-chip').first();
    const chipText = (await firstChip.textContent())?.trim() ?? '';
    expect(chipText.length).toBeGreaterThan(0);

    await firstChip.click();

    // The chip performs an explicit handoff to the global assistant, carrying
    // the (context-prefixed) chip text as the q param.
    await page.waitForURL(/\/assistant\?q=/, { timeout: 15_000 });
    const q = new URL(page.url()).searchParams.get('q') ?? '';
    expect(q).toContain(chipText);
  });

  test('ask input is visible and focusable', async ({ page }) => {
    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    const input = page.getByTestId('ask-odesa-bar-input');
    await expect(input).toBeVisible();
    await input.click();
    await input.fill('Test query');
    await expect(input).toHaveValue('Test query');
  });

  // ---------------------------------------------------------------------------
  // Lease & rules section
  // ---------------------------------------------------------------------------

  test('lease rules section renders with key rows', async ({ page }) => {
    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    // Section label + KvGrid keys render as standalone spans. Use exact match:
    // "Escalation" would otherwise also substring-match the Odesa note text.
    await expect(page.getByText('Lease · rules', { exact: true })).toBeVisible();
    await expect(page.getByText('Rent due', { exact: true })).toBeVisible();
    await expect(page.getByText('Grace period', { exact: true })).toBeVisible();
    await expect(page.getByText('Late fee', { exact: true })).toBeVisible();
    await expect(page.getByText('Escalation', { exact: true })).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // No console errors
  // ---------------------------------------------------------------------------

  test('no console errors during page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    await page.goto(MARCUS_ROUTE);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();
    // Let client islands settle so late errors are captured.
    await expect(page.getByTestId('ask-odesa-bar-input')).toBeVisible();

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
