import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DOCUMENTS, seedRelativeDate } from '../e2e/fixtures/manifest';
import {
  runCleanupTasks,
  type CleanupTask,
} from '../e2e/fixtures/isolated-org';

describe('Wave 0 fixture safety', () => {
  it('continues cleanup and aggregates returned plus thrown failures by target', async () => {
    const visited: string[] = [];
    const tasks: CleanupTask[] = [
      {
        target: 'delete:leases',
        run: async () => {
          visited.push('leases');
          return { error: { message: 'lease delete rejected' } };
        },
      },
      {
        target: 'delete:tenants',
        run: async () => {
          visited.push('tenants');
          throw new Error('tenant transport failed');
        },
      },
      {
        target: 'auth:deleteUser',
        run: async () => {
          visited.push('auth');
          return { error: undefined };
        },
      },
    ];

    await expect(runCleanupTasks(tasks)).rejects.toThrow(
      /delete:leases.*lease delete rejected.*delete:tenants.*tenant transport failed/,
    );
    expect(visited).toEqual(['leases', 'tenants', 'auth']);
  });

  it('uses the same document expiry offsets declared by seed.sql', () => {
    const seed = readFileSync(resolve('supabase/seed.sql'), 'utf8');
    const expected = new Map([
      ['cccccccc-cccc-cccc-cccc-cccccccccc01', 264],
      ['cccccccc-cccc-cccc-cccc-cccccccccc03', 174],
      ['cccccccc-cccc-cccc-cccc-cccccccccc05', -10],
    ]);

    for (const [id, offset] of expected) {
      const sqlOffset =
        offset < 0
          ? `- interval '${Math.abs(offset)} days'`
          : `+ interval '${offset} days'`;
      const seedRow = seed.split('\n').find((line) => line.includes(`'${id}'`));
      expect(seedRow, `missing document seed row ${id}`).toBeDefined();
      expect(seedRow).toContain(`CURRENT_DATE ${sqlOffset}`);
      const manifestRow = DOCUMENTS.find((document) => document.id === id);
      expect(manifestRow?.expiryOffsetDays).toBe(offset);
    }
  });

  it('computes relative dates without month or leap-year drift', () => {
    const today = new Date('2028-02-28T23:59:59.000Z');
    expect(seedRelativeDate(1, today)).toBe('2028-02-29');
    expect(seedRelativeDate(2, today)).toBe('2028-03-01');
    expect(seedRelativeDate(-59, today)).toBe('2027-12-31');
  });

  it('contains no committed hook-secret literal or fallback', () => {
    const config = readFileSync(resolve('playwright.config.ts'), 'utf8');
    const manifest = readFileSync(resolve('e2e/fixtures/manifest.ts'), 'utf8');
    expect(`${config}\n${manifest}`).not.toContain('odesa-e2e-test-hooks-v0');
    expect(manifest).not.toMatch(/TEST_HOOKS_SECRET\s*=.*\|\|/);
  });
});
