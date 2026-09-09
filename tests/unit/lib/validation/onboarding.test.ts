import { describe, expect, it } from 'vitest';
import {
  leaseSchema,
  normalizePhoneE164,
  propertySchema,
  tenantSchema,
  unitSchema,
} from '@/lib/validation/onboarding';

describe('onboarding validation', () => {
  describe('propertySchema', () => {
    it('accepts a fully-formed property', () => {
      const result = propertySchema.safeParse({
        name: 'Oakwood',
        addressStreet: '500 Main',
        addressCity: 'Arlington',
        addressState: 'VA',
        addressZip: '22201',
        timezone: 'America/New_York',
      });
      expect(result.success).toBe(true);
    });

    it('defaults timezone when omitted', () => {
      const result = propertySchema.safeParse({
        name: 'Oakwood',
        addressStreet: '500 Main',
        addressCity: 'Arlington',
        addressState: 'VA',
        addressZip: '22201',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timezone).toBe('America/New_York');
      }
    });

    it('rejects 2-digit zip', () => {
      const result = propertySchema.safeParse({
        name: 'Oakwood',
        addressStreet: '500 Main',
        addressCity: 'Arlington',
        addressState: 'VA',
        addressZip: '22',
      });
      expect(result.success).toBe(false);
    });

    it('accepts ZIP+4', () => {
      const result = propertySchema.safeParse({
        name: 'Oakwood',
        addressStreet: '500 Main',
        addressCity: 'Arlington',
        addressState: 'VA',
        addressZip: '22201-1234',
      });
      expect(result.success).toBe(true);
    });

    it('rejects lowercase state', () => {
      const result = propertySchema.safeParse({
        name: 'Oakwood',
        addressStreet: '500 Main',
        addressCity: 'Arlington',
        addressState: 'va',
        addressZip: '22201',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('unitSchema', () => {
    // v4 UUID (version 4, RFC 4122) fixtures.
    const PROPERTY_UUID = '8bbfa8bc-6b0e-4f96-8c77-77e69d75c9c1';

    it('accepts a minimal unit (label + propertyId only)', () => {
      const result = unitSchema.safeParse({
        propertyId: PROPERTY_UUID,
        label: '101',
      });
      expect(result.success).toBe(true);
    });

    it('coerces numeric strings for bedrooms/bathrooms', () => {
      const result = unitSchema.safeParse({
        propertyId: PROPERTY_UUID,
        label: '101',
        bedrooms: '2',
        bathrooms: '1.5',
        squareFeet: '850',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.bedrooms).toBe(2);
        expect(result.data.bathrooms).toBe(1.5);
        expect(result.data.squareFeet).toBe(850);
      }
    });

    it('rejects invalid uuid propertyId', () => {
      const result = unitSchema.safeParse({
        propertyId: 'not-a-uuid',
        label: '101',
      });
      expect(result.success).toBe(false);
    });

    it('rejects bedroom count above 20', () => {
      const result = unitSchema.safeParse({
        propertyId: PROPERTY_UUID,
        label: '101',
        bedrooms: 99,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('tenantSchema', () => {
    it('accepts E.164 phone with country code', () => {
      const result = tenantSchema.safeParse({
        fullName: 'Jane',
        phoneE164: '+15715551234',
      });
      expect(result.success).toBe(true);
    });

    it('accepts bare 10-digit US number', () => {
      const result = tenantSchema.safeParse({
        fullName: 'Jane',
        phoneE164: '5715551234',
      });
      expect(result.success).toBe(true);
    });

    it('rejects 3-digit phone', () => {
      const result = tenantSchema.safeParse({
        fullName: 'Jane',
        phoneE164: '123',
      });
      expect(result.success).toBe(false);
    });

    it('treats empty email as optional', () => {
      const result = tenantSchema.safeParse({
        fullName: 'Jane',
        phoneE164: '+15715551234',
        email: '',
      });
      expect(result.success).toBe(true);
    });

    it('rejects malformed email', () => {
      const result = tenantSchema.safeParse({
        fullName: 'Jane',
        phoneE164: '+15715551234',
        email: 'not-an-email',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('leaseSchema', () => {
    const base = {
      // Both are RFC 4122 v4 UUIDs — version nibble is "4", variant nibble
      // is one of 8/9/a/b. Zod v4 rejects non-compliant layouts.
      unitId: '8bbfa8bc-6b0e-4f96-8c77-77e69d75c9c1',
      tenantId: '0f2c3b7a-9c0e-4b2a-8d3e-6e4f1a2b3c4d',
      rentAmount: 1500,
      rentDueDay: 1,
      startDate: '2026-05-01',
      endDate: '2027-04-30',
    };

    it('accepts a valid lease', () => {
      expect(leaseSchema.safeParse(base).success).toBe(true);
    });

    it('rejects rent_due_day of 0', () => {
      expect(
        leaseSchema.safeParse({ ...base, rentDueDay: 0 }).success,
      ).toBe(false);
    });

    it('rejects rent_due_day of 32', () => {
      expect(
        leaseSchema.safeParse({ ...base, rentDueDay: 32 }).success,
      ).toBe(false);
    });

    it('rejects negative rent', () => {
      expect(
        leaseSchema.safeParse({ ...base, rentAmount: -1 }).success,
      ).toBe(false);
    });

    it('rejects endDate before startDate', () => {
      expect(
        leaseSchema.safeParse({
          ...base,
          startDate: '2027-01-01',
          endDate: '2026-01-01',
        }).success,
      ).toBe(false);
    });

    it('rejects endDate equal to startDate', () => {
      expect(
        leaseSchema.safeParse({
          ...base,
          startDate: '2026-05-01',
          endDate: '2026-05-01',
        }).success,
      ).toBe(false);
    });
  });

  describe('normalizePhoneE164', () => {
    it('prefixes 10-digit US number with +1', () => {
      expect(normalizePhoneE164('5715551234')).toBe('+15715551234');
    });

    it('prefixes 11-digit leading-1 with +', () => {
      expect(normalizePhoneE164('15715551234')).toBe('+15715551234');
    });

    it('preserves an already E.164 number', () => {
      expect(normalizePhoneE164('+15715551234')).toBe('+15715551234');
    });

    it('strips formatting before prefixing', () => {
      expect(normalizePhoneE164('(571) 555-1234')).toBe('+15715551234');
    });
  });
});
