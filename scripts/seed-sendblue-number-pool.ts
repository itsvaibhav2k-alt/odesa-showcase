/**
 * Sendblue number-pool seeder.
 *
 * Inserts E.164 numbers into `sendblue_number_pool` so the onboarding
 * messaging step can claim them. Idempotent on `e164`: rows already
 * present are left untouched.
 *
 * Usage:
 *
 *   npx tsx scripts/seed-sendblue-number-pool.ts +12025550100 +16452468236
 *
 *   # Or pipe a CSV/whitespace-delimited list:
 *   cat numbers.txt | npx tsx scripts/seed-sendblue-number-pool.ts -
 *
 * Requires `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_URL`
 * to be set (uses {@link createAdminClient} so RLS is bypassed).
 */

import { createAdminClient } from '../src/lib/supabase/admin';

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

interface SeedResult {
  inserted: string[];
  skipped: Array<{ e164: string; reason: string }>;
  total: number;
}

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

const defaultLogger: Logger = {
  info: (msg) => console.log(`[seed-sendblue-number-pool] ${msg}`),
  warn: (msg) => console.warn(`[seed-sendblue-number-pool] ${msg}`),
};

/**
 * Idempotently insert one number row at a time. Uses `upsert` keyed on
 * the `e164` UNIQUE constraint with `ignoreDuplicates: true` so the
 * function is safe to re-run with overlap.
 */
export async function seedSendblueNumberPool(
  rawNumbers: ReadonlyArray<string>,
  options: {
    client?: ReturnType<typeof createAdminClient>;
    logger?: Logger;
  } = {},
): Promise<SeedResult> {
  const logger = options.logger ?? defaultLogger;
  const client = options.client ?? createAdminClient();

  const result: SeedResult = {
    inserted: [],
    skipped: [],
    total: rawNumbers.length,
  };

  for (const raw of rawNumbers) {
    const e164 = raw.trim();
    if (!e164) continue;

    if (!E164_REGEX.test(e164)) {
      logger.warn(`Skipping malformed E.164: "${e164}"`);
      result.skipped.push({ e164, reason: 'invalid_e164' });
      continue;
    }

    // Use `upsert` with `ignoreDuplicates` so the script remains
    // idempotent on the `e164` UNIQUE constraint.
    const { data, error } = await client
      .from('sendblue_number_pool')
      .upsert(
        { e164, status: 'available' },
        { onConflict: 'e164', ignoreDuplicates: true },
      )
      .select('e164');

    if (error) {
      logger.warn(`Failed to upsert ${e164}: ${error.message}`);
      result.skipped.push({ e164, reason: error.message });
      continue;
    }

    if (data && data.length > 0) {
      result.inserted.push(e164);
      logger.info(`Inserted ${e164}`);
    } else {
      // ignoreDuplicates → empty result on conflict
      result.skipped.push({ e164, reason: 'already_exists' });
      logger.info(`Skipped ${e164} (already in pool)`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      'Usage: npx tsx scripts/seed-sendblue-number-pool.ts <e164...> | -',
    );
    process.exit(1);
  }

  let numbers: string[];
  if (args[0] === '-') {
    const input = await readStdin();
    numbers = input
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  } else {
    numbers = args;
  }

  if (numbers.length === 0) {
    console.error('No numbers supplied; nothing to seed.');
    process.exit(1);
  }

  const result = await seedSendblueNumberPool(numbers);
  console.log(
    `\nSeed complete — inserted: ${result.inserted.length}, ` +
      `skipped: ${result.skipped.length}, total: ${result.total}`,
  );
  if (result.skipped.length > 0) {
    for (const { e164, reason } of result.skipped) {
      console.log(`  skipped ${e164} — ${reason}`);
    }
  }
}

// `import.meta.main`-style guard: only run main() when executed
// directly (tsx scripts/...). Importable as a module otherwise.
const isDirectInvocation =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  process.argv[1].endsWith('seed-sendblue-number-pool.ts');

if (isDirectInvocation) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
