/**
 * Weekly briefing cron — fires every Monday at 7am UTC, fans out across
 * every organization, computes metrics, upserts the briefing into
 * `weekly_reports`, and SMSes the owner. Failures per-org are logged
 * but do not abort the remaining orgs.
 */

import { inngest } from '@/lib/inngest/client';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { computeBriefingMetrics } from '@/lib/briefing/metrics';
import { generateBriefingText } from '@/lib/briefing/generate';
import { mondayOfWeek, persistBriefing } from '@/lib/briefing/persist';
import { notifyLandlord } from '@/lib/messaging/notify';

export const weeklyBriefingCron = inngest.createFunction(
  {
    id: 'weekly-briefing-monday',
    triggers: [{ cron: '0 7 * * 1' }],
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

    const weekStart = mondayOfWeek();

    for (const organizationId of orgIds) {
      await step.run(`briefing-${organizationId}`, async () => {
        const metrics = await computeBriefingMetrics({
          db,
          organizationId,
          weekStartDate: weekStart,
        });

        // Anchor property: provides per-property worker context for
        // prose polish; metrics remain org-scoped. v1 picks first by
        // name asc. Skips orgs without any properties.
        const { data: anchorProperty } = await db
          .from('properties')
          .select('id')
          .eq('organization_id', organizationId)
          .order('name', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!anchorProperty?.id) {
          return { organizationId, skipped: 'no_properties' };
        }

        const briefing = await generateBriefingText(metrics, anchorProperty.id, {
          admin: db,
        });
        const result = await persistBriefing({ db, organizationId, briefing });
        if (!result.ok) {
          throw new Error(`persist failed for ${organizationId}: ${result.error}`);
        }
        const smsResult = await notifyLandlord({
          db,
          organizationId,
          body: `${briefing.briefingText} odesa.app/w`,
        });
        return {
          organizationId,
          reportId: result.id,
          smsSent: smsResult.ok,
          smsError: smsResult.error,
        };
      });
    }

    return { orgsProcessed: orgIds.length, weekStart };
  },
);
