/**
 * Nightly per-property reflection cron — fires once per day at 2am UTC.
 *
 * For every property that had ≥1 ActionProposal in the last 24h, run the
 * Haiku-driven reflection loop. Per-property failures are surfaced via the
 * step's thrown error but do not abort sibling properties.
 */

import { inngest } from '@/lib/inngest/client';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { runReflection } from '@/lib/agent/meta/reflection';

export const reflectionNightlyCron = inngest.createFunction(
  {
    id: 'reflection-nightly',
    triggers: [{ cron: '0 2 * * *' }],
  },
  async ({ step }) => {
    const db = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const propertyIds = await step.run('list-active-properties', async () => {
      const { data } = await db
        .from('action_proposals')
        .select('property_id')
        .gte('created_at', sinceIso);
      const ids = new Set<string>();
      for (const row of (data ?? []) as Array<{ property_id: string | null }>) {
        if (row.property_id) ids.add(row.property_id);
      }
      return Array.from(ids);
    });

    let totalFactsCreated = 0;

    for (const propertyId of propertyIds) {
      await step.run(`reflection-${propertyId}`, async () => {
        const result = await runReflection({ db, propertyId });
        totalFactsCreated += result.factsCreated;
        return {
          propertyId,
          proposalsScanned: result.proposalsScanned,
          factsCreated: result.factsCreated,
        };
      });
    }

    return {
      propertiesProcessed: propertyIds.length,
      totalFactsCreated,
      windowStart: sinceIso,
    };
  },
);
