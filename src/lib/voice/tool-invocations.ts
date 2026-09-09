import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@/types/database';

type Db = SupabaseClient<Database>;

export type InvocationOutcome = 'completed' | 'failed' | 'unsupported';

export interface ToolExecutionResult {
  body: Record<string, unknown>;
  httpStatus?: number;
  outcome?: InvocationOutcome;
  retryable?: boolean;
  errorCode?: string | null;
  evidence?: Record<string, unknown>;
}

export interface DurableToolResult {
  body: Record<string, unknown>;
  httpStatus: number;
  replayed: boolean;
}

interface ClaimResult {
  id: string;
  claimed: boolean;
  takeover?: boolean;
  claim_token: string | null;
  claim_generation: number;
  lease_expires_at?: string;
  status: 'processing' | InvocationOutcome;
  canonical_result: Json | null;
  http_status: number | null;
}

const WAIT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 20;
const LEASE_RENEW_INTERVAL_MS = 1_500;

export interface InvocationOwnership {
  readonly signal: AbortSignal;
  readonly claimGeneration: number;
  /** Renew and prove the current token/generation still owns the lease. */
  assertOwned: () => Promise<void>;
}

class InvocationOwnershipLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvocationOwnershipLostError';
  }
}

function asObject(value: Json | null): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Claims one durable Retell invocation before any side effect. Concurrent
 * callers wait for, then replay, the winner's canonical terminal result.
 * A terminal failure is replayed too: the same provider retry never blindly
 * re-runs an ambiguous side effect.
 */
