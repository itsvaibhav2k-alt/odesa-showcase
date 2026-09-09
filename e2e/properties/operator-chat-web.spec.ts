/**
 * Operator chat web UI — Phase 3.
 *
 * Tests the client-side surface end-to-end: page renders, input submits,
 * SSE event reducer mutates state correctly, ProposedActionCard
 * renders + commits via the server action.
 *
 * The Claude Agent SDK that powers the dispatcher cannot be cheaply
 * intercepted from a Playwright spec (it's wired directly into the
 * dispatcher, not behind the existing hosted-haiku mock harness). To
 * keep the spec fast and deterministic, we stub the SSE endpoint
 * itself via `page.route` and replay a scripted stream of
 * DispatcherEvent frames.
 *
 * The spec verifies the UI contract; dispatcher event production is
 * covered by `src/lib/agent/operator/__tests__/dispatcher.test.ts`.
 */

import { expect, test, type Route } from '@playwright/test';

import {
  HAVE_SUPABASE,
  OAKWOOD_PROPERTY_ID,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';

const SSE_ROUTE_GLOB = `**/api/chat/property/${OAKWOOD_PROPERTY_ID}`;

interface SseFrame {
  data: Record<string, unknown>;
}

function encodeSseFrames(frames: SseFrame[]): string {
  return frames.map((f) => `data: ${JSON.stringify(f.data)}\n\n`).join('');
}

async function fulfillSseRoute(route: Route, frames: SseFrame[]) {
  await route.fulfill({
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
    body: encodeSseFrames(frames),
  });
}

test.describe('properties: operator chat (web)', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;

  test.beforeEach(async () => {
    owner = await provisionGalaxyOwner();
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  test('renders the chat page with header + back link', async ({ page }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}/chat`);

    await expect(page.getByTestId('property-chat-page')).toBeVisible();
    await expect(page.getByTestId('property-chat-heading')).toContainText(
      /attention at/i,
    );
    await expect(page.getByTestId('property-chat-back')).toBeVisible();
    await expect(page.getByTestId('chat-panel')).toBeVisible();
    await expect(page.getByTestId('chat-panel-empty')).toBeVisible();
  });

  test('property detail page links to chat', async ({ page }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}`);

    const chatLink = page.getByTestId('property-detail-chat-link');
    await expect(chatLink).toBeVisible();
    await chatLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/properties/${OAKWOOD_PROPERTY_ID}/chat`),
    );
  });

  test('streams say.delta events into the assistant bubble', async ({
    page,
  }) => {
    await signIn(page, { email: owner.email, password: owner.password });

    await page.route(SSE_ROUTE_GLOB, async (route) => {
      await fulfillSseRoute(route, [
        { data: { type: 'say.delta', text: 'Looking at ' } },
        { data: { type: 'say.delta', text: 'pending decisions' } },
        { data: { type: 'say.delta', text: ' for you.' } },
        { data: { type: 'done', turnId: 'test-turn-1' } },
      ]);
    });

    await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}/chat`);
    await page.getByTestId('chat-panel-input').fill("what's pending here?");
    await page.getByTestId('chat-panel-send').click();

    // User bubble appears immediately.
    await expect(page.getByTestId('chat-message-user')).toContainText(
      "what's pending here?",
    );

    // Assistant bubble accumulates the streamed deltas.
    const assistant = page.getByTestId('chat-message-assistant').last();
    await expect(assistant).toContainText('Looking at pending decisions for you.', {
      timeout: 10_000,
    });

    // After `done`, the streaming flag clears (caret hidden).
    await expect(assistant).toHaveAttribute('data-streaming', 'false', {
      timeout: 5_000,
    });
  });

  test('renders an ack line above the assistant bubble', async ({ page }) => {
    await signIn(page, { email: owner.email, password: owner.password });

    await page.route(SSE_ROUTE_GLOB, async (route) => {
      await fulfillSseRoute(route, [
        { data: { type: 'ack', text: 'On it — one sec.' } },
        { data: { type: 'say.delta', text: 'Three drafts ready.' } },
        { data: { type: 'done', turnId: 'test-turn-2' } },
      ]);
    });

    await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}/chat`);
    await page.getByTestId('chat-panel-input').fill('list pending drafts');
    await page.getByTestId('chat-panel-send').click();

    await expect(page.getByTestId('chat-message-ack')).toContainText(
      'On it — one sec.',
    );
    await expect(page.getByTestId('chat-message-assistant').last()).toContainText(
      'Three drafts ready.',
    );
  });

  test('renders a review_required ProposedActionCard with Approve/Reject', async ({
    page,
  }) => {
    await signIn(page, { email: owner.email, password: owner.password });

    const proposalId = '99999999-9999-9999-9999-999999999901';
    const proposal = {
      id: proposalId,
      organizationId: '11111111-1111-1111-1111-111111111101',
      propertyId: OAKWOOD_PROPERTY_ID,
      workerModel: 'claude-haiku-4-5',
      action_type: 'draft_sms_reply',
      payload: { body: 'Hi Jane — your balance is paid in full.' },
      routing: null,
      reasoning: 'Tenant asked for balance confirmation; record shows $0 due.',
      confidence: 0.92,
      context_fact_ids: [],
      gate_decision: 'review',
      status: 'proposed',
      createdAt: new Date().toISOString(),
    };

    await page.route(SSE_ROUTE_GLOB, async (route) => {
      await fulfillSseRoute(route, [
        { data: { type: 'say.delta', text: 'Drafted.' } },
        { data: { type: 'proposal.recorded', proposal } },
        {
          data: {
            type: 'proposal.review_required',
            proposal,
            reviewUrl: `/properties/${OAKWOOD_PROPERTY_ID}/proposals/${proposalId}`,
          },
        },
        { data: { type: 'done', turnId: 'test-turn-3' } },
      ]);
    });

    await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}/chat`);
    await page.getByTestId('chat-panel-input').fill('text jane about her balance');
    await page.getByTestId('chat-panel-send').click();

    const card = page.getByTestId('proposed-action-card');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-status', 'review_required');
    await expect(page.getByTestId('proposed-action-card-title')).toContainText(
      /Draft SMS/i,
    );
    await expect(page.getByTestId('proposed-action-card-preview')).toContainText(
      'balance is paid in full',
    );
    await expect(page.getByTestId('proposed-action-card-approve')).toBeVisible();
    await expect(page.getByTestId('proposed-action-card-reject')).toBeVisible();
    await expect(
      page.getByTestId('proposed-action-card-review-link'),
    ).toBeVisible();
  });

  test('proposal.committed transitions the card to Sent', async ({ page }) => {
    await signIn(page, { email: owner.email, password: owner.password });

    const proposalId = '99999999-9999-9999-9999-999999999902';
    const proposal = {
      id: proposalId,
      organizationId: '11111111-1111-1111-1111-111111111101',
      propertyId: OAKWOOD_PROPERTY_ID,
      workerModel: 'claude-haiku-4-5',
      action_type: 'draft_sms_reply',
      payload: { body: 'Auto-sent reply text.' },
      routing: null,
      reasoning: 'Auto-committed per autonomy_level=4 + confidence=0.95.',
      confidence: 0.95,
      context_fact_ids: [],
      gate_decision: 'auto',
      status: 'committed',
      createdAt: new Date().toISOString(),
    };

    await page.route(SSE_ROUTE_GLOB, async (route) => {
      await fulfillSseRoute(route, [
        { data: { type: 'say.delta', text: 'Done.' } },
        { data: { type: 'proposal.recorded', proposal } },
        { data: { type: 'proposal.committed', proposal } },
        { data: { type: 'done', turnId: 'test-turn-4' } },
      ]);
    });

    await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}/chat`);
    await page.getByTestId('chat-panel-input').fill('reply to last tenant');
    await page.getByTestId('chat-panel-send').click();

    const card = page.getByTestId('proposed-action-card');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-status', 'committed');
    await expect(page.getByTestId('proposed-action-card-status')).toContainText(
      /Sent/i,
    );
    await expect(
      page.getByTestId('proposed-action-card-approve'),
    ).toHaveCount(0);
  });

  test('tool.error renders a destructive alert', async ({ page }) => {
    await signIn(page, { email: owner.email, password: owner.password });

    await page.route(SSE_ROUTE_GLOB, async (route) => {
      await fulfillSseRoute(route, [
        {
          data: {
            type: 'tool.error',
            name: 'spawn_property_worker',
            message: 'Vendor lookup timed out.',
          },
        },
        { data: { type: 'done', turnId: 'test-turn-5' } },
      ]);
    });

    await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}/chat`);
    await page.getByTestId('chat-panel-input').fill('dispatch a plumber');
    await page.getByTestId('chat-panel-send').click();

    const err = page.getByTestId('chat-message-tool-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText('Vendor lookup timed out.');
  });
});
