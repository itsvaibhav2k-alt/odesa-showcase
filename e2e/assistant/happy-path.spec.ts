/**
 * Assistant page happy-path E2E (Wave 5).
 *
 * Exercises `/assistant`:
 *
 *   1. Provision a verified owner via `provisionInboxOwner` and stamp
 *      `users.phone_verified_at` directly so the dashboard surface
 *      mirrors the post-onboarding state.
 *   2. Sign in via the UI; navigate to `/assistant`.
 *   3. Assert the page mounts (`data-testid="assistant-page"`) and the
 *      ChatPanel input + send button are present.
 *   4. Stub the durable `/api/chat/runs` POST + terminal GET contract so
 *      the test stays hermetic (no live model/provider calls). The
 *      terminal fixture is unavailable until the client has submitted
 *      and the route has accepted the real `{ message, submissionId }`
 *      request shape.
 *   5. Type a prompt, click Send, then assert the optimistic user turn
 *      and the terminal durable-run reply render honestly.
 *
 * Skipped when the local Supabase stack is offline (matches the rest
 * of the e2e gating pattern). Live-AI variant gated on
 * RUN_LIVE_AI === '1' — kept as a minimal smoke test that just checks
 * the page mounts when the dev server has Anthropic creds.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  provisionInboxOwner,
  signInOwner,
  type InboxOwner,
} from '../inbox/helpers';

const RUN_LIVE_AI = process.env.RUN_LIVE_AI === '1';

test.describe('/assistant — happy path', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: InboxOwner;

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  test('page mounts with chat compose box for verified owner', async ({
    page,
  }) => {
    owner = await provisionInboxOwner('assistant');

    // Stamp verified phone via admin so the owner mirrors the
    // post-onboarding state. The /assistant route does not gate on
    // phone_verified_at today (the iMessage thread row only requires
    // org membership), but a verified owner is the realistic shape.
    const admin = createAdmin();
    await admin
      .from('users')
      .update({
        phone_e164: '+15715559555',
        phone_verified_at: new Date().toISOString(),
      })
      .eq('id', owner.userId);

    await signInOwner(page, owner);
    await page.goto('/assistant');

    await expect(page.getByTestId('assistant-page')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('chat-panel')).toBeVisible();
    await expect(page.getByTestId('chat-panel-input')).toBeVisible();
    await expect(page.getByTestId('chat-panel-send')).toBeVisible();
  });

  test('typing + Send renders a terminal durable-run reply', async ({
    page,
  }) => {
    owner = await provisionInboxOwner('assistant-send');
    const admin = createAdmin();
    await admin
      .from('users')
      .update({
        phone_e164: '+15715559556',
        phone_verified_at: new Date().toISOString(),
      })
      .eq('id', owner.userId);

    // Exercise the release-default durable transport contract. The terminal
    // state is only exposed after a valid enqueue POST has been accepted.
    const runId = '77777777-7777-4777-8777-777777777777';
    const chatId = '66666666-6666-4666-8666-666666666666';
    const terminalReply = 'Hello from the durable run fixture.';
    const durableFixture: {
      acceptedSubmission: {
        message: string;
        submissionId: string;
      } | null;
      terminalPollCount: number;
    } = {
      acceptedSubmission: null,
      terminalPollCount: 0,
    };

    await page.route('**/api/chat/runs**', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as {
          message?: unknown;
          submissionId?: unknown;
        };
        if (
          typeof body.message !== 'string' ||
          typeof body.submissionId !== 'string' ||
          body.submissionId.length === 0
        ) {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              error: 'Invalid fixture submission',
            }),
          });
          return;
        }
        durableFixture.acceptedSubmission = {
          message: body.message,
          submissionId: body.submissionId,
        };
        await route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { runId, chatId, turnId: body.submissionId },
          }),
        });
        return;
      }

      if (request.method() === 'GET') {
        const requestedRunId = new URL(request.url()).searchParams.get(
          'runId',
        );
        if (!durableFixture.acceptedSubmission || requestedRunId !== runId) {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, error: 'Run not found' }),
          });
          return;
        }
        durableFixture.terminalPollCount += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              runId,
              status: 'done',
              replyText: terminalReply,
              error: null,
            },
          }),
        });
        return;
      }

      await route.fallback();
    });

    await signInOwner(page, owner);
    await page.goto('/assistant');
    await expect(page.getByTestId('assistant-page')).toBeVisible({
      timeout: 15_000,
    });

    const promptText = 'list pending proposals';
    await page.getByTestId('chat-panel-input').fill(promptText);
    await page.getByTestId('chat-panel-send').click();

    await expect
      .poll(() => durableFixture.acceptedSubmission?.message ?? null)
      .toBe(promptText);
    expect(durableFixture.acceptedSubmission?.submissionId).toBeTruthy();

    // The user bubble appears immediately (optimistic local insert).
    await expect(
      page
        .locator('[data-testid="chat-message-user"]')
        .filter({ hasText: promptText }),
    ).toBeVisible({ timeout: 5_000 });

    // With no realtime fixture, the client takes its canonical polling
    // fallback and settles from the durable terminal row.
    const assistantReply = page
      .locator('[data-testid="chat-message-assistant"]')
      .filter({ hasText: terminalReply });
    await expect(assistantReply).toBeVisible({ timeout: 15_000 });
    await expect(assistantReply).toHaveAttribute('data-streaming', 'false');
    await expect(page.getByTestId('chat-panel-input')).toBeEnabled();
    expect(durableFixture.terminalPollCount).toBeGreaterThan(0);
  });

  // Live-Claude smoke test — opt-in only. Run with `RUN_LIVE_AI=1` and
  // a configured ANTHROPIC_API_KEY in the dev server's environment.
  // Kept narrow: just confirms the dispatcher returns SOME assistant
  // text within a generous window. The real-vs-stub matrix lives in
  // the v1.8 channel-parity spec at e2e/operator/.
  test('live dispatcher returns a real reply (smoke; opt-in)', async ({
    page,
  }) => {
    test.skip(!RUN_LIVE_AI, 'Skipped: set RUN_LIVE_AI=1 to opt in');

    owner = await provisionInboxOwner('assistant-live');
    const admin = createAdmin();
    await admin
      .from('users')
      .update({
        phone_e164: '+15715559557',
        phone_verified_at: new Date().toISOString(),
      })
      .eq('id', owner.userId);

    await signInOwner(page, owner);
    await page.goto('/assistant');
    await expect(page.getByTestId('assistant-page')).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId('chat-panel-input').fill('say hello');
    await page.getByTestId('chat-panel-send').click();

    await expect(
      page.locator('[data-testid="chat-message-assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
