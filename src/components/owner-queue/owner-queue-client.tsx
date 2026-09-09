"use client";

import { useMemo, useState } from "react";
import type {
  Decision,
  DecisionSummary,
} from "@/lib/owner-queue/mock-decisions";
import { AskOdesaPanel } from "./ask-odesa-panel";
import { ApproveAllModal } from "./approve-all-modal";
import { DecisionEditDrawer } from "./decision-edit-drawer";
import { DecisionSummaryBanner } from "./decision-summary-banner";
import { DecisionDossier } from "./decision-dossier";
import { LedgerIndex, type LedgerFilter } from "./ledger-index";
import {
  Masthead,
  OwnerQueueEmptyState,
  WorkspaceFrame,
} from "./owner-queue-layout";
import { SaveGuidanceDialog } from "./save-guidance-dialog";
import { useOwnerQueueController } from "./use-owner-queue-controller";

const ASK_SUGGESTIONS = [
  "Which decisions actually send a message?",
  "What's the cash impact if I review the batch?",
  "What guidance should I set from these?",
  "Show only the ones that need my review",
];

/** Ledger page size — the finite window shown before Prev/Next paginates. */
const PAGE_SIZE = 10;

export interface OwnerQueueClientProps {
  judgmentDecisions: Decision[];
  routineDecisions: Decision[];
  summary: DecisionSummary;
}

/** A decision needs owner judgment when it is not the auto-approve tier. */
function isJudgment(decision: Decision): boolean {
  return decision.recommendation !== "approve";
}

/**
 * Interactive island for /owner-queue — the Owner's decision ledger.
 *
 * A bounded master-detail workspace: a finite ruled ledger on the left, one
 * open dossier on the right. Selection, filtering, pagination, and mobile
 * index/dossier routing live here; the server-action behavior and safety gates
 * are untouched (routed verbatim through `useOwnerQueueController`).
 */
