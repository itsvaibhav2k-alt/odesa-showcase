/**
 * Unit tests for `deriveQueueStatus`.
 *
 * Exhaustively covers each branch of the priority ladder: review →
 * escalated → draft → handled. Each test uses a fixed `now` to make
 * the time-window logic deterministic.
 */
import { describe, expect, it } from 'vitest';

import type { ConversationListItem } from '@/lib/inbox/conversation-queries';
import {
  deriveQueueStatus,
  watchingStatus,
} from '@/lib/inbox/queue-status';

const NOW = Date.parse('2026-05-28T12:00:00.000Z');

function makeConv(
  overrides: Partial<ConversationListItem> = {},
): ConversationListItem {
  return {
    id: 'c1',
    tenantId: 't1',
    tenantName: 'Sample Tenant',
    unitLabel: null,
    lastMessageAt: new Date(NOW - 60_000).toISOString(),
    lastMessagePreview: 'Hi there.',
    lastMessageDirection: 'outbound',
    pendingDraftId: null,
    ...overrides,
  };
}

describe('deriveQueueStatus', () => {
  describe('review branch', () => {
    it('returns review when a pending draft exists', () => {
      const conv = makeConv({ pendingDraftId: 'd-1' });
      const out = deriveQueueStatus(conv, { now: NOW });
      expect(out).toEqual({ kind: 'review', label: 'Needs review' });
    });

    it('returns review even when a work order is also breached', () => {
      const conv = makeConv({ pendingDraftId: 'd-1' });
      const out = deriveQueueStatus(conv, {
        now: NOW,
        workOrderSlaBreached: true,
      });
      // Review wins over escalated.
      expect(out.kind).toBe('review');
    });
  });

  describe('escalated branch', () => {
    it('returns escalated when SLA breached and no pending draft', () => {
      const conv = makeConv();
      const out = deriveQueueStatus(conv, {
        now: NOW,
        workOrderSlaBreached: true,
      });
      expect(out).toEqual({ kind: 'escalated', label: 'Vendor delay' });
    });

    it('returns escalated even when inbound is recent', () => {
      const conv = makeConv({
        lastMessageDirection: 'inbound',
        lastMessageAt: new Date(NOW - 2 * 60_000).toISOString(),
      });
      const out = deriveQueueStatus(conv, {
        now: NOW,
        workOrderSlaBreached: true,
      });
      // Escalated wins over draft.
      expect(out.kind).toBe('escalated');
    });
  });

  describe('draft branch', () => {
    it('returns draft for recent inbound (within default 15m window)', () => {
      const conv = makeConv({
        lastMessageDirection: 'inbound',
        lastMessageAt: new Date(NOW - 5 * 60_000).toISOString(),
      });
      const out = deriveQueueStatus(conv, { now: NOW });
      expect(out).toEqual({ kind: 'draft', label: 'Draft pending' });
    });

    it('respects a custom draftWindowMinutes', () => {
      const conv = makeConv({
        lastMessageDirection: 'inbound',
        lastMessageAt: new Date(NOW - 20 * 60_000).toISOString(),
      });
      const out = deriveQueueStatus(conv, {
        now: NOW,
        draftWindowMinutes: 30,
      });
      expect(out.kind).toBe('draft');
    });

    it('does not classify outbound recent messages as draft', () => {
      const conv = makeConv({
        lastMessageDirection: 'outbound',
        lastMessageAt: new Date(NOW - 1 * 60_000).toISOString(),
      });
      const out = deriveQueueStatus(conv, { now: NOW });
      expect(out.kind).toBe('handled');
    });

    it('treats future-dated inbound (clock skew) as recent', () => {
      const conv = makeConv({
        lastMessageDirection: 'inbound',
        // 30 seconds in the future
        lastMessageAt: new Date(NOW + 30_000).toISOString(),
      });
      const out = deriveQueueStatus(conv, { now: NOW });
      expect(out.kind).toBe('draft');
    });
  });

  describe('handled branch', () => {
    it('returns handled for stale inbound (outside the window)', () => {
      const conv = makeConv({
        lastMessageDirection: 'inbound',
        lastMessageAt: new Date(NOW - 60 * 60_000).toISOString(),
      });
      const out = deriveQueueStatus(conv, { now: NOW });
      expect(out).toEqual({ kind: 'handled', label: 'Odesa handled' });
    });

    it('returns handled when the last message is outbound', () => {
      const conv = makeConv({ lastMessageDirection: 'outbound' });
      const out = deriveQueueStatus(conv, { now: NOW });
      expect(out.kind).toBe('handled');
    });

    it('returns handled when ctx is omitted entirely', () => {
      const conv = makeConv({ lastMessageDirection: 'outbound' });
      const out = deriveQueueStatus(conv);
      expect(out.kind).toBe('handled');
    });
  });

  describe('edge cases', () => {
    it('returns handled when lastMessageAt is empty', () => {
      const conv = makeConv({
        lastMessageDirection: 'inbound',
        lastMessageAt: '',
      });
      const out = deriveQueueStatus(conv, { now: NOW });
      expect(out.kind).toBe('handled');
    });

    it('returns handled when lastMessageAt is unparseable', () => {
      const conv = makeConv({
        lastMessageDirection: 'inbound',
        lastMessageAt: 'not-a-date',
      });
      const out = deriveQueueStatus(conv, { now: NOW });
      expect(out.kind).toBe('handled');
    });
  });

  describe('watchingStatus', () => {
    it('returns the watching kind + label', () => {
      expect(watchingStatus()).toEqual({
        kind: 'watching',
        label: 'Watching',
      });
    });
  });
});
