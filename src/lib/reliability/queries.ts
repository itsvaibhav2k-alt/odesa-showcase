/**
 * Reliability query adapter — the RLS-scoped IO that feeds the pure
 * `buildReliabilityStatus` builder.
 *
 * Like `@/lib/financials/queries`, every read goes through
 * `createServerClient()` so RLS auto-scopes to the caller's
 * `organization_id`; this helper never accepts an `organizationId`. It
 * shapes the latest timestamps from `daily_digests`, `weekly_reports`,
 * `agent_runs`, and the `health_flag` proposals, samples recent outbound
 * `messages`, runs the config-gated worker `/healthz` probe, and reads
 * credential presence from the environment — then hands a normalized
 * {@link ReliabilityInput} to the pure builder. ALL interpretation lives
 * in `./status`; this file only fetches and normalizes.
 *
 * Resilience: each read is independent and failure-tolerant — a missing
 * table read or a probe timeout degrades that one signal to
 * absent/`unknown` rather than throwing, so the settings card always
 * renders.
 */

import { createServerClient } from "@/lib/supabase/server";

import {
  buildReliabilityStatus,
  type OutboundMessageSignal,
  type ReliabilityInput,
  type ReliabilityStatus,
  type WorkerProbe,
} from "./status";

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

/** How many recent outbound messages to sample for delivery inference. */
const OUTBOUND_SAMPLE_SIZE = 20;

/** Worker `/healthz` probe timeout (ms) — kept short so the page never hangs. */
const WORKER_PROBE_TIMEOUT_MS = 2500;

/**
 * Build the reliability status for the caller's organization (RLS-scoped),
 * for the current moment.
 *
 * @returns A typed {@link ReliabilityStatus}; signals that can't be read
 *          resolve to `unknown` rather than failing the whole surface.
 */
export async function getReliabilityStatus(): Promise<ReliabilityStatus> {
  const supabase = await createServerClient();
  const now = new Date();

  const [digestAt, weeklyAt, healthSweepAt, agentRun, recentOutbound, worker] =
    await Promise.all([
      fetchLatestDigestAt(supabase),
      fetchLatestWeeklyAt(supabase),
      fetchLatestHealthFlagAt(supabase),
      fetchLatestAgentRun(supabase),
      fetchRecentOutbound(supabase),
      probeWorker(),
    ]);

  const input: ReliabilityInput = {
    now,
    digest: { lastRunAt: digestAt },
    weekly: { lastRunAt: weeklyAt },
    healthSweep: { lastRunAt: healthSweepAt },
    agentRun,
    notifications: { recentOutbound },
    worker,
    config: readConfigSanity(),
  };

  return buildReliabilityStatus(input);
}

// ===========================================================================
// Per-source fetch helpers (each failure-tolerant)
// ===========================================================================

async function fetchLatestDigestAt(
  supabase: SupabaseServerClient,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("daily_digests")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { created_at: string } | null)?.created_at ?? null;
  } catch {
    return null;
  }
}

async function fetchLatestWeeklyAt(
  supabase: SupabaseServerClient,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("weekly_reports")
      .select("generated_at")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { generated_at: string } | null)?.generated_at ?? null;
  } catch {
    return null;
  }
}

async function fetchLatestHealthFlagAt(
  supabase: SupabaseServerClient,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("action_proposals")
      .select("created_at")
      .eq("action_type", "health_flag")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { created_at: string } | null)?.created_at ?? null;
  } catch {
    return null;
  }
}

async function fetchLatestAgentRun(
  supabase: SupabaseServerClient,
): Promise<{ lastFinishedAt: string | null; lastStatus: string | null }> {
  try {
    const { data } = await supabase
      .from("agent_runs")
      .select("finished_at, status")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = data as { finished_at: string | null; status: string } | null;
    return {
      lastFinishedAt: row?.finished_at ?? null,
      lastStatus: row?.status ?? null,
    };
  } catch {
    return { lastFinishedAt: null, lastStatus: null };
  }
}

async function fetchRecentOutbound(
  supabase: SupabaseServerClient,
): Promise<OutboundMessageSignal[]> {
  try {
    const { data } = await supabase
      .from("messages")
      .select(
        "sent_at, draft_status, provider_message_id, created_at, delivery_status",
      )
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(OUTBOUND_SAMPLE_SIZE);

    const rows = (data ?? []) as Array<{
      sent_at: string | null;
      draft_status: string;
      provider_message_id: string | null;
      created_at: string;
      delivery_status: string;
    }>;

    return rows.map((r) => ({
      sentAt: r.sent_at,
      draftStatus: r.draft_status,
      providerMessageId: r.provider_message_id,
      createdAt: r.created_at,
      deliveryStatus: r.delivery_status,
    }));
  } catch {
    return [];
  }
}

// ===========================================================================
// Worker probe + config sanity (environment, not Supabase)
// ===========================================================================

/**
 * Config-gated `/healthz` probe. The URL is read from `WORKER_HEALTHZ_URL`
 * (or `WORKER_HEALTH_URL`). If unset, the worker signal is `unknown` —
 * we never claim a worker we can't see is alive.
 */
async function probeWorker(): Promise<WorkerProbe> {
  const url =
    process.env.WORKER_HEALTHZ_URL ?? process.env.WORKER_HEALTH_URL ?? "";
  if (!url) {
    return { configured: false, reachable: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WORKER_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        configured: true,
        reachable: false,
        detail: `Operator worker /healthz returned ${res.status}.`,
      };
    }
    return { configured: true, reachable: true };
  } catch {
    return {
      configured: true,
      reachable: false,
      detail: "Operator worker unreachable — /healthz did not respond.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort credential presence check. Messaging is considered
 * configured when a Linq or Twilio credential is present; Inngest when an
 * event key is present. This is a sanity signal, not a deep validation.
 */
function readConfigSanity(): {
  messagingConfigured: boolean;
  inngestConfigured: boolean;
} {
  const messagingConfigured = Boolean(
    process.env.LINQ_API_KEY_ID ||
    process.env.LINQ_API_SECRET_KEY ||
    process.env.TWILIO_AUTH_TOKEN,
  );
  const inngestConfigured = Boolean(
    process.env.INNGEST_EVENT_KEY || process.env.INNGEST_SIGNING_KEY,
  );
  return { messagingConfigured, inngestConfigured };
}
