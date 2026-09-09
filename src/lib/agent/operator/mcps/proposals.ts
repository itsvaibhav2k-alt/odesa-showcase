/**
 * Proposals MCP — list / commit / reject pending action proposals.
 *
 * Wraps the existing v1.5 helpers:
 *   - `commitProposal` from src/lib/agent/proposals/commit.ts
 *   - `recordOutcome`  from src/lib/agent/proposals/outcome.ts (rejection path)
 *
 * The list endpoint goes direct to Supabase because no public list
 * helper exists yet (proposals/* exposes record / commit / outcome
 * surfaces — listing is a UI concern that v1.5 read off the dashboard
 * SSR query).
 *
 * `list_proposals` accepts an optional `propertyName`. When supplied it
 * resolves via `resolvePropertyName` and filters to that property. When
 * omitted it lists across ALL org properties, capped at 50 rows — useful
 * for portfolio-wide "what's pending?" queries.
 *
 * `commit_proposal` and `reject_proposal` are unchanged: they operate
 * on a `proposalId` and validate org membership via the proposal row.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { Database } from '@/types/database';
import { commitProposal } from '@/lib/agent/proposals/commit';
import { recordOutcome } from '@/lib/agent/proposals/outcome';
import {
  WORKER_ACTION_TYPES,
  type WorkerActionType,
} from '@/lib/agent/worker/types';
import { REVIEW_ACTION_LABELS } from '@/lib/agent/worker/action-labels';
import type { CommitActor } from '@/lib/authz/policy';
import type { OrganizationContext } from '../org-context';
import { resolvePropertyName } from '../property-resolver';

const LIST_LIMIT_PROPERTY = 20;
const LIST_LIMIT_ORG = 50;

const PROPOSAL_STATUSES = [
  'proposed',
  'committed',
  'rejected',
  'edited',
  'expired',
] as const;

export interface CreateProposalsMcpDeps {
  admin: SupabaseClient<Database>;
  organizationId: string;
  orgContext: OrganizationContext;
  /** Operator user id; persisted into outcome metadata for audit. */
  userId: string;
  /** Human actor for owner-only proposal decisions. */
  commitActor: CommitActor;
  /**
   * The dispatcher is inspection-only. A future non-model boundary may opt in
   * only after it has already verified a distinct human confirmation.
   */
  decisionAuthority: 'inspection_only' | 'confirmed_human';
}

export function createProposalsMcp(deps: CreateProposalsMcpDeps) {
  return createSdkMcpServer({
    name: 'odesa-operator-proposals',
    version: '0.1.0',
    // 16 tools total — always in the prompt; deferral behind ToolSearch
    // costs a full model round trip per fresh conversation.
    alwaysLoad: true,
    tools: [
      tool(
        'list_proposals',
        'List recent action proposals. Pass propertyName to filter to one property; omit for a portfolio-wide view (up to 50 rows). Defaults to status=proposed (the queue awaiting review).',
        {
          propertyName: z
            .string()
            .optional()
            .describe(
              'Name (or substring) of the property to filter by. Omit to list across all org properties.',
            ),
          status: z
            .enum(PROPOSAL_STATUSES)
            .optional()
            .describe('Filter by status. Default "proposed".'),
        },
        async (args) => {
          const status = args.status ?? 'proposed';

          // Property-scoped query.
          if (args.propertyName !== undefined) {
            const resolved = resolvePropertyName(
              deps.orgContext.properties,
              args.propertyName,
            );
            if (resolved.kind !== 'unique') {
              const allNames = deps.orgContext.properties.map((p) => p.name).join(', ');
              if (resolved.kind === 'none') {
                return text(
                  `No property matches '${args.propertyName}'. Org has: ${allNames}.`,
                );
              }
              const matchNames = resolved.matches.map((m) => m.name).join(', ');
              return text(
                `Multiple properties match '${args.propertyName}': ${matchNames}. Be more specific.`,
              );
            }

            const { data, error } = await deps.admin
              .from('action_proposals')
              .select(
                'action_type, status, property_id, created_at',
              )
              .eq('organization_id', deps.organizationId)
              .eq('property_id', resolved.property.id)
              .eq('status', status)
              .order('created_at', { ascending: false })
              .limit(LIST_LIMIT_PROPERTY);

            if (error) return text(`list_proposals failed: ${error.message}`);
            return text(
              JSON.stringify(summarizeProposals(data ?? [], deps.orgContext)),
            );
          }

          // Org-wide query (no propertyName supplied).
          const { data, error } = await deps.admin
            .from('action_proposals')
            .select(
              'action_type, status, property_id, created_at',
            )
            .eq('organization_id', deps.organizationId)
            .eq('status', status)
            .order('created_at', { ascending: false })
            .limit(LIST_LIMIT_ORG);

          if (error) return text(`list_proposals failed: ${error.message}`);
          return text(
            JSON.stringify(summarizeProposals(data ?? [], deps.orgContext)),
          );
        },
      ),
      tool(
        'commit_proposal',
        'Approve a pending proposal and execute its side effect (e.g. send the drafted SMS). The proposal must belong to this organization.',
        {
          proposalId: z.string().min(1),
          note: z
            .string()
            .optional()
            .describe('Optional approval note (operator-only; not sent to tenant).'),
        },
        async (args) => {
          if (deps.decisionAuthority !== 'confirmed_human') {
            return text(
              'Commitments can only be approved in Owner Queue after explicit human review.',
            );
          }
          if (!canCommitProposals(deps.commitActor)) {
            return text(
              'Owner approval is required to commit this proposal. I can summarize it for an owner handoff.',
            );
          }

          const ownership = await assertOwnership(deps, args.proposalId);
          if (!ownership.ok) return text(ownership.message);

          try {
            const result = await commitProposal(
              deps.admin,
              args.proposalId,
              deps.commitActor,
            );
            if (result.proposal.status !== 'committed') {
              return text(
                'The decision was not completed and needs reconciliation in Owner Queue.',
              );
            }
            return text('The reviewed decision is committed.');
          } catch {
            return text('The decision could not be completed. Open Owner Queue to reconcile it.');
          }
        },
      ),
      tool(
        'reject_proposal',
        'Reject a pending proposal so it never executes. Reason is captured for the audit log + autonomy graduation.',
        {
          proposalId: z.string().min(1),
          reason: z
            .string()
            .optional()
            .describe('Why the operator is rejecting (steers trust graduation).'),
        },
        async (args) => {
          if (deps.decisionAuthority !== 'confirmed_human') {
            return text(
              'Commitments can only be declined in Owner Queue after explicit human review.',
            );
          }
          if (!canRejectProposals(deps.commitActor)) {
            return text(
              'Owner approval is required to reject this proposal. I can summarize it for an owner handoff.',
            );
          }

          const ownership = await assertOwnership(deps, args.proposalId);
          if (!ownership.ok) return text(ownership.message);

          try {
            await recordOutcome(deps.admin, {
              proposalId: args.proposalId,
              outcome: { kind: 'rejected', reason: args.reason },
              outcomeMeta: {
                rejected_by: deps.userId,
                channel: 'operator_chat',
              },
            });
            return text('The reviewed decision was declined.');
          } catch {
            return text('The decision could not be declined. Open Owner Queue to reconcile it.');
          }
        },
      ),
    ],
  });
}

