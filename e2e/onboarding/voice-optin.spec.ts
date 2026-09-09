/**
 * Voice/Retell opt-in — Playwright specs.
 *
 * Covers the /onboarding/voice page and the phone-card toggle in
 * Settings that reflects `organizations.voice_enabled`.
 *
 * UX placement note: voice opt-in lives at /onboarding/voice (settings-
 * adjacent, not a mandatory 7th step). See the page module's JSDoc for
 * the full rationale. Operators reach it via:
 *   - The "Set up voice calling" link in Settings → Phone card (when
 *     voice_enabled is null / column absent)
 *   - Direct navigation to /onboarding/voice
 *
 * BLOCKER — column pending:
 * `organizations.voice_enabled` does not exist yet (T2b migration). The
 * setVoiceEnabledAction returns a DB error when called. These specs are
 * written for the post-migration steady state; they will skip at runtime
 * until the column lands (VOICE_COLUMN_READY=true env var gates them).
 *
 * Specs that don't require the column (auth guards, page shape) run
 * unconditionally.
 *
 * Skip-if-not-logged-in pattern: specs needing auth use provisionFreshLandlord
 * from helpers.ts and gate on HAVE_SUPABASE exactly like the rest of the
 * onboarding suite.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  provisionFreshLandlord,
  type FreshLandlord,
} from './helpers';

const VOICE_COLUMN_READY = process.env.VOICE_COLUMN_READY === 'true';

// ---------------------------------------------------------------------------
// Auth guard specs — no column dependency
// ---------------------------------------------------------------------------

test.describe('voice opt-in: auth guards', () => {
  test('unauthenticated /onboarding/voice redirects to /login', async ({
    page,
  }) => {
    await page.goto('/onboarding/voice');
    await page.waitForURL(/\/login(\/|\?|$)/, { timeout: 10_000 });
    await expect(page.getByTestId('login-form')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Page shape + UI — requires auth, does NOT require the column
// ---------------------------------------------------------------------------

test.describe('voice opt-in: page shape', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let landlord: FreshLandlord;

  test.beforeEach(async ({ page }) => {
    landlord = await provisionFreshLandlord('voice-shape');
    // Seed through messaging step so the layout doesn't redirect us away.
    // We seed odesa_phone_number and phone_verified_at so the layout's
    // completion check passes and renders children (voice page).
    const admin = createAdmin();

    // Seed property→unit→tenant→lease so the onboarding index won't
    // bounce us back to earlier steps if we navigate via /onboarding.
    const { data: prop } = await admin
      .from('properties')
      .insert({
        organization_id: landlord.organizationId,
        name: 'Voice Test Building',
        address_street: '1 Voice Ln',
        address_city: 'Arlington',
        address_state: 'VA',
        address_zip: '22201',
      })
      .select('id')
      .single();
    const { data: unit } = await admin
      .from('units')
      .insert({
        organization_id: landlord.organizationId,
        property_id: prop!.id,
        label: '101',
      })
      .select('id')
      .single();
    const { data: tenant } = await admin
      .from('tenants')
      .insert({
        organization_id: landlord.organizationId,
        full_name: 'Voice Tenant',
        phone_e164: '+17035550001',
      })
      .select('id')
      .single();
    await admin.from('leases').insert({
      organization_id: landlord.organizationId,
      unit_id: unit!.id,
      tenant_id: tenant!.id,
      rent_amount: 1500,
      rent_due_day: 1,
      status: 'active',
    });

    // Assign number + verify phone so the onboarding layout lets the
    // user through to /today (and by extension allows /onboarding/voice).
    const poolE164 = `+1555${Date.now().toString().slice(-7)}`;
    await admin
      .from('sendblue_number_pool')
      .insert({ e164: poolE164, status: 'assigned' });
    await admin
      .from('organizations')
      .update({ odesa_phone_number: poolE164 })
      .eq('id', landlord.organizationId);
    await admin
      .from('users')
      .update({
        phone_e164: '+17035550002',
        phone_verified_at: new Date().toISOString(),
      })
      .eq('id', landlord.userId);

    // Sign in.
    await page.goto('/login');
    await page.getByTestId('login-email').fill(landlord.email);
    await page.getByTestId('login-password').fill(landlord.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/, { timeout: 15_000 });
  });

  test.afterEach(async () => {
    await landlord?.teardown();
  });

  test('renders voice opt-in page with enable and skip buttons', async ({
    page,
  }) => {
    await page.goto('/onboarding/voice');
    await expect(page.getByTestId('onboarding-voice')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('voice-form')).toBeVisible();
    await expect(page.getByTestId('voice-enable-button')).toBeVisible();
    await expect(page.getByTestId('voice-skip-button')).toBeVisible();
    await expect(
      page.getByTestId('voice-feature-description'),
    ).toBeVisible();
    await expect(page.getByTestId('voice-footer-note')).toContainText(
      /Settings/,
    );
  });
});

// ---------------------------------------------------------------------------
// Happy path — requires auth AND the voice_enabled column
// ---------------------------------------------------------------------------

test.describe('voice opt-in: happy path (post-migration)', () => {
  test.skip(
    !HAVE_SUPABASE || !VOICE_COLUMN_READY,
    'Skipped: set SUPABASE_URL + VOICE_COLUMN_READY=true to run (column pending T2b migration)',
  );

  let landlord: FreshLandlord;

  test.afterEach(async () => {
    await landlord?.teardown();
  });

  test('operator can enable voice and lands on /today', async ({ page }) => {
    landlord = await provisionFreshLandlord('voice-enable');
    const admin = createAdmin();

    // Minimal seed: number + phone verification so layout allows /today.
    const poolE164 = `+1555${Date.now().toString().slice(-7)}`;
    await admin
      .from('sendblue_number_pool')
      .insert({ e164: poolE164, status: 'assigned' });
    await admin
      .from('organizations')
      .update({ odesa_phone_number: poolE164 })
      .eq('id', landlord.organizationId);
    await admin
      .from('users')
      .update({
        phone_e164: '+17035550010',
        phone_verified_at: new Date().toISOString(),
      })
      .eq('id', landlord.userId);

    await page.goto('/login');
    await page.getByTestId('login-email').fill(landlord.email);
    await page.getByTestId('login-password').fill(landlord.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/, { timeout: 15_000 });

    await page.goto('/onboarding/voice');
    await expect(page.getByTestId('voice-form')).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId('voice-enable-button').click();
    await page.waitForURL(/\/today(\/|\?|$)/, { timeout: 15_000 });

    // Verify DB state.
    const { data: org } = await admin
      .from('organizations')
      .select('voice_enabled')
      .eq('id', landlord.organizationId)
      .single();
    expect(org?.voice_enabled).toBe(true);
  });

  test('operator can skip voice and lands on /today with voice_enabled=false', async ({
    page,
  }) => {
    landlord = await provisionFreshLandlord('voice-skip');
    const admin = createAdmin();

    const poolE164 = `+1555${Date.now().toString().slice(-7)}`;
    await admin
      .from('sendblue_number_pool')
      .insert({ e164: poolE164, status: 'assigned' });
    await admin
      .from('organizations')
      .update({ odesa_phone_number: poolE164 })
      .eq('id', landlord.organizationId);
    await admin
      .from('users')
      .update({
        phone_e164: '+17035550011',
        phone_verified_at: new Date().toISOString(),
      })
      .eq('id', landlord.userId);

    await page.goto('/login');
    await page.getByTestId('login-email').fill(landlord.email);
    await page.getByTestId('login-password').fill(landlord.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/, { timeout: 15_000 });

    await page.goto('/onboarding/voice');
    await expect(page.getByTestId('voice-form')).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId('voice-skip-button').click();
    await page.waitForURL(/\/today(\/|\?|$)/, { timeout: 15_000 });

    // Verify DB: explicit false (operator opted out rather than leaving null).
    const { data: org } = await admin
      .from('organizations')
      .select('voice_enabled')
      .eq('id', landlord.organizationId)
      .single();
    expect(org?.voice_enabled).toBe(false);
  });
});
