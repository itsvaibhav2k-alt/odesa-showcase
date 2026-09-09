/**
 * Org-level web SSE endpoint for the operator dispatcher (Wave 5).
 *
 *   POST /api/chat/assistant
 *   Body: { message: string }
 *   Response: text/event-stream — one `data: ${JSON.stringify(DispatcherEvent)}\n\n`
 *             frame per event yielded by `runOperatorDispatcher`. Stream
 *             closes after the terminal `done` event (or after a
 *             `tool.error` followed by `done` when the dispatcher crashes).
 *
 * Mirrors `/api/chat/inbox/route.ts` but invokes the dispatcher with
 * `channel: 'imessage', propertyId: null` so the chat row resolves to
 * the same `operator_chats` row that `handle-operator-inbound.ts` writes
 * to when the verified owner texts the org's Sendblue number. Net effect:
 * the dashboard `/assistant` surface and the operator's iMessage thread
 * with Odesa share a single rolling thread.
 *
 * Auth: cookie-based via `requireAuthContext()` (Supabase SSR client).
 * Database writes inside the dispatcher run through the admin client.
 *
 * Runtime: nodejs (the Claude Agent SDK requires Node, not edge).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { loadOrCreateChat } from '@/lib/agent/operator/persist';
import type { DispatcherEvent } from '@/lib/agent/operator/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({
  message: z.string().trim().min(1, 'Message is required').max(4000),
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

function encodeSseFrame(event: DispatcherEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthContext();
  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  let parsed: { message: string };
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

  const admin = createAdminClient();

  // Resolve / create the iMessage rolling chat — keyed on
  // (org, user, channel='imessage') with property_id IS NULL. This is
  // the SAME row `handle-operator-inbound.ts` writes to, so the dashboard
  // surface and the operator's iPhone iMessage thread are one thread.
  let chatId: string;
  let stampedPropertyId: string | null = null;
  try {
    const chat = await loadOrCreateChat(admin, {
      organizationId: auth.data.organizationId,
      userId: auth.data.userId,
      propertyId: null,
      channel: 'imessage',
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

  // If the chat row carries a property hint from a prior turn, look up
  // the property name so the dispatcher can render its propertyHint
  // prologue line. The lookup goes through the SSR client so RLS
  // double-checks org membership; on miss (deleted property, cross-org)
  // we drop the hint silently rather than fail the whole turn.
  let propertyHint: { id: string; name: string } | undefined;
  if (stampedPropertyId) {
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const runStartedAt = Date.now();
      console.log(`[agent-run] start route=chat/assistant chatId=${chatId} channel=imessage`);
      try {
        // Lazy import: the dispatcher statically imports the Claude
        // Agent SDK, which must never enter the Vercel static bundle
        // (check-vercel-sdk-leak guards this path).
        const { runOperatorDispatcher } = await import(
          '@/lib/agent/operator/dispatcher'
        );
        const generator = runOperatorDispatcher({
          admin,
          organizationId: auth.data.organizationId,
          userId: auth.data.userId,
          chatId,
          ...(propertyHint ? { propertyHint } : {}),
          message: parsed.message,
          channel: 'imessage',
          signal: req.signal,
        });

        for await (const event of generator) {
          controller.enqueue(encoder.encode(encodeSseFrame(event)));
        }
      } catch (err) {
        // Dispatcher promises never to throw, but belt-and-suspenders:
        // surface a synthetic tool.error + done so the client always
        // sees a clean terminal frame and clears its streaming state.
        const fallbackError: DispatcherEvent = {
          type: 'tool.error',
          name: 'sse-route',
          message: err instanceof Error ? err.message : String(err),
        };
        const fallbackDone: DispatcherEvent = {
          type: 'done',
          turnId: 'sse-route-fallback',
        };
        controller.enqueue(encoder.encode(encodeSseFrame(fallbackError)));
        controller.enqueue(encoder.encode(encodeSseFrame(fallbackDone)));
      } finally {
        console.log(`[agent-run] end route=chat/assistant chatId=${chatId} ms=${Date.now() - runStartedAt}`);
        controller.close();
      }
    },
    cancel() {
      // The browser closed the connection mid-stream. The dispatcher
      // saw the AbortSignal we wired up and is unwinding its own loop;
      // nothing to do here.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Keep proxies/CDNs from buffering. Vercel respects this header
      // for streaming responses.
      'X-Accel-Buffering': 'no',
    },
  });
}
