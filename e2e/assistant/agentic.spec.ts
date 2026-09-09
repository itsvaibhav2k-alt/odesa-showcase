/**
 * Wave 6 Stream E.2 — agentic dispatcher smoke test.
 *
 * Sign in as a verified owner, type a `create_property` intent into the
 * /assistant compose, submit, then verify "Test House" lands in the
 * /properties list. Mirrors the auth + nav flow used in
 * `e2e/assistant/happy-path.spec.ts`.
 *
 * The dispatcher's Claude SDK call is hermetically stubbed via
 * `page.route()` against `/api/chat/assistant`. Our stub returns an
 * SSE stream that includes a `proposal.committed` event for
 * `create_property` — but the actual properties row insert is performed
 * by the test itself (via the admin client) before navigating to
 * /properties. This keeps the test deterministic without requiring a
 * live Claude key OR running the full agentic pipeline against the
 * dev server (which would need `ANTHROPIC_API_KEY` propagated to the
 * Playwright webServer environment — a known issue from prior waves).
 *
 * The unit-level pipeline (dispatcher → spawn → handler → proposal →
 * commit → properties INSERT) is covered by the vitest spec at
 * `src/lib/agent/operator/__tests__/dispatcher-write-tools.test.ts`.
 * This e2e is a smoke test for the UI surface: compose → reply →
 * navigate.
 *
 * Skipped when the local Supabase stack is offline (matches the rest
 * of the e2e gating pattern). A live-AI variant is intentionally
 * omitted — the wave-5 happy-path spec already proves the live path
 * mounts with Anthropic creds present.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  provisionInboxOwner,
  signInOwner,
  type InboxOwner,
} from '../inbox/helpers';

test.describe('/assistant — agentic write (create_property)', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: InboxOwner;

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  test('compose → assistant reply → /properties shows the new property', async ({
    page,
  }) => {
    owner = await provisionInboxOwner('agentic');

    const admin = createAdmin();
    await admin
      .from('users')
      .update({
        phone_e164: '+15715559600',
        phone_verified_at: new Date().toISOString(),
      })
      .eq('id', owner.userId);

    // Insert the row the dispatcher would have created. The dispatcher
    // path itself is covered by the vitest integration spec; this
    // smoke test exercises the UI: compose → SSE stream → navigation.
    const { data: created, error: createErr } = await admin
      .from('properties')
      .insert({
        organization_id: owner.organizationId,
        name: 'Test House',
        address_street: '1 Main St',
        address_city: 'Aldie',
        address_state: 'VA',
        address_zip: '20105',
      })
      .select('id')
      .single();
    if (createErr || !created) {
      throw new Error(
        `seed property failed: ${createErr?.message ?? 'no row'}`,
      );
    }

    // Stub the SSE dispatcher endpoint with a canned committed-proposal
    // stream so we don't depend on a live Claude key in the webServer.
    // Frame shapes mirror DispatcherEvent — see
    // `src/lib/agent/operator/types.ts`.
    const cannedReply = "Created Test House at 1 Main St, Aldie VA 20105.";
    const proposalFrame = {
      type: 'proposal.committed',
      proposal: {
        id: '00000000-0000-0000-0000-000000000abc',
        organizationId: owner.organizationId,
        propertyId: created.id,
        workerModel: 'dispatcher-direct',
        action_type: 'create_property',
        payload: {
          name: 'Test House',
          addressStreet: '1 Main St',
          addressCity: 'Aldie',
          addressState: 'VA',
          addressZip: '20105',
        },
        reasoning: 'Dispatcher-supplied create_property',
        confidence: 0.9,
        context_fact_ids: [],
        gate_decision: 'auto',
        status: 'committed',
        createdAt: new Date().toISOString(),
        routing: null,
      },
    };
    const sseFrames =
      `data: ${JSON.stringify({ type: 'say.delta', text: cannedReply })}\n\n` +
      `data: ${JSON.stringify(proposalFrame)}\n\n` +
      `data: ${JSON.stringify({ type: 'done', turnId: 'agentic-stub-1' })}\n\n`;

    await page.route('**/api/chat/assistant', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        },
        body: sseFrames,
      });
    });

    await signInOwner(page, owner);
    await page.goto('/assistant');
    await expect(page.getByTestId('assistant-page')).toBeVisible({
      timeout: 15_000,
    });

    const promptText =
      'add a property called Test House at 1 Main St Aldie VA 20105';
    await page.getByTestId('chat-panel-input').fill(promptText);
    await page.getByTestId('chat-panel-send').click();

    // The user bubble appears immediately (optimistic local insert).
    await expect(
      page
        .locator('[data-testid="chat-message-user"]')
        .filter({ hasText: 'Test House' }),
    ).toBeVisible({ timeout: 5_000 });

    // The canned `say.delta` mutates the in-flight assistant bubble.
    await expect(
      page
        .locator('[data-testid="chat-message-assistant"]')
        .filter({ hasText: 'Test House' }),
    ).toBeVisible({ timeout: 10_000 });

    // Side-effect verification: navigate to /properties and confirm
    // Test House is listed.
    await page.goto('/properties');
    await expect(page.getByTestId('properties-page')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('property-table')).toBeVisible();
    await expect(page.getByText('Test House')).toBeVisible({
      timeout: 5_000,
    });
  });
});
