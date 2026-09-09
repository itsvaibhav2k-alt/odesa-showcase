/**
 * Calendar MCP — `list_calendar_events`.
 *
 * Specs: happy path returns formatted lines; calendar_not_connected
 * narration when no oauth_tokens row exists.
 */

import { describe, expect, it, vi } from 'vitest';
import type { calendar_v3 } from 'googleapis';

import { createCalendarMcp } from '../calendar';
import { ORG_ID, makeAdmin } from '@/lib/agent/worker/handlers/__tests__/__helpers';

const USER_ID = '77777777-7777-4777-8777-777777777777';

interface ToolDefShape {
  name?: string;
  handler: (
    args: Record<string, unknown>,
    extra: unknown,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}
interface McpServerShape {
  instance?: { _registeredTools?: Record<string, ToolDefShape> };
  tools?: ToolDefShape[];
}

function getHandler(server: unknown, name: string): ToolDefShape['handler'] {
  const s = server as McpServerShape;
  return (
    s.instance?._registeredTools?.[name]?.handler ??
    s.tools?.find((t) => t.name === name)?.handler ??
    (() => {
      throw new Error(`${name} handler not found`);
    })()
  );
}

function makeFakeCalendar(items: calendar_v3.Schema$Event[]): {
  calendar: calendar_v3.Calendar;
  list: ReturnType<typeof vi.fn>;
} {
  const list = vi.fn(async () => ({ data: { items } }));
  const calendar = {
    events: { list },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as calendar_v3.Calendar;
  return { calendar, list };
}

describe('calendar MCP — list_calendar_events', () => {
  it('returns a numbered list of upcoming events (happy path)', async () => {
    const { admin } = makeAdmin({
      oauth_tokens: [{ data: { user_id: USER_ID }, error: null }],
    });
    const { calendar, list } = makeFakeCalendar([
      {
        id: 'evt_a',
        summary: 'Plumbing visit',
        start: { dateTime: '2026-06-03T18:00:00Z' },
        end: { dateTime: '2026-06-03T19:00:00Z' },
      },
      {
        id: 'evt_b',
        summary: 'Showing — unit 2',
        start: { dateTime: '2026-06-05T14:00:00Z' },
        end: { dateTime: '2026-06-05T15:00:00Z' },
      },
    ]);

    const server = createCalendarMcp({
      admin,
      organizationId: ORG_ID,
      getCalendarClient: vi.fn(async () => calendar),
    });

    const handler = getHandler(server, 'list_calendar_events');
    const result = await handler(
      {
        startIso: '2026-06-01T00:00:00.000Z',
        endIso: '2026-06-30T00:00:00.000Z',
      },
      {},
    );

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: 'primary',
        timeMin: '2026-06-01T00:00:00.000Z',
        timeMax: '2026-06-30T00:00:00.000Z',
        singleEvents: true,
        orderBy: 'startTime',
      }),
    );

    const text = result.content[0]?.text ?? '';
    expect(text).toContain('evt_a');
    expect(text).toContain('Plumbing visit');
    expect(text).toContain('evt_b');
    expect(text).toContain('Showing — unit 2');
  });

  it('returns calendar_not_connected text when no oauth row exists', async () => {
    const { admin } = makeAdmin({
      oauth_tokens: [{ data: null, error: null }],
    });
    const factory = vi.fn();

    const server = createCalendarMcp({
      admin,
      organizationId: ORG_ID,
      getCalendarClient: factory,
    });
    const handler = getHandler(server, 'list_calendar_events');
    const result = await handler(
      { startIso: '2026-06-01T00:00:00.000Z' },
      {},
    );

    const text = result.content[0]?.text ?? '';
    expect(text).toContain('calendar_not_connected');
    expect(factory).not.toHaveBeenCalled();
  });

  it('returns a friendly empty-state line when Google returns no events', async () => {
    const { admin } = makeAdmin({
      oauth_tokens: [{ data: { user_id: USER_ID }, error: null }],
    });
    const { calendar } = makeFakeCalendar([]);

    const server = createCalendarMcp({
      admin,
      organizationId: ORG_ID,
      getCalendarClient: vi.fn(async () => calendar),
    });
    const handler = getHandler(server, 'list_calendar_events');
    const result = await handler(
      { startIso: '2026-06-01T00:00:00.000Z' },
      {},
    );

    const text = result.content[0]?.text ?? '';
    expect(text.toLowerCase()).toContain('no events');
  });
});
