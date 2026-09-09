/**
 * Reliability status — the PURE builder behind Odesa's visible
 * job/notification/worker health surface.
 *
 * `buildReliabilityStatus(input)` folds already-fetched, already-shaped
 * telemetry (the IO lives in `./queries`) into a typed status the
 * settings reliability card and the `/financials` reliability strip both
 * render. It is deterministic given an injected `now` clock — no hidden
 * Date, no Supabase — so it is unit-tested directly.
 *
 * Honesty contract (the whole point of this module):
 *   - Three levels only: `healthy` | `degraded` | `unknown`.
 *   - It NEVER reports `healthy`/green when a signal is merely absent.
 *     Missing data → `unknown` (calm, neutral), distinct from `degraded`
 *     (something we can see is wrong). Overall is `healthy` ONLY when
 *     every signal is provably healthy.
 *   - It never fabricates a heartbeat: freshness is derived from real
 *     timestamps (`daily_digests.created_at`, `weekly_reports.generated_at`,
 *     `agent_runs.finished_at/status`, health-flag `created_at`,
 *     `messages.sent_at/draft_status/provider_message_id`) and the
 *     config-gated worker `/healthz` probe.
 *
 * Division of labour: this module interprets; `./queries` fetches and
 * normalizes. No money, no aggregation, no side effects.
 */

// ===========================================================================
// Levels & shapes
// ===========================================================================

export type ReliabilityLevel = "healthy" | "degraded" | "unknown";

/** A single recent outbound message, normalized for delivery inference. */
export interface OutboundMessageSignal {
  /** `messages.sent_at` — provider accepted the send. */
  sentAt: string | null;
  /** `messages.draft_status` (message_draft_status enum value). */
  draftStatus: string;
  /** `messages.provider_message_id` — provider's delivery handle. */
  providerMessageId: string | null;
  /** `messages.created_at` — fallback ordering key. */
  createdAt: string;
  deliveryStatus?: string;
}

/** Result of the config-gated `/healthz` probe (resolved in `./queries`). */
export interface WorkerProbe {
  /** Is a worker telemetry URL configured at all? */
  configured: boolean;
  /** `true` reachable, `false` unreachable, `null` not probed/unknown. */
  reachable: boolean | null;
  /** Optional override copy from the probe. */
  detail?: string | null;
}

/** Already-fetched, already-shaped telemetry — the pure builder's input. */
export interface ReliabilityInput {
  /** Injected clock — the single source of "now". */
  now: Date;
  /** Latest `daily_digests` row's `created_at`, or null if none. */
  digest: { lastRunAt: string | null };
  /** Latest `weekly_reports` row's `generated_at`, or null if none. */
  weekly: { lastRunAt: string | null };
  /** Latest `health_flag` action_proposal `created_at`, or null. */
  healthSweep: { lastRunAt: string | null };
  /** Latest `agent_runs` finished_at + status (or nulls if none). */
  agentRun: { lastFinishedAt: string | null; lastStatus: string | null };
  /** Recent outbound messages (newest-first preferred, not required). */
  notifications: { recentOutbound: OutboundMessageSignal[] };
  /** Worker `/healthz` probe outcome. */
  worker: WorkerProbe;
  /** Messaging-provider + Inngest credential presence. */
  config: { messagingConfigured: boolean; inngestConfigured: boolean };
}

/** Per-scheduled-job reliability row. */
export interface JobReliability {
  key: string;
  name: string;
  /** ISO timestamp of the last observed run, or null if never. */
  lastRunAt: string | null;
  /** Derived health for this job. */
  lastStatus: ReliabilityLevel;
  /** True only when a real `lastRunAt` is overdue past its grace window. */
  staleFlag: boolean;
  /** ISO timestamp the next run is expected by, or null (event-driven). */
  nextExpected: string | null;
  /** Plain-English operator copy. */
  detail: string;
}

/** A non-job signal (notifications / worker / config). */
export interface SignalReliability {
  level: ReliabilityLevel;
  detail: string;
}

export interface NotificationReliability extends SignalReliability {
  /** Most recent confirmed-sent timestamp, or null. */
  lastSentAt: string | null;
}

