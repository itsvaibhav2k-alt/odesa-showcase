/**
 * Worker-augmented inbound → draft → approve → send pipeline (v1.5).
 *
 * End-to-end coverage for the integration of `spawnPropertyWorker` into
 * the inbound SMS path. Three variants:
 *   1. Approve-and-send: worker drafts a `pending_review` proposal, the
 *      owner approves it from the drafts queue, the message is sent.
 *   2. Edit-and-send: owner edits the worker's draft before approving.
 *   3. Reject: owner rejects the worker's draft; no SMS goes out.
 *
 * Toggling between worker and v1 fallback paths is via the
 * `ODESA_USE_REAL_AI` env var. This spec runs the worker path —
 * gate-eng's policy keeps `draft_sms_reply` at `gate_decision='review'`
 * for autonomy_level=0.5, so the proposal lands in the queue rather
 * than auto-firing.
 */

import { expect, test } from '@playwright/test';

import {
  createAnthropicMockHarness,
  workerOutputReply,
} from '../mocks/anthropic-mock';
import { createMessagingMockHarness } from '../mocks/messaging-mock';
import {
  HAVE_SUPABASE,
  LINQ_TEST_SECRET,
  createAdmin,
  provisionMessagingFixture,
  signIn,
  type MessagingFixture,
} from './helpers';

interface PropertyLeaseSeed {
  propertyId: string;
  unitId: string;
  leaseId: string;
}

/**
 * Seed a property + unit + active lease for the messaging fixture's
 * tenant. Without these joins, `resolveTenantProperty` returns null and
 * the inbound flow takes the v1 fallback path instead of the worker.
 */
async function seedPropertyLease(
  fixture: MessagingFixture,
): Promise<PropertyLeaseSeed> {
  const admin = createAdmin();
  const stamp = Date.now().toString().slice(-6);

  const { data: property, error: propErr } = await admin
    .from('properties')
    .insert({
      organization_id: fixture.organizationId,
      name: `Worker Draft Property ${stamp}`,
      rules_text: 'Be direct and helpful. Confirm before scheduling vendors.',
      autonomy_level: 0.5,
      privacy_mode: 'hosted',
    })
    .select('id')
    .single();
  if (propErr || !property) {
    throw new Error(`property insert failed: ${propErr?.message}`);
  }

  const { data: unit, error: unitErr } = await admin
    .from('units')
    .insert({
      organization_id: fixture.organizationId,
      property_id: property.id,
      label: `Unit ${stamp}`,
      bedrooms: 2,
      bathrooms: 1,
    })
    .select('id')
    .single();
  if (unitErr || !unit) {
    throw new Error(`unit insert failed: ${unitErr?.message}`);
  }

  const { data: lease, error: leaseErr } = await admin
    .from('leases')
    .insert({
      organization_id: fixture.organizationId,
      tenant_id: fixture.tenant.id,
      unit_id: unit.id,
      rent_amount: 2200,
      rent_due_day: 1,
      status: 'active',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    })
    .select('id')
    .single();
  if (leaseErr || !lease) {
    throw new Error(`lease insert failed: ${leaseErr?.message}`);
  }

  return {
    propertyId: property.id,
    unitId: unit.id,
    leaseId: lease.id,
  };
}

