/**
 * Unit tests for the v1.9 scheduled-action condition evaluator.
 *
 * Strategy:
 *   - Hand-rolled SupabaseClient mock that returns canned `{data, error}`
 *     for the tables we touch (leases, rent_events, action_proposals,
 *     messages). Mirrors the bivariant-method-shorthand mock pattern in
 *     `src/lib/agent/worker/__tests__/spawn.test.ts`.
 *   - One describe block per condition variant, plus the legacy `null`
 *     defensive path. Every assertion checks both `holds` and `reason`
 *     so the audit string contract is locked in.
 */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

import { evaluateCondition } from '../conditions';
import type { ScheduledCondition } from '../types';

// ---------------------------------------------------------------------------
// SupabaseClient mock
// ---------------------------------------------------------------------------

interface MockResult {
  data: unknown;
  error: { message: string } | null;
}

interface MockHandlers {
  leases?: () => MockResult;
  rent_events?: () => MockResult;
  action_proposals?: () => MockResult;
  messages?: () => MockResult;
}

/**
 * Build a SupabaseClient-shaped mock whose `.from(table)` returns a
 * chainable builder terminating in `.maybeSingle()`. The handler map
 * is keyed by table name so a single test can wire up multiple tables
 * (e.g. tenant_no_response touches both action_proposals and messages).
 */
function makeClient(handlers: MockHandlers): SupabaseClient<Database> {
  function builder(table: keyof MockHandlers) {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      gt: () => b,
      lte: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => {
        const handler = handlers[table];
        if (!handler) return { data: null, error: null };
        return handler();
      },
    };
    return b;
  }

  return {
    from(table: string) {
      return builder(table as keyof MockHandlers);
    },
  } as unknown as SupabaseClient<Database>;
}

const ORG_ID = 'org-1';
const TRIGGER_AT = new Date('2026-05-10T17:00:00Z');

// ---------------------------------------------------------------------------
// always + null defensive default
// ---------------------------------------------------------------------------

