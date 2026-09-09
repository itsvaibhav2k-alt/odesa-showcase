/**
 * Tests for the demo-safe display normalization helpers.
 *
 * These cover the display boundary only: stripping "(demo)"/"(test)"
 * suffixes, mapping known demo tenants to credible names, and filtering
 * obvious e2e/test users out of the client-facing Team list WITHOUT hiding
 * the genuine seeded Galaxy owner.
 */

import { describe, expect, it } from 'vitest';

import {
  displayName,
  displayUnitLabel,
  isClientVisibleTeamMember,
} from '../normalize';

describe('displayName', () => {
  describe('known demo-tenant mapping', () => {
    it('should map the seeded Alvarez demo tenant to a credible name', () => {
      expect(displayName('Demo Tenant Alvarez (demo)')).toBe('Nora Alvarez');
    });

    it('should map the seeded Okafor demo tenant to a credible name', () => {
      expect(displayName('Demo Tenant Okafor (demo)')).toBe('Grace Okafor');
    });

    it('should not collide with the real Oakwood Marcus Alvarez', () => {
      // The real tenant must pass through untouched; the demo Alvarez must
      // resolve to a DISTINCT given name so the two never read as the same.
      expect(displayName('Marcus Alvarez')).toBe('Marcus Alvarez');
      expect(displayName('Demo Tenant Alvarez (demo)')).not.toBe(
        'Marcus Alvarez',
      );
    });

    it('should pass through an already-credible re-seeded name unchanged', () => {
      expect(displayName('Nora Alvarez')).toBe('Nora Alvarez');
      expect(displayName('Grace Okafor')).toBe('Grace Okafor');
    });
  });

  describe('suffix stripping', () => {
    it('should strip a trailing (demo) suffix', () => {
      expect(displayName('Jordan Reyes (demo)')).toBe('Jordan Reyes');
    });

    it('should strip a trailing (test) suffix', () => {
      expect(displayName('Jordan Reyes (test)')).toBe('Jordan Reyes');
    });

    it('should be case-insensitive for the suffix', () => {
      expect(displayName('Jordan Reyes (DEMO)')).toBe('Jordan Reyes');
      expect(displayName('Jordan Reyes (Test)')).toBe('Jordan Reyes');
    });

    it('should tolerate extra whitespace around the suffix', () => {
      expect(displayName('Jordan Reyes  (demo)  ')).toBe('Jordan Reyes');
    });
  });

  describe('pass-through', () => {
    it('should return a clean name unchanged', () => {
      expect(displayName('Priya Nair')).toBe('Priya Nair');
    });

    it('should not strip a non-trailing demo token', () => {
      expect(displayName('Demonte Carter')).toBe('Demonte Carter');
    });

    it('should return empty string unchanged', () => {
      expect(displayName('')).toBe('');
    });
  });
});

describe('displayUnitLabel', () => {
  it('should strip a trailing (demo) suffix', () => {
    expect(displayUnitLabel('D1 (demo)')).toBe('D1');
  });

  it('should strip a trailing (test) suffix', () => {
    expect(displayUnitLabel('D2 (test)')).toBe('D2');
  });

  it('should leave a clean numeric label unchanged', () => {
    expect(displayUnitLabel('201')).toBe('201');
  });

  it('should leave a clean alpha label unchanged', () => {
    expect(displayUnitLabel('PH-A')).toBe('PH-A');
  });

  it('should return empty string unchanged', () => {
    expect(displayUnitLabel('')).toBe('');
  });
});

