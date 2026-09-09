/**
 * Unit tests for the daily-digest pure builders.
 *
 * Everything runs against a fixed clock / fixed fixture rows — no
 * Supabase, no Inngest. Cases: window derivation, deterministic section
 * assembly, item caps, preview truncation, and schema conformance of
 * the builder's output (the boundary contract the /today reader parses
 * against).
 */

import { describe, expect, it } from 'vitest';

import {
  buildSections,
  computeDigestWindow,
  PREVIEW_LENGTH,
  SECTION_ITEM_CAP,
  type DigestSourceRows,
} from '../build';
import { digestSectionsSchema, SECTIONS_VERSION } from '../types';

const FIXED_NOW = new Date('2026-06-11T09:30:00.000Z');

function emptyRows(): DigestSourceRows {
  return {
    rentEvents: [],
    pendingDrafts: [],
    agentRuns: [],
    workOrdersOpened: [],
    workOrdersClosed: [],
    scheduledActionsFired: [],
  };
}

function fixtureRows(): DigestSourceRows {
  return {
    rentEvents: [
      {
        id: 're-1',
        lease_id: 'lease-1',
        cycle_month: '2026-06-01',
        status: 'paid',
        amount_due: 1450,
        amount_paid: 1450,
        due_date: '2026-06-01',
        updated_at: '2026-06-11T02:10:00.000Z',
      },
    ],
    pendingDrafts: [
      {
        id: 'msg-1',
        conversation_id: 'conv-1',
        body: 'Hi Maria — confirming the plumber visit tomorrow at 9am.',
        created_at: '2026-06-11T01:00:00.000Z',
      },
    ],
    agentRuns: [
      {
        id: 'run-1',
        status: 'done',
        surface: 'web',
        message: 'Follow up on unit 3B leak',
        error: null,
        finished_at: '2026-06-11T03:00:00.000Z',
      },
      {
        id: 'run-2',
        status: 'failed',
        surface: 'imessage',
        message: 'Draft rent reminder',
        error: 'timeout',
        finished_at: '2026-06-11T04:00:00.000Z',
      },
    ],
    workOrdersOpened: [
      {
        id: 'wo-1',
        status: 'open',
        urgency: 'emergency',
        description: 'Water heater leaking in unit 3B',
        created_at: '2026-06-11T05:00:00.000Z',
      },
    ],
    workOrdersClosed: [
      {
        id: 'wo-2',
        status: 'completed',
        description: null,
        updated_at: '2026-06-10T20:00:00.000Z',
      },
    ],
    scheduledActionsFired: [
      {
        id: 'sa-1',
        status: 'fired',
        action_type: 'draft_sms_reply',
        trigger_at: '2026-06-11T08:00:00.000Z',
        fired_at: '2026-06-11T08:00:05.000Z',
      },
      {
        id: 'sa-2',
        status: 'condition_failed',
        action_type: 'draft_sms_reply',
        trigger_at: '2026-06-11T08:30:00.000Z',
        fired_at: '2026-06-11T08:30:02.000Z',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// computeDigestWindow
// ---------------------------------------------------------------------------

describe('computeDigestWindow', () => {
  it('should derive a 24h window ending at the fire instant when given a fixed clock', () => {
    const window = computeDigestWindow(FIXED_NOW);

    expect(window).toEqual({
      digestDate: '2026-06-11',
      windowStart: '2026-06-10T09:30:00.000Z',
      windowEnd: '2026-06-11T09:30:00.000Z',
    });
  });

  it('should file the digest under the UTC date of the fire instant when the window crosses midnight', () => {
    const window = computeDigestWindow(new Date('2026-07-01T00:05:00.000Z'));

    expect(window.digestDate).toBe('2026-07-01');
    expect(window.windowStart).toBe('2026-06-30T00:05:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// buildSections
// ---------------------------------------------------------------------------

describe('buildSections', () => {
  it('should fold fixture rows into the version-1 sections shape deterministically', () => {
    const sections = buildSections(fixtureRows());

    expect(sections.rent_activity.count).toBe(1);
    expect(sections.rent_activity.items[0]).toEqual({
      id: 're-1',
      lease_id: 'lease-1',
      cycle_month: '2026-06-01',
      status: 'paid',
      amount_due: 1450,
      amount_paid: 1450,
      due_date: '2026-06-01',
      updated_at: '2026-06-11T02:10:00.000Z',
    });

    expect(sections.drafts_pending.count).toBe(1);
    expect(sections.drafts_pending.items[0]?.preview).toBe(
      'Hi Maria — confirming the plumber visit tomorrow at 9am.',
    );

    expect(sections.agent_runs.done_count).toBe(1);
    expect(sections.agent_runs.failed_count).toBe(1);
    expect(sections.agent_runs.items).toHaveLength(2);
    expect(sections.agent_runs.items[1]?.error).toBe('timeout');

    expect(sections.work_orders.opened_count).toBe(1);
    expect(sections.work_orders.closed_count).toBe(1);
    expect(sections.work_orders.closed[0]?.preview).toBeNull();

    expect(sections.scheduled_actions_fired.count).toBe(2);
    expect(sections.scheduled_actions_fired.items[1]?.status).toBe(
      'condition_failed',
    );
  });

  it('should produce identical output for identical input (pure)', () => {
    expect(buildSections(fixtureRows())).toEqual(buildSections(fixtureRows()));
  });

  it('should return zero counts and empty arrays when no rows exist', () => {
    const sections = buildSections(emptyRows());

    expect(sections.rent_activity).toEqual({ count: 0, items: [] });
    expect(sections.drafts_pending).toEqual({ count: 0, items: [] });
    expect(sections.agent_runs).toEqual({
      done_count: 0,
      failed_count: 0,
      items: [],
    });
    expect(sections.work_orders).toEqual({
      opened_count: 0,
      closed_count: 0,
      opened: [],
      closed: [],
    });
    expect(sections.scheduled_actions_fired).toEqual({ count: 0, items: [] });
  });

  it('should cap stored items while keeping counts exact when rows exceed the cap', () => {
    const manyDrafts = Array.from({ length: SECTION_ITEM_CAP + 5 }, (_, i) => ({
      id: `msg-${i}`,
      conversation_id: 'conv-1',
      body: 'hello',
      created_at: '2026-06-11T01:00:00.000Z',
    }));

    const sections = buildSections({ ...emptyRows(), pendingDrafts: manyDrafts });

    expect(sections.drafts_pending.count).toBe(SECTION_ITEM_CAP + 5);
    expect(sections.drafts_pending.items).toHaveLength(SECTION_ITEM_CAP);
  });

  it('should truncate long free-text fields to the preview length', () => {
    const longBody = 'a'.repeat(PREVIEW_LENGTH * 2);
    const sections = buildSections({
      ...emptyRows(),
      pendingDrafts: [
        {
          id: 'msg-long',
          conversation_id: 'conv-1',
          body: longBody,
          created_at: '2026-06-11T01:00:00.000Z',
        },
      ],
    });

    const preview = sections.drafts_pending.items[0]?.preview ?? '';
    expect(preview.length).toBe(PREVIEW_LENGTH);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('should produce output that satisfies the version-1 zod schema', () => {
    expect(SECTIONS_VERSION).toBe(1);
    expect(() => digestSectionsSchema.parse(buildSections(fixtureRows()))).not.toThrow();
    expect(() => digestSectionsSchema.parse(buildSections(emptyRows()))).not.toThrow();
  });
});
