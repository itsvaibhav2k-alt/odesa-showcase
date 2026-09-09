/**
 * Monthly cross-property meta-learning cron — fires at 4am UTC on the
 * first day of each month. Runs the Opus loop per organization.
 */

import { inngest } from '@/lib/inngest/client';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { runCrossProperty } from '@/lib/agent/meta/cross-property';

export const metaLearningMonthlyCron = inngest.createFunction(
  {
    id: 'meta-learning-monthly',
    triggers: [{ cron: '0 4 1 * *' }],
  },
  async ({ step }) => {
    const db = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const orgIds = await step.run('list-organizations', async () => {
      const { data } = await db.from('organizations').select('id');
      return (data ?? []).map((o) => o.id);
    });

    let totalInsights = 0;

    for (const organizationId of orgIds) {
      await step.run(`meta-${organizationId}`, async () => {
        const result = await runCrossProperty({ db, organizationId });
        totalInsights += result.insightsEmitted;
        return {
          organizationId,
          factsScanned: result.factsScanned,
          proposalsScanned: result.proposalsScanned,
          insightsEmitted: result.insightsEmitted,
        };
      });
    }

    return {
      orgsProcessed: orgIds.length,
      totalInsights,
    };
  },
);
