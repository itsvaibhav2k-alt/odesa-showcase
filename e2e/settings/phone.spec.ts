/**
 * Settings — Odesa phone number section (spec §11.4 section 1).
 *
 * Covers:
 *  - The assigned number renders in big JetBrains Mono when present
 *  - The placeholder copy renders when `odesa_phone_number` is null
 *  - The "currently taking calls" toggle shows an on-state (disabled
 *    in Phase 2 per the spec's "UI only, Phase 4 wires it" note)
 *
 * Skipped when the local Supabase stack is unavailable — the null-phone
 * case requires an admin-mediated org update to exercise.
 */

import { expect, test } from '@playwright/test';

import {
  createAdmin,
  GALAXY_ORG_ID,
  GALAXY_PHONE_DISPLAY,
  GALAXY_PHONE_E164,
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signInAndOpenSettings,
  type SeededOwner,
} from './helpers';

test.describe('settings: phone number', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  // The two tests in this file mutate the same shared organization row
  // (`organizations.odesa_phone_number` for GALAXY_ORG_ID) — placeholder
  // test nulls it then restores. Running them in parallel under
  // `workers > 1` lets the placeholder test observe a null mid-flight in
  // the provisioned test. Serialize the describe to keep the row stable.
  test.describe.configure({ mode: 'serial' });

  let owner: SeededOwner;

  test.beforeEach(async () => {
    owner = await provisionGalaxyOwner();
    // Shared DB drifts (migration 20260610000005 moved the number), so this
    // spec pins its own arrange state — mirrors the null-then-restore pattern
    // in the placeholder test below.
    const admin = createAdmin();
    const { error: pinErr } = await admin
      .from('organizations')
      .update({ odesa_phone_number: GALAXY_PHONE_E164 })
      .eq('id', GALAXY_ORG_ID);
    expect(pinErr).toBeNull();
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  test('renders the big mono number and caption for a provisioned org', async ({
    page,
  }) => {
    await signInAndOpenSettings(page, {
      email: owner.email,
      password: owner.password,
    });

    await expect(page.getByTestId('settings-page')).toBeVisible();
    await expect(page.getByTestId('settings-section-phone')).toBeVisible();

    const card = page.getByTestId('settings-phone-card');
    await expect(card).toBeVisible();

    const number = page.getByTestId('settings-phone-number');
    await expect(number).toHaveText(GALAXY_PHONE_DISPLAY);

    // Honest voice-readiness caption. Per src/lib/voice/readiness.ts
    // `phoneLineCaption`, the "Odesa answers 24/7" claim is made ONLY at
    // state 4 (production-live, external evidence). Galaxy's local stack
    // sits at state 1 (Local simulation ready), so the card honestly says
    // the number is still in setup and not answering live calls yet. This
    // is the approved voice-readiness truth fix — asserting the real
    // state-1 copy, not weakening the test.
    await expect(page.getByTestId('settings-phone-caption')).toContainText(
      /in setup — Local simulation ready\. Odesa is not answering live calls yet/,
    );

    // Honest outbound status block: Odesa drafts tenant-facing messages
    // but nothing sends until the owner approves it.
    await expect(page.getByTestId('settings-phone-outbound')).toContainText(
      /Nothing sends to a tenant until you approve/,
    );

    // Toggle reflects organizations.voice_enabled (Phase 4 wiring complete).
    // Galaxy seed does not set voice_enabled, so the toggle renders off (false).
    // The "set up voice calling" link appears when voice_enabled is null.
    const toggle = page.getByTestId('settings-phone-voice-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).toBeDisabled();
  });

  test('renders the placeholder copy when the number is not yet provisioned', async ({
    page,
  }) => {
    // Flip the seeded number off so the placeholder branch renders.
    const admin = createAdmin();
    const { error: nullErr } = await admin
      .from('organizations')
      .update({ odesa_phone_number: null })
      .eq('id', GALAXY_ORG_ID);
    expect(nullErr).toBeNull();

    try {
      await signInAndOpenSettings(page, {
        email: owner.email,
        password: owner.password,
      });

      await expect(page.getByTestId('settings-phone-card')).toBeVisible();
      await expect(page.getByTestId('settings-phone-placeholder')).toContainText(
        /10DLC approval/,
      );
      // The big mono number should not render.
      await expect(page.getByTestId('settings-phone-number')).toHaveCount(0);
    } finally {
      // Restore the seeded number regardless of assertion outcome so
      // other specs running in the same session see the expected state.
      await admin
        .from('organizations')
        .update({ odesa_phone_number: GALAXY_PHONE_E164 })
        .eq('id', GALAXY_ORG_ID);
    }
  });
});
