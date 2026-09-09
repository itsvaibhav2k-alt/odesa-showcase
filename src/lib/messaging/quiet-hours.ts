/**
 * Owner-notification quiet hours. Cron-driven landlord alerts (rent
 * escalations at 08:00 UTC, weekly briefing at 07:00 UTC Monday) land
 * at 3-4am US-local — correct content, alarming delivery time. This
 * module decides whether an owner SMS may go out now or must wait for
 * the org's morning.
 *
 * Window: deliver immediately between 09:00 and 21:00 in the org's
 * timezone; otherwise defer to the NEXT 09:00 local. The deferral
 * instant is computed as a minutes-until-target delta off the current
 * local wall clock, so no tz-database conversion is needed. A DST
 * transition inside the wait can skew delivery by one hour — accepted,
 * it still lands in the morning.
 *
 * Tenant-facing cron messages never hit this path: they are queued as
 * pending_review drafts, not sent.
 */

export const OWNER_NOTIFY_WINDOW_START_HOUR = 9;
export const OWNER_NOTIFY_WINDOW_END_HOUR = 21;

/** Used when the org's timezone string is missing or unparseable. */
export const FALLBACK_TIMEZONE = 'America/New_York';

const MINUTES_PER_DAY = 24 * 60;

interface LocalWallClock {
  hour: number;
  minute: number;
}

function localWallClock(now: Date, timezone: string): LocalWallClock {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const read = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  // Intl renders midnight as "24" with hour12:false in some runtimes.
  return { hour: read('hour') % 24, minute: read('minute') };
}

function safeLocalWallClock(now: Date, timezone: string): LocalWallClock {
  try {
    return localWallClock(now, timezone);
  } catch {
    return localWallClock(now, FALLBACK_TIMEZONE);
  }
}

/**
 * Returns `null` when an owner notification may be delivered now, or
 * the ISO instant of the next 09:00 in the org's timezone when it must
 * be deferred.
 */
export function resolveOwnerNotifyDeferral(
  now: Date,
  timezone: string,
): string | null {
  const { hour, minute } = safeLocalWallClock(
    now,
    timezone.trim().length > 0 ? timezone : FALLBACK_TIMEZONE,
  );
  if (
    hour >= OWNER_NOTIFY_WINDOW_START_HOUR &&
    hour < OWNER_NOTIFY_WINDOW_END_HOUR
  ) {
    return null;
  }
  const minutesOfDay = hour * 60 + minute;
  const targetMinutes = OWNER_NOTIFY_WINDOW_START_HOUR * 60;
  const minutesUntilTarget =
    (targetMinutes - minutesOfDay + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const deliverAt = new Date(now.getTime() + minutesUntilTarget * 60_000);
  return deliverAt.toISOString();
}
