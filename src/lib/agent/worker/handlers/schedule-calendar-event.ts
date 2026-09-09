/**
 * Wave 7 — handler for `schedule_calendar_event`.
 *
 * Books a primary-calendar event on the operator's connected Google
 * Calendar. The OAuth row is owned by the operator's user_id, not the
 * organization (calendars are personal credentials). We look up the
 * org's first owner — the user who originally connected the calendar.
 * For v1 we treat each org's calendar connection as singular.
 *
 * Handler contract:
 *   - Returns `{ok:false, error:'calendar_not_connected'}` when no
 *     `oauth_tokens` row exists. The dispatcher narrates "connect
 *     Google Calendar in settings first".
 *   - Returns `{ok:true, data:{eventId, htmlLink}, confidence:0.95}` on
 *     a successful insert.
 *   - Wraps unexpected googleapis errors into stable codes so the
 *     narration layer can humanize them. Never logs raw tokens.
 *
 * Privacy: payload may carry `propertyRef` / `tenantRef` for tagging
 * back to the portfolio — but they are NOT persisted on the Google
 * event (Google has no schema for them). We could surface them in the
 * description, but the dispatcher already includes the operator's
 * intent in `summary` / `description`, so we leave the payload tags
 * alone. They're useful only as audit on the proposal row.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { calendar_v3 } from 'googleapis';

import type { Database } from '@/types/database';

import { getCalendarClient } from '@/lib/integrations/google/client';
import type { ScheduleCalendarEventPayload } from '../types';
import type { HandlerArgs, HandlerResult } from './index';

/**
 * Test seam — overrides the calendar-client factory. Production code
 * leaves this unset and the handler imports from
 * `@/lib/integrations/google/client`.
 */
export interface ScheduleCalendarEventDeps {
  getCalendarClient?: (args: {
    admin: SupabaseClient<Database>;
    organizationId: string;
    userId: string;
  }) => Promise<calendar_v3.Calendar | null>;
}

/**
 * Resolve the user_id whose OAuth row should service this org's
 * calendar bookings. v1 picks the first user in the org with a
 * `google_calendar` row. Future: store a per-org "default calendar
 * user" pointer.
 */
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

export async function handleScheduleCalendarEvent(
  args: HandlerArgs<ScheduleCalendarEventPayload>,
  deps: ScheduleCalendarEventDeps = {},
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

  const eventBody: calendar_v3.Schema$Event = {
    summary: payload.summary,
    start: { dateTime: payload.startIso },
    end: { dateTime: payload.endIso },
  };
  if (payload.description) eventBody.description = payload.description;
  if (payload.location) eventBody.location = payload.location;
  if (payload.attendees && payload.attendees.length > 0) {
    eventBody.attendees = payload.attendees.map((email) => ({ email }));
  }

  try {
    const { data: event } = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: eventBody,
    });
    if (!event?.id) {
      return {
        ok: false,
        error: 'calendar_insert_no_id',
        confidence: 0,
      };
    }
    return {
      ok: true,
      data: {
        eventId: event.id,
        htmlLink: event.htmlLink ?? null,
        summary: payload.summary,
        startIso: payload.startIso,
        endIso: payload.endIso,
      },
      confidence: 0.95,
      reasoning: `Booked '${payload.summary}' on the operator's calendar.`,
    };
  } catch (err) {
    return {
      ok: false,
      error: `calendar_insert_failed: ${asMessage(err)}`,
      confidence: 0,
    };
  }
}

function asMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
