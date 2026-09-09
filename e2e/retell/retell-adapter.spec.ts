/**
 * Retell production adapter — nested tool shape, tool idempotency, and the
 * inbound `call_inbound` webhook, end-to-end at API level.
 *
 * These specs prove the production-hardening additions on top of the existing
 * flat-internal contract (which tool-endpoints.spec.ts / voice-operator.spec.ts
 * still cover): the real Retell NESTED tool body works and stays org/policy
 * scoped; a retried record-creating tool creates exactly ONE record; and the
 * inbound webhook returns privacy-gated dynamic variables ({} for unknown
 * callers). Auth mirrors the existing suites (bearer RETELL_API_KEY). Requires
 * the local Supabase stack + Galaxy seed (skips otherwise). Self-cleaning.
 */
import { expect, test } from '@playwright/test';

import { HAVE_SUPABASE, GALAXY_ORG_ID, createAdmin } from '../today/helpers';
import { signWebhookPost } from './signed-webhook';

const RETELL_KEY = process.env.RETELL_API_KEY ?? 'retell-dev-test-key';
const HEADERS = { authorization: `Bearer ${RETELL_KEY}` };

const GALAXY_ORG_PHONE = '+15715550101';
const GALAXY_TENANT_PHONE = '+15715550201'; // Marcus Alvarez (seeded)
const GHOST_PHONE = '+15715559999'; // unseeded → unknown caller
const UNROUTED_PHONE = '+15719999999'; // no org routes this number
const RUN = Date.now();