describe('isClientVisibleTeamMember', () => {
  describe('must-keep genuine client owner', () => {
    it('should keep the seeded Galaxy owner (owner@galaxy-estates.test)', () => {
      expect(
        isClientVisibleTeamMember({
          fullName: 'Galaxy Owner',
          email: 'owner@galaxy-estates.test',
        }),
      ).toBe(true);
    });

    it('should keep the seeded Galaxy manager', () => {
      expect(
        isClientVisibleTeamMember({
          fullName: 'Galaxy Manager',
          email: 'manager@galaxy-estates.test',
        }),
      ).toBe(true);
    });

    it('should keep the seeded Galaxy VA', () => {
      expect(
        isClientVisibleTeamMember({
          fullName: 'Galaxy VA',
          email: 'va@galaxy-estates.test',
        }),
      ).toBe(true);
    });

    it('should keep a normal teammate with a human handle', () => {
      expect(
        isClientVisibleTeamMember({
          fullName: 'Priya Nair',
          email: 'priya@galaxy-estates.test',
        }),
      ).toBe(true);
    });
  });

  describe('hide provisioned/test owners by name', () => {
    it('should hide the provisioned "Galaxy Settings Owner"', () => {
      expect(
        isClientVisibleTeamMember({
          fullName: 'Galaxy Settings Owner',
          email: 'settings-owner.1749600000000.483921@galaxy.test',
        }),
      ).toBe(false);
    });

    it('should hide a "Galaxy Test Owner"', () => {
      expect(
        isClientVisibleTeamMember({
          fullName: 'Galaxy Test Owner',
          email: 'someone@galaxy-estates.test',
        }),
      ).toBe(false);
    });

    it('should hide a "Galaxy Demo Owner"', () => {
      expect(
        isClientVisibleTeamMember({ fullName: 'Galaxy Demo Owner' }),
      ).toBe(false);
    });

    it('should hide a name starting with "Galaxy Test"', () => {
      expect(
        isClientVisibleTeamMember({ fullName: 'Galaxy Test Account' }),
      ).toBe(false);
    });

    it('should hide an "Inbox Viewer" fixture', () => {
      expect(
        isClientVisibleTeamMember({
          fullName: 'Inbox Viewer',
          email: 'viewer@galaxy-estates.test',
        }),
      ).toBe(false);
    });
  });

  describe('hide harness users by email', () => {
    it('should hide galaxy-properties.test addresses', () => {
      expect(
        isClientVisibleTeamMember({
          fullName: 'Alex Doe',
          email: 'alex@galaxy-properties.test',
        }),
      ).toBe(false);
    });

    it('should hide inbox.test addresses', () => {
      expect(
        isClientVisibleTeamMember({
          fullName: 'Alex Doe',
          email: 'alex@inbox.test',
        }),
      ).toBe(false);
    });

    it('should hide example.com addresses', () => {
      expect(
        isClientVisibleTeamMember({
          fullName: 'Alex Doe',
          email: 'alex@example.com',
        }),
      ).toBe(false);
    });

    it('should hide example.test addresses', () => {
      expect(
        isClientVisibleTeamMember({
          fullName: 'Alex Doe',
          email: 'alex@example.test',
        }),
      ).toBe(false);
    });

    it('should hide timestamp-style generated local parts', () => {
      expect(
        isClientVisibleTeamMember({
          fullName: 'Alex Doe',
          email: 'auto.1749600000000@galaxy.test',
        }),
      ).toBe(false);
    });

    it('should hide uuid-style generated local parts', () => {
      expect(
        isClientVisibleTeamMember({
          fullName: 'Alex Doe',
          email: '11111111-1111-1111-1111-111111111101@galaxy.test',
        }),
      ).toBe(false);
    });
  });

  describe('default-visible (if unsure, keep)', () => {
    it('should keep a member with no matching pattern', () => {
      expect(
        isClientVisibleTeamMember({
          fullName: 'Sam Rivera',
          email: 'sam@galaxy-estates.test',
        }),
      ).toBe(true);
    });

    it('should keep a member with a null name and a human email', () => {
      expect(
        isClientVisibleTeamMember({
          fullName: null,
          email: 'owner@galaxy-estates.test',
        }),
      ).toBe(true);
    });

    it('should keep a member with no fields at all', () => {
      expect(isClientVisibleTeamMember({})).toBe(true);
    });
  });
});
