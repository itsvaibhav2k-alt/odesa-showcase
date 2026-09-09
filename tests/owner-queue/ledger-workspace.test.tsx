/**
 * Component tests for the owner-queue master-detail workspace (structural
 * redesign — the ledger index + the dossier). These lock the load-bearing
 * guarantees of the "Owner's decision ledger": a finite, paginated, grouped
 * ledger of `decision-card-<id>` rows and one dossier that carries every
 * per-decision control + the boundary copy inside a single <article>.
 *
 * Both components are pure/presentational (no server-action imports), so they
 * mount directly with hand-built `Decision` fixtures.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { Decision } from "@/lib/owner-queue/mock-decisions";
import { LedgerIndex } from "@/components/owner-queue/ledger-index";
import { DecisionDossier } from "@/components/owner-queue/decision-dossier";

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "d-1",
    recommendation: "hold",
    type: "VENDOR DISPATCH",
    location: "14 MAPLE CT · UNIT 3B",
    title: "Dispatch a plumber for the water heater",
    metricChips: [{ label: "Estimated vendor cost", value: "$450" }],
    odesaLine: "The tenant reported no hot water.",
    impact: "$450 one-time",
    sources: [],
    considerations: [],
    sourceNote: "",
    askPlaceholder: "",
    askSuggestions: [],
    actionType: "dispatch_vendor",
    propertyId: "p-1",
    gateReason: "Owner review required — spend",
    boundary: "The vendor is not contacted until you approve it.",
    ifIgnored: "No dispatch is recorded; the request stays pending.",
    primaryActionLabel: "Record dispatch approval",
    financialLabel: "Estimated vendor cost",
    editKind: null,
    whyFacts: ["The tenant reported no hot water."],
    state: "recommended",
    ...overrides,
  };
}

const isJudgment = (d: Decision) => d.recommendation !== "approve";

describe("LedgerIndex", () => {
  const judgmentA = makeDecision({ id: "j-1", title: "Judgment one" });
  const judgmentB = makeDecision({ id: "j-2", title: "Judgment two" });
  const routine = makeDecision({
    id: "r-1",
    recommendation: "approve",
    title: "Routine one",
  });
  const items = [judgmentA, judgmentB, routine];

  function renderIndex(
    overrides: Partial<Parameters<typeof LedgerIndex>[0]> = {},
  ) {
    const onSelect = vi.fn();
    const onFilterChange = vi.fn();
    const onPageChange = vi.fn();
    const onReviewBatch = vi.fn();
    render(
      <LedgerIndex
        items={items}
        filter="all"
        onFilterChange={onFilterChange}
        counts={{ all: 3, judgment: 2, routine: 1 }}
        page={0}
        pageSize={10}
        onPageChange={onPageChange}
        selectedId="j-1"
        onSelect={onSelect}
        statusFor={() => "recommended"}
        isJudgment={isJudgment}
        batchEligibleCount={1}
        onReviewBatch={onReviewBatch}
        {...overrides}
      />,
    );
    return { onSelect, onFilterChange, onPageChange, onReviewBatch };
  }

  it("renders one decision-card row per decision (finite, not a feed)", () => {
    renderIndex();
    const rows = screen.getAllByTestId(/^decision-card-/);
    expect(rows).toHaveLength(3);
  });

  it('shows an explicit "1–N of M" range rather than infinite scroll', () => {
    renderIndex();
    expect(screen.getByTestId("ledger-range")).toHaveTextContent("1–3 of 3");
  });

  it("groups judgment and routine with in-list section rules", () => {
    renderIndex();
    expect(screen.getByText("Needs judgment")).toBeInTheDocument();
    expect(screen.getByText("Routine")).toBeInTheDocument();
  });

  it("reports a row selection up with the decision id", () => {
    const { onSelect } = renderIndex();
    fireEvent.click(screen.getByTestId("decision-card-r-1"));
    expect(onSelect).toHaveBeenCalledWith("r-1");
  });

  it("marks the selected row with aria-current", () => {
    renderIndex();
    expect(screen.getByTestId("decision-card-j-1")).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByTestId("decision-card-j-2")).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("exposes the batch-review affordance when routine items are eligible", () => {
    const { onReviewBatch } = renderIndex();
    const batch = screen.getByTestId("ledger-review-batch");
    expect(batch).toHaveTextContent("Review routine batch (1)");
    fireEvent.click(batch);
    expect(onReviewBatch).toHaveBeenCalledTimes(1);
  });

  it("disables Prev/Next when the whole set fits one page", () => {
    renderIndex();
    expect(screen.getByTestId("ledger-prev")).toBeDisabled();
    expect(screen.getByTestId("ledger-next")).toBeDisabled();
  });

  it("paginates: Next enabled and range reflects the window when overflowing", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      makeDecision({ id: `m-${i}`, title: `Item ${i}` }),
    );
    const onPageChange = vi.fn();
    render(
      <LedgerIndex
        items={many}
        filter="all"
        onFilterChange={vi.fn()}
        counts={{ all: 12, judgment: 12, routine: 0 }}
        page={0}
        pageSize={10}
        onPageChange={onPageChange}
        selectedId="m-0"
        onSelect={vi.fn()}
        statusFor={() => "recommended"}
        isJudgment={isJudgment}
        batchEligibleCount={0}
        onReviewBatch={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ledger-range")).toHaveTextContent("1–10 of 12");
    expect(screen.getAllByTestId(/^decision-card-/)).toHaveLength(10);
    const next = screen.getByTestId("ledger-next");
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});

describe("DecisionDossier", () => {
  const decision = makeDecision();

  function renderDossier(
    overrides: Partial<Parameters<typeof DecisionDossier>[0]> = {},
  ) {
    const onPrimary = vi.fn();
    const onDecline = vi.fn();
    const onToggleDisclosure = vi.fn();
    render(
      <DecisionDossier
        decision={decision}
        isJudgment
        status="recommended"
        error={null}
        busy={false}
        isDisclosureOpen={false}
        onToggleDisclosure={onToggleDisclosure}
        onPrimary={onPrimary}
        onDecline={onDecline}
        onSaveGuidance={vi.fn()}
        position={{ index: 1, total: 3 }}
        hasPrev={false}
        hasNext
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onBackToDocket={vi.fn()}
        {...overrides}
      />,
    );
    return { onPrimary, onDecline, onToggleDisclosure };
  }

  it("renders one dossier article carrying the controls AND the boundary copy", () => {
    renderDossier();
    const dossier = screen.getByTestId("decision-dossier");
    // test 3 in decisions-desk.spec walks approve → ancestor <article> → boundary
    expect(dossier.tagName.toLowerCase()).toBe("article");
    expect(within(dossier).getByTestId("approve-d-1")).toBeInTheDocument();
    expect(within(dossier).getByTestId("decline-d-1")).toBeInTheDocument();
    expect(dossier).toHaveTextContent(/vendor is not contacted/i);
  });

  it('shows the "Decision N of M" orientation cue', () => {
    renderDossier();
    expect(screen.getByTestId("dossier-position")).toHaveTextContent(
      "Decision 1 of 3",
    );
  });

  it("uses the adapter primary label and routes it through onPrimary", () => {
    const { onPrimary } = renderDossier();
    const primary = screen.getByTestId("approve-d-1");
    expect(primary).toHaveTextContent("Record dispatch approval");
    fireEvent.click(primary);
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it("wires the Why disclosure toggle to its reasoning panel via aria-controls", () => {
    const { onToggleDisclosure } = renderDossier();
    const toggle = screen.getByTestId("why-d-1");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "why-this-d-1");
    fireEvent.click(toggle);
    expect(onToggleDisclosure).toHaveBeenCalledTimes(1);
  });

  it("renders the settled state instead of live actions once approved", () => {
    renderDossier({ status: "approved" });
    expect(screen.getByTestId("settled-d-1")).toBeInTheDocument();
    expect(screen.queryByTestId("approve-d-1")).toBeNull();
    expect(screen.queryByTestId("decline-d-1")).toBeNull();
  });
});
