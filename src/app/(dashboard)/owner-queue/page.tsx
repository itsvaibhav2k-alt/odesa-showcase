/**
 * /owner-queue — the Owner's decision ledger.
 *
 * Async server component. Reads the live decision queue from Supabase
 * (`action_proposals`, RLS-scoped) via `@/lib/owner-queue/queries` and threads
 * it through the sticky top bar + the single interactive client island — a
 * bounded master-detail docket (finite ledger index + one open dossier), not a
 * stacked card feed. Wraps everything in `today-theme` so the warm operator
 * tokens (--canvas, --ink, --terracotta, …) resolve. Does NOT use
 * TodayPageShell.
 */

import {
  getDecisionSummary,
  getJudgmentDecisions,
  getRoutineDecisions,
} from "@/lib/owner-queue/queries";
import { OwnerQueueTopBar } from "@/components/owner-queue/owner-queue-top-bar";
import { OwnerQueueClient } from "@/components/owner-queue/owner-queue-client";
import { createServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OwnerQueuePage() {
  const supabase = await createServerClient();
  const { data: currentRole } = await supabase.rpc("current_user_role");
  if (currentRole === "va") {
    // UX routing only: shared server guards remain authoritative. VAs inspect
    // the grounded read-only escalation desk instead of entering owner controls.
    redirect("/escalations");
  }

  const [summary, judgmentDecisions, routineDecisions] = await Promise.all([
    getDecisionSummary(),
    getJudgmentDecisions(),
    getRoutineDecisions(),
  ]);

  return (
    <div
      data-testid="owner-queue-page"
      className="today-theme"
      style={{
        background: "var(--panel-clean)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <OwnerQueueTopBar
        pendingCount={summary.pendingCount}
        totalAtStake={summary.totalAtStake}
        timeSensitiveCount={summary.timeSensitiveCount}
      />
      <OwnerQueueClient
        judgmentDecisions={judgmentDecisions}
        routineDecisions={routineDecisions}
        summary={summary}
      />
    </div>
  );
}
