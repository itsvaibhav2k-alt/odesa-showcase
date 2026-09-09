import { describe, expect, it } from 'vitest';

import { evaluateTestHooksAccess } from '../guard';

const SECRET = 'odesa-e2e-test-hooks-v0';

describe('evaluateTestHooksAccess', () => {
  describe('production', () => {
    it('should deny when the flag is absent', () => {
      expect(
        evaluateTestHooksAccess({
          nodeEnv: 'production',
          flag: undefined,
          configuredSecret: SECRET,
          providedSecret: SECRET,
        }),
      ).toBe(false);
    });

    it('should deny when flagged but no secret is configured', () => {
      expect(
        evaluateTestHooksAccess({
          nodeEnv: 'production',
          flag: '1',
          configuredSecret: undefined,
          providedSecret: null,
        }),
      ).toBe(false);
    });

    it('should deny when flagged + secret set but no secret provided', () => {
      expect(
        evaluateTestHooksAccess({
          nodeEnv: 'production',
          flag: '1',
          configuredSecret: SECRET,
          providedSecret: null,
        }),
      ).toBe(false);
    });

    it('should deny when flagged + secret set but provided secret is wrong', () => {
      expect(
        evaluateTestHooksAccess({
          nodeEnv: 'production',
          flag: '1',
          configuredSecret: SECRET,
          providedSecret: 'nope',
        }),
      ).toBe(false);
    });

    it('should allow when flagged + secret set + provided secret matches', () => {
      expect(
        evaluateTestHooksAccess({
          nodeEnv: 'production',
          flag: '1',
          configuredSecret: SECRET,
          providedSecret: SECRET,
        }),
      ).toBe(true);
    });

    it('should treat an empty configured secret as no secret (deny)', () => {
      expect(
        evaluateTestHooksAccess({
          nodeEnv: 'production',
          flag: '1',
          configuredSecret: '',
          providedSecret: '',
        }),
      ).toBe(false);
    });
  });

  describe('non-production', () => {
    it('should allow when secret configured and provided secret matches', () => {
      expect(
        evaluateTestHooksAccess({
          nodeEnv: 'development',
          flag: undefined,
          configuredSecret: SECRET,
          providedSecret: SECRET,
        }),
      ).toBe(true);
    });

    it('should deny when secret configured but provided secret is wrong', () => {
      expect(
        evaluateTestHooksAccess({
          nodeEnv: 'development',
          flag: undefined,
          configuredSecret: SECRET,
          providedSecret: 'nope',
        }),
      ).toBe(false);
    });

    it('should allow when no secret is configured (dev/vitest convenience)', () => {
      expect(
        evaluateTestHooksAccess({
          nodeEnv: 'test',
          flag: undefined,
          configuredSecret: undefined,
          providedSecret: null,
        }),
      ).toBe(true);
    });
  });
});
