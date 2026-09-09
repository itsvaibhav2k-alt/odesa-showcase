/**
 * Wave 6 — handler for `create_property`.
 *
 * Inserts a new properties row scoped to the dispatcher-provided
 * organization. Mirrors the column shape of `createPropertyAction`
 * in `src/app/(dashboard)/onboarding/actions.ts:114` so the agentic
 * path lands the same row the onboarding flow would.
 *
 * Idempotency: natural key is (name, address_street, organization_id).
 * If the same triple already exists we return that row with
 * `idempotent: true` instead of inserting a duplicate. This protects
 * against double-spawns (dispatcher re-tries, owner re-confirms a
 * gated proposal) without touching `created_at`.
 *
 * Confidence:
 *   - 1.0 when every required field validates cleanly. There are no
 *     name → id refs to resolve in this handler, so we never drop to
 *     0.8.
 *   - 0.5 reserved for future "optional context missing" cases (no
 *     such case currently — every field on createPropertyPayload is
 *     either required or has a default).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import type { CreatePropertyPayload } from '../types';
import type { HandlerArgs, HandlerResult } from './index';

const DEFAULT_TIMEZONE = 'America/New_York';

export async function handleCreateProperty(
  args: HandlerArgs<CreatePropertyPayload>,
): Promise<HandlerResult> {
  const { admin, organizationId, payload } = args;
  const timezone = payload.timezone ?? DEFAULT_TIMEZONE;

  // Idempotency lookup — name + street + org is the natural key.
  const existing = await findExisting(admin, organizationId, payload);
  if (existing.error) {
    return {
      ok: false,
      error: `lookup_failed: ${existing.error}`,
      confidence: 0,
    };
  }
  if (existing.row) {
    return {
      ok: true,
      data: existing.row,
      confidence: 1.0,
      reasoning: `Found existing property "${payload.name}" for this org.`,
      idempotent: true,
    };
  }

  const { data, error } = await admin
    .from('properties')
    .insert({
      organization_id: organizationId,
      name: payload.name,
      address_street: payload.addressStreet,
      address_city: payload.addressCity,
      address_state: payload.addressState,
      address_zip: payload.addressZip,
      timezone,
    })
    .select('id, name, address_street, address_city, address_state, address_zip, timezone')
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? 'insert_failed',
      confidence: 0,
    };
  }

  return {
    ok: true,
    data,
    confidence: 1.0,
    reasoning: `Created property "${payload.name}" at ${payload.addressStreet}.`,
  };
}

interface ExistingLookup {
  row: Record<string, unknown> | null;
  error: string | null;
}

async function findExisting(
  admin: SupabaseClient<Database>,
  organizationId: string,
  payload: CreatePropertyPayload,
): Promise<ExistingLookup> {
  const { data, error } = await admin
    .from('properties')
    .select('id, name, address_street, address_city, address_state, address_zip, timezone')
    .eq('organization_id', organizationId)
    .eq('name', payload.name)
    .eq('address_street', payload.addressStreet)
    .limit(1)
    .maybeSingle();

  if (error) return { row: null, error: error.message };
  return { row: data ?? null, error: null };
}
