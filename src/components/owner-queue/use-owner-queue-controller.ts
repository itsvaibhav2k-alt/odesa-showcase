'use client';

import { useState, useTransition } from 'react';
import {
  approveDecision,
  batchApprove,
  declineDecision,
  saveDecisionAsOwnerRule,
} from '@/app/(dashboard)/owner-queue/actions';
import type { Decision } from '@/lib/owner-queue/mock-decisions';
import {
  directCommitKindFor,
  editKindFor,
  guidanceDefaultFor,
} from '@/lib/owner-queue/decision-actions';
import type { ApproveAllResult } from './approve-all-modal';
import type { CommittedSummary } from './decision-summary-banner';
import type { DecisionEditResult } from './decision-edit-drawer';
import type { GuidanceTarget } from './save-guidance-dialog';

/** Owner-facing lifecycle status reconciled from server-action results. */
export type DecisionStatus = 'recommended' | 'edited' | 'approved' | 'declined';

export interface OwnerQueueController {
  pending: boolean;
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  batchApproved: boolean;
  committedSummary: CommittedSummary | null;
  committedCount: number;
  editingDecision: Decision | null;
  drawerOpen: boolean;
  guidanceTarget: GuidanceTarget | null;
  setGuidanceTarget: (target: GuidanceTarget | null) => void;
  batchEligible: () => Decision[];
  statusFor: (decision: Decision) => DecisionStatus;
  errorFor: (id: string) => string | null;
  isDisclosureOpen: (id: string) => boolean;
  toggleDisclosure: (id: string) => void;
  handlePrimary: (decision: Decision) => void;
  handleDecline: (id: string) => void;
  handleSaveGuidance: (decision: Decision) => void;
  handleGuidanceSave: (
    propertyId: string,
    text: string,
  ) => Promise<{ ok: true; duplicate: boolean } | { ok: false; error: string }>;
  handleBatchApprove: (ids: string[]) => Promise<ApproveAllResult>;
  handleDrawerOpenChange: (open: boolean) => void;
  handleDrawerResult: (result: DecisionEditResult) => void;
}

