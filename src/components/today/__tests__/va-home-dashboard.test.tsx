import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  VaHomeDashboard,
  type VaHomeDashboardProps,
} from "@/components/today/va-home-dashboard";
import { buildVaHomeMetrics } from "@/lib/today/va-presentation";
import type { QueueItem, WatchSignal } from "@/types/today";

function queueItem(id: string, overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id,
    status: "review",
    title: `Real queue item ${id}`,
    property: "Galaxy",
    unit: "Unit 101",
    tenant: "Marcus Alvarez",
    meta: ["Marcus Alvarez", "Unit 101", "Emergency"],
    recommendation: "Verify the known facts and prepare the owner handoff.",
    timestamp: "12m ago",
    channel: "maintenance",
    contextLabel: `work order ${id}`,
    contextSuggestions: [],
    contextPlaceholder: "Ask about this work order",
    primaryAction: {
      label: "Approve dispatch",
      handler: `/review/work_order/${id}`,
    },
    secondaryAction: { label: "Send update", handler: "send-update" },
    nextStep: "Vendor outreach or dispatch requires the owner.",
    ownerRule: "Owner approval required",
    sourceLabel: "View work order",
    sourceHref: `/work-orders/${id}`,
    ...overrides,
  };
}

const watchSignals: WatchSignal[] = [
  {
    channel: "lease",
    title: "Lease deadlines",
    meta: "No leases expiring this week.",
    dotVariant: "muted",
  },
  {
    channel: "maintenance",
    title: "Maintenance risk",
    meta: "1 urgent work order open · vendor timing not verified.",
    dotVariant: "clay",
  },
];

const deadlines: VaHomeDashboardProps["deadlines"] = [
  {
    id: "lease:lease-1",
    kind: "lease-end",
    label: "Lease ends",
    title: "Jordan Lee",
    context: "Unit 4B",
    dateIso: "2026-08-06",
    dateLabel: "Aug 6",
  },
  {
    id: "move-in:2026-08-08:2A:0",
    kind: "move-in",
    label: "Move-in",
    title: "Taylor Morgan",
    context: "Unit 2A",
    dateIso: "2026-08-08",
    dateLabel: "Aug 8",
  },
];

function props(
  overrides: Partial<VaHomeDashboardProps> = {},
): VaHomeDashboardProps {
  return {
    userName: "Avery Chen",
    dateLabel: "Monday, August 3",
    propertiesCount: 2,
    tenantsCount: 10,
    checkedAgoLabel: "just now",
    metrics: buildVaHomeMetrics({
      queueCount: 2,
      urgentWorkOrdersCount: 1,
      draftsAwaitingOwner: 1,
      callsAwaitingOwner: 0,
      callsToday: 1,
      callsHandledToday: 1,
    }),
    queueItems: [queueItem("wo-1"), queueItem("wo-2")],
    deadlines,
    watchSignals,
    draftsSentToday: 1,
    callsHandledToday: 1,
    callsToday: 1,
    ...overrides,
  };
}

