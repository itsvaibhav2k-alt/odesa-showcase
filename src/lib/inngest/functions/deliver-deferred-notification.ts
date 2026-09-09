/**
 * deliver-deferred-notification — morning delivery for owner SMS held
 * back by quiet hours (src/lib/messaging/quiet-hours.ts).
 *
 * `notifyLandlord` emits NOTIFY_LANDLORD_DEFERRED_EVENT instead of
 * sending when the org's local clock is outside 09:00-21:00. This
 * function sleeps until the precomputed `deliverAt` instant, then
 * re-enters `notifyLandlord` with `urgent: true` so the gate cannot
 * defer the same alert twice.
 *
 * Retry safety: the whole send runs in one step and `notifyLandlord`
 * never throws (provider failure returns `ok: false` and the message
 * row is demoted to pending_review for the owner's review queue), so
 * Inngest never replays a successful provider send.
 */

import { inngest } from '@/lib/inngest/client';
import {
  NOTIFY_LANDLORD_DEFERRED_EVENT,
  NOTIFY_LANDLORD_DEFERRED_FN_ID,
  type NotifyLandlordDeferredEventData,
} from '@/lib/inngest/events';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyLandlord } from '@/lib/messaging/notify';

export const deliverDeferredNotificationFn = inngest.createFunction(
  {
    id: NOTIFY_LANDLORD_DEFERRED_FN_ID,
    retries: 2,
    triggers: [{ event: NOTIFY_LANDLORD_DEFERRED_EVENT }],
  },
  async ({ event, step }) => {
    const data = event.data as Partial<NotifyLandlordDeferredEventData>;
    if (
      typeof data?.organizationId !== 'string' ||
      typeof data?.body !== 'string' ||
      typeof data?.deliverAt !== 'string'
    ) {
      return { kind: 'skipped', reason: 'malformed_event_data' };
    }
    const deliverAt = new Date(data.deliverAt);
    if (Number.isNaN(deliverAt.getTime())) {
      return { kind: 'skipped', reason: 'invalid_deliver_at' };
    }

    await step.sleepUntil('wait-for-morning', deliverAt);

    return step.run('send', async () => {
      const db = createAdminClient();
      const result = await notifyLandlord({
        db,
        organizationId: data.organizationId as string,
        body: data.body as string,
        urgent: true,
      });
      return { kind: 'sent', ok: result.ok, error: result.error };
    });
  },
);