export interface ConfigReliability extends SignalReliability {
  messagingConfigured: boolean;
  inngestConfigured: boolean;
}

/**
 * Client-safe readiness digest derived from the signal states. Both
 * surfaces render this: `/financials` shows it ALONE (compact), `/settings`
 * shows it as a heading above the full row-by-row detail. It never invents
 * confidence — `attentionCount` is just the number of signals that are not
 * provably healthy, so an `unknown` signal is honestly counted, never
 * silently dropped into "delivering".
 */
export interface ReliabilitySummary {
  /** Heading, e.g. "2 setup items need attention before production." */
  heading: string;
  /** One-line readiness sentence, e.g. "Daily digest and weekly briefing
   *  are delivering. Worker telemetry and messaging configuration need
   *  setup before production." */
  sentence: string;
  /** Count of signals that are not provably healthy (degraded or unknown). */
  attentionCount: number;
}

/** The full status object every reliability surface renders. */
export interface ReliabilityStatus {
  overall: ReliabilityLevel;
  generatedAt: string;
  summary: ReliabilitySummary;
  jobs: JobReliability[];
  notifications: NotificationReliability;
  worker: SignalReliability;
  config: ConfigReliability;
}

// ===========================================================================
// Tunables
// ===========================================================================

const HOUR_MS = 3_600_000;

/** Daily jobs: grace window before "fresh" becomes "overdue". */
const DAILY_STALE_HOURS = 26;
const DAILY_INTERVAL_HOURS = 24;

/** Weekly jobs: 8-day grace (one missed Monday + a day). */
const WEEKLY_STALE_HOURS = 24 * 8;
const WEEKLY_INTERVAL_HOURS = 24 * 7;

/** agent_runs statuses we treat as a hard failure. */
const AGENT_FAILURE_STATUSES = new Set([
  "failed",
  "error",
  "stuck",
  "timed_out",
  "cancelled",
  "terminated",
  "expired",
  "condition_failed",
]);

/** agent_runs statuses that mean "still working" (not a failure). */
const AGENT_IN_PROGRESS_STATUSES = new Set([
  "running",
  "queued",
  "pending",
  "active",
]);

/**
 * Draft statuses that assert a send was INTENDED. If one of these lacks
 * both a provider handle and a sent timestamp, the send silently failed.
 * `pending_review` is deliberately excluded — it is the by-design hold
 * Odesa uses when a provider call fails (never an automatic retry/claim),
 * so it is neutral, not a failure.
 */
const SENT_INTENT_STATUSES = new Set([
  "auto_sent",
  "sent_by_human",
  "approved",
]);

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// ===========================================================================
// Small pure helpers
// ===========================================================================

function ageHours(now: Date, iso: string): number {
  return (now.getTime() - Date.parse(iso)) / HOUR_MS;
}

function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * HOUR_MS).toISOString();
}

/**
 * Format an ISO timestamp as `Monday 8:01 AM` (UTC). Deterministic and
 * dependency-free so copy stays stable across environments and tests; the
 * operator's local timezone isn't known to the server, so UTC is the
 * honest, consistent choice.
 */
export function formatRunLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an unknown time";
  const weekday = WEEKDAYS[d.getUTCDay()];
  let hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const meridiem = hour < 12 ? "AM" : "PM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${weekday} ${hour}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

// ===========================================================================
// Per-signal builders
// ===========================================================================

/**
 * A scheduled job with a fixed cadence (daily digest, weekly briefing).
 * Absent `lastRunAt` → `unknown` (never green). Present but overdue past
 * the grace window → `degraded` + `staleFlag`. Otherwise → `healthy`.
 */