test.describe('retell production adapter', () => {
  test.skip(!HAVE_SUPABASE, 'requires local Supabase env (SUPABASE_URL etc.)');

  test('accepts the real NESTED Retell tool shape and preserves org/policy scoping', async ({
    request,
  }) => {
    const admin = createAdmin();
    const callId = `retell-adapter-${RUN}-nested`;
    const woIds: string[] = [];
    try {
      // report_intents via the nested {name, args, call} shape → verified tenant,
      // policy brain intact.
      const reported = await request.post('/api/retell/tools/report_intents', {
        headers: HEADERS,
        data: {
          name: 'report_intents',
          args: { intents: ['maintenance_request'] },
          call: {
            call_type: 'phone_call',
            call_id: callId,
            from_number: GALAXY_TENANT_PHONE,
            to_number: GALAXY_ORG_PHONE,
          },
        },
      });
      expect(reported.status()).toBe(200);
      const plan = await reported.json();
      expect(plan.caller_kind).toBe('verified_tenant');

      // Unknown caller via the nested shape → zero private tools allowed.
      const ghostReported = await request.post('/api/retell/tools/report_intents', {
        headers: HEADERS,
        data: {
          name: 'report_intents',
          args: { intents: ['unknown_general'] },
          call: {
            call_type: 'phone_call',
            call_id: `${callId}-ghost`,
            from_number: GHOST_PHONE,
            to_number: GALAXY_ORG_PHONE,
          },
        },
      });
      expect(ghostReported.status()).toBe(200);
      const ghostPlan = await ghostReported.json();
      expect(ghostPlan.caller_kind).toBe('unknown_caller');
      expect(ghostPlan.allowed_tools).not.toContain('create_work_order');
      expect(ghostPlan.allowed_tools).not.toContain('get_rent_status');

      // create_work_order via the nested shape → WO scoped to the Galaxy org.
      const wo = await request.post('/api/retell/tools/create_work_order', {
        headers: HEADERS,
        data: {
          name: 'create_work_order',
          args: {
            description: `Nested-shape probe ${RUN}`,
            category: 'plumbing',
            urgency: 'routine',
          },
          call: {
            call_type: 'phone_call',
            call_id: `${callId}-wo`,
            from_number: GALAXY_TENANT_PHONE,
            to_number: GALAXY_ORG_PHONE,
          },
        },
      });
      expect(wo.status()).toBe(200);
      const woBody = await wo.json();
      expect(woBody.work_order_id).toMatch(/^[0-9a-f-]{36}$/);
      woIds.push(woBody.work_order_id);

      const { data: row } = await admin
        .from('work_orders')
        .select('organization_id')
        .eq('id', woBody.work_order_id)
        .single();
      expect(row?.organization_id).toBe(GALAXY_ORG_ID);
    } finally {
      for (const id of woIds) await admin.from('work_orders').delete().eq('id', id);
      await admin.from('voice_calls').delete().eq('retell_call_id', callId);
      await admin.from('voice_calls').delete().eq('retell_call_id', `${callId}-ghost`);
      await admin.from('retell_tool_invocations').delete().like('call_id', `${callId}%`);
    }
  });

  test('55 concurrent create_work_order retries produce one WO and replay one canonical result', async ({
    request,
  }) => {
    const admin = createAdmin();
    const callId = `retell-adapter-${RUN}-idem`;
    const uniqueDesc = `IDEMPOTENCY PROBE ${RUN} kitchen sink leak`;
    try {
      // Establish the voice_calls row so the idempotency ledger has a home.
      const startedSigned = signWebhookPost({
        event: 'call_started',
        call: {
          call_id: callId,
          from_number: GALAXY_TENANT_PHONE,
          to_number: GALAXY_ORG_PHONE,
        },
      });
      const started = await request.post('/api/retell/webhook', {
        headers: startedSigned.headers,
        data: startedSigned.body,
      });
      expect(started.status()).toBe(200);

      const nestedBody = {
        name: 'create_work_order',
        args: { description: uniqueDesc, category: 'plumbing', urgency: 'routine' },
        call: {
          call_type: 'phone_call',
          call_id: callId,
          from_number: GALAXY_TENANT_PHONE,
          to_number: GALAXY_ORG_PHONE,
        },
      };

      const responses = await Promise.all(
        Array.from({ length: 55 }, () =>
          request.post('/api/retell/tools/create_work_order', {
            headers: HEADERS,
            data: nestedBody,
          }),
        ),
      );
      expect(new Set(responses.map((response) => response.status()))).toEqual(new Set([200]));
      const bodies = await Promise.all(responses.map((response) => response.json()));
      expect(bodies[0].work_order_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Set(bodies.map((body) => body.work_order_id))).toEqual(
        new Set([bodies[0].work_order_id]),
      );

      const { data: rows } = await admin
        .from('work_orders')
        .select('id')
        .eq('description', uniqueDesc);
      expect(rows?.length).toBe(1);
    } finally {
      await admin.from('work_orders').delete().eq('description', uniqueDesc);
      await admin.from('retell_tool_invocations').delete().eq('call_id', callId);
      await admin.from('voice_calls').delete().eq('retell_call_id', callId);
      const [{ count: calls }, { count: conversations }, { count: messages }, { count: proposals }] = await Promise.all([
        admin.from('voice_calls').select('*', { count: 'exact', head: true }).eq('retell_call_id', callId),
        admin.from('conversations').select('*', { count: 'exact', head: true }).like('retell_artifact_key', `${callId}%`),
        admin.from('messages').select('*', { count: 'exact', head: true }).like('retell_artifact_key', `${callId}%`),
        admin.from('action_proposals').select('*', { count: 'exact', head: true }).like('retell_artifact_key', `${callId}%`),
      ]);
      expect({ calls, conversations, messages, proposals }).toEqual({ calls: 0, conversations: 0, messages: 0, proposals: 0 });
    }
  });

  test('inbound webhook: {} for unknown, gated vars for verified tenant, 404 unrouted', async ({
    request,
  }) => {
    // Unknown caller → zero private data.
    const unknown = await (() => {
      const signedInbound1 = signWebhookPost({
        event: 'call_inbound',
        event_timestamp: Date.now(),
        call_inbound: {
          agent_id: 'agent_x',
          from_number: GHOST_PHONE,
          to_number: GALAXY_ORG_PHONE,
        },
      });
      return request.post('/api/retell/inbound', {
        headers: signedInbound1.headers,
        data: signedInbound1.body,
      });
    })();
    expect(unknown.status()).toBe(200);
    const unknownBody = await unknown.json();
    expect(unknownBody.call_inbound.dynamic_variables).toEqual({});

    // Verified tenant → gated, ledger-honest variables (no payment date).
    const tenant = await (() => {
      const signedInbound2 = signWebhookPost({
        event: 'call_inbound',
        event_timestamp: Date.now(),
        call_inbound: {
          agent_id: 'agent_x',
          from_number: GALAXY_TENANT_PHONE,
          to_number: GALAXY_ORG_PHONE,
        },
      });
      return request.post('/api/retell/inbound', {
        headers: signedInbound2.headers,
        data: signedInbound2.body,
      });
    })();
    expect(tenant.status()).toBe(200);
    const vars = (await tenant.json()).call_inbound.dynamic_variables;
    expect(vars.caller_name).toContain('Marcus');
    expect(vars.ledger_status_line).toMatch(/ledger currently shows|ledger has no rent entries/);
    // Ledger honesty: never a bare payment date phrasing.
    expect(JSON.stringify(vars)).not.toMatch(/you paid on|paid on \d/i);

    // Unrouted to_number → 404, fail closed.
    const unrouted = await (() => {
      const signedInbound3 = signWebhookPost({
        event: 'call_inbound',
        event_timestamp: Date.now(),
        call_inbound: {
          agent_id: 'agent_x',
          from_number: GALAXY_TENANT_PHONE,
          to_number: UNROUTED_PHONE,
        },
      });
      return request.post('/api/retell/inbound', {
        headers: signedInbound3.headers,
        data: signedInbound3.body,
      });
    })();
    expect(unrouted.status()).toBe(404);
  });

  test('inbound webhook rejects a request without bearer auth', async ({ request }) => {
    const res = await request.post('/api/retell/inbound', {
      data: {
        event: 'call_inbound',
        event_timestamp: Date.now(),
        call_inbound: { from_number: GHOST_PHONE, to_number: GALAXY_ORG_PHONE },
      },
    });
    expect(res.status()).toBe(401);
  });

  test('55 concurrent finalization deliveries create one atomic dossier and replay canonical ids', async ({ request }) => {
    const admin = createAdmin();
    const callId = `retell-finalize-${RUN}`;
    const postWebhook = (event: 'call_started' | 'call_ended' | 'call_analyzed', extra: Record<string, unknown> = {}) => {
      const signed = signWebhookPost({
        event,
        call: {
          call_id: callId,
          from_number: GALAXY_TENANT_PHONE,
          to_number: GALAXY_ORG_PHONE,
          ...extra,
        },
      });
      return request.post('/api/retell/webhook', { headers: signed.headers, data: signed.body });
    };

    try {
      expect((await postWebhook('call_started')).status()).toBe(200);
      const reported = await request.post('/api/retell/tools/report_intents', {
        headers: HEADERS,
        data: {
          call_id: callId,
          from_number: GALAXY_TENANT_PHONE,
          to_number: GALAXY_ORG_PHONE,
          args: { intents: ['payment_dispute'], facts: { paymentClaim: { claimed: true, method: 'zelle' } } },
        },
      });
      expect(reported.status()).toBe(200);

      const deliveries = await Promise.all(
        Array.from({ length: 55 }, (_, index) =>
          postWebhook(index % 2 === 0 ? 'call_ended' : 'call_analyzed', {
            transcript: 'Tenant says the ledger is wrong after a Zelle payment.',
            ...(index % 2 === 1 ? { call_analysis: { call_summary: 'Payment dispute needs review.' } } : {}),
          }),
        ),
      );
      expect(new Set(deliveries.map((delivery) => delivery.status()))).toEqual(new Set([200]));
      const bodies = await Promise.all(deliveries.map((delivery) => delivery.json()));
      expect(new Set(bodies.map((body) => body.conversation_id)).size).toBe(1);
      expect(new Set(bodies.map((body) => body.proposal_id)).size).toBe(1);

      const [{ count: conversations }, { count: messages }, { count: proposals }] = await Promise.all([
        admin.from('conversations').select('*', { count: 'exact', head: true }).eq('retell_artifact_key', `${callId}:final:conversation`),
        admin.from('messages').select('*', { count: 'exact', head: true }).eq('retell_artifact_key', `${callId}:final:message`),
        admin.from('action_proposals').select('*', { count: 'exact', head: true }).eq('retell_artifact_key', `${callId}:final:proposal`),
      ]);
      expect({ conversations, messages, proposals }).toEqual({ conversations: 1, messages: 1, proposals: 1 });

      const { data: call } = await admin.from('voice_calls').select('status, session, outcome, conversation_id').eq('retell_call_id', callId).single();
      expect(call?.status).toBe('completed');
      expect((call?.session as { providerAnalysis?: unknown }).providerAnalysis).toBeTruthy();
      expect(call?.conversation_id).toBe(bodies[0].conversation_id);
    } finally {
      await admin.from('messages').delete().like('retell_artifact_key', `${callId}%`);
      await admin.from('action_proposals').delete().like('retell_artifact_key', `${callId}%`);
      await admin.from('conversations').delete().like('retell_artifact_key', `${callId}%`);
      await admin.from('retell_tool_invocations').delete().eq('call_id', callId);
      await admin.from('voice_calls').delete().eq('retell_call_id', callId);
      const [{ count: calls }, { count: conversations }, { count: messages }, { count: proposals }] = await Promise.all([
        admin.from('voice_calls').select('*', { count: 'exact', head: true }).eq('retell_call_id', callId),
        admin.from('conversations').select('*', { count: 'exact', head: true }).like('retell_artifact_key', `${callId}%`),
        admin.from('messages').select('*', { count: 'exact', head: true }).like('retell_artifact_key', `${callId}%`),
        admin.from('action_proposals').select('*', { count: 'exact', head: true }).like('retell_artifact_key', `${callId}%`),
      ]);
      expect({ calls, conversations, messages, proposals }).toEqual({ calls: 0, conversations: 0, messages: 0, proposals: 0 });
    }
  });

  test('sparse ended and rich analyzed converge all derived dossier fields in either order', async ({ request }) => {
    const admin = createAdmin();
    const callIds = [`retell-order-ended-first-${RUN}`, `retell-order-analyzed-first-${RUN}`];
    const post = (callId: string, event: string, extra: Record<string, unknown> = {}) => {
      const signed = signWebhookPost({ event, call: { call_id: callId, from_number: GALAXY_TENANT_PHONE, to_number: GALAXY_ORG_PHONE, ...extra } });
      return request.post('/api/retell/webhook', { headers: signed.headers, data: signed.body });
    };
    const reportDispute = (callId: string) => request.post('/api/retell/tools/report_intents', {
      headers: HEADERS, data: { call_id: callId, from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
        args: { intents: ['payment_dispute'], facts: { paymentClaim: { claimed: true, method: 'zelle' } } } },
    });
    try {
      for (const callId of callIds) {
        expect((await post(callId, 'call_started')).status()).toBe(200);
      }
      const rich = { transcript: 'Tenant disputes the ledger after a Zelle payment.', call_analysis: { call_summary: 'Rich provider analysis' } };
      expect((await post(callIds[0], 'call_ended')).status()).toBe(200);
      expect((await reportDispute(callIds[0])).status()).toBe(200);
      expect((await post(callIds[0], 'call_analyzed', rich)).status()).toBe(200);
      expect((await reportDispute(callIds[1])).status()).toBe(200);
      expect((await post(callIds[1], 'call_analyzed', rich)).status()).toBe(200);
      expect((await post(callIds[1], 'call_ended')).status()).toBe(200);

      const dossiers = await Promise.all(callIds.map(async (callId) => {
        const { data: call } = await admin.from('voice_calls').select('summary, outcome, session, transcript, finalization_richness').eq('retell_call_id', callId).single();
        const { data: conversation } = await admin.from('conversations').select('summary, status').eq('retell_artifact_key', `${callId}:final:conversation`).single();
        const { data: message } = await admin.from('messages').select('body').eq('retell_artifact_key', `${callId}:final:message`).single();
        const { data: proposal } = await admin.from('action_proposals').select('payload, reasoning').eq('retell_artifact_key', `${callId}:final:proposal`).single();
        const outcome = { ...(call!.outcome as Record<string, unknown>) }; delete outcome.endedAt;
        const session = { ...(call!.session as Record<string, unknown>) }; delete session.endedAt; delete session.startedAt; delete session.retellCallId;
        const payload = { ...(proposal!.payload as Record<string, unknown>) }; delete payload.callId;
        return { summary: call!.summary, outcome, session, transcript: call!.transcript,
          richness: call!.finalization_richness, conversation, message,
          proposal: { payload, reasoning: proposal!.reasoning } };
      }));
      expect(dossiers[0]).toEqual(dossiers[1]);
      expect(dossiers[0]).toMatchObject({ richness: 3, transcript: rich.transcript,
        session: { providerAnalysis: rich.call_analysis }, conversation: { summary: dossiers[0].summary },
        proposal: { payload: { summary: dossiers[0].summary } } });
    } finally {
      for (const callId of callIds) {
        await admin.from('messages').delete().like('retell_artifact_key', `${callId}%`);
        await admin.from('action_proposals').delete().like('retell_artifact_key', `${callId}%`);
        await admin.from('conversations').delete().like('retell_artifact_key', `${callId}%`);
        await admin.from('retell_tool_invocations').delete().eq('call_id', callId);
        await admin.from('voice_calls').delete().eq('retell_call_id', callId);
      }
    }
  });
});
