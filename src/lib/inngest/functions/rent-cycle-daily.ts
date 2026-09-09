/**
 * Daily rent cycle cron — fires once per day at 8am UTC (roughly 4am
 * East Coast; revisit to be org-timezone-local in Phase 8).
 *
 * One pass per tick: advance every non-terminal rent_event via the
 * state machine. Tenant-facing side effects land as pending_review
 * drafts.
 *
 * Cycle-row CREATION lives in generate-rent-cycles.ts (06:00 UTC). The
 * emit pass that used to live here upserted with
 * `onConflict: 'lease_id,cycle_month'` and NO ignoreDuplicates — every
 * tick rewrote existing rows with `amount_paid: 0, status: 'pending'`,
 * wiping payment state for the whole current month. Do not reintroduce
 * row creation here.
 *
 * Landlord escalation ("late_7 → escalated") sets the event to
 * `escalated` and logs an escalation row in `conversations` — the actual
 * SMS to the landlord lands when Agent L's messaging layer merges.
 */

import { inngest } from '@/lib/inngest/client';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { tickRentEvent } from '@/lib/rent/tick';

export const rentCycleDailyCron = inngest.createFunction(
  {
    id: 'rent-cycle-daily',
    triggers: [{ cron: '0 8 * * *' }],
  },
  async ({ step }) => {
    const db = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const today = await step.run('resolve-today', async () =>
      new Date().toISOString().slice(0, 10),
    );

    const result = await step.run('advance-open-events', async () => {
      const { data: events } = await db
        .from('rent_events')
        .select('id')
        .not('status', 'in', '("paid","escalated","plan_agreed")');

      const ticks: Array<{ id: string; next: string; changed: boolean }> = [];
      for (const e of events ?? []) {
        const tr = await tickRentEvent({ db, rentEventId: e.id, today });
        ticks.push({ id: e.id, next: tr.next, changed: tr.changed });
      }
      return { processed: ticks.length, changed: ticks.filter((t) => t.changed).length };
    });

    return { today, ...result };
  },
);

