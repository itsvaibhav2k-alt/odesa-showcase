/**
 * Unit tests for the pure reliability status builder.
 *
 * Covers the honesty contract end to end:
 *   - healthy: every signal provably fresh → overall healthy.
 *   - degraded: a stale daily job, a failed agent run, a silent
 *     notification failure, an unreachable worker, missing config.
 *   - unknown: absent timestamps and an unconfigured worker NEVER read as
 *     green — overall stays unknown when nothing is wrong but something is
 *     unconfirmed.
 *   - stale detection: grace windows for daily vs weekly cadences, plus
 *     the derived `nextExpected`.
 *
 * The builder is pure (injected `now`), so no Supabase stub is needed —
 * we hand it normalized input directly, mirroring the DI style of
 * `src/lib/health/__tests__/generate.test.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  buildReliabilityStatus,
  formatRunLabel,
  type ReliabilityInput,
} from "../status";

const NOW = new Date("2026-06-22T12:00:00.000Z"); // Monday noon UTC

/** Minutes/hours-ago ISO helper relative to NOW. */
function hoursAgo(h: number, base: Date = NOW): string {
  return new Date(base.getTime() - h * 3_600_000).toISOString();
}

/** A baseline input where every signal is provably healthy. */
function healthyInput(): ReliabilityInput {
  return {
    now: NOW,
    digest: { lastRunAt: hoursAgo(3) }, // this morning
    weekly: { lastRunAt: hoursAgo(5) }, // Monday briefing, fresh
    healthSweep: { lastRunAt: hoursAgo(2) },
    agentRun: { lastFinishedAt: hoursAgo(1), lastStatus: "done" },
    notifications: {
      recentOutbound: [
        {
          sentAt: hoursAgo(4),
          draftStatus: "auto_sent",
          providerMessageId: "linq_abc123",
          createdAt: hoursAgo(4),
          deliveryStatus: "delivered",
        },
      ],
    },
    worker: { configured: true, reachable: true },
    config: { messagingConfigured: true, inngestConfigured: true },
  };
}