export function useOwnerQueueController(
  routineDecisions: Decision[],
): OwnerQueueController {
  const [openDisclosures, setOpenDisclosures] = useState<Set<string>>(new Set());
  const [states, setStates] = useState<Map<string, DecisionStatus>>(new Map());
  const [modalOpen, setModalOpen] = useState(false);
  const [batchApproved, setBatchApproved] = useState(false);
  const [committedSummary, setCommittedSummary] =
    useState<CommittedSummary | null>(null);
  const [committedCount, setCommittedCount] = useState(0);
  const [editingDecision, setEditingDecision] = useState<Decision | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [guidanceTarget, setGuidanceTarget] = useState<GuidanceTarget | null>(
    null,
  );
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [pending, startTransition] = useTransition();

  function toggleDisclosure(id: string) {
    setOpenDisclosures((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function setStatus(id: string, status: DecisionStatus) {
    setStates((prev) => {
      const next = new Map(prev);
      next.set(id, status);
      return next;
    });
  }

  function setError(id: string, message: string | null) {
    setErrors((prev) => {
      const next = new Map(prev);
      if (message) {
        next.set(id, message);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function statusFor(decision: Decision): DecisionStatus {
    return states.get(decision.id) ?? decision.state ?? 'recommended';
  }

  function errorFor(id: string): string | null {
    return errors.get(id) ?? null;
  }

  function isDisclosureOpen(id: string): boolean {
    return openDisclosures.has(id);
  }

  function openDrawer(decision: Decision) {
    setEditingDecision(decision);
    setDrawerOpen(true);
  }

  function handleDrawerOpenChange(open: boolean) {
    setDrawerOpen(open);
    if (!open) setEditingDecision(null);
  }

  function handleDrawerResult(result: DecisionEditResult) {
    setStatus(result.id, result.state === 'approved' ? 'approved' : 'edited');
    setError(result.id, null);
  }

  /**
   * Routes the card primary through the direct-commit allow-list. Message,
   * money, and lease decisions still open the preview drawer and never commit
   * from a bare card click.
   */
  function handlePrimary(decision: Decision) {
    const directCommit = directCommitKindFor(decision.actionType ?? '');
    if (directCommit === 'dispatch' || directCommit === 'acknowledge') {
      runApprove(decision.id);
      return;
    }
    if (decision.editKind != null) {
      openDrawer(decision);
      return;
    }
    toggleDisclosure(decision.id);
  }

  function runApprove(id: string) {
    setError(id, null);
    startTransition(async () => {
      const result = await approveDecision(id);
      if (result.ok) {
        setStatus(id, 'approved');
      } else {
        setError(id, result.error);
      }
    });
  }

  function handleDecline(id: string) {
    setError(id, null);
    startTransition(async () => {
      const result = await declineDecision(id);
      if (result.ok) {
        setStatus(id, 'declined');
      } else {
        setError(id, result.error);
      }
    });
  }

  function batchEligible(): Decision[] {
    return routineDecisions.filter((decision) => {
      const status = statusFor(decision);
      return decision.recommendation === 'approve' && status === 'recommended';
    });
  }

  async function handleBatchApprove(ids: string[]): Promise<ApproveAllResult> {
    if (ids.length === 0) return { ok: true, results: [] };

    const { ok, results } = await batchApprove(ids);
    const committedIds = new Set(
      results.filter((item) => item.ok).map((item) => item.id),
    );

    setStates((prev) => {
      const next = new Map(prev);
      for (const id of committedIds) next.set(id, 'approved');
      return next;
    });

    if (ok && committedIds.size > 0) {
      const committedDecisions = routineDecisions.filter((decision) =>
        committedIds.has(decision.id),
      );
      setCommittedSummary(committedSummaryFor(committedDecisions));
      setCommittedCount(committedIds.size);
      setBatchApproved(true);
    }

    return { ok, results };
  }

  function handleSaveGuidance(decision: Decision) {
    setGuidanceTarget(toGuidance(decision));
  }

  async function handleGuidanceSave(
    propertyId: string,
    text: string,
  ): Promise<{ ok: true; duplicate: boolean } | { ok: false; error: string }> {
    const result = await saveDecisionAsOwnerRule(propertyId, text);
    if (result.ok) {
      return { ok: true, duplicate: result.data?.status === 'duplicate' };
    }
    return { ok: false, error: result.error };
  }

  return {
    pending,
    modalOpen,
    setModalOpen,
    batchApproved,
    committedSummary,
    committedCount,
    editingDecision,
    drawerOpen,
    guidanceTarget,
    setGuidanceTarget,
    batchEligible,
    statusFor,
    errorFor,
    isDisclosureOpen,
    toggleDisclosure,
    handlePrimary,
    handleDecline,
    handleSaveGuidance,
    handleGuidanceSave,
    handleBatchApprove,
    handleDrawerOpenChange,
    handleDrawerResult,
  };
}

function committedSummaryFor(decisions: Decision[]): CommittedSummary {
  const summary: CommittedSummary = {
    messages: 0,
    payments: 0,
    leases: 0,
    dispatches: 0,
  };
  for (const decision of decisions) {
    switch (editKindFor(decision.actionType)) {
      case 'message':
        summary.messages += 1;
        break;
      case 'rent_payment':
        summary.payments += 1;
        break;
      case 'lease':
        summary.leases += 1;
        break;
      case 'dispatch':
        summary.dispatches += 1;
        break;
      default:
        break;
    }
  }
  return summary;
}

function toGuidance(decision: Decision): GuidanceTarget {
  return {
    decisionId: decision.id,
    propertyId: decision.propertyId ?? '',
    propertyLabel: decision.location,
    text: guidanceDefaultFor(decision.actionType, decision.title),
  };
}