export async function runDurableToolInvocation(args: {
  db: Db;
  organizationId: string;
  callId: string;
  toolName: string;
  idempotencyKey: string;
  requestHash: string;
  execute: (ownership: InvocationOwnership) => Promise<ToolExecutionResult>;
  /** Reconstruct a canonical result from uniquely-keyed durable artifacts. */
  recover?: () => Promise<ToolExecutionResult | null>;
}): Promise<DurableToolResult> {
  let claim = await claimInvocation(args);
  while (!claim.claimed && claim.status === 'processing') {
    const waitMs = Math.max(
      POLL_INTERVAL_MS,
      Math.min(250, (claim.lease_expires_at ? Date.parse(claim.lease_expires_at) : Date.now()) - Date.now() + 5),
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    claim = await claimInvocation(args);
  }
  if (!claim.claimed) return canonical(claim);
  if (!claim.claim_token) throw new Error('Retell invocation claim returned no token');

  let execution: ToolExecutionResult | null = claim.takeover && args.recover
    ? await args.recover()
    : null;
  const controller = new AbortController();
  let ownershipFailure: Error | null = null;
  let renewalChain = Promise.resolve();
  const ownership: InvocationOwnership = {
    signal: controller.signal,
    claimGeneration: claim.claim_generation,
    assertOwned: () => {
      const check = renewalChain.then(async () => {
        if (ownershipFailure) throw ownershipFailure;
        const { data, error } = await args.db.rpc('renew_retell_tool_invocation_lease', {
          p_invocation_id: claim.id,
          p_claim_token: claim.claim_token!,
          p_claim_generation: claim.claim_generation,
        });
        if (error || data !== true) {
          ownershipFailure = new InvocationOwnershipLostError(
            `Retell invocation lease ownership lost: ${error?.message ?? 'fence rejected'}`,
          );
          controller.abort(ownershipFailure);
          throw ownershipFailure;
        }
      });
      renewalChain = check.catch(() => undefined);
      return check;
    },
  };
  let heartbeatStopped = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let wakeHeartbeat: () => void = () => undefined;
  const heartbeat = (async () => {
    while (!heartbeatStopped) {
      await new Promise<void>((resolve) => {
        wakeHeartbeat = resolve;
        heartbeatTimer = setTimeout(resolve, LEASE_RENEW_INTERVAL_MS);
      });
      heartbeatTimer = null;
      wakeHeartbeat = () => undefined;
      if (heartbeatStopped) break;
      try {
        await ownership.assertOwned();
      } catch {
        break;
      }
    }
  })();
  try {
    await ownership.assertOwned();
    execution ??= await args.execute(ownership);
  } catch (error_) {
    if (ownershipFailure || error_ instanceof InvocationOwnershipLostError) {
      return ownershipUncertain(ownershipFailure ?? error_);
    }
    execution = args.recover ? await args.recover() : null;
    if (!execution) {
      const message = error_ instanceof Error ? error_.message : String(error_);
      execution = {
        body: { error: 'tool execution failed', retryable: true },
        httpStatus: 500,
        outcome: 'failed',
        retryable: true,
        errorCode: 'tool_execution_failed',
        evidence: { message },
      };
    }
  } finally {
    heartbeatStopped = true;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    wakeHeartbeat();
    await heartbeat;
  }

  try {
    await ownership.assertOwned();
  } catch (error) {
    return ownershipUncertain(error);
  }
  return completeInvocation(args.db, claim, execution);
}

function ownershipUncertain(error: unknown): DurableToolResult {
  return {
    body: {
      error: 'invocation ownership uncertain',
      retryable: true,
      reconciliation_required: true,
      evidence: error instanceof Error ? error.message : String(error),
    },
    httpStatus: 409,
    replayed: false,
  };
}

async function claimInvocation(args: {
  db: Db;
  organizationId: string;
  callId: string;
  toolName: string;
  idempotencyKey: string;
  requestHash: string;
}): Promise<ClaimResult> {
  const { data, error } = await args.db.rpc('claim_retell_tool_invocation', {
    p_organization_id: args.organizationId,
    p_call_id: args.callId,
    p_tool_name: args.toolName,
    p_idempotency_key: args.idempotencyKey,
    p_request_hash: args.requestHash,
  });
  if (error || !data) {
    throw new Error(`Retell invocation claim failed: ${error?.message ?? 'no result'}`);
  }

  return data as unknown as ClaimResult;
}

async function completeInvocation(
  db: Db,
  claim: ClaimResult,
  execution: ToolExecutionResult,
): Promise<DurableToolResult> {
  const outcome = execution.outcome ?? 'completed';
  const httpStatus = execution.httpStatus ?? 200;
  const { data: completed, error: completeError } = await db.rpc(
    'complete_retell_tool_invocation',
    {
      p_invocation_id: claim.id,
      p_claim_token: claim.claim_token!,
      p_claim_generation: claim.claim_generation,
      p_status: outcome,
      p_canonical_result: execution.body as unknown as Json,
      p_http_status: httpStatus,
      p_error_code: execution.errorCode ?? null,
      p_retryable: execution.retryable ?? false,
      p_evidence: (execution.evidence ?? {}) as Json,
    },
  );
  if (completeError || !completed) {
    throw new Error(
      `Retell invocation completion failed: ${completeError?.message ?? 'no result'}`,
    );
  }
  const terminal = completed as unknown as ClaimResult;
  if (terminal.status === 'processing') return waitForCanonicalResult(db, terminal);
  return {
    body: asObject(terminal.canonical_result) ?? execution.body,
    httpStatus: terminal.http_status ?? httpStatus,
    replayed: false,
  };
}

async function waitForCanonicalResult(db: Db, claim: ClaimResult): Promise<DurableToolResult> {
  if (claim.status !== 'processing') return canonical(claim);

  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { data, error } = await db
      .from('retell_tool_invocations')
      .select('status, canonical_result, http_status, lease_expires_at')
      .eq('id', claim.id)
      .single();
    if (error) throw new Error(`Retell invocation replay read failed: ${error.message}`);
    if (data.status !== 'processing') {
      return canonical({ ...claim, ...data } as ClaimResult);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return {
    body: { error: 'invocation still processing', retryable: true },
    httpStatus: 409,
    replayed: true,
  };
}

function canonical(claim: ClaimResult): DurableToolResult {
  const body = asObject(claim.canonical_result);
  if (!body || claim.http_status === null) {
    throw new Error(`Retell invocation ${claim.id} is terminal without a canonical result`);
  }
  return { body, httpStatus: claim.http_status, replayed: true };
}