function canCommitProposals(actor: CommitActor): boolean {
  return actor.kind === 'user' && actor.role === 'owner';
}

function canRejectProposals(actor: CommitActor): boolean {
  return actor.kind === 'user' && actor.role === 'owner';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface OwnershipOk {
  ok: true;
}
interface OwnershipFail {
  ok: false;
  message: string;
}

/**
 * Confirm the proposal belongs to this org. RLS already guards this on
 * writes, but fail-fast here gives the model a clean tool error rather
 * than a Postgres complaint.
 */
async function assertOwnership(
  deps: CreateProposalsMcpDeps,
  proposalId: string,
): Promise<OwnershipOk | OwnershipFail> {
  const { data, error } = await deps.admin
    .from('action_proposals')
    .select('id, organization_id')
    .eq('id', proposalId)
    .maybeSingle();
  if (error) {
    return { ok: false, message: 'The proposal could not be loaded.' };
  }
  if (!data) {
    return { ok: false, message: 'That proposal was not found.' };
  }
  if (data.organization_id !== deps.organizationId) {
    return {
      ok: false,
      message: 'That proposal was not found.',
    };
  }
  return { ok: true };
}

const WORKER_ACTION_TYPE_SET = new Set<string>(WORKER_ACTION_TYPES);

function summarizeProposals(
  rows: ReadonlyArray<{
    action_type: string;
    status: string;
    property_id: string;
    created_at: string;
  }>,
  orgContext: OrganizationContext,
): Array<{
  action: string;
  property: string;
  status: string;
  createdAt: string;
}> {
  const propertyNames = new Map(
    orgContext.properties.map((property) => [property.id, property.name]),
  );
  return rows.map((row) => ({
    action: WORKER_ACTION_TYPE_SET.has(row.action_type)
      ? REVIEW_ACTION_LABELS[row.action_type as WorkerActionType]
      : 'Property operation',
    property: propertyNames.get(row.property_id) ?? 'Portfolio',
    status: humaneProposalStatus(row.status),
    createdAt: row.created_at,
  }));
}

function humaneProposalStatus(status: string): string {
  switch (status) {
    case 'proposed':
      return 'Awaiting Owner Queue review';
    case 'committed':
      return 'Completed';
    case 'rejected':
      return 'Declined';
    case 'edited':
      return 'Edited';
    case 'expired':
      return 'Expired';
    default:
      return 'Recorded';
  }
}

function text(s: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: s }] };
}
