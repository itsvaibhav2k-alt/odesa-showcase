/**
 * Test call simulation endpoint — POST /api/retell/test-call
 *
 * Dashboard-only route for generating safe test call artifacts without any
 * external provider calls. Creates a deterministic voice_calls row with a
 * realistic outcome that renders properly in the /calls UI.
 *
 * AUTH: Dashboard user via getUser() — no Retell bearer token. RLS-scoped
 * writes ensure org isolation.
 *
 * SAFETY: No real Retell, Twilio, or Linq calls. No tenant/vendor/owner
 * contact. Purely local database artifact for UI testing.
 */

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

import { createServerClient } from '@/lib/supabase/server';
import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import { buildTestCallFixture, TEST_CALL_SCENARIOS } from '@/lib/voice/test-call-fixtures';
import type { Json } from '@/types/database';

/** 'create_work_order' → 'Create work order'. */
function humanizeAction(action: string): string {
  const spaced = action.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export async function POST(request: Request) {
  return Sentry.startSpan({ name: 'retell.test-call', op: 'http.server' }, async () => {
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // Get user's organization for RLS
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();

    if (userError || !userData?.organization_id) {
      return NextResponse.json(
        { error: 'organization not found' },
        { status: 404 }
      );
    }
    if (userData.role === 'va') {
      return NextResponse.json(
        { success: false, error: FORBIDDEN_MESSAGE },
        { status: 403 },
      );
    }

    // Optional scenario; no body / invalid → maintenance_clean (byte-compatible
    // with the existing no-body e2e call).
    const body = await request.json().catch(() => ({}));
    const scenario = z.enum(TEST_CALL_SCENARIOS).catch('maintenance_clean').parse(body?.scenario);

    const organizationId = userData.organization_id;
    const now = new Date();
    const retellCallId = `test-call-${organizationId}-${now.getTime()}`;

    const fixture = buildTestCallFixture(scenario, organizationId, retellCallId, now);
    const { session, outcome, transcript, summary } = fixture;

    // Insert the test call
    const { data: call, error: callError } = await supabase
      .from('voice_calls')
      .insert({
        organization_id: organizationId,
        retell_call_id: retellCallId,
        direction: 'inbound',
        from_number: session.fromNumber,
        to_number: session.toNumber,
        caller_kind: session.callerKind,
        tenant_id: session.tenantId,
        property_id: session.propertyId,
        unit_id: session.unitId,
        status: 'completed',
        started_at: session.startedAt,
        ended_at: outcome.endedAt,
        transcript,
        summary,
        session: session as unknown as Json,
        outcome: outcome as unknown as Json,
      })
      .select('id')
      .single();

    if (callError || !call) {
      console.error('[test-call] insert failed:', callError);
      return NextResponse.json(
        { error: 'failed to create test call' },
        { status: 500 }
      );
    }

    // Create a conversation for the call (matching real flow)
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .insert({
        organization_id: organizationId,
        channel: 'voice',
        status: 'open',
        summary,
        last_message_at: outcome.endedAt,
      })
      .select('id')
      .single();

    if (conversation && !convError) {
      // Link the conversation to the call
      await supabase
        .from('voice_calls')
        .update({ conversation_id: conversation.id })
        .eq('id', call.id);

      // Derive the message body honestly from the fixture: approximate duration,
      // one-sentence outcome, and an "Actions taken" block ONLY when the fixture
      // actually executed autonomous actions (omitted for review/privacy calls).
      const durationMs =
        new Date(outcome.endedAt).getTime() - new Date(session.startedAt).getTime();
      const durationMin = Math.max(1, Math.round(durationMs / 60000));
      const actionsBlock =
        outcome.autonomousActions.length > 0
          ? `\n\nActions taken:\n${outcome.autonomousActions
              .map((a) => `• ${humanizeAction(a.action)}`)
              .join('\n')}`
          : '';
      const messageBody = `📞 Voice call (${durationMin} minute${durationMin === 1 ? '' : 's'})\n\n${summary}${actionsBlock}\n\n---\n\nTranscript:\n${transcript}`;

      // Create the outcome message
      await supabase.from('messages').insert({
        conversation_id: conversation.id,
        organization_id: organizationId,
        direction: 'inbound',
        provider: 'retell',
        body: messageBody,
        draft_status: 'auto_sent',
        sent_at: outcome.endedAt,
      });
    }

    return NextResponse.json({
      success: true,
      callId: call.id,
      href: `/calls/${call.id}`,
      message: 'Test call created successfully',
    });
  });
}