/** Poll until a draft_sms_reply proposal lands for the given property. */
async function waitForDraftProposal(
  propertyId: string,
  timeoutMs = 8_000,
): Promise<{
  id: string;
  reasoning: string | null;
  payload: unknown;
  gateDecision: string;
  status: string;
} | null> {
  const admin = createAdmin();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await admin
      .from('action_proposals')
      .select('id, reasoning, payload, gate_decision, status')
      .eq('property_id', propertyId)
      .eq('action_type', 'draft_sms_reply')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      return {
        id: data.id,
        reasoning: data.reasoning,
        payload: data.payload,
        gateDecision: data.gate_decision,
        status: data.status,
      };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test.describe('messaging worker: inbound → draft → owner action', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );
  test.skip(
    process.env.ODESA_USE_REAL_AI !== 'true',
    'Skipped: set ODESA_USE_REAL_AI=true to exercise the worker path',
  );

  let fixture: MessagingFixture;
  let seed: PropertyLeaseSeed;

  test.beforeEach(async ({ request }) => {
    fixture = await provisionMessagingFixture({ messagingPrimary: 'linq' });
    seed = await seedPropertyLease(fixture);

    // Mock outbound SMS so approve doesn't burn real Twilio/Linq calls.
    const messaging = createMessagingMockHarness(request);
    await messaging.install();

    // Mock the Anthropic SDK to return a deterministic ActionProposal
    // body for `draft_sms_reply` calls.
    const anthropic = createAnthropicMockHarness(request);
    // Confidence sub-0.3 forces the commit gate to route the proposal
    // to `review` (per draft_sms_reply policy in commit-gate.ts). This
    // is what puts the proposal in the drafts queue rather than
    // auto-firing. The spec asserts that exact behavior.
    await anthropic.install({
      scripts: [
        {
          matchActionType: 'draft_sms_reply',
          reply: workerOutputReply(
            'draft_sms_reply',
            {
              body: 'Got it — I will check on the leak today and follow up by 5pm.',
              tone: 'warm',
            },
            { confidence: 0.2 },
          ),
        },
      ],
    });
  });

  test.afterEach(async ({ request }) => {
    const anthropic = createAnthropicMockHarness(request);
    await anthropic.uninstall().catch(() => {});
    const messaging = createMessagingMockHarness(request);
    await messaging.uninstall().catch(() => {});
    if (fixture) await fixture.teardown();
  });

  test('worker drafts a pending_review proposal carried to the drafts queue', async ({
    request,
  }) => {
    const inboundText = 'There is a leak under the kitchen sink, can you help?';
    const resp = await request.post('/api/messaging/inbound/linq', {
      headers: { 'X-Linq-Signature': LINQ_TEST_SECRET },
      data: {
        message_handle: `linq-worker-${Date.now()}`,
        from_number: fixture.tenant.phoneE164,
        to_number: fixture.odesaPhoneE164,
        content: inboundText,
      },
    });
    expect(resp.status()).toBe(200);

    const proposal = await waitForDraftProposal(seed.propertyId);
    expect(proposal).not.toBeNull();
    expect(proposal!.status).toBe('proposed');
    expect(proposal!.gateDecision).toBe('review');
    // Reasoning surfaced in the inbox feed.
    expect(typeof proposal!.reasoning).toBe('string');
    expect(proposal!.reasoning!.length).toBeGreaterThan(0);

    // The drafts queue (messages table) shows a `pending_review` outbound
    // whose body matches the worker's payload.
    const admin = createAdmin();
    const { data: draft } = await admin
      .from('messages')
      .select('body, draft_status, direction')
      .eq('organization_id', fixture.organizationId)
      .eq('draft_status', 'pending_review')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    expect(draft?.draft_status).toBe('pending_review');
    expect(draft?.direction).toBe('outbound');
    expect(draft?.body).toContain('check on the leak');
  });

  test('owner approves the worker draft → SMS is sent + status flips', async ({
    page,
    request,
  }) => {
    const inboundText = 'leak in the bathroom, getting worse';
    await request.post('/api/messaging/inbound/linq', {
      headers: { 'X-Linq-Signature': LINQ_TEST_SECRET },
      data: {
        message_handle: `linq-approve-${Date.now()}`,
        from_number: fixture.tenant.phoneE164,
        to_number: fixture.odesaPhoneE164,
        content: inboundText,
      },
    });

    const proposal = await waitForDraftProposal(seed.propertyId);
    expect(proposal).not.toBeNull();

    // Find the matching pending_review draft.
    const admin = createAdmin();
    const { data: draft } = await admin
      .from('messages')
      .select('id')
      .eq('organization_id', fixture.organizationId)
      .eq('draft_status', 'pending_review')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(draft?.id).toBeTruthy();

    await signIn(page, {
      email: fixture.owner.email,
      password: fixture.owner.password,
    });

    const approveResp = await page.request.post(
      `/api/messaging/drafts/${draft!.id}/approve`,
    );
    expect(approveResp.status()).toBe(200);

    // Mocked outbound observed.
    const messaging = createMessagingMockHarness(request);
    const recorded = await messaging.getRecorded();
    const sent = recorded[recorded.length - 1];
    expect(sent?.body).toContain('check on the leak');
    expect(sent?.to).toBe(fixture.tenant.phoneE164);

    // Proposal should be marked committed (commit gate path).
    const { data: proposalRow } = await admin
      .from('action_proposals')
      .select('status')
      .eq('id', proposal!.id)
      .maybeSingle();
    expect(proposalRow?.status).toBe('committed');
  });

  test('owner edits the worker draft before approving', async ({
    page,
    request,
  }) => {
    await request.post('/api/messaging/inbound/linq', {
      headers: { 'X-Linq-Signature': LINQ_TEST_SECRET },
      data: {
        message_handle: `linq-edit-${Date.now()}`,
        from_number: fixture.tenant.phoneE164,
        to_number: fixture.odesaPhoneE164,
        content: 'pipe under the sink is dripping',
      },
    });
    await waitForDraftProposal(seed.propertyId);

    const admin = createAdmin();
    const { data: draft } = await admin
      .from('messages')
      .select('id')
      .eq('organization_id', fixture.organizationId)
      .eq('draft_status', 'pending_review')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(draft?.id).toBeTruthy();

    await signIn(page, {
      email: fixture.owner.email,
      password: fixture.owner.password,
    });

    const editedBody = 'Heading over now — turn off the sink valve if you can.';
    const editResp = await page.request.patch(
      `/api/messaging/drafts/${draft!.id}/edit`,
      { data: { body: editedBody } },
    );
    expect(editResp.status()).toBe(200);

    const approveResp = await page.request.post(
      `/api/messaging/drafts/${draft!.id}/approve`,
    );
    expect(approveResp.status()).toBe(200);

    const messaging = createMessagingMockHarness(request);
    const recorded = await messaging.getRecorded();
    const sent = recorded[recorded.length - 1];
    expect(sent?.body).toBe(editedBody);
  });

  test('owner rejects the worker draft → no SMS sent', async ({
    page,
    request,
  }) => {
    await request.post('/api/messaging/inbound/linq', {
      headers: { 'X-Linq-Signature': LINQ_TEST_SECRET },
      data: {
        message_handle: `linq-reject-${Date.now()}`,
        from_number: fixture.tenant.phoneE164,
        to_number: fixture.odesaPhoneE164,
        content: 'random unhelpful message',
      },
    });
    const proposal = await waitForDraftProposal(seed.propertyId);
    expect(proposal).not.toBeNull();

    const admin = createAdmin();
    const { data: draft } = await admin
      .from('messages')
      .select('id')
      .eq('organization_id', fixture.organizationId)
      .eq('draft_status', 'pending_review')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(draft?.id).toBeTruthy();

    await signIn(page, {
      email: fixture.owner.email,
      password: fixture.owner.password,
    });

    const rejectResp = await page.request.post(
      `/api/messaging/drafts/${draft!.id}/reject`,
    );
    expect(rejectResp.status()).toBe(200);

    const messaging = createMessagingMockHarness(request);
    const recorded = await messaging.getRecorded();
    expect(recorded).toHaveLength(0);

    const { data: proposalRow } = await admin
      .from('action_proposals')
      .select('status')
      .eq('id', proposal!.id)
      .maybeSingle();
    expect(proposalRow?.status).toBe('rejected');
  });
});
