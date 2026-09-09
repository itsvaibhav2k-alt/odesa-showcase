import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VaEscalationsDesk } from "@/components/today/va-escalations-desk";
import type { QueueItem } from "@/types/today";
import type { DraftDetail } from "@/components/inbox/types";

const escalation: QueueItem = {
  id: "wo-1",
  status: "review",
  title: "Emergency repair",
  property: "Galaxy",
  unit: "Unit 101",
  tenant: "Marcus Alvarez",
  meta: ["Marcus Alvarez", "Unit 101", "Emergency"],
  recommendation: "Verify the known facts and prepare the owner handoff.",
  timestamp: "12m ago",
  channel: "maintenance",
  contextLabel: "work order wo-1",
  contextSuggestions: [],
  contextPlaceholder: "Ask about this work order",
  primaryAction: {
    label: "Approve dispatch",
    handler: "/review/work_order/wo-1",
  },
  secondaryAction: { label: "Send update", handler: "send-update" },
  nextStep: "Vendor outreach or dispatch requires the owner.",
  ownerRule: "Owner approval required",
  sourceLabel: "View work order",
  sourceHref: "/work-orders/wo-1",
};

const referencedProposal: DraftDetail = {
  source: "proposal",
  id: "proposal-1",
  draftType: "Draft tenant reply",
  draftedBy: "Odesa",
  draftedAt: "8m ago",
  recipient: "Marcus Alvarez",
  shortcuts: { reject: "r", edit: "e", approveSend: "a" },
  reasoning: "The caller asked for a repair update.",
  smsBody: "We are preparing the repair details for owner review.",
  smsPhone: "+15555550101",
  tenant: {
    name: "Marcus Alvarez",
    badge: "TENANT SINCE 2024",
    property: "Galaxy",
    unit: "Unit 101",
    bedBath: "2 bed · 1 bath",
    currentRent: "$1,900",
  },
  touchpoints: { days: 7, entries: [] },
};

describe("VaEscalationsDesk", () => {
  it("renders a distinct read-only escalation desk with evidence but no owner controls", () => {
    render(<VaEscalationsDesk items={[escalation]} />);

    expect(
      screen.getByRole("heading", { name: "Escalation desk." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Owner handoffs requiring review",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Prepare, do not decide" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Build from recorded evidence" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("va-current-handoff")).toHaveTextContent(
      "Emergency repair",
    );
    expect(screen.getByTestId("va-current-handoff")).toHaveTextContent(
      "Verify the known facts and prepare the owner handoff.",
    );
    expect(document.querySelector('a[href^="/assistant"]')).toBeNull();
    const row = screen.getByTestId("va-escalation-row");
    expect(within(row).getByText("Emergency repair")).toBeInTheDocument();
    expect(
      within(row).getByText("Owner approval required"),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("link", { name: /View work order/ }),
    ).toHaveAttribute("href", "/work-orders/wo-1");
    expect(screen.queryByText("Approve dispatch")).not.toBeInTheDocument();
    expect(screen.queryByText("Send update")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders an honest empty escalation state", () => {
    render(<VaEscalationsDesk items={[]} />);
    expect(screen.getByTestId("va-escalations-empty")).toHaveTextContent(
      "No active escalations.",
    );
    expect(screen.queryByTestId("va-escalation-row")).not.toBeInTheDocument();
  });

  it("opens an exact read-only call proposal reference without owner controls", () => {
    render(
      <VaEscalationsDesk
        items={[escalation]}
        referencedProposal={referencedProposal}
        referencedProposalRequested
      />,
    );

    const reference = screen.getByTestId("va-referenced-proposal");
    expect(reference).toHaveTextContent("Draft tenant reply");
    expect(reference).toHaveTextContent("Marcus Alvarez");
    expect(reference).toHaveTextContent(
      "The caller asked for a repair update.",
    );
    expect(reference).toHaveTextContent(
      "We are preparing the repair details for owner review.",
    );
    expect(within(reference).queryByRole("button")).not.toBeInTheDocument();
  });
});