function buildScheduledJob(args: {
  key: string;
  name: string;
  /** Lower-case noun used in copy, e.g. `operator digest`. */
  label: string;
  lastRunAt: string | null;
  now: Date;
  intervalHours: number;
  staleHours: number;
  cadenceWord: "day" | "week";
}): JobReliability {
  const {
    key,
    name,
    label,
    lastRunAt,
    now,
    intervalHours,
    staleHours,
    cadenceWord,
  } = args;

  if (lastRunAt === null) {
    return {
      key,
      name,
      lastRunAt: null,
      lastStatus: "unknown",
      staleFlag: false,
      nextExpected: null,
      detail: `No ${label} recorded yet — status can't be confirmed.`,
    };
  }

  const stale = ageHours(now, lastRunAt) > staleHours;
  const when = formatRunLabel(lastRunAt);
  return {
    key,
    name,
    lastRunAt,
    lastStatus: stale ? "degraded" : "healthy",
    staleFlag: stale,
    nextExpected: addHours(lastRunAt, intervalHours),
    detail: stale
      ? `Last ${label} was ${when} — overdue, expected every ${cadenceWord}.`
      : `Last ${label} delivered ${when}.`,
  };
}

/**
 * Health sweep freshness is derived from the most recent `health_flag`
 * proposal. A healthy portfolio legitimately produces NO flags, so the
 * absence of flags can never be read as a failure — it is `unknown`. A
 * recent flag is positive proof the sweep ran (`healthy`); an old-only
 * flag can't confirm the sweep is current, so it degrades to `unknown`,
 * never `degraded`.
 */
function buildHealthSweepJob(
  lastRunAt: string | null,
  now: Date,
): JobReliability {
  const base = { key: "health-sweep", name: "Daily health sweep" };

  if (lastRunAt === null) {
    return {
      ...base,
      lastRunAt: null,
      lastStatus: "unknown",
      staleFlag: false,
      nextExpected: null,
      detail:
        "No recent health flags — a healthy portfolio raises none, so the sweep can't be confirmed from flags alone.",
    };
  }

  const fresh = ageHours(now, lastRunAt) <= DAILY_STALE_HOURS;
  const when = formatRunLabel(lastRunAt);
  return {
    ...base,
    lastRunAt,
    lastStatus: fresh ? "healthy" : "unknown",
    staleFlag: false,
    nextExpected: addHours(lastRunAt, DAILY_INTERVAL_HOURS),
    detail: fresh
      ? `Health sweep active — last flag ${when}.`
      : `Last health flag ${when}; no recent flags to confirm the current sweep — treated as unknown.`,
  };
}

/**
 * Agent operator runs are event-driven (fired by inbound activity), so
 * "stale" does not apply. We report the latest run's outcome: a failed
 * status is `degraded`; an in-progress run is `healthy` (the system is
 * working — the watchdog reconciles genuinely-stuck runs); a completed
 * run is `healthy`; no runs at all is `unknown`.
 */
function buildAgentJob(agentRun: ReliabilityInput["agentRun"]): JobReliability {
  const base = {
    key: "agent-runs",
    name: "Agent operator runs",
    staleFlag: false,
    nextExpected: null,
  };
  const { lastFinishedAt, lastStatus } = agentRun;

  if (lastFinishedAt === null && lastStatus === null) {
    return {
      ...base,
      lastRunAt: null,
      lastStatus: "unknown",
      detail: "No agent runs recorded yet.",
    };
  }

  const status = lastStatus ?? "";
  const when = lastFinishedAt ? formatRunLabel(lastFinishedAt) : "recently";

  if (AGENT_FAILURE_STATUSES.has(status)) {
    return {
      ...base,
      lastRunAt: lastFinishedAt,
      lastStatus: "degraded",
      detail: `Most recent agent run failed (${when}).`,
    };
  }

  if (AGENT_IN_PROGRESS_STATUSES.has(status)) {
    return {
      ...base,
      lastRunAt: lastFinishedAt,
      lastStatus: "healthy",
      detail: "An agent run is currently in progress.",
    };
  }

  return {
    ...base,
    lastRunAt: lastFinishedAt,
    lastStatus: "healthy",
    detail: `Agent runs healthy — last completed ${when}.`,
  };
}

/**
 * Notification delivery health from recent outbound messages.
 *   - degraded: a message asserts it was sent yet has no provider handle
 *     AND no `sent_at` → a silent delivery failure.
 *   - healthy: at least one provider-confirmed delivery and no failures.
 *   - unknown: nothing to confirm (no outbound, or all still pending).
 */