describe('evaluateCondition', () => {
  describe('always', () => {
    it('should return holds true with unconditional reason', async () => {
      // Arrange
      const condition: ScheduledCondition = { type: 'always' };
      const db = makeClient({});

      // Act
      const result = await evaluateCondition(condition, {
        db,
        organizationId: ORG_ID,
        triggerAt: TRIGGER_AT,
      });

      // Assert
      expect(result.holds).toBe(true);
      expect(result.reason).toBe('unconditional fire');
    });
  });

  describe('null condition (legacy / never-set)', () => {
    it('should be treated as always and fire', async () => {
      // Arrange
      const db = makeClient({});

      // Act
      const result = await evaluateCondition(null, {
        db,
        organizationId: ORG_ID,
        triggerAt: TRIGGER_AT,
      });

      // Assert
      expect(result.holds).toBe(true);
      expect(result.reason).toBe('unconditional fire');
    });
  });

  // -------------------------------------------------------------------------
  // rent_unpaid
  // -------------------------------------------------------------------------

  describe('rent_unpaid', () => {
    const condition: ScheduledCondition = {
      type: 'rent_unpaid',
      tenantId: 'tenant-1',
      asOf: 'trigger_at',
    };

    it('should return holds false when latest rent_event status is paid', async () => {
      // Arrange
      const db = makeClient({
        leases: () => ({
          data: { id: 'lease-1', status: 'active', organization_id: ORG_ID },
          error: null,
        }),
        rent_events: () => ({
          data: {
            status: 'paid',
            created_at: '2026-05-09T12:00:00Z',
          },
          error: null,
        }),
      });

      // Act
      const result = await evaluateCondition(condition, {
        db,
        organizationId: ORG_ID,
        triggerAt: TRIGGER_AT,
      });

      // Assert
      expect(result.holds).toBe(false);
      expect(result.reason).toBe('Tenant paid before deadline');
    });

    it('should return holds false when latest rent_event status is plan_agreed', async () => {
      // Arrange
      const db = makeClient({
        leases: () => ({
          data: { id: 'lease-1', status: 'active', organization_id: ORG_ID },
          error: null,
        }),
        rent_events: () => ({
          data: {
            status: 'plan_agreed',
            created_at: '2026-05-08T08:00:00Z',
          },
          error: null,
        }),
      });

      // Act
      const result = await evaluateCondition(condition, {
        db,
        organizationId: ORG_ID,
        triggerAt: TRIGGER_AT,
      });

      // Assert
      expect(result.holds).toBe(false);
      expect(result.reason).toBe('Tenant paid before deadline');
    });

    it('should return holds true when latest rent_event status is late_3', async () => {
      // Arrange
      const db = makeClient({
        leases: () => ({
          data: { id: 'lease-1', status: 'active', organization_id: ORG_ID },
          error: null,
        }),
        rent_events: () => ({
          data: {
            status: 'late_3',
            created_at: '2026-05-09T12:00:00Z',
          },
          error: null,
        }),
      });

      // Act
      const result = await evaluateCondition(condition, {
        db,
        organizationId: ORG_ID,
        triggerAt: TRIGGER_AT,
      });

      // Assert
      expect(result.holds).toBe(true);
      expect(result.reason).toBe('No payment confirmed by trigger time');
    });

    it('should return holds true when there are no rent_events at all', async () => {
      // Arrange
      const db = makeClient({
        leases: () => ({
          data: { id: 'lease-1', status: 'active', organization_id: ORG_ID },
          error: null,
        }),
        rent_events: () => ({ data: null, error: null }),
      });

      // Act
      const result = await evaluateCondition(condition, {
        db,
        organizationId: ORG_ID,
        triggerAt: TRIGGER_AT,
      });

      // Assert
      expect(result.holds).toBe(true);
      expect(result.reason).toBe('No payment confirmed by trigger time');
    });

    it('should return holds false when tenant has no active lease', async () => {
      // Arrange
      const db = makeClient({
        leases: () => ({ data: null, error: null }),
      });

      // Act
      const result = await evaluateCondition(condition, {
        db,
        organizationId: ORG_ID,
        triggerAt: TRIGGER_AT,
      });

      // Assert
      expect(result.holds).toBe(false);
      expect(result.reason).toBe('Tenant no longer has an active lease');
    });
  });

  // -------------------------------------------------------------------------
  // tenant_no_response
  // -------------------------------------------------------------------------

  describe('tenant_no_response', () => {
    const condition: ScheduledCondition = {
      type: 'tenant_no_response',
      tenantId: 'tenant-1',
      sinceProposalId: 'prop-1',
    };

    it('should return holds false when an inbound reply exists in window', async () => {
      // Arrange
      const db = makeClient({
        action_proposals: () => ({
          data: {
            status: 'committed',
            committed_at: '2026-05-09T15:00:00Z',
            routing: { conversationId: 'conv-1', tenantId: 'tenant-1' },
          },
          error: null,
        }),
        messages: () => ({
          data: { created_at: '2026-05-09T18:30:00Z' },
          error: null,
        }),
      });

      // Act
      const result = await evaluateCondition(condition, {
        db,
        organizationId: ORG_ID,
        triggerAt: TRIGGER_AT,
      });

      // Assert
      expect(result.holds).toBe(false);
      expect(result.reason).toBe('Tenant replied at 2026-05-09T18:30:00Z');
    });

    it('should return holds true when there is no inbound reply', async () => {
      // Arrange
      const db = makeClient({
        action_proposals: () => ({
          data: {
            status: 'committed',
            committed_at: '2026-05-09T15:00:00Z',
            routing: { conversationId: 'conv-1', tenantId: 'tenant-1' },
          },
          error: null,
        }),
        messages: () => ({ data: null, error: null }),
      });

      // Act
      const result = await evaluateCondition(condition, {
        db,
        organizationId: ORG_ID,
        triggerAt: TRIGGER_AT,
      });

      // Assert
      expect(result.holds).toBe(true);
      expect(result.reason).toBe('No tenant response since reminder sent');
    });

    it('should return holds false when reference proposal was never committed', async () => {
      // Arrange
      const db = makeClient({
        action_proposals: () => ({
          data: {
            status: 'rejected',
            committed_at: null,
            routing: { conversationId: 'conv-1', tenantId: 'tenant-1' },
          },
          error: null,
        }),
      });

      // Act
      const result = await evaluateCondition(condition, {
        db,
        organizationId: ORG_ID,
        triggerAt: TRIGGER_AT,
      });

      // Assert
      expect(result.holds).toBe(false);
      expect(result.reason).toBe('reference proposal was never committed');
    });

    it('should return holds false when reference proposal id does not exist', async () => {
      // Arrange
      const db = makeClient({
        action_proposals: () => ({ data: null, error: null }),
      });

      // Act
      const result = await evaluateCondition(condition, {
        db,
        organizationId: ORG_ID,
        triggerAt: TRIGGER_AT,
      });

      // Assert
      expect(result.holds).toBe(false);
      expect(result.reason).toBe('reference proposal was never committed');
    });

    it('should return holds false when routing has no conversationId', async () => {
      // Arrange
      const db = makeClient({
        action_proposals: () => ({
          data: {
            status: 'committed',
            committed_at: '2026-05-09T15:00:00Z',
            routing: { tenantId: 'tenant-1' },
          },
          error: null,
        }),
      });

      // Act
      const result = await evaluateCondition(condition, {
        db,
        organizationId: ORG_ID,
        triggerAt: TRIGGER_AT,
      });

      // Assert
      expect(result.holds).toBe(false);
      expect(result.reason).toBe('reference proposal has no conversation routing');
    });
  });
});
