/**
 * Calendar MCP — `list_calendar_events` (read-only).
 *
 * Wave 7 — Stream G. Direct MCP tool exposing the operator's connected
 * Google Calendar to the dispatcher so it can peek at upcoming events
 * BEFORE proposing a new booking. Read-only by design — bookings flow
 * through `spawn_property_worker(action_type='schedule_calendar_event')`
 * so they go through the gate / proposal system like every other write.
 *
 * Behavior:
 *   - Returns up to 20 upcoming events on the operator's primary
 *     calendar between `startIso` and (optional) `endIso`.
 *   - Optional `query` filters by Google's full-text search.
 *   - When the calendar isn't connected, returns a one-line text
 *     telling the model to ask the operator to connect it. The model
 *     is then free to skip a booking attempt and tell the operator.
 *   - Output is a stable, line-per-event format (id · summary · start
 *     → end) so the model can quote ids back into a subsequent
 *     `cancel_calendar_event` spawn.
 *
 * Privacy: event ids ARE returned to the model — they are NOT a secret
 * and the operator's calendar is the operator's own data. We do not
 * include attendee email addresses unless the model already needs
 * them for narration.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { calendar_v3 } from 'googleapis';
import { z } from 'zod';

import type { Database } from '@/types/database';

import { getCalendarClient } from '@/lib/integrations/google/client';

const PROVIDER = 'google_calendar';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 20;

export interface CreateCalendarMcpDeps {
  admin: SupabaseClient<Database>;
  organizationId: string;
  /**
   * Test seam — overrides the calendar-client factory.
   */
  getCalendarClient?: (args: {
    admin: SupabaseClient<Database>;
    organizationId: string;
    userId: string;
  }) => Promise<calendar_v3.Calendar | null>;
}

/**
 * Resolve which user_id owns the org's connected calendar. Same logic
 * as the worker handler: pick the earliest-connected row.
 */
async function resolveCalendarUserId(
  admin: SupabaseClient<Database>,
  organizationId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('oauth_tokens')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('provider', PROVIDER)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.user_id;
}

export function createCalendarMcp(deps: CreateCalendarMcpDeps) {
  return createSdkMcpServer({
    name: 'odesa-operator-calendar',
    version: '0.1.0',
    // 16 tools total — always in the prompt; deferral behind ToolSearch
    // costs a full model round trip per fresh conversation.
    alwaysLoad: true,
    tools: [
      tool(
        'list_calendar_events',
        "Peek at the operator's connected Google Calendar before proposing a new booking. Read-only. Returns up to 20 events between startIso (required) and endIso (optional, defaults to +14 days).",
        {
          startIso: z
            .string()
            .datetime({ offset: true })
            .describe(
              'ISO 8601 lower bound; events ending before this are excluded.',
            ),
          endIso: z
            .string()
            .datetime({ offset: true })
            .optional()
            .describe(
              'ISO 8601 upper bound. Defaults to startIso + 14 days when omitted.',
            ),
          query: z
            .string()
            .optional()
            .describe(
              "Optional full-text search (Google's `q` param). Match summary, description, location.",
            ),
        },
        async (args) => {
          const userId = await resolveCalendarUserId(
            deps.admin,
            deps.organizationId,
          );
          if (!userId) {
            return text(
              "calendar_not_connected — ask the operator to connect Google Calendar in settings before scheduling.",
            );
          }

          const factory = deps.getCalendarClient ?? getCalendarClient;
          let calendar: calendar_v3.Calendar | null;
          try {
            calendar = await factory({
              admin: deps.admin,
              organizationId: deps.organizationId,
              userId,
            });
          } catch (err) {
            return text(
              `list_calendar_events failed: ${asMessage(err)}`,
            );
          }
          if (!calendar) {
            return text(
              "calendar_not_connected — ask the operator to connect Google Calendar in settings before scheduling.",
            );
          }

          const start = new Date(args.startIso);
          const end = args.endIso
            ? new Date(args.endIso)
            : new Date(start.getTime() + 14 * 24 * 3600 * 1000);

          let events: calendar_v3.Schema$Events;
          try {
            const { data } = await calendar.events.list({
              calendarId: 'primary',
              timeMin: start.toISOString(),
              timeMax: end.toISOString(),
              singleEvents: true,
              orderBy: 'startTime',
              maxResults: Math.min(MAX_LIMIT, DEFAULT_LIMIT),
              ...(args.query ? { q: args.query } : {}),
            });
            events = data;
          } catch (err) {
            return text(
              `list_calendar_events failed: ${asMessage(err)}`,
            );
          }

          const items = events.items ?? [];
          if (items.length === 0) {
            return text(
              `No events between ${start.toISOString()} and ${end.toISOString()}.`,
            );
          }

          const lines = items.map((ev) => describeEvent(ev));
          return text(lines.join('\n'));
        },
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeEvent(ev: calendar_v3.Schema$Event): string {
  const id = ev.id ?? '?';
  const summary = ev.summary ?? '(untitled)';
  const start = ev.start?.dateTime ?? ev.start?.date ?? '';
  const end = ev.end?.dateTime ?? ev.end?.date ?? '';
  return `${id} · ${summary} · ${start} → ${end}`;
}

function asMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function text(s: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: s }] };
}
