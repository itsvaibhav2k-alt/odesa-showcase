/**
 * Wave 7 — handler for `cancel_calendar_event`.
 *
 * Deletes a Google Calendar event from the operator's primary calendar
 * by event id. Mirrors the OAuth-row resolution from
 * schedule-calendar-event so handlers can be invoked in either order.
 *
 * Stable error codes:
 *   - `calendar_not_connected` — no OAuth row exists for the org.
 *   - `event_not_found` — Google returned 404 / 410 (already gone).
 *   - `calendar_delete_failed: <msg>` — anything else.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { calendar_v3 } from 'googleapis';

import type { Database } from '@/types/database';

import { getCalendarClient } from '@/lib/integrations/google/client';
import type { CancelCalendarEventPayload } from '../types';
import type { HandlerArgs, HandlerResult } from './index';

export interface CancelCalendarEventDeps {
  getCalendarClient?: (args: {
    admin: SupabaseClient<Database>;
    organizationId: string;
    userId: string;
  }) => Promise<calendar_v3.Calendar | null>;
}

interface ApiErrorLike {
  code?: number;
  status?: number;
  response?: { status?: number };
  message?: string;
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as ApiErrorLike;
  if (e.code === 404 || e.code === 410) return true;
  if (e.status === 404 || e.status === 410) return true;
  if (e.response?.status === 404 || e.response?.status === 410) return true;
  return false;
}

async function resolveCalendarUserId(
  admin: SupabaseClient<Database>,
  organizationId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('oauth_tokens')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('provider', 'google_calendar')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.user_id;
}

export async function handleCancelCalendarEvent(
  args: HandlerArgs<CancelCalendarEventPayload>,
  deps: CancelCalendarEventDeps = {},
): Promise<HandlerResult> {
  const { admin, organizationId, payload } = args;

  const userId = await resolveCalendarUserId(admin, organizationId);
  if (!userId) {
    return {
      ok: false,
      error: 'calendar_not_connected',
      confidence: 0,
    };
  }

  let calendar: calendar_v3.Calendar | null;
  try {
    const factory = deps.getCalendarClient ?? getCalendarClient;
    calendar = await factory({ admin, organizationId, userId });
  } catch (err) {
    return {
      ok: false,
      error: `calendar_client_failed: ${asMessage(err)}`,
      confidence: 0,
    };
  }
  if (!calendar) {
    return {
      ok: false,
      error: 'calendar_not_connected',
      confidence: 0,
    };
  }

  try {
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: payload.eventId,
    });
    return {
      ok: true,
      data: {
        eventId: payload.eventId,
      },
      confidence: 0.95,
      reasoning: `Cancelled calendar event ${payload.eventId}.`,
    };
  } catch (err) {
    if (isNotFoundError(err)) {
      return {
        ok: false,
        error: 'event_not_found',
        confidence: 0,
      };
    }
    return {
      ok: false,
      error: `calendar_delete_failed: ${asMessage(err)}`,
      confidence: 0,
    };
  }
}

function asMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
