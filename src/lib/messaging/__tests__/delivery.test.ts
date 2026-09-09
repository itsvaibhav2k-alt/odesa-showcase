import { describe, expect, it } from "vitest";

import {
  canonicalDeliveryEvent,
  normalizeDeliveryStatus,
  type DeliveryEvent,
} from "../delivery";

describe("delivery reconciliation", () => {
  it.each([
    ["queued", "queued"],
    ["accepted", "provider_accepted"],
    ["sent", "provider_accepted"],
    ["delivered", "delivered"],
    ["undelivered", "undelivered"],
    ["failed", "failed"],
  ] as const)("normalizes provider status %s", (input, expected) => {
    expect(normalizeDeliveryStatus(input)).toBe(expected);
  });

  it("uses provider event time so a reordered accepted event cannot erase a later failure", () => {
    const events: DeliveryEvent[] = [
      { status: "failed", occurredAt: "2026-07-11T12:02:00.000Z" },
      { status: "provider_accepted", occurredAt: "2026-07-11T12:01:00.000Z" },
    ];

    expect(canonicalDeliveryEvent(events)).toEqual(events[0]);
    expect(canonicalDeliveryEvent([...events].reverse())).toEqual(events[0]);
  });

  it("is deterministic for duplicate/tied events", () => {
    const at = "2026-07-11T12:02:00.000Z";
    expect(
      canonicalDeliveryEvent([
        { status: "provider_accepted", occurredAt: at },
        { status: "undelivered", occurredAt: at },
        { status: "undelivered", occurredAt: at },
      ]),
    ).toEqual({ status: "undelivered", occurredAt: at });
  });
});
