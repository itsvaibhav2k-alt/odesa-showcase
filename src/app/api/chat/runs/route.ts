/**
 * Durable web-chat enqueue endpoint (Phase B — behind NEXT_PUBLIC_DURABLE_CHAT).
 *
 *   POST /api/chat/runs
 *   Body: { message: string, propertyId?: string }
 *   Response: 202 { success: true, data: { runId, chatId, turnId } }
 *
 * Instead of driving the operator dispatcher inside the HTTP request
 * (the SSE routes — a browser refresh aborts the run mid-tool), this
 * route only records durable intent: it resolves the chat row, mints a
 * turn_id, inserts an `agent_runs(status='queued')` row, and fires the
 * `odesa/operator-run.requested` Inngest event. The run executes in
 * `executeAgentRun` (src/lib/agent/operator/run-executor.ts); delivery
 * back to the browser is Supabase realtime on `operator_chat_turns` +
 * `agent_runs` (DB state is canonical, realtime is only delivery).
 *
 * Chat-row keying preserves the EXACT keys the SSE routes use today:
 *   - propertyId present → the per-property thread:
 *       loadOrCreateChat({ propertyId, channel: 'web' })
 *       (mirrors /api/chat/property/[id])
 *   - propertyId absent  → the org-level assistant thread, shared with
 *     the operator's iMessage thread:
 *       loadOrCreateChat({ propertyId: null, channel: 'imessage' })
 *       (mirrors /api/chat/assistant)
 *
 * LOCAL FALLBACK: when the Inngest event key is absent AND we are not
 * in production AND DURABLE_CHAT_REQUIRE_INNGEST !== 'true', the run is
 * driven via `after()` in this same process instead of `inngest.send`.
 * Same DB lifecycle (claim → heartbeat → fenced finalize) — the
 * agent_runs row is never bypassed. Production never falls back inline.
 *
 *   GET /api/chat/runs?runId=<id>
 *   Response: 200 { success: true, data: { runId, status, replyText, error } }
 *
 * Lightweight org-scoped status read — the client's polling fallback
 * when realtime delivery has not been observed.
 */

import { NextResponse, after, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { appendTurn, loadOrCreateChat } from '@/lib/agent/operator/persist';
import {
  DURABLE_RUN_FAILURE_REPLY,
  persistCanonicalAssistantTurn,
} from '@/lib/agent/operator/run-projection';
import { inngest } from '@/lib/inngest/client';
// Event name comes from the dependency-free events module — importing
// it from functions/run-operator-dispatcher would statically pull
// run-executor + the Claude Agent SDK into this Vercel function.
import { RUN_OPERATOR_DISPATCHER_EVENT } from '@/lib/inngest/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PG_UNIQUE_VIOLATION = '23505';

const bodySchema = z.object({
  message: z.string().trim().min(1, 'Message is required').max(4000),
  propertyId: z.string().trim().min(1).optional(),
  submissionId: z.string().trim().min(1).max(200).optional(),
});

interface AuthContext {
  userId: string;
  organizationId: string;
}

type AuthContextResult =
  | { success: true; data: AuthContext }
  | { success: false; error: string; status: 401 | 403 };

async function requireAuthContext(): Promise<AuthContextResult> {
  const supabase = await createServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Not authenticated', status: 401 };
  }

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (userErr || !userRow) {
    return { success: false, error: 'User profile not found', status: 401 };
  }
  if (userRow.role !== 'owner') {
    return { success: false, error: 'Owner access required', status: 403 };
  }

  return {
    success: true,
    data: { userId: user.id, organizationId: userRow.organization_id },
  };
}

/**
 * The local inline fallback is allowed only when Inngest is not
 * configured, we are NOT in production, and the operator has not
 * explicitly required Inngest. Production never executes runs inline.
 */