export function OwnerQueueClient({
  judgmentDecisions,
  routineDecisions,
  summary,
}: OwnerQueueClientProps) {
  const controller = useOwnerQueueController(routineDecisions);
  const eligibleDecisions = controller.batchEligible();
  const hasDecisions =
    judgmentDecisions.length > 0 || routineDecisions.length > 0;

  // Judgment-first so the highest-attention work leads the ledger.
  const orderedAll = useMemo(
    () => [...judgmentDecisions, ...routineDecisions],
    [judgmentDecisions, routineDecisions],
  );

  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(
    orderedAll[0]?.id ?? null,
  );
  const [mobileView, setMobileView] = useState<"index" | "dossier">("index");

  const filteredAll = useMemo(() => {
    if (filter === "judgment") return judgmentDecisions;
    if (filter === "routine") return routineDecisions;
    return orderedAll;
  }, [filter, judgmentDecisions, routineDecisions, orderedAll]);

  const counts = {
    all: orderedAll.length,
    judgment: judgmentDecisions.length,
    routine: routineDecisions.length,
  };

  // The open decision, always resolved against the current filtered view so
  // the dossier and the "Decision N of M" cue never point off-list.
  const selectedIndex = Math.max(
    0,
    filteredAll.findIndex((d) => d.id === selectedId),
  );
  const selectedDecision = filteredAll[selectedIndex] ?? null;

  function handleFilterChange(next: LedgerFilter) {
    setFilter(next);
    setPage(0);
    const nextList =
      next === "judgment"
        ? judgmentDecisions
        : next === "routine"
          ? routineDecisions
          : orderedAll;
    setSelectedId(nextList[0]?.id ?? null);
  }

  function handleSelect(id: string) {
    setSelectedId(id);
    setMobileView("dossier");
  }

  function handlePageChange(nextPage: number) {
    const clampedPage = Math.max(
      0,
      Math.min(
        nextPage,
        Math.max(0, Math.ceil(filteredAll.length / PAGE_SIZE) - 1),
      ),
    );
    const firstDecisionOnPage = filteredAll[clampedPage * PAGE_SIZE];
    setPage(clampedPage);
    if (firstDecisionOnPage) setSelectedId(firstDecisionOnPage.id);
  }

  function stepDecision(delta: number) {
    const next = Math.min(
      filteredAll.length - 1,
      Math.max(0, selectedIndex + delta),
    );
    const target = filteredAll[next];
    if (!target) return;
    setSelectedId(target.id);
    setPage(Math.floor(next / PAGE_SIZE));
  }

  return (
    <>
      {!hasDecisions ? (
        <OwnerQueueEmptyState />
      ) : (
        <div
          className="owner-queue-workspace"
          data-mobile-view={mobileView}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div className="oq-masthead">
            <Masthead
              summary={summary}
              judgmentCount={judgmentDecisions.length}
              routineCount={routineDecisions.length}
            />
          </div>

          <div
            className="oq-batch-strip"
            style={{
              maxWidth: 1240,
              margin: "0 auto",
              width: "100%",
              padding: "0 32px 6px",
            }}
          >
            <DecisionSummaryBanner
              routineCount={eligibleDecisions.length}
              reviewCount={judgmentDecisions.length}
              totalAmount={summary.routineTotal}
              batchApproved={controller.batchApproved}
              onApproveAll={() => controller.setModalOpen(true)}
              committedCount={controller.committedCount}
              committedSummary={controller.committedSummary ?? undefined}
            />
          </div>

          <WorkspaceFrame
            mobileView={mobileView}
            index={
              <LedgerIndex
                items={filteredAll}
                filter={filter}
                onFilterChange={handleFilterChange}
                counts={counts}
                page={page}
                pageSize={PAGE_SIZE}
                onPageChange={handlePageChange}
                selectedId={selectedDecision?.id ?? null}
                onSelect={handleSelect}
                statusFor={controller.statusFor}
                isJudgment={isJudgment}
                batchEligibleCount={eligibleDecisions.length}
                onReviewBatch={() => controller.setModalOpen(true)}
              />
            }
            dossier={
              selectedDecision ? (
                <DecisionDossier
                  key={selectedDecision.id}
                  decision={selectedDecision}
                  isJudgment={isJudgment(selectedDecision)}
                  status={controller.statusFor(selectedDecision)}
                  error={controller.errorFor(selectedDecision.id)}
                  busy={controller.pending}
                  isDisclosureOpen={controller.isDisclosureOpen(
                    selectedDecision.id,
                  )}
                  onToggleDisclosure={() =>
                    controller.toggleDisclosure(selectedDecision.id)
                  }
                  onPrimary={() => controller.handlePrimary(selectedDecision)}
                  onDecline={() =>
                    controller.handleDecline(selectedDecision.id)
                  }
                  onSaveGuidance={() =>
                    controller.handleSaveGuidance(selectedDecision)
                  }
                  position={{
                    index: selectedIndex + 1,
                    total: filteredAll.length,
                  }}
                  hasPrev={selectedIndex > 0}
                  hasNext={selectedIndex < filteredAll.length - 1}
                  onPrev={() => stepDecision(-1)}
                  onNext={() => stepDecision(1)}
                  onBackToDocket={() => setMobileView("index")}
                />
              ) : (
                <DossierEmpty />
              )
            }
          />

          <div
            className="oq-ask-panel"
            style={{
              maxWidth: 1240,
              margin: "0 auto",
              width: "100%",
              padding: "0 32px",
            }}
          >
            <AskOdesaPanel
              suggestions={ASK_SUGGESTIONS}
              contextLabel="Across all decisions"
            />
          </div>
        </div>
      )}

      <ApproveAllModal
        open={controller.modalOpen}
        onClose={() => controller.setModalOpen(false)}
        onConfirm={controller.handleBatchApprove}
        routine={eligibleDecisions}
        excluded={judgmentDecisions}
        totalAmount={summary.routineTotal}
      />

      <DecisionEditDrawer
        decision={controller.editingDecision}
        open={controller.drawerOpen}
        onOpenChange={controller.handleDrawerOpenChange}
        onResult={controller.handleDrawerResult}
      />

      <SaveGuidanceDialog
        target={controller.guidanceTarget}
        onClose={() => controller.setGuidanceTarget(null)}
        onSave={controller.handleGuidanceSave}
      />

      <style
        precedence="default"
        href="owner-queue-styles"
        dangerouslySetInnerHTML={{
          __html: `
.oq-workspace {
  display: grid;
  grid-template-columns: minmax(340px, 384px) 1fr;
  gap: 20px;
  align-items: start;
}
.oq-index, .oq-dossier { height: calc(100vh - 268px); min-height: 440px; }
@media (max-width: 980px) {
  .oq-workspace { grid-template-columns: 1fr; }
  .oq-workspace[data-mobile-view="index"] .oq-dossier { display: none; }
  .oq-workspace[data-mobile-view="dossier"] .oq-index { display: none; }
  .owner-queue-workspace[data-mobile-view="dossier"] .oq-masthead,
  .owner-queue-workspace[data-mobile-view="dossier"] .oq-batch-strip,
  .owner-queue-workspace[data-mobile-view="dossier"] .oq-ask-panel { display: none; }
  .oq-index, .oq-dossier { height: auto; min-height: 0; }
  .oq-back { display: inline-flex !important; }
}
.owner-queue-workspace button:focus-visible {
  outline: 2px solid var(--terracotta);
  outline-offset: 2px;
}
`,
        }}
      />
    </>
  );
}

/** Fallback when a filter view resolves to no decisions (e.g. empty tier). */
function DossierEmpty() {
  return (
    <div
      style={{
        background: "var(--panel-lift)",
        border: "1px solid var(--hairline)",
        borderRadius: 10,
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        textAlign: "center",
        fontSize: "13px",
        color: "var(--ink-3)",
      }}
    >
      Select a decision from the ledger to open its dossier.
    </div>
  );
}
