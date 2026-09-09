'use client';

/**
 * `useInboxRealtime` — wave 3 stage 3.
 *
 * Subscribes the inbox surface to Supabase realtime so a new draft or
 * proposal arriving in another tab/session triggers `router.refresh()`
 * within ~250 ms. The hook keeps a single channel per `(orgId, hook
 * instance)` pair and tears it down on unmount.
 *
 * Channel: `inbox:${orgId}`. Subscribes to four `postgres_changes`
 * filters:
 *
 *   1. `public.messages`         INSERT|UPDATE  filter `organization_id=eq.<orgId>`
 *   2. `public.action_proposals` INSERT|UPDATE  filter `organization_id=eq.<orgId>`
 *   3. `public.rent_events`      INSERT|UPDATE  filter `organization_id=eq.<orgId>`
 *   4. `public.work_orders`      INSERT|UPDATE  filter `organization_id=eq.<orgId>`
 *
 * (3) + (4) keep the case-file column live: a vendor accepting a job or
 * a rent_event flipping to late_3 should redraw without a manual reload.
 *
 * Multiple events landing within `DEBOUNCE_MS` collapse to a single
 * trailing call to `onChange()` so a batch insert (e.g. a worker
 * committing five proposals at once) doesn't trigger five route
 * refreshes.
 *
 * Failure mode: if `subscribe()` reports a non-`SUBSCRIBED` status,
 * we log a warning ONCE per mount and quietly stay subscribed — the
 * hook never throws. The user keeps a working surface (just without
 * realtime push); the next mutation's `router.refresh()` resyncs.
 */

import { useEffect } from 'react';

import { createBrowserClient } from '@/lib/supabase/client';

const DEBOUNCE_MS = 250;

export function useInboxRealtime(orgId: string, onChange: () => void): void {
  useEffect(() => {
    if (!orgId) return;

    const supabase = createBrowserClient();
    const channel = supabase.channel(`inbox:${orgId}`);

    let trailingTimer: ReturnType<typeof setTimeout> | null = null;
    let warned = false;

    const trigger = () => {
      if (trailingTimer !== null) {
        clearTimeout(trailingTimer);
      }
      trailingTimer = setTimeout(() => {
        trailingTimer = null;
        try {
          onChange();
        } catch {
          // The consumer's onChange is router.refresh() in practice;
          // swallow defensively so realtime errors never surface as
          // unhandled exceptions.
        }
      }, DEBOUNCE_MS);
    };

    const filter = `organization_id=eq.${orgId}`;

    channel
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter },
        trigger,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter },
        trigger,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'action_proposals',
          filter,
        },
        trigger,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'action_proposals',
          filter,
        },
        trigger,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'rent_events',
          filter,
        },
        trigger,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rent_events',
          filter,
        },
        trigger,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'work_orders',
          filter,
        },
        trigger,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'work_orders',
          filter,
        },
        trigger,
      )
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED' && !warned) {
          warned = true;
          console.warn(
            `[useInboxRealtime] subscribe status=${status} for inbox:${orgId}`,
          );
        }
      });

    return () => {
      if (trailingTimer !== null) {
        clearTimeout(trailingTimer);
        trailingTimer = null;
      }
      // `removeChannel` calls `unsubscribe` and clears the client-side
      // registry so the same orgId can re-subscribe cleanly on remount.
      void supabase.removeChannel(channel);
    };
  }, [orgId, onChange]);
}
