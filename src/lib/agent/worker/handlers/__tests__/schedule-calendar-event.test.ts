/**
 * Unit tests for handleScheduleCalendarEvent.
 *
 * Mocks:
 *   - `oauth_tokens` lookup via the chainable handler-helper mock.
 *   - The `getCalendarClient` factory via the handler's `deps`
 *     parameter, so we don't need to wire `googleapis` in the test.
 *
 * Specs:
 *   1. Happy path — calendar.events.insert called with the right body,
 *      handler returns ok with eventId + htmlLink.
 *   2. calendar_not_connected — no oauth_tokens row exists.
 *   3. calendar_not_connected — getCalendarClient returns null
 *      (row exists but client factory bailed, e.g. refresh failure
 *      surfaced as null).
 *   4. Insert error — googleapis throws, handler returns
 *      calendar_insert_failed.
 */

import { describe, expect, it, vi } from 'vitest';
import type { calendar_v3 } from 'googleapis';

import { handleScheduleCalendarEvent } from '../schedule-calendar-event';
import { ORG_ID, makeAdmin } from './__helpers';

const USER_ID = '77777777-7777-4777-8777-777777777777';

function makeFakeCalendar(
  insertImpl?: (req: unknown) => Promise<{ data: calendar_v3.Schema$Event }>,
): {
  calendar: calendar_v3.Calendar;
  insert: ReturnType<typeof vi.fn>;
} {
  const insert = vi.fn(async (req: unknown) => {
    if (insertImpl) return insertImpl(req);
    return {
      data: {
        id: 'evt_123',
        htmlLink: 'https://calendar.google.com/event?eid=evt_123',
      },
    };
  });
  const calendar = {
    events: { insert },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as calendar_v3.Calendar;
  return { calendar, insert };
}

describe('handleScheduleCalendarEvent', () => {
  const basePayload = {
    summary: 'Plumbing visit',
    description: 'Joe Plumbing to inspect leak',
    startIso: '2026-06-03T18:00:00.000Z',
    endIso: '2026-06-03T19:00:00.000Z',
    location: '17 17th St',
    attendees: ['joe@plumbing.com'],
  };

  it('books an event on the operator calendar (happy path)', async () => {
    const { admin } = makeAdmin({
      oauth_tokens: [{ data: { user_id: USER_ID }, error: null }],
    });
    const { calendar, insert } = makeFakeCalendar();

    const result = await handleScheduleCalendarEvent(
      {
        admin,
        organizationId: ORG_ID,
        payload: basePayload,
      },
      {
        getCalendarClient: vi.fn(async () => calendar),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBeCloseTo(0.95);
    expect(result.data).toMatchObject({
      eventId: 'evt_123',
      htmlLink: 'https://calendar.google.com/event?eid=evt_123',
      summary: 'Plumbing visit',
    });

    expect(insert).toHaveBeenCalledOnce();
    const arg = insert.mock.calls[0]?.[0] as {
      calendarId: string;
      requestBody: calendar_v3.Schema$Event;
    };
    expect(arg.calendarId).toBe('primary');
    expect(arg.requestBody.summary).toBe('Plumbing visit');
    expect(arg.requestBody.description).toBe('Joe Plumbing to inspect leak');
    expect(arg.requestBody.location).toBe('17 17th St');
    expect(arg.requestBody.start).toEqual({
      dateTime: '2026-06-03T18:00:00.000Z',
    });
    expect(arg.requestBody.end).toEqual({
      dateTime: '2026-06-03T19:00:00.000Z',
    });
    expect(arg.requestBody.attendees).toEqual([{ email: 'joe@plumbing.com' }]);
  });

  it('returns calendar_not_connected when no oauth_tokens row exists', async () => {
    const { admin } = makeAdmin({
      oauth_tokens: [{ data: null, error: null }],
    });
    const factory = vi.fn();

    const result = await handleScheduleCalendarEvent(
      {
        admin,
        organizationId: ORG_ID,
        payload: basePayload,
      },
      { getCalendarClient: factory },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('calendar_not_connected');
    // Factory shouldn't be called when there is no row.
    expect(factory).not.toHaveBeenCalled();
  });

  it('returns calendar_not_connected when factory returns null', async () => {
    const { admin } = makeAdmin({
      oauth_tokens: [{ data: { user_id: USER_ID }, error: null }],
    });

    const result = await handleScheduleCalendarEvent(
      {
        admin,
        organizationId: ORG_ID,
        payload: basePayload,
      },
      { getCalendarClient: vi.fn(async () => null) },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('calendar_not_connected');
  });

  it('wraps insert errors as calendar_insert_failed', async () => {
    const { admin } = makeAdmin({
      oauth_tokens: [{ data: { user_id: USER_ID }, error: null }],
    });
    const { calendar } = makeFakeCalendar(async () => {
      throw new Error('quota exceeded');
    });

    const result = await handleScheduleCalendarEvent(
      {
        admin,
        organizationId: ORG_ID,
        payload: basePayload,
      },
      { getCalendarClient: vi.fn(async () => calendar) },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('calendar_insert_failed');
    expect(result.error).toContain('quota exceeded');
  });

  it('returns calendar_insert_no_id when Google omits the event id', async () => {
    const { admin } = makeAdmin({
      oauth_tokens: [{ data: { user_id: USER_ID }, error: null }],
    });
    const { calendar } = makeFakeCalendar(async () => ({
      data: { htmlLink: 'https://x' },
    }));

    const result = await handleScheduleCalendarEvent(
      {
        admin,
        organizationId: ORG_ID,
        payload: basePayload,
      },
      { getCalendarClient: vi.fn(async () => calendar) },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('calendar_insert_no_id');
  });
});
