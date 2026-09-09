import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@/types/database';
import type { ImportSource } from './types';
import type { ImportPlan } from './types';

type Admin = SupabaseClient<Database>;

export interface CommitSummary {
  inserted: { properties: number; units: number; tenants: number; leases: number };
  skipped: { properties: number; units: number; tenants: number; leases: number };
  errors: [];
}

export type CommitOutcome =
  | { ok: true; summary: CommitSummary; replay: boolean }
  | { ok: false; error: string; conflict: boolean };

function serializablePlan(plan: ImportPlan): Json {
  return JSON.parse(JSON.stringify({
    properties: plan.properties,
    units: plan.units,
    tenants: plan.tenants,
    leases: plan.leases,
  })) as Json;
}

/** One RPC call is the transaction boundary; PostgreSQL owns locking/replay. */
export async function commitPlan(
  admin: Admin,
  organizationId: string,
  source: ImportSource,
  idempotencyKey: string,
  sourceBytes: Uint8Array,
  plan: ImportPlan,
): Promise<CommitOutcome> {
  const payloadHash = createHash('sha256')
    .update(source)
    .update('\0')
    .update(sourceBytes)
    .digest('hex');

  const { data, error } = await admin.rpc('commit_portfolio_import', {
    p_organization_id: organizationId,
    p_idempotency_key: idempotencyKey,
    p_source: source,
    p_payload_hash: payloadHash,
    p_plan: serializablePlan(plan),
  });

  if (error) {
    if (error.message.includes('unit_not_vacant')) {
      return { ok: false, error: 'unit_not_vacant', conflict: true };
    }
    const conflict = error.message.includes('idempotency key');
    return { ok: false, error: conflict ? error.message : 'Import transaction failed', conflict };
  }

  const result = data as unknown as { summary: CommitSummary; replay: boolean } | null;
  if (!result?.summary) {
    return { ok: false, error: 'Import transaction returned no result', conflict: false };
  }
  return { ok: true, summary: result.summary, replay: result.replay === true };
}
