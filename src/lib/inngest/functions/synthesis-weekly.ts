/**
 * Weekly per-property synthesis cron — fires every Monday at 3am UTC,
 * before the briefing at 7am. Runs the Sonnet 3-phase consolidation.
 */

import { inngest } from '@/lib/inngest/client';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { runSynthesis } from '@/lib/agent/meta/synthesis';

export const synthesisWeeklyCron = inngest.createFunction(
  {
    id: 'synthesis-weekly-monday',
    triggers: [{ cron: '0 3 * * 1' }],
  },
  async ({ step }) => {
    const db = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const propertyIds = await step.run('list-properties', async () => {
      const { data } = await db.from('properties').select('id');
      return (data ?? []).map((p) => p.id);
    });

    let totalMerged = 0;
    let totalSuperseded = 0;
    let totalPruned = 0;
    let totalRulesQueued = 0;

    for (const propertyId of propertyIds) {
      await step.run(`synthesis-${propertyId}`, async () => {
        const result = await runSynthesis({ db, propertyId });
        totalMerged += result.merged;
        totalSuperseded += result.superseded;
        totalPruned += result.pruned;
        totalRulesQueued += result.rulesQueued;
        return {
          propertyId,
          factsScanned: result.factsScanned,
          proposalsCount: result.proposalsCount,
          approvedCount: result.approvedCount,
          merged: result.merged,
          superseded: result.superseded,
          pruned: result.pruned,
          rulesQueued: result.rulesQueued,
        };
      });
    }

    return {
      propertiesProcessed: propertyIds.length,
      totalMerged,
      totalSuperseded,
      totalPruned,
      totalRulesQueued,
    };
  },
);