function canFallBackInline(): boolean {
  return (
    !process.env.INNGEST_EVENT_KEY &&
    process.env.NODE_ENV !== 'production' &&
    process.env.DURABLE_CHAT_REQUIRE_INNGEST !== 'true'
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthContext();
  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  let parsed: { message: string; propertyId?: string; submissionId?: string };
  try {
    const json = (await req.json()) as unknown;
    const result = bodySchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error.issues[0]?.message ?? 'Invalid body' },
        { status: 400 },
      );
    }
    parsed = result.data;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  // Property ownership is RLS-enforced when the caller hits the page.
  // The executor uses the admin client, so we double-check ownership
  // here to prevent a cross-org POST against a known property id
  // (lifted from /api/chat/property/[id]).
  let verifiedProperty: { id: string; name: string } | null = null;
  if (parsed.propertyId) {
    const supabase = await createServerClient();
    const { data: property, error: propertyErr } = await supabase
      .from('properties')
      .select('id, name')
      .eq('id', parsed.propertyId)
      .maybeSingle();

    if (propertyErr) {
      return NextResponse.json(
        { success: false, error: propertyErr.message },
        { status: 500 },
      );
    }
    if (!property) {
      return NextResponse.json(
        { success: false, error: 'Property not found' },
        { status: 404 },
      );
    }
    verifiedProperty = { id: property.id, name: property.name };
  }

  const admin = createAdminClient();

  // Resolve the chat row with the EXACT keying the SSE routes use:
  // per-property → (propertyId, channel 'web'); assistant → the
  // org-level rolling iMessage thread (propertyId null, channel
  // 'imessage') shared with the operator's phone.
  const channel = verifiedProperty ? ('web' as const) : ('imessage' as const);
  let chatId: string;
  let stampedPropertyId: string | null = null;
  try {
    const chat = await loadOrCreateChat(admin, {
      organizationId: auth.data.organizationId,
      userId: auth.data.userId,
      propertyId: verifiedProperty ? verifiedProperty.id : null,
      channel,
    });
    chatId = chat.id;
    stampedPropertyId = chat.property_id;
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to load chat',
      },
      { status: 500 },
    );
  }

  // Snapshot the property hint onto the run row so the executor can
  // rebuild the dispatcher's propertyHint without re-querying. For the
  // assistant thread the hint is whatever property a prior turn stamped
  // on the chat row (same lookup /api/chat/assistant does — RLS-checked
  // via the SSR client; on miss we drop the hint, not the turn).
  let propertyHint: { id: string; name: string } | null = verifiedProperty;
  if (!propertyHint && stampedPropertyId) {
    const supabase = await createServerClient();
    const { data: property } = await supabase
      .from('properties')
      .select('id, name')
      .eq('id', stampedPropertyId)
      .maybeSingle();
    if (property) {
      propertyHint = { id: property.id, name: property.name };
    }
  }

  // The browser mints this once per submit attempt. Replays reuse it so the
  // unique web (organization_id, user_id, turn_id) index prevents a completed
  // turn from running again even if concurrent first requests raced and created
  // different chat rows. Older callers may omit it and retain server-minted
  // behavior.
  const turnId = parsed.submissionId ?? crypto.randomUUID();

  const { data: run, error: insertError } = await admin
    .from('agent_runs')
    .insert({
      organization_id: auth.data.organizationId,
      user_id: auth.data.userId,
      chat_id: chatId,
      turn_id: turnId,
      surface: 'web',
      channel,
      message: parsed.message,
      property_hint: propertyHint,
      status: 'queued',
    })
    .select()
    .single();

  if (insertError || !run) {
    // A 23505 can be either an exact submission replay or a different active
    // turn occupying the one-active-run-per-chat index. Resolve the stable web
    // submission key first; chat_id is deliberately absent because concurrent
    // first-thread creation can produce two chat rows. Only the same logical
    // request is an idempotent success.
    if (insertError?.code === PG_UNIQUE_VIOLATION) {
      const { data: existing } = await admin
        .from('agent_runs')
        .select('id, chat_id, turn_id, message')
        .eq('organization_id', auth.data.organizationId)
        .eq('user_id', auth.data.userId)
        .eq('turn_id', turnId)
        .eq('surface', 'web')
        .maybeSingle();
      if (existing) {
        if (existing.message !== parsed.message) {
          return NextResponse.json(
            {
              success: false,
              error: 'This submission identifier was already used for a different message',
            },
            { status: 409 },
          );
        }
        return NextResponse.json(
          {
            success: true,
            data: {
              runId: existing.id,
              chatId: existing.chat_id,
              turnId: existing.turn_id,
              duplicate: true,
            },
          },
          { status: 202 },
        );
      }
      return NextResponse.json(
        {
          success: false,
          error: 'Odesa is already working on this thread',
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: insertError?.message ?? 'Failed to queue agent run',
      },
      { status: 500 },
    );
  }

  // Persist the operator's message before handing work to the background
  // worker. A lost event or never-started worker must still leave a durable,
  // refresh-safe record of what the owner asked. The executor tells the
  // dispatcher this row already exists so it is never duplicated.
  try {
    await appendTurn(admin, {
      chatId,
      organizationId: auth.data.organizationId,
      turnId,
      role: 'user',
      body: parsed.message,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { data: failed, error: failError } = await admin
      .from('agent_runs')
      .update({
        status: 'failed',
        error: `user turn persistence failed: ${message}`,
        reply_text: DURABLE_RUN_FAILURE_REPLY,
        finished_at: new Date().toISOString(),
      })
      .eq('id', run.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle();
    if (failError || !failed) {
      console.error(
        `[chat-runs] user turn and failure persistence failed for run ${run.id}: ${failError?.message ?? 'fence missed'}`,
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: 'Odesa could not safely record this request. Refresh before trying again.',
      },
      { status: 500 },
    );
  }

  if (canFallBackInline()) {
    // Local dev without Inngest: drive the executor after the response
    // flushes. Same agent_runs lifecycle — never bypassed. The dynamic
    // import is load-bearing: `canFallBackInline()` is always false in
    // production, so the Agent SDK chain behind run-executor is never
    // loaded (or bundled) into this Vercel function.
    after(async () => {
      try {
        const { executeAgentRun } = await import(
          '@/lib/agent/operator/run-executor'
        );
        await executeAgentRun(run.id);
      } catch (err) {
        console.error(
          `[chat-runs] inline fallback failed for run ${run.id}:`,
          err,
        );
      }
    });
  } else {
    try {
      await inngest.send({
        name: RUN_OPERATOR_DISPATCHER_EVENT,
        data: { runId: run.id, chatId },
      });
    } catch (err) {
      // A queued row that will never start would block this chat (the
      // partial unique index) until the watchdog clears it — fail the
      // run now so the operator can immediately retry.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[chat-runs] enqueue failed for run ${run.id}: ${message}`);
      const { data: failed, error: failError } = await admin
        .from('agent_runs')
        .update({
          status: 'failed',
          error: `enqueue failed: ${message}`,
          reply_text: DURABLE_RUN_FAILURE_REPLY,
          finished_at: new Date().toISOString(),
        })
        .eq('id', run.id)
        .eq('status', 'queued')
        .select('id, organization_id, chat_id, turn_id')
        .maybeSingle();
      if (failError || !failed) {
        console.error(
          `[chat-runs] enqueue failure could not be recorded for run ${run.id}: ${failError?.message ?? 'fence missed'}`,
        );
        return NextResponse.json(
          {
            success: false,
            error: 'Odesa could not start this request. Refresh before trying again.',
          },
          { status: 500 },
        );
      }
      try {
        await persistCanonicalAssistantTurn(
          admin,
          failed,
          DURABLE_RUN_FAILURE_REPLY,
        );
      } catch (projectionError) {
        console.error(
          `[chat-runs] enqueue failure projection failed for run ${run.id}:`,
          projectionError,
        );
      }
      return NextResponse.json(
        {
          success: false,
          error: 'Odesa could not start this request. It is recorded as failed.',
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(
    { success: true, data: { runId: run.id, chatId, turnId } },
    { status: 202 },
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireAuthContext();
  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  const runId = req.nextUrl.searchParams.get('runId');
  if (!runId) {
    return NextResponse.json(
      { success: false, error: 'runId is required' },
      { status: 400 },
    );
  }

  // SSR client → agent_runs RLS is org-scoped; the explicit
  // organization_id filter is defense-in-depth on top of it.
  const supabase = await createServerClient();
  const { data: run, error } = await supabase
    .from('agent_runs')
    .select('id, status, reply_text, error')
    .eq('id', runId)
    .eq('organization_id', auth.data.organizationId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
  if (!run) {
    return NextResponse.json(
      { success: false, error: 'Run not found' },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      runId: run.id,
      status: run.status,
      replyText: run.reply_text,
      // Detailed errors stay in the durable audit row/logs. This endpoint is
      // customer-facing polling state and must not expose provider/tool names.
      error:
        run.status === 'failed'
          ? 'Odesa could not finish this request.'
          : null,
    },
  });
}
