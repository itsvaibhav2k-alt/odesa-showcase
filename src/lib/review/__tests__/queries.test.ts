import { describe, it, expect } from 'vitest';
import {
  rentBadge,
  conversationBadge,
  workOrderActions,
  rentActions,
  conversationActions,
  rentTitle,
  conversationTitle,
} from '../queries';

describe('review/queries pure mappers', () => {
  describe('rentBadge', () => {
    it('maps escalated to clay', () => {
      expect(rentBadge('escalated')).toEqual({ label: 'Escalated', tone: 'clay' });
    });
    it('maps late_7 to amber', () => {
      expect(rentBadge('late_7')).toEqual({ label: '7 days late', tone: 'amber' });
    });
    it('maps paid to green', () => {
      expect(rentBadge('paid')).toEqual({ label: 'Paid', tone: 'green' });
    });
  });

  describe('rentTitle', () => {
    it('humanises the status', () => {
      expect(rentTitle('late_3')).toBe('3 days late');
      expect(rentTitle('escalated')).toBe('Escalated');
    });
  });

  describe('rentActions', () => {
    it('offers send + escalate + arrange-plan with one primary', () => {
      const actions = rentActions();
      expect(actions.map((a) => a.id)).toEqual([
        'rent.send_reminder',
        'rent.escalate',
        'rent.arrange_plan',
      ]);
      expect(actions.filter((a) => a.variant === 'primary')).toHaveLength(1);
      expect(actions.find((a) => a.id === 'rent.escalate')?.kind).toBe('transition');
    });
  });

  describe('conversationBadge', () => {
    it('maps escalated to clay and open to amber', () => {
      expect(conversationBadge('escalated')).toEqual({ label: 'Escalated', tone: 'clay' });
      expect(conversationBadge('open')).toEqual({ label: 'Open reply', tone: 'amber' });
    });
  });

  describe('conversationTitle', () => {
    it('humanises status', () => {
      expect(conversationTitle('open')).toBe('Open reply');
      expect(conversationTitle('resolved')).toBe('Resolved');
    });
  });

  describe('conversationActions', () => {
    it('includes send (only when a draft exists) + resolve', () => {
      const withDraft = conversationActions(true);
      expect(withDraft.map((a) => a.id)).toEqual([
        'conversation.send_reply',
        'conversation.resolve',
      ]);
      const noDraft = conversationActions(false);
      expect(noDraft.map((a) => a.id)).toEqual(['conversation.resolve']);
      expect(noDraft[0].variant).toBe('primary');
    });
  });

  describe('workOrderActions', () => {
    it('offers start (transition) + open-ticket (link)', () => {
      const actions = workOrderActions('w1');
      expect(actions.map((a) => a.id)).toEqual([
        'work_order.start',
        'work_order.open_ticket',
      ]);
      const link = actions.find((a) => a.id === 'work_order.open_ticket');
      expect(link?.kind).toBe('link');
      expect(link?.href).toBe('/work-orders/w1');
    });
  });
});
