import { describe, it, expect } from 'vitest';
import {
  getMockQueueItems,
  getRowContextTable,
  urgentItemToQueueItem,
} from '@/lib/today/queue-adapter';
import type { UrgentItem } from '@/lib/today/queries';

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function makeUrgentItem(overrides: Partial<UrgentItem> = {}): UrgentItem {
  return {
    id: 'urgent-1',
    kind: 'conversation',
    tenantName: null,
    unitLabel: null,
    statusLabel: '',
    ageAnchor: '2026-05-26T12:00:00Z',
    href: '/inbox?conversation=urgent-1',
    channel: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// urgentItemToQueueItem — kind → channel mapping
// ---------------------------------------------------------------------

describe('urgentItemToQueueItem', () => {
  describe('kind → channel mapping', () => {
    it('should map kind=rent to channel=rent without inventing a draft', () => {
      // Arrange
      const item = makeUrgentItem({
        id: 'r1',
        kind: 'rent',
        tenantName: 'A tenant',
        statusLabel: '5 days late',
        href: '/inbox?rent=r1',
        channel: null,
      });

      // Act
      const result = urgentItemToQueueItem(item);

      // Assert
      expect(result.channel).toBe('rent');
      expect(result.status).toBe('waiting');
    });

    it('should map an emergency work order to an escalated source status', () => {
      const item = makeUrgentItem({
        id: 'w1',
        kind: 'work_order',
        statusLabel: 'Emergency repair',
        urgency: 'emergency',
        unitLabel: '3B',
        href: '/inbox?work_order=w1',
        channel: null,
      });

      const result = urgentItemToQueueItem(item);

      expect(result.channel).toBe('maintenance');
      expect(result.status).toBe('escalated');
    });

    it('should map kind=conversation with channel=vendor to channel=vendor', () => {
      const item = makeUrgentItem({
        id: 'c1',
        kind: 'conversation',
        statusLabel: 'Open reply',
        channel: 'vendor',
      });

      const result = urgentItemToQueueItem(item);

      expect(result.channel).toBe('vendor');
    });

    it("should default conversation channel to 'inbox' when channel is sms/email/voice/unknown", () => {
      const item = makeUrgentItem({
        id: 'c2',
        kind: 'conversation',
        statusLabel: 'Open reply',
        tenantName: 'A tenant',
        channel: 'sms',
      });

      const result = urgentItemToQueueItem(item);

      expect(result.channel).toBe('inbox');
    });

    it('should mark conversation with "escalated" status label as escalated', () => {
      const item = makeUrgentItem({
        id: 'c3',
        kind: 'conversation',
        statusLabel: 'Escalated',
        tenantName: 'A tenant',
        channel: 'sms',
      });

      const result = urgentItemToQueueItem(item);

      expect(result.status).toBe('escalated');
    });

    it('should still return a row (never null) for an otherwise-bare conversation', () => {
      const item = makeUrgentItem({
        id: 'mystery',
        kind: 'conversation',
        statusLabel: 'Open reply',
        channel: 'sms',
      });

      const result = urgentItemToQueueItem(item);

      expect(result.id).toBe('mystery');
      expect(result.channel).toBe('inbox');
    });

    it('should return a row for any rent tenant (no demo allow-list)', () => {
      const item = makeUrgentItem({
        id: 'r-unknown',
        kind: 'rent',
        tenantName: 'Anyone At All',
        statusLabel: '3 days late',
        channel: null,
      });

      const result = urgentItemToQueueItem(item);
      expect(result.channel).toBe('rent');
      expect(result.tenant).toBe('Anyone At All');
    });

    it('should return a row for any work order (no leak substring needed)', () => {
      const item = makeUrgentItem({
        id: 'w-misc',
        kind: 'work_order',
        statusLabel: 'Open work order',
        rawStatus: 'open',
        channel: null,
      });

      const result = urgentItemToQueueItem(item);
      expect(result.channel).toBe('maintenance');
    });
  });

  // -------------------------------------------------------------------
  // QueueItem completeness — generic context, derived from the live row
  // -------------------------------------------------------------------

  describe('completeness', () => {
    it.each([
      ['work_order with unit', { kind: 'work_order' as const, statusLabel: 'Emergency repair', urgency: 'emergency' as const, unitLabel: '3B' }],
      ['rent with tenant', { kind: 'rent' as const, tenantName: 'A tenant', statusLabel: '5 days late', rawStatus: 'late_7' }],
      ['vendor conversation', { kind: 'conversation' as const, statusLabel: 'Open reply', channel: 'vendor' }],
      ['inbox conversation', { kind: 'conversation' as const, statusLabel: 'Open reply', tenantName: 'A tenant', channel: 'sms' }],
      ['bare conversation', { kind: 'conversation' as const, statusLabel: 'Open reply', channel: 'sms' }],
    ])('should produce a complete QueueItem for %s', (_label, overrides) => {
      const item = makeUrgentItem(overrides as Partial<UrgentItem>);
      const result = urgentItemToQueueItem(item);

      expect(result.id).toBeTruthy();
      expect(result.status).toBeTruthy();
      expect(result.title).toBeTruthy();
      expect(result.channel).toBeTruthy();
      expect(result.contextLabel).toBeTruthy();
      expect(result.contextSuggestions).toHaveLength(4);
      expect(result.contextPlaceholder).toBeTruthy();
      expect(result.linkedLabel).toBeTruthy();
      expect(result.primaryAction.label).toBeTruthy();
      // href is threaded through the primary action handler.
      expect(result.primaryAction.handler).toBe(item.href);
    });

    it('should never read demo strings (no Greene/Sandra/Maple leakage)', () => {
      const item = makeUrgentItem({
        kind: 'conversation',
        statusLabel: 'Open reply',
        channel: 'sms',
      });
      const result = urgentItemToQueueItem(item);
      const blob = JSON.stringify(result).toLowerCase();
      for (const demo of ['sandra', 'greene', 'maple', 'priya', 'marcus', 'cedar', 'lockbox']) {
        expect(blob).not.toContain(demo);
      }
    });
  });

  // -------------------------------------------------------------------
  // Operational output — event-first title, ref-first meta, boundaries
  // -------------------------------------------------------------------

  describe('operational output', () => {
    it('should use an event-first title for late rent (not the status label)', () => {
      const item = makeUrgentItem({
        kind: 'rent',
        tenantName: 'A tenant',
        statusLabel: '7 days late',
        rawStatus: 'late_7',
      });

      const result = urgentItemToQueueItem(item);

      expect(result.title).toBe('Late rent');
    });

    it("should title escalated rent as 'Rent escalation'", () => {
      const item = makeUrgentItem({
        kind: 'rent',
        statusLabel: 'Escalated',
        rawStatus: 'escalated',
      });

      expect(urgentItemToQueueItem(item).title).toBe('Rent escalation');
    });

    it("should title an emergency work order as 'Emergency repair'", () => {
      const item = makeUrgentItem({
        kind: 'work_order',
        statusLabel: 'Emergency repair',
        urgency: 'emergency',
      });

      expect(urgentItemToQueueItem(item).title).toBe('Emergency repair');
    });

    it("should title a non-emergency work order as 'Open work order'", () => {
      const item = makeUrgentItem({
        kind: 'work_order',
        statusLabel: 'Open work order',
        urgency: 'urgent',
        rawStatus: 'open',
      });

      expect(urgentItemToQueueItem(item).title).toBe('Open work order');
    });

    it("should title an escalated conversation as 'Escalated thread'", () => {
      const item = makeUrgentItem({
        kind: 'conversation',
        statusLabel: 'Escalated',
        rawStatus: 'escalated',
        channel: 'sms',
      });

      expect(urgentItemToQueueItem(item).title).toBe('Escalated thread');
    });

    it("should title a waiting conversation as 'Tenant message awaiting reply'", () => {
      const item = makeUrgentItem({
        kind: 'conversation',
        statusLabel: 'Waiting on reply',
        channel: 'sms',
      });

      expect(urgentItemToQueueItem(item).title).toBe('Tenant message awaiting reply');
    });

    it('should build ref-first rent meta with unpaid balance and due date', () => {
      const item = makeUrgentItem({
        kind: 'rent',
        tenantName: 'A tenant',
        unitLabel: '1',
        statusLabel: '7 days late',
        rawStatus: 'late_7',
        dueDate: '2026-04-21',
        amountDueCents: 295000,
        amountPaidCents: 0,
      });

      const result = urgentItemToQueueItem(item);

      expect(result.meta).toEqual([
        'A tenant',
        'Unit 1',
        '$2,950 unpaid',
        'Due Apr 21',
      ]);
    });

    it('should omit the unpaid token when the balance is not positive', () => {
      const item = makeUrgentItem({
        kind: 'rent',
        tenantName: 'A tenant',
        statusLabel: '3 days late',
        rawStatus: 'late_3',
        dueDate: '2026-04-21',
        amountDueCents: 100000,
        amountPaidCents: 100000,
      });

      const result = urgentItemToQueueItem(item);

      expect(result.meta).not.toContain('$0 unpaid');
      expect(result.meta).toContain('Due Apr 21');
    });

    it('should omit money/date tokens when rent amounts are absent', () => {
      const item = makeUrgentItem({
        kind: 'rent',
        tenantName: 'A tenant',
        statusLabel: '3 days late',
        rawStatus: 'late_3',
      });

      const result = urgentItemToQueueItem(item);

      expect(result.meta).toEqual(['A tenant']);
    });

    it('should tag an emergency work order in meta and report its date', () => {
      const item = makeUrgentItem({
        kind: 'work_order',
        unitLabel: '3B',
        statusLabel: 'Emergency repair',
        urgency: 'emergency',
        ageAnchor: '2026-04-21T12:00:00Z',
      });

      const result = urgentItemToQueueItem(item);

      expect(result.meta).toEqual(['Unit 3B', 'Emergency', 'Reported Apr 21']);
    });

    it('should set a specific primary-action label per kind, handler = href', () => {
      const rent = urgentItemToQueueItem(
        makeUrgentItem({ kind: 'rent', href: '/review/rent/r1' }),
      );
      const wo = urgentItemToQueueItem(
        makeUrgentItem({ kind: 'work_order', href: '/review/work_order/w1' }),
      );
      const convo = urgentItemToQueueItem(
        makeUrgentItem({ kind: 'conversation', channel: 'sms', href: '/review/conversation/c1' }),
      );

      expect(rent.primaryAction).toEqual({ label: 'Open rent record', handler: '/review/rent/r1' });
      expect(wo.primaryAction).toEqual({ label: 'Open work order', handler: '/review/work_order/w1' });
      expect(convo.primaryAction).toEqual({ label: 'Open thread', handler: '/review/conversation/c1' });
    });

    it('should populate boundary/disclosure fields and source link per kind', () => {
      const rent = urgentItemToQueueItem(
        makeUrgentItem({ kind: 'rent', href: '/review/rent/r1' }),
      );

      expect(rent.nextStep).toBe('No tenant-facing action is recorded from this source item.');
      expect(rent.ownerRule).toBe('Source record · commitments in Owner Queue');
      expect(rent.reason).toContain('current Rent record');
      expect(rent.sourceLabel).toBe('View ledger');
      expect(rent.sourceHref).toBe('/review/rent/r1');

      const wo = urgentItemToQueueItem(makeUrgentItem({ kind: 'work_order' }));
      expect(wo.ownerRule).toBe('Source record · commitments in Owner Queue');
      expect(wo.sourceLabel).toBe('View work order');

      const convo = urgentItemToQueueItem(
        makeUrgentItem({ kind: 'conversation', channel: 'sms' }),
      );
      expect(convo.sourceLabel).toBe('View thread');
      expect(convo.ownerRule).toBe('Source record · commitments in Owner Queue');
    });

    it('should ground the recommendation deterministically (no implied tone/rule data)', () => {
      const rent = urgentItemToQueueItem(makeUrgentItem({ kind: 'rent' }));
      expect(rent.recommendation).toBe(
        'Current Rent record shows an unpaid balance — open the ledger for source evidence.',
      );
    });

    it('does not turn source rows into unproven automation artifacts', () => {
      const rows = [
        urgentItemToQueueItem(makeUrgentItem({ kind: 'rent' })),
        urgentItemToQueueItem(makeUrgentItem({ kind: 'work_order' })),
        urgentItemToQueueItem(
          makeUrgentItem({ kind: 'conversation', channel: 'vendor' }),
        ),
      ];
      const copy = JSON.stringify(rows).toLowerCase();

      expect(copy).not.toContain('reminder sends');
      expect(copy).not.toContain('approval required');
      expect(copy).not.toContain('vendor notified');
      expect(copy).not.toContain('drafted reply');
    });
  });

  // -------------------------------------------------------------------
  // Timestamp semantics — relative for recent, absolute for stale
  // -------------------------------------------------------------------

  describe('relativeTimestamp', () => {
    it('should read minutes for recent items', () => {
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const result = urgentItemToQueueItem(
        makeUrgentItem({ kind: 'conversation', channel: 'sms', ageAnchor: tenMinAgo }),
      );
      expect(result.timestamp).toBe('10m ago');
    });

    it("should read 'yesterday' between 24h and 48h", () => {
      const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
      const result = urgentItemToQueueItem(
        makeUrgentItem({ kind: 'conversation', channel: 'sms', ageAnchor: thirtyHoursAgo }),
      );
      expect(result.timestamp).toBe('yesterday');
    });

    it('should read an ABSOLUTE short date for items older than 48h', () => {
      const result = urgentItemToQueueItem(
        makeUrgentItem({ kind: 'conversation', channel: 'sms', ageAnchor: '2026-04-21T12:00:00Z' }),
      );
      // No "Nd ago" growth — stale rows read as a calendar date.
      expect(result.timestamp).toBe('Apr 21');
      expect(result.timestamp).not.toMatch(/ago$/);
    });
  });
});

// ---------------------------------------------------------------------
// ROW_CONTEXT snapshot — catches accidental copy edits
// ---------------------------------------------------------------------

describe('ROW_CONTEXT', () => {
  it('should match the verbatim 5-row context table from ref-context-map', () => {
    expect(getRowContextTable()).toMatchInlineSnapshot(`
      {
        "leak": {
          "channel": "maintenance",
          "contextLabel": "leak escalation",
          "contextPlaceholder": "Ask about the Unit 3B leak…",
          "contextSuggestions": [
            "Explain why Greene Plumbing",
            "Draft tenant update for Unit 3B",
            "Compare vendor quotes",
            "What happens if I snooze this?",
          ],
          "linkedLabel": "leak escalation",
        },
        "lockbox": {
          "channel": "vendor",
          "contextLabel": "lockbox rotation",
          "contextPlaceholder": "Ask about the lockbox rotation…",
          "contextSuggestions": [
            "Show the rotation log",
            "Which vendors got new codes?",
            "When is the next rotation?",
            "Audit access changes",
          ],
          "linkedLabel": "lockbox rotation",
        },
        "noise": {
          "channel": "inbox",
          "contextLabel": "noise dispute",
          "contextPlaceholder": "Ask about the noise dispute at Unit 4…",
          "contextSuggestions": [
            "Show both incident threads",
            "Draft a neutral reply to Marcus",
            "Is this a lease violation?",
            "Risk if this is ignored?",
          ],
          "linkedLabel": "noise dispute",
        },
        "rent": {
          "channel": "rent",
          "contextLabel": "Sandra K. late payment",
          "contextPlaceholder": "Ask about Sandra's late payment…",
          "contextSuggestions": [
            "Show Sandra's payment history",
            "Draft a softer reminder",
            "Suggest a payment plan threshold",
            "Who else is at risk this month?",
          ],
          "linkedLabel": "Sandra K. late",
        },
        "vendor": {
          "channel": "vendor",
          "contextLabel": "Greene HVAC silence",
          "contextPlaceholder": "Ask about the Greene HVAC delay…",
          "contextSuggestions": [
            "Show Greene HVAC track record",
            "Draft escalation script",
            "Suggest a backup vendor",
            "When should I switch vendors?",
          ],
          "linkedLabel": "Greene HVAC silence",
        },
      }
    `);
  });
});

// ---------------------------------------------------------------------
// getMockQueueItems — order + count
// ---------------------------------------------------------------------

describe('getMockQueueItems', () => {
  it('should return exactly 5 items', () => {
    expect(getMockQueueItems()).toHaveLength(5);
  });

  it('should return rows in order leak → rent → vendor → noise → lockbox', () => {
    const ids = getMockQueueItems().map((i) => i.id);
    expect(ids).toEqual([
      'leak',
      'rent',
      'vendor',
      'noise',
      'lockbox',
    ]);
  });

  it('should assign each row the channel from its row-context entry', () => {
    const byId = new Map(getMockQueueItems().map((i) => [i.id, i]));
    expect(byId.get('leak')?.channel).toBe('maintenance');
    expect(byId.get('rent')?.channel).toBe('rent');
    expect(byId.get('vendor')?.channel).toBe('vendor');
    expect(byId.get('noise')?.channel).toBe('inbox');
    expect(byId.get('lockbox')?.channel).toBe('vendor');
  });

  it('should assign each row the status from the mockup spec', () => {
    const byId = new Map(getMockQueueItems().map((i) => [i.id, i.status]));
    expect(byId.get('leak')).toBe('review');
    expect(byId.get('rent')).toBe('draft');
    expect(byId.get('vendor')).toBe('waiting');
    expect(byId.get('noise')).toBe('escalated');
    expect(byId.get('lockbox')).toBe('resolved');
  });
});