describe("buildReliabilityStatus", () => {
  describe("healthy path", () => {
    it("should report overall healthy when every signal is fresh", () => {
      const status = buildReliabilityStatus(healthyInput());

      expect(status.overall).toBe("healthy");
      expect(status.generatedAt).toBe(NOW.toISOString());
      expect(status.jobs.every((j) => j.lastStatus === "healthy")).toBe(true);
      expect(status.notifications.level).toBe("healthy");
      expect(status.worker.level).toBe("healthy");
      expect(status.config.level).toBe("healthy");
    });

    it('should emit the example digest copy "Last operator digest delivered Monday 8:01 AM"', () => {
      const input = healthyInput();
      input.digest.lastRunAt = "2026-06-22T08:01:00.000Z";
      const status = buildReliabilityStatus(input);

      const digest = status.jobs.find((j) => j.key === "daily-digest");
      expect(digest?.detail).toBe(
        "Last operator digest delivered Monday 8:01 AM.",
      );
      expect(digest?.staleFlag).toBe(false);
    });

    it("should derive nextExpected as lastRunAt + cadence interval", () => {
      const input = healthyInput();
      input.digest.lastRunAt = "2026-06-22T08:01:00.000Z";
      input.weekly.lastRunAt = "2026-06-22T07:00:00.000Z";
      const status = buildReliabilityStatus(input);

      const digest = status.jobs.find((j) => j.key === "daily-digest");
      const weekly = status.jobs.find((j) => j.key === "weekly-briefing");
      expect(digest?.nextExpected).toBe("2026-06-23T08:01:00.000Z"); // +24h
      expect(weekly?.nextExpected).toBe("2026-06-29T07:00:00.000Z"); // +7d
    });
  });

  describe("stale detection", () => {
    it("should flag a daily digest overdue past its 26h grace window as degraded", () => {
      const input = healthyInput();
      input.digest.lastRunAt = hoursAgo(30); // > 26h
      const status = buildReliabilityStatus(input);

      const digest = status.jobs.find((j) => j.key === "daily-digest");
      expect(digest?.staleFlag).toBe(true);
      expect(digest?.lastStatus).toBe("degraded");
      expect(digest?.detail).toContain("overdue");
      expect(status.overall).toBe("degraded");
    });

    it("should NOT flag a daily digest still inside the grace window", () => {
      const input = healthyInput();
      input.digest.lastRunAt = hoursAgo(25); // < 26h
      const status = buildReliabilityStatus(input);

      const digest = status.jobs.find((j) => j.key === "daily-digest");
      expect(digest?.staleFlag).toBe(false);
      expect(digest?.lastStatus).toBe("healthy");
    });

    it("should flag a weekly briefing older than 8 days as degraded", () => {
      const input = healthyInput();
      input.weekly.lastRunAt = hoursAgo(24 * 9); // 9 days
      const status = buildReliabilityStatus(input);

      const weekly = status.jobs.find((j) => j.key === "weekly-briefing");
      expect(weekly?.staleFlag).toBe(true);
      expect(weekly?.lastStatus).toBe("degraded");
    });
  });

  describe("unknown — never green on absence", () => {
    it("should report unknown (not healthy) when a digest has never run", () => {
      const input = healthyInput();
      input.digest.lastRunAt = null;
      const status = buildReliabilityStatus(input);

      const digest = status.jobs.find((j) => j.key === "daily-digest");
      expect(digest?.lastStatus).toBe("unknown");
      expect(digest?.staleFlag).toBe(false);
      expect(digest?.nextExpected).toBeNull();
      expect(status.overall).toBe("unknown");
    });

    it("should treat an unconfigured worker as unknown with the telemetry copy", () => {
      const input = healthyInput();
      input.worker = { configured: false, reachable: null };
      const status = buildReliabilityStatus(input);

      expect(status.worker.level).toBe("unknown");
      expect(status.worker.detail).toBe(
        "Worker telemetry not configured — health unknown.",
      );
      expect(status.overall).toBe("unknown");
    });

    it("should treat a healthy portfolio with no health flags as unknown, not degraded", () => {
      const input = healthyInput();
      input.healthSweep.lastRunAt = null;
      const status = buildReliabilityStatus(input);

      const sweep = status.jobs.find((j) => j.key === "health-sweep");
      expect(sweep?.lastStatus).toBe("unknown");
      expect(sweep?.lastStatus).not.toBe("degraded");
    });

    it("should be unknown overall when everything is absent/unconfigured but nothing is broken", () => {
      const status = buildReliabilityStatus({
        now: NOW,
        digest: { lastRunAt: null },
        weekly: { lastRunAt: null },
        healthSweep: { lastRunAt: null },
        agentRun: { lastFinishedAt: null, lastStatus: null },
        notifications: { recentOutbound: [] },
        worker: { configured: false, reachable: null },
        config: { messagingConfigured: true, inngestConfigured: true },
      });

      expect(status.overall).toBe("unknown");
      expect(status.jobs.every((j) => j.lastStatus !== "healthy")).toBe(true);
    });
  });

  describe("agent runs", () => {
    it("should mark a failed latest agent run as degraded", () => {
      const input = healthyInput();
      input.agentRun = { lastFinishedAt: hoursAgo(2), lastStatus: "failed" };
      const status = buildReliabilityStatus(input);

      const agent = status.jobs.find((j) => j.key === "agent-runs");
      expect(agent?.lastStatus).toBe("degraded");
      expect(agent?.detail).toContain("failed");
      expect(status.overall).toBe("degraded");
    });

    it("should treat an in-progress run as healthy (watchdog owns stuck reconciliation)", () => {
      const input = healthyInput();
      input.agentRun = { lastFinishedAt: null, lastStatus: "running" };
      const status = buildReliabilityStatus(input);

      const agent = status.jobs.find((j) => j.key === "agent-runs");
      expect(agent?.lastStatus).toBe("healthy");
    });
  });

  describe("notification delivery", () => {
    it("should mark a send-intent message with no provider id and no sent_at as degraded", () => {
      const input = healthyInput();
      input.notifications.recentOutbound = [
        {
          sentAt: null,
          draftStatus: "auto_sent",
          providerMessageId: null,
          createdAt: hoursAgo(1),
          deliveryStatus: "failed",
        },
      ];
      const status = buildReliabilityStatus(input);

      expect(status.notifications.level).toBe("degraded");
      expect(status.notifications.detail).toContain(
        "failed or was not delivered",
      );
      expect(status.overall).toBe("degraded");
    });

    it("should be unknown when there are no recent outbound messages", () => {
      const input = healthyInput();
      input.notifications.recentOutbound = [];
      const status = buildReliabilityStatus(input);

      expect(status.notifications.level).toBe("unknown");
      expect(status.notifications.lastSentAt).toBeNull();
    });

    it("should NOT penalize a by-design pending_review hold (neutral, not failure)", () => {
      const input = healthyInput();
      input.notifications.recentOutbound = [
        {
          sentAt: hoursAgo(2),
          draftStatus: "auto_sent",
          providerMessageId: "linq_ok",
          createdAt: hoursAgo(2),
          deliveryStatus: "delivered",
        },
        {
          sentAt: null,
          draftStatus: "pending_review",
          providerMessageId: null,
          createdAt: hoursAgo(1),
          deliveryStatus: "draft",
        },
      ];
      const status = buildReliabilityStatus(input);

      expect(status.notifications.level).toBe("healthy");
    });
  });

  describe("worker + config", () => {
    it("should mark a configured-but-unreachable worker as degraded", () => {
      const input = healthyInput();
      input.worker = { configured: true, reachable: false };
      const status = buildReliabilityStatus(input);

      expect(status.worker.level).toBe("degraded");
      expect(status.overall).toBe("degraded");
    });

    it("should mark missing messaging config as degraded with actionable copy", () => {
      const input = healthyInput();
      input.config = { messagingConfigured: false, inngestConfigured: true };
      const status = buildReliabilityStatus(input);

      expect(status.config.level).toBe("degraded");
      expect(status.config.messagingConfigured).toBe(false);
      expect(status.config.detail).toContain("messaging provider");
      expect(status.overall).toBe("degraded");
    });
  });

  describe("readiness summary", () => {
    it("should report zero attention items and an all-delivering sentence when every signal is healthy", () => {
      const status = buildReliabilityStatus(healthyInput());

      expect(status.summary.attentionCount).toBe(0);
      expect(status.summary.heading).toBe(
        "All operator signals are reporting in.",
      );
      expect(status.summary.sentence).toContain("are delivering.");
      expect(status.summary.sentence).not.toContain("need setup");
    });

    it("should list delivering jobs and the setup items that need attention before production", () => {
      const input = healthyInput();
      // Jobs + notifications stay healthy (delivering); only the two
      // production-config signals are not yet set up.
      input.worker = { configured: false, reachable: null };
      input.config = { messagingConfigured: false, inngestConfigured: true };
      const status = buildReliabilityStatus(input);

      expect(status.summary.attentionCount).toBe(2);
      expect(status.summary.heading).toBe(
        "2 setup items need attention before production.",
      );
      expect(status.summary.sentence).toContain("are delivering.");
      expect(status.summary.sentence).toContain(
        "Worker telemetry and messaging configuration need setup before production.",
      );
    });

    it("should use singular grammar for a single setup item", () => {
      const input = healthyInput();
      input.config = { messagingConfigured: false, inngestConfigured: true };
      const status = buildReliabilityStatus(input);

      expect(status.summary.attentionCount).toBe(1);
      expect(status.summary.heading).toBe(
        "1 setup item needs attention before production.",
      );
      expect(status.summary.sentence).toContain(
        "Messaging configuration needs setup before production.",
      );
    });

    it("should honestly count an unknown signal as needing attention, never as delivering", () => {
      const input = healthyInput();
      input.worker = { configured: false, reachable: null }; // unknown, not green
      const status = buildReliabilityStatus(input);

      expect(status.summary.attentionCount).toBe(1);
      expect(status.summary.sentence).toContain("Worker telemetry needs setup");
    });
  });

  describe("formatRunLabel", () => {
    it('should format a UTC timestamp as "<Weekday> h:mm AM/PM"', () => {
      expect(formatRunLabel("2026-06-22T08:01:00.000Z")).toBe("Monday 8:01 AM");
      expect(formatRunLabel("2026-06-22T00:00:00.000Z")).toBe(
        "Monday 12:00 AM",
      );
      expect(formatRunLabel("2026-06-22T13:30:00.000Z")).toBe("Monday 1:30 PM");
    });

    it("should degrade gracefully on an invalid timestamp", () => {
      expect(formatRunLabel("not-a-date")).toBe("an unknown time");
    });
  });
});
