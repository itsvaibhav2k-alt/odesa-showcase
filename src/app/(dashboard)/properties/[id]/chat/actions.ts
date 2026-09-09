'use server';

/**
 * Server actions for the operator chat ProposedActionCard (Phase 3).
 *
 * Two thin wrappers around existing helpers:
 *   - `commitProposalAction(proposalId)` → `commitProposal(admin, ...)`
 *   - `rejectProposalAction({proposalId, reason})` → `recordOutcome(admin, ...)`
 *
 * Both run cookie-auth via `requireAuthContext()` (mirrors the
 * properties/[id]/actions.ts pattern), then verify the proposal
 * belongs to the caller's org via the SSR client (RLS-scoped) before
 * handing the proposal id to the admin client. The admin client is
 * needed because `commitProposal` writes to messages / weekly_reports
 * which the authenticated client may not have grants on for cross-
 * table dispatch — same justification as the tenant-side approve route.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { commitProposal } from '@/lib/agent/proposals/commit';
import { recordOutcome } from '@/lib/agent/proposals/outcome';
import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import type { ApiResponse } from '@/types';

interface AuthContext {
  userId: string;
  organizationId: string;
  /** users.role of the caller; commit role gates fail closed on null. */
  role: string | null;
}

async function requireAuthContext(): Promise<ApiResponse<AuthContext>> {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Not authenticated' };
  }

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (userErr || !userRow) {
    return { success: false, error: 'User profile not found' };
  }

  return {
    success: true,
    data: {
      userId: user.id,
      organizationId: userRow.organization_id,
      role: userRow.role ?? null,
    },
  };
}

async function assertProposalInOrg(
  proposalId: string,
  organizationId: string,
): Promise<ApiResponse<{ propertyId: string }>> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('action_proposals')
    .select('id, organization_id, property_id')
    .eq('id', proposalId)
    .maybeSingle();

  if (error) {
    return { success: false, error: error.message };
  }
  if (!data) {
    return { success: false, error: 'Proposal not found' };
  }
  // RLS already filters cross-org, so this branch is defence-in-depth.
  if (data.organization_id !== organizationId) {
    return { success: false, error: 'Forbidden' };
  }
  return { success: true, data: { propertyId: data.property_id } };
}

// ---------------------------------------------------------------------------
// commitProposalAction
// ---------------------------------------------------------------------------

const commitSchema = z.object({
  proposalId: z.string().uuid('Invalid proposal id'),
});

export interface CommitProposalActionPayload {
  proposalId: string;
}

export async function commitProposalAction(
  payload: CommitProposalActionPayload,
): Promise<ApiResponse<{ proposalId: string; status: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;

  // A human proposal decision is owner-only regardless of proposal type.
  if (auth.data.role !== 'owner') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const parsed = commitSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid payload',
    };
  }

  const ownership = await assertProposalInOrg(
    parsed.data.proposalId,
    auth.data.organizationId,
  );
  if (!ownership.success) return ownership;

  try {
    const admin = createAdminClient();
    const result = await commitProposal(admin, parsed.data.proposalId, {
      kind: 'user',
      role: auth.data.role,
    });

    if (result.proposal.status !== 'committed') {
      return {
        success: false,
        error: 'The decision was not completed and needs reconciliation',
      };
    }

    revalidatePath(`/properties/${ownership.data.propertyId}/chat`);

    return {
      success: true,
      data: {
        proposalId: result.proposal.id ?? parsed.data.proposalId,
        status: result.proposal.status,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Commit failed',
    };
  }
}

// ---------------------------------------------------------------------------
// rejectProposalAction
// ---------------------------------------------------------------------------

const rejectSchema = z.object({
  proposalId: z.string().uuid('Invalid proposal id'),
  reason: z.string().trim().max(500).optional(),
});

export interface RejectProposalActionPayload {
  proposalId: string;
  reason?: string;
}

export async function rejectProposalAction(
  payload: RejectProposalActionPayload,
): Promise<ApiResponse<{ proposalId: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;

  if (auth.data.role !== 'owner') {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const parsed = rejectSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid payload',
    };
  }

  const ownership = await assertProposalInOrg(
    parsed.data.proposalId,
    auth.data.organizationId,
  );
  if (!ownership.success) return ownership;

  try {
    const admin = createAdminClient();
    await recordOutcome(admin, {
      proposalId: parsed.data.proposalId,
      outcome: { kind: 'rejected', reason: parsed.data.reason },
      outcomeMeta: {
        rejected_by: auth.data.userId,
        channel: 'operator_chat_web',
      },
    });

    revalidatePath(`/properties/${ownership.data.propertyId}/chat`);

    return { success: true, data: { proposalId: parsed.data.proposalId } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Reject failed',
    };
  }
}