describe("VaHomeDashboard", () => {
  it("keeps a multi-item queue compact and scannable without owner controls", () => {
    render(<VaHomeDashboard {...props()} />);

    const queue = screen.getByTestId("va-home-priority-queue");
    expect(queue).toHaveAttribute("data-queue-mode", "list");
    expect(within(queue).getAllByTestId("va-home-queue-row")).toHaveLength(2);
    expect(
      within(queue).queryByTestId("va-home-single-dossier"),
    ).not.toBeInTheDocument();
    expect(within(queue).getByText("Real queue item wo-1")).toBeInTheDocument();
    expect(within(queue).getAllByText("Owner approval required")).toHaveLength(
      2,
    );
    expect(within(queue).queryByRole("button")).not.toBeInTheDocument();
    expect(
      within(queue).queryByText("Approve dispatch"),
    ).not.toBeInTheDocument();
    expect(within(queue).queryByText("Send update")).not.toBeInTheDocument();
    expect(within(queue).getAllByRole("link")).toHaveLength(2);
  });

  it("expands one finite task into a truthful selected-task dossier", () => {
    const item = queueItem("wo-only", {
      reason: "Marked emergency/open and still active.",
      ifIgnored: "The open maintenance request remains unresolved.",
      contextSuggestions: [
        "Summarize this work order",
        "Draft an owner handoff",
        "List the open questions",
      ],
    });
    render(<VaHomeDashboard {...props({ queueItems: [item] })} />);

    const queue = screen.getByTestId("va-home-priority-queue");
    const dossier = within(queue).getByTestId("va-home-single-dossier");
    expect(queue).toHaveAttribute("data-queue-mode", "single");
    expect(within(queue).queryByTestId("va-home-queue-row")).not.toBeInTheDocument();
    expect(
      within(dossier).getByRole("heading", { name: "Real queue item wo-only" }),
    ).toBeInTheDocument();
    expect(dossier).toHaveTextContent(/Selected task dossier/i);
    expect(dossier).toHaveTextContent("Marcus Alvarez");
    expect(dossier).toHaveTextContent("Unit 101");
    expect(dossier).toHaveTextContent(
      "Verify the known facts and prepare the owner handoff.",
    );
    expect(dossier).toHaveTextContent("Marked emergency/open and still active.");
    expect(dossier).toHaveTextContent(
      "The open maintenance request remains unresolved.",
    );
    expect(dossier).toHaveTextContent("Owner approval required");
    expect(dossier).toHaveTextContent(
      "Vendor outreach or dispatch requires the owner.",
    );
    expect(dossier).toHaveTextContent("Summarize this work order");
    expect(dossier).toHaveTextContent("Draft an owner handoff");
    expect(within(dossier).getByRole("link", { name: /View work order/ })).toHaveAttribute(
      "href",
      "/work-orders/wo-only",
    );
    expect(within(dossier).queryByRole("button")).not.toBeInTheDocument();
    expect(dossier).not.toHaveTextContent("Approve dispatch");
    expect(dossier).not.toHaveTextContent("Send update");
  });

  it("uses the real user name without exposing the owner-reserved assistant", () => {
    render(<VaHomeDashboard {...props()} />);

    expect(
      screen.getByRole("heading", { name: "Welcome back, Avery Chen." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Work from the recorded evidence" }),
    ).toBeInTheDocument();
    expect(document.querySelector('a[href^="/assistant"]')).toBeNull();
    expect(screen.getByTestId("va-home-dashboard")).not.toHaveTextContent(
      /SLA|satisfaction|automation rate|schedule meeting/i,
    );
  });

  it("renders supplied seven-day deadlines and recorded activity counts without fake events or controls", () => {
    render(
      <VaHomeDashboard
        {...props({
          draftsSentToday: 2,
          callsHandledToday: 1,
          callsToday: 3,
        })}
      />,
    );

    const lowerModules = screen.getByTestId("va-home-lower-modules");
    const schedule = screen.getByTestId("va-home-schedule");
    const activity = screen.getByTestId("va-home-activity");

    expect(
      within(schedule).getByRole("heading", { name: "Today’s schedule" }),
    ).toBeInTheDocument();
    expect(
      within(schedule).getAllByTestId("va-home-schedule-row"),
    ).toHaveLength(2);
    expect(within(schedule).getByText("Jordan Lee")).toBeInTheDocument();
    expect(within(schedule).getByText("Unit 4B")).toBeInTheDocument();
    expect(within(schedule).getByText("Aug 6")).toHaveAttribute(
      "datetime",
      "2026-08-06",
    );
    expect(schedule).toHaveTextContent("next 7 days");
    expect(schedule).toHaveTextContent(
      "Calendar events are not included in this view.",
    );
    expect(within(schedule).queryByRole("link")).not.toBeInTheDocument();

    expect(
      within(activity).getByRole("heading", { name: "Recent activity" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("va-home-activity-drafts")).toHaveTextContent(
      "Drafts sentDraft records marked sent today2today",
    );
    expect(
      screen.getByTestId("va-home-activity-calls-handled"),
    ).toHaveTextContent("Calls resolved without owner review");
    expect(
      screen.getByTestId("va-home-activity-calls-recorded"),
    ).toHaveTextContent("Calls recordedCall records returned for today3today");
    expect(activity).toHaveTextContent(
      "Event-level timestamps are not available in this view.",
    );

    expect(within(lowerModules).queryByRole("button")).not.toBeInTheDocument();
    expect(within(lowerModules).queryByRole("link")).not.toBeInTheDocument();
    expect(lowerModules).not.toHaveTextContent(
      /calendar synced|team standup|schedule meeting|approve dispatch|send update/i,
    );
  });

  it("renders truthful zero states without fabricating schedule or activity rows", () => {
    render(
      <VaHomeDashboard
        {...props({
          userName: null,
          queueItems: [],
          deadlines: [],
          watchSignals: [],
          metrics: buildVaHomeMetrics({
            queueCount: 0,
            urgentWorkOrdersCount: 0,
            draftsAwaitingOwner: 0,
            callsAwaitingOwner: 0,
            callsToday: 0,
            callsHandledToday: 0,
          }),
          draftsSentToday: 0,
          callsHandledToday: 0,
          callsToday: 0,
        })}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Welcome to your shift." }),
    ).toBeInTheDocument();
    const schedule = screen.getByTestId("va-home-schedule");
    const activity = screen.getByTestId("va-home-activity");
    const queue = screen.getByTestId("va-home-priority-queue");
    expect(queue).toHaveAttribute("data-queue-mode", "empty");
    expect(within(queue).getByTestId("va-home-queue-empty")).toHaveTextContent(
      "No attention items were returned for this shift.",
    );
    expect(within(queue).queryByTestId("va-home-single-dossier")).not.toBeInTheDocument();
    expect(within(queue).queryByTestId("va-home-queue-row")).not.toBeInTheDocument();
    expect(schedule).toHaveTextContent(
      "No lease endings or move-ins were returned for the next 7 days.",
    );
    expect(schedule).toHaveTextContent(
      "Calendar events are not included in this view.",
    );
    expect(within(schedule).queryAllByRole("listitem")).toHaveLength(0);
    expect(activity).toHaveTextContent(
      "No draft or call activity is recorded today.",
    );
    expect(within(activity).queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByTestId("va-home-schedule-empty")).toBeInTheDocument();
    expect(screen.getByTestId("va-home-activity-empty")).toBeInTheDocument();
  });

  it("keeps the existing owner composition after the explicit VA return branch", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(dashboard)/today/page.tsx"),
      "utf8",
    );
    const vaBranch = source.indexOf("const vaQueueItems");
    const ownerBranch = source.indexOf("const attentionChannel", vaBranch);

    expect(vaBranch).toBeGreaterThan(-1);
    expect(ownerBranch).toBeGreaterThan(vaBranch);
    expect(source.slice(vaBranch - 30, vaBranch)).toContain("if (isVa)");
    expect(source.slice(vaBranch, ownerBranch)).toContain("<VaHomeDashboard");

    const ownerComposition = source.slice(ownerBranch);
    expect(ownerComposition).toContain("<TodayTopbar");
    expect(ownerComposition).toContain("<TodayBriefing");
    expect(ownerComposition).toContain("<OvernightCard");
    expect(ownerComposition).toContain("<VoiceCallsCard");
    expect(ownerComposition).toContain("<FinancialBriefingCard");
    expect(ownerComposition).toContain("<TodayInteractions");
    expect(ownerComposition).toContain("<OdesaHandlingPanel");
    expect(ownerComposition).not.toContain("<VaHomeDashboard");
  });
});
