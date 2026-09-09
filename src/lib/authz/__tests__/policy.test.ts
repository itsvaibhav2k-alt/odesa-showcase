/**
 * Unit tests for the role→capability policy (src/lib/authz/policy.ts).
 *
 * Binding matrix (conservative, owner-only): 'owner' may exercise every
 * sensitive capabilities; every other role — 'manager', 'va', missing,
 * unknown garbage — fails CLOSED for every capability.
 */
import { describe, expect, it } from 'vitest';

import {
  can,
  FORBIDDEN_MESSAGE,
  proposalCommitCapability,
  type SensitiveCapability,
} from '../policy';

const CAPABILITIES: SensitiveCapability[] = [
  'record_payment',
  'waive_balance',
  'change_lease_terms',
  'approve_tenant_message',
  'approve_payment_request',
  'approve_vendor_dispatch',
  'import_portfolio',
  'mutate_work_order',
];

describe('authz/policy', () => {
  describe('can', () => {
    it('should allow owner for every sensitive capability', () => {
      for (const capability of CAPABILITIES) {
        expect(can('owner', capability)).toBe(true);
      }
    });

    it.each(['manager', 'accountant', 'va'] as const)(
      'should deny %s for every sensitive capability',
      (role) => {
        for (const capability of CAPABILITIES) {
          expect(can(role, capability)).toBe(false);
        }
      },
    );

    it('should fail closed on null role', () => {
      for (const capability of CAPABILITIES) {
        expect(can(null, capability)).toBe(false);
      }
    });

    it('should fail closed on undefined role', () => {
      for (const capability of CAPABILITIES) {
        expect(can(undefined, capability)).toBe(false);
      }
    });

    it.each(['', 'OWNER', 'admin', 'garbage', ' owner '])(
      'should fail closed on unknown role %j',
      (role) => {
        for (const capability of CAPABILITIES) {
          expect(can(role, capability)).toBe(false);
        }
      },
    );
  });

  describe('FORBIDDEN_MESSAGE', () => {
    it('should be a stable non-empty string', () => {
      expect(typeof FORBIDDEN_MESSAGE).toBe('string');
      expect(FORBIDDEN_MESSAGE.length).toBeGreaterThan(0);
    });
  });

  describe('proposalCommitCapability', () => {
    it('should map tenant-facing sends to approve_tenant_message', () => {
      expect(proposalCommitCapability('draft_sms_reply')).toBe(
        'approve_tenant_message',
      );
      expect(proposalCommitCapability('send_tenant_message')).toBe(
        'approve_tenant_message',
      );
    });

    it('should map payment requests to approve_payment_request', () => {
      expect(proposalCommitCapability('request_rent_payment')).toBe(
        'approve_payment_request',
      );
    });

    it('should map vendor dispatch to approve_vendor_dispatch', () => {
      expect(proposalCommitCapability('dispatch_vendor')).toBe(
        'approve_vendor_dispatch',
      );
    });

    it('should map lease/rent term changes to change_lease_terms', () => {
      expect(proposalCommitCapability('set_lease_terms')).toBe(
        'change_lease_terms',
      );
      expect(proposalCommitCapability('update_rent')).toBe(
        'change_lease_terms',
      );
    });

    it('should map waive_rent to waive_balance', () => {
      expect(proposalCommitCapability('waive_rent')).toBe('waive_balance');
    });

    it('should return null for internal-record and unknown action types', () => {
      expect(proposalCommitCapability('health_flag')).toBeNull();
      expect(proposalCommitCapability('voice_call_review')).toBeNull();
      expect(proposalCommitCapability('update_rulebook')).toBeNull();
      expect(proposalCommitCapability('log_maintenance_ticket')).toBeNull();
      expect(proposalCommitCapability('create_property')).toBeNull();
      expect(proposalCommitCapability('some_future_verb')).toBeNull();
      expect(proposalCommitCapability(null)).toBeNull();
      expect(proposalCommitCapability(undefined)).toBeNull();
    });
  });
});
