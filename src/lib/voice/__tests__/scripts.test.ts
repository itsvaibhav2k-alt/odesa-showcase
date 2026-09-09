/**
 * Unit tests for the typed call scripts and override schema
 * (src/lib/voice/scripts.ts). Pure objects — no Supabase, no network, no jsdom.
 *
 * WHY: the scripts are the inspectable, landlord-readable mirror of the
 * policy.ts safety layer, and the override map is jsonb that can rot. These
 * pin that every script type is complete and that the read path is fail-open
 * (drops junk, never throws) while the write path is strict on customNotes.
 */

import { describe, expect, it } from 'vitest';

import {
  CALL_SCRIPTS,
  CALL_SCRIPT_TYPES,
  parseScriptOverrides,
  scriptOverridesSchema,
} from '../scripts';

describe('CALL_SCRIPTS', () => {
  it('should define a complete script for every call type', () => {
    for (const type of CALL_SCRIPT_TYPES) {
      const script = CALL_SCRIPTS[type];
      expect(script.type).toBe(type);
      expect(script.title.length).toBeGreaterThan(0);
      expect(script.summary.length).toBeGreaterThan(0);
      expect(script.defaultBehavior.length).toBeGreaterThan(0);
      expect(script.safetyBoundaries.length).toBeGreaterThan(0);
      expect(script.collectedFields.length).toBeGreaterThan(0);
    }
  });

  it('should have exactly the five expected script types', () => {
    expect(CALL_SCRIPT_TYPES).toEqual([
      'maintenance_request',
      'rent_payment_dispute',
      'owner_briefing',
      'vendor_context',
      'unknown_caller',
    ]);
  });
});

describe('parseScriptOverrides', () => {
  it('should round-trip a valid single-key map', () => {
    const input = { maintenance_request: { customNotes: 'Prefer morning access windows.' } };
    expect(parseScriptOverrides(input)).toEqual(input);
  });

  it('should keep known keys and drop unknown keys', () => {
    const result = parseScriptOverrides({
      owner_briefing: { customNotes: 'Lead with vacancies.' },
      not_a_script_type: { customNotes: 'ignore me' },
    });
    expect(result).toEqual({ owner_briefing: { customNotes: 'Lead with vacancies.' } });
  });

  it('should trim customNotes on the way in', () => {
    const result = parseScriptOverrides({ vendor_context: { customNotes: '  keep ETA notes  ' } });
    expect(result).toEqual({ vendor_context: { customNotes: 'keep ETA notes' } });
  });

  it.each([
    ['null', null],
    ['a string', 'maintenance_request'],
    ['a number', 42],
    ['an array', [{ customNotes: 'x' }]],
    ['undefined', undefined],
  ])('should return {} for %s', (_label, value) => {
    expect(parseScriptOverrides(value)).toEqual({});
  });

  it('should drop entries with empty customNotes', () => {
    expect(parseScriptOverrides({ maintenance_request: { customNotes: '   ' } })).toEqual({});
  });

  it('should drop entries with customNotes over 2000 chars', () => {
    const tooLong = 'x'.repeat(2001);
    expect(parseScriptOverrides({ rent_payment_dispute: { customNotes: tooLong } })).toEqual({});
  });

  it('should drop malformed entries (wrong shape) without throwing', () => {
    const result = parseScriptOverrides({
      maintenance_request: 'not an object',
      owner_briefing: { customNotes: 42 },
      vendor_context: { customNotes: 'valid note' },
    });
    expect(result).toEqual({ vendor_context: { customNotes: 'valid note' } });
  });

  it('should never throw on hostile input', () => {
    expect(() => parseScriptOverrides(Symbol('x') as unknown)).not.toThrow();
    expect(() => parseScriptOverrides(() => undefined)).not.toThrow();
    expect(() => parseScriptOverrides(new Map())).not.toThrow();
  });
});

describe('scriptOverridesSchema (strict write path)', () => {
  it('should accept a valid partial map', () => {
    const parsed = scriptOverridesSchema.safeParse({
      maintenance_request: { customNotes: 'Ask about pets on entry.' },
    });
    expect(parsed.success).toBe(true);
  });

  it('should reject empty customNotes', () => {
    const parsed = scriptOverridesSchema.safeParse({
      maintenance_request: { customNotes: '' },
    });
    expect(parsed.success).toBe(false);
  });

  it('should reject customNotes over 2000 chars', () => {
    const parsed = scriptOverridesSchema.safeParse({
      maintenance_request: { customNotes: 'x'.repeat(2001) },
    });
    expect(parsed.success).toBe(false);
  });

  it('should reject unknown keys', () => {
    const parsed = scriptOverridesSchema.safeParse({
      not_a_script_type: { customNotes: 'nope' },
    });
    expect(parsed.success).toBe(false);
  });
});
