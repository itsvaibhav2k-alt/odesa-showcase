import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute only the guard: importing these maintenance scripts would write data.
describe('publication maintenance sender guard', () => {
  it('Retell preflight refuses missing or fictional routing before any checks', () => {
    const source = readFileSync('scripts/retell-preflight.ts', 'utf8');
    const start = source.indexOf('  if (!/^\\+1[2-9]');
    const end = source.indexOf('\n  const { base, tunnel, cell }', start);
    expect(start).toBeGreaterThan(source.indexOf('async function main()'));
    expect(end).toBeGreaterThan(start);
    const guard = source.slice(start, end);
    for (const ROUTED_NUMBER of ['', 'invalid', '+12025550102']) {
      expect(() => runInNewContext(guard, { ROUTED_NUMBER })).toThrow(/Set RETELL_ROUTED_NUMBER/);
    }
    expect(() => runInNewContext(guard, { ROUTED_NUMBER: '+12025550000' })).not.toThrow();
  });
  for (const script of ['mirror-local-to-cloud.mjs', 'seed-cloud-galaxy.mjs']) {
    const source = readFileSync(`scripts/${script}`, 'utf8');
    const start = source.indexOf('const GALAXY_SENDBLUE_E164 =');
    const end = source.indexOf('\n}', start) + 2;
    const guard = source.slice(start, end);
    it(`${script} validates before client construction`, () => {
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThan(source.indexOf('= createClient('));
    });
    for (const value of [undefined, '', 'not-a-phone', '+12025550100', '+12025550101', '+15715550101']) {
      it(`${script} rejects missing, invalid or fictional configuration: ${value}`, () => {
        expect(() => runInNewContext(guard, { process: { env: { GALAXY_SENDBLUE_E164: value } } }))
          .toThrow(/Set GALAXY_SENDBLUE_E164/);
      });
    }
    it(`${script} accepts syntactically valid non-fictional input without contacting any provider`, () => {
      // Shape-only input, not a provisioned/verified sender; never used for I/O.
      expect(() => runInNewContext(guard, { process: { env: { GALAXY_SENDBLUE_E164: '+12025550000' } } }))
        .not.toThrow();
    });
  }
});
