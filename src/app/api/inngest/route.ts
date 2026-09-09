import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { weeklyBriefingCron } from '@/lib/inngest/functions/weekly-briefing';
import { rentCycleDailyCron } from '@/lib/inngest/functions/rent-cycle-daily';
import { reflectionNightlyCron } from '@/lib/inngest/functions/reflection-nightly';
import { synthesisWeeklyCron } from '@/lib/inngest/functions/synthesis-weekly';
import { metaLearningMonthlyCron } from '@/lib/inngest/functions/meta-learning-monthly';
import { backfillMemoryEmbeddings } from '@/lib/inngest/functions/backfill-memory-embeddings';
import { fireScheduledAction } from '@/lib/inngest/functions/fire-scheduled-action';
import { agentRunWatchdogCron } from '@/lib/inngest/functions/agent-run-watchdog';
import { generateRentCyclesCron } from '@/lib/inngest/functions/generate-rent-cycles';
import { generateDailyDigestCron } from '@/lib/inngest/functions/daily-digest';
import { dailyHealthCheckCron } from '@/lib/inngest/functions/daily-health-check';
import { deliverDeferredNotificationFn } from '@/lib/inngest/functions/deliver-deferred-notification';

export const maxDuration = 300;

// NOTE: `runOperatorDispatcherFn` is deliberately NOT served here. It
// transitively imports the Claude Agent SDK, whose linux-x64 native
// binary (~249MB) exceeds Vercel's 250MB function cap. It is served on
// Railway by the dedicated Inngest app 'odesa-operator-worker'
// (src/worker/inngest-server.ts), distinct from this app's id 'odesa' —
// Inngest keys apps by id, and two services syncing the same id from
// different URLs overwrite each other (last sync wins, missing functions
// archived). `scripts/check-vercel-sdk-leak.mjs` (npm run check:sdk-leak)
// guards against the SDK chain re-entering the Vercel bundle.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    weeklyBriefingCron,
    rentCycleDailyCron,
    reflectionNightlyCron,
    synthesisWeeklyCron,
    metaLearningMonthlyCron,
    backfillMemoryEmbeddings,
    fireScheduledAction,
    agentRunWatchdogCron,
    generateRentCyclesCron,
    generateDailyDigestCron,
    dailyHealthCheckCron,
    deliverDeferredNotificationFn,
  ],
});
