/**
 * Unit tests for handleCancelCalendarEvent.
 *
 * Specs: happy path, 404 → event_not_found, no row → calendar_not_connected,
 * generic error → calendar_delete_failed.
 */

import { describe, expect, it, vi } from 'vitest';
import type { calendar_v3 } from 'googleapis';

import { handleCancelCalendarEvent } from '../cancel-calendar-event';
import { ORG_ID, makeAdmin } from './__helpers';

const USER_ID = '77777777-7777-4777-8777-777777777777';

function makeFakeCalendar(deleteImpl?: (req: unknown) => Promise<void>): {
  calendar: calendar_v3.Calendar;
  del: ReturnType<typeof vi.fn>;
} {
  const del = vi.fn(async (req: unknown) => {
    if (deleteImpl) return deleteImpl(req);
    return undefined;
  });
  const calendar = {
    events: { delete: del },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as calendar_v3.Calendar;
  return { calendar, del };
}

describe('handleCancelCalendarEvent', () => {
  const payload = { eventId: 'evt_abc' };

  it('deletes a calendar event (happy path)', async () => {
    const { admin } = makeAdmin({
      oauth_tokens: [{ data: { user_id: USER_ID }, error: null }],
    });
    const { calendar, del } = makeFakeCalendar();

    const result = await handleCancelCalendarEvent(
      { admin, organizationId: ORG_ID, payload },
      { getCalendarClient: vi.fn(async () => calendar) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ eventId: 'evt_abc' });

    expect(del).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: 'evt_abc',
    });
  });

  it('returns event_not_found on 404', async () => {
    const { admin } = makeAdmin({
      oauth_tokens: [{ data: { user_id: USER_ID }, error: null }],
    });
    const notFound = Object.assign(new Error('not found'), { code: 404 });
    const { calendar } = makeFakeCalendar(async () => {
      throw notFound;
    });

    const result = await handleCancelCalendarEvent(
      { admin, organizationId: ORG_ID, payload },
      { getCalendarClient: vi.fn(async () => calendar) },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('event_not_found');
  });

  it('returns event_not_found on 410 Gone', async () => {
    const { admin } = makeAdmin({
      oauth_tokens: [{ data: { user_id: USER_ID }, error: null }],
    });
    const gone = Object.assign(new Error('gone'), {
      response: { status: 410 },
    });
    const { calendar } = makeFakeCalendar(async () => {
      throw gone;
    });

    const result = await handleCancelCalendarEvent(
      { admin, organizationId: ORG_ID, payload },
      { getCalendarClient: vi.fn(async () => calendar) },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('event_not_found');
  });

  it('returns calendar_not_connected when no oauth_tokens row exists', async () => {
    const { admin } = makeAdmin({
      oauth_tokens: [{ data: null, error: null }],
    });

    const result = await handleCancelCalendarEvent(
      { admin, organizationId: ORG_ID, payload },
      { getCalendarClient: vi.fn() },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('calendar_not_connected');
  });

  it('returns calendar_delete_failed for generic errors', async () => {
    const { admin } = makeAdmin({
      oauth_tokens: [{ data: { user_id: USER_ID }, error: null }],
    });
    const { calendar } = makeFakeCalendar(async () => {
      throw new Error('timeout');
    });

    const result = await handleCancelCalendarEvent(
      { admin, organizationId: ORG_ID, payload },
      { getCalendarClient: vi.fn(async () => calendar) },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('calendar_delete_failed');
    expect(result.error).toContain('timeout');
  });
});
