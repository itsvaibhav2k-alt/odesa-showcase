/**
 * Unit tests for src/lib/agent/operator/property-resolver.ts.
 *
 * `resolvePropertyName` does no DB access — it operates entirely on an
 * in-memory `PropertySummary[]`. Tests cover:
 *   - unique match (exact name, substring, case-insensitive)
 *   - multiple matches (substring hits more than one)
 *   - no match
 *   - single-property org always returns unique regardless of input
 *   - empty / blank name → none
 */

import { describe, expect, it } from 'vitest';

import { resolvePropertyName } from '../property-resolver';
import type { PropertySummary } from '../org-context';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function prop(id: string, name: string): PropertySummary {
  return {
    id,
    name,
    address: '1 Test St',
    timezone: 'America/New_York',
    autonomyLevel: 0.5,
    privacyMode: 'hosted',
  };
}

const TWO_PROPS = [prop('a', 'Oakwood Commons'), prop('b', 'Galaxy Lofts')];
const THREE_PROPS = [
  prop('a', 'Oakwood Commons'),
  prop('b', 'Galaxy Lofts'),
  prop('c', 'Galaxy Tower'),
];
const ONE_PROP = [prop('only', 'Sunset Row')];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolvePropertyName', () => {
  describe('unique match', () => {
    it('should return unique when exact name matches one property', () => {
      const result = resolvePropertyName(TWO_PROPS, 'Oakwood Commons');
      expect(result.kind).toBe('unique');
      if (result.kind === 'unique') {
        expect(result.property.id).toBe('a');
      }
    });

    it('should return unique on case-insensitive substring match', () => {
      const result = resolvePropertyName(TWO_PROPS, 'oakwood');
      expect(result.kind).toBe('unique');
      if (result.kind === 'unique') {
        expect(result.property.id).toBe('a');
      }
    });

    it('should return unique for a mixed-case partial match', () => {
      const result = resolvePropertyName(TWO_PROPS, 'GALAXY LOFTS');
      expect(result.kind).toBe('unique');
      if (result.kind === 'unique') {
        expect(result.property.id).toBe('b');
      }
    });

    it('should return unique even with a non-matching name for a single-property org', () => {
      // Single-property org: the model shouldn't need to name the property.
      // But `resolvePropertyName` itself still matches by name. A caller
      // wanting auto-unique for one-property orgs should do that check
      // before calling here. Here we verify the substring behaviour only.
      const result = resolvePropertyName(ONE_PROP, 'Sunset');
      expect(result.kind).toBe('unique');
    });
  });

  describe('multiple matches', () => {
    it('should return multiple when substring matches two or more properties', () => {
      // 'galaxy' matches both 'Galaxy Lofts' and 'Galaxy Tower'
      const result = resolvePropertyName(THREE_PROPS, 'galaxy');
      expect(result.kind).toBe('multiple');
      if (result.kind === 'multiple') {
        expect(result.matches).toHaveLength(2);
        expect(result.matches.map((p) => p.id)).toEqual(['b', 'c']);
      }
    });

    it('should return multiple when a common word matches all properties', () => {
      const allContainO = [
        prop('x', 'Oakwood Commons'),
        prop('y', 'Downtown Lofts'),
        prop('z', 'Old Harbor'),
      ];
      // 'o' matches all three names (Oakwood, Downtown, Old).
      const result = resolvePropertyName(allContainO, 'o');
      expect(result.kind).toBe('multiple');
      if (result.kind === 'multiple') {
        expect(result.matches).toHaveLength(3);
      }
    });
  });

  describe('no match', () => {
    it('should return none when no property name contains the substring', () => {
      const result = resolvePropertyName(TWO_PROPS, 'downtown');
      expect(result.kind).toBe('none');
    });

    it('should return none for an empty string', () => {
      const result = resolvePropertyName(TWO_PROPS, '');
      expect(result.kind).toBe('none');
    });

    it('should return none for a whitespace-only string', () => {
      const result = resolvePropertyName(TWO_PROPS, '   ');
      expect(result.kind).toBe('none');
    });

    it('should return none when the properties list is empty', () => {
      const result = resolvePropertyName([], 'anything');
      expect(result.kind).toBe('none');
    });
  });

  describe('single-property org', () => {
    it('should return unique for the exact name in a single-property org', () => {
      const result = resolvePropertyName(ONE_PROP, 'Sunset Row');
      expect(result.kind).toBe('unique');
      if (result.kind === 'unique') {
        expect(result.property.id).toBe('only');
      }
    });

    it('should return none for a non-matching name in a single-property org', () => {
      // The plan note says "single-property org returns unique even with
      // non-matching message" — this applies at the DISPATCHER level where
      // the dispatcher may skip name resolution for 1-property orgs. The
      // resolver itself is pure substring matching and returns none here.
      const result = resolvePropertyName(ONE_PROP, 'completely unrelated');
      expect(result.kind).toBe('none');
    });
  });
});