function buildNotifications(
  recentOutbound: OutboundMessageSignal[],
): NotificationReliability {
  if (recentOutbound.length === 0) {
    return {
      level: "unknown",
      lastSentAt: null,
      detail: "No recent outbound messages to confirm delivery.",
    };
  }

  const delivered = recentOutbound.filter(
    (m) => m.deliveryStatus === "delivered",
  );
  const providerFailed = recentOutbound.filter(
    (m) => m.deliveryStatus === "failed" || m.deliveryStatus === "undelivered",
  );
  const failed = recentOutbound.filter(
    (m) =>
      SENT_INTENT_STATUSES.has(m.draftStatus) &&
      m.providerMessageId === null &&
      m.sentAt === null,
  );

  // Most recent confirmed send timestamp (prefer sent_at, fall back to created_at).
  const lastSentAt =
    delivered
      .map((m) => m.sentAt ?? m.createdAt)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

  if (failed.length > 0 || providerFailed.length > 0) {
    return {
      level: "degraded",
      lastSentAt,
      detail: `${failed.length + providerFailed.length} recent message${
        failed.length + providerFailed.length === 1 ? "" : "s"
      } failed or was not delivered.`,
    };
  }

  if (delivered.length > 0) {
    return {
      level: "healthy",
      lastSentAt,
      detail: `Last message delivered ${formatRunLabel(lastSentAt as string)} (delivery-confirmed).`,
    };
  }

  return {
    level: "unknown",
    lastSentAt: null,
    detail:
      "Recent messages are queued or provider-accepted; delivery is not yet confirmed.",
  };
}

/**
 * Worker health from the config-gated `/healthz` probe. Unconfigured →
 * `unknown` (never green): we will not claim a worker is alive we can't
 * see. Reachable → `healthy`; unreachable → `degraded`.
 */
function buildWorker(probe: WorkerProbe): SignalReliability {
  if (!probe.configured) {
    return {
      level: "unknown",
      detail:
        probe.detail ?? "Worker telemetry not configured — health unknown.",
    };
  }
  if (probe.reachable === true) {
    return {
      level: "healthy",
      detail: probe.detail ?? "Operator worker reachable — /healthz OK.",
    };
  }
  if (probe.reachable === false) {
    return {
      level: "degraded",
      detail:
        probe.detail ??
        "Operator worker unreachable — /healthz did not respond.",
    };
  }
  return {
    level: "unknown",
    detail: probe.detail ?? "Worker health could not be determined.",
  };
}

/**
 * Messaging-provider + Inngest credential sanity. Missing credentials are
 * a known, actionable problem (`degraded`), not merely `unknown`.
 */
function buildConfig(config: ReliabilityInput["config"]): ConfigReliability {
  const { messagingConfigured, inngestConfigured } = config;
  if (messagingConfigured && inngestConfigured) {
    return {
      level: "healthy",
      messagingConfigured,
      inngestConfigured,
      detail: "Messaging provider and Inngest credentials are present.",
    };
  }
  const missing: string[] = [];
  if (!messagingConfigured) missing.push("a messaging provider");
  if (!inngestConfigured) missing.push("Inngest credentials");
  return {
    level: "degraded",
    messagingConfigured,
    inngestConfigured,
    detail: `Configuration incomplete — missing ${missing.join(" and ")}.`,
  };
}

// ===========================================================================
// Public builder
// ===========================================================================

/** Reduce a set of levels: any degraded → degraded; else any unknown → unknown. */
function rollUp(levels: ReliabilityLevel[]): ReliabilityLevel {
  if (levels.includes("degraded")) return "degraded";
  if (levels.includes("unknown")) return "unknown";
  return "healthy";
}

/**
 * Short, lower-case readiness labels per signal — phrased for the one-line
 * summary sentence (the row-by-row detail keeps the longer formal names).
 */
const SUMMARY_LABELS: Record<string, string> = {
  "daily-digest": "daily digest",
  "weekly-briefing": "weekly briefing",
  "health-sweep": "health sweep",
  "agent-runs": "agent runs",
  notifications: "messaging delivery",
  worker: "worker telemetry",
  config: "messaging configuration",
};

/** Capitalize the first character of a sentence fragment. */
function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** Join labels as "a", "a and b", or "a, b, and c". */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Fold the per-signal levels into a client-safe readiness summary. Healthy
 * signals are reported as "delivering"; everything not provably healthy
 * (degraded OR unknown) is honestly counted and listed as needing setup
 * before production — `unknown` is never quietly promoted to delivering.
 */
function buildSummary(args: {
  jobs: JobReliability[];
  notifications: NotificationReliability;
  worker: SignalReliability;
  config: ConfigReliability;
}): ReliabilitySummary {
  const signals: { key: string; level: ReliabilityLevel }[] = [
    ...args.jobs.map((j) => ({ key: j.key, level: j.lastStatus })),
    { key: "notifications", level: args.notifications.level },
    { key: "worker", level: args.worker.level },
    { key: "config", level: args.config.level },
  ];

  const labelFor = (key: string): string => SUMMARY_LABELS[key] ?? key;
  const delivering = signals
    .filter((s) => s.level === "healthy")
    .map((s) => labelFor(s.key));
  const attention = signals
    .filter((s) => s.level !== "healthy")
    .map((s) => labelFor(s.key));

  const sentenceParts: string[] = [];
  if (delivering.length > 0) {
    sentenceParts.push(
      capitalizeFirst(
        `${joinList(delivering)} ${delivering.length === 1 ? "is" : "are"} delivering.`,
      ),
    );
  }
  if (attention.length > 0) {
    sentenceParts.push(
      capitalizeFirst(
        `${joinList(attention)} ${
          attention.length === 1 ? "needs" : "need"
        } setup before production.`,
      ),
    );
  }
  if (sentenceParts.length === 0) {
    sentenceParts.push("All operator signals are reporting in.");
  }

  const heading =
    attention.length === 0
      ? "All operator signals are reporting in."
      : `${attention.length} setup item${attention.length === 1 ? "" : "s"} ${
          attention.length === 1 ? "needs" : "need"
        } attention before production.`;

  return {
    heading,
    sentence: sentenceParts.join(" "),
    attentionCount: attention.length,
  };
}

/**
 * Build the full reliability status from already-fetched telemetry.
 *
 * @param input - Normalized telemetry + injected `now` clock.
 * @returns A typed {@link ReliabilityStatus}; `overall` is `healthy` only
 *          when every signal is provably healthy — never green on absence.
 */
export function buildReliabilityStatus(
  input: ReliabilityInput,
): ReliabilityStatus {
  const { now } = input;

  const jobs: JobReliability[] = [
    buildScheduledJob({
      key: "daily-digest",
      name: "Daily operator digest",
      label: "operator digest",
      lastRunAt: input.digest.lastRunAt,
      now,
      intervalHours: DAILY_INTERVAL_HOURS,
      staleHours: DAILY_STALE_HOURS,
      cadenceWord: "day",
    }),
    buildScheduledJob({
      key: "weekly-briefing",
      name: "Weekly owner briefing",
      label: "owner briefing",
      lastRunAt: input.weekly.lastRunAt,
      now,
      intervalHours: WEEKLY_INTERVAL_HOURS,
      staleHours: WEEKLY_STALE_HOURS,
      cadenceWord: "week",
    }),
    buildHealthSweepJob(input.healthSweep.lastRunAt, now),
    buildAgentJob(input.agentRun),
  ];

  const notifications = buildNotifications(input.notifications.recentOutbound);
  const worker = buildWorker(input.worker);
  const config = buildConfig(input.config);

  const overall = rollUp([
    ...jobs.map((j) => j.lastStatus),
    notifications.level,
    worker.level,
    config.level,
  ]);

  const summary = buildSummary({ jobs, notifications, worker, config });

  return {
    overall,
    generatedAt: now.toISOString(),
    summary,
    jobs,
    notifications,
    worker,
    config,
  };
}
