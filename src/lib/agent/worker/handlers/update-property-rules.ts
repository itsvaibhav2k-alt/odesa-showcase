/**
 * Wave 6 — handler for `update_property_rules`.
 *
 * Resolves the propertyRef (UUID short-circuit OR name lookup) and
 * UPDATEs properties.rules_text. The 4000-char ceiling is enforced by
 * the payload's Zod schema before this handler runs; we only re-check
 * defensively here in case a future caller skips the schema.
 *
 * Idempotency: if the existing rules_text already matches, we tag the
 * result with `idempotent: true` and skip the no-op write.
 *
 * Confidence:
 *   - 1.0 when propertyRef is a UUID we verify in-org.
 *   - 0.8 when propertyRef is a name resolving to a single match.
 *   - 0.2 with `error: 'ambiguous_property'` on multi-match.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { resolveProperty } from '../resolve-refs';
import type { UpdatePropertyRulesPayload } from '../types';
import type { HandlerArgs, HandlerResult } from './index';

const RULES_MAX_CHARS = 4000;

export async function handleUpdatePropertyRules(
  args: HandlerArgs<UpdatePropertyRulesPayload>,
): Promise<HandlerResult> {
  const { admin, organizationId, payload } = args;

  if (payload.rulesText.length > RULES_MAX_CHARS) {
    return {
      ok: false,
      error: `rules_text exceeds ${RULES_MAX_CHARS} chars`,
      confidence: 0,
    };
  }

  const resolved = await resolvePropertyRef(admin, organizationId, payload);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.reason === 'ambiguous'
        ? 'ambiguous_property'
        : 'property_not_found',
      confidence: resolved.reason === 'ambiguous' ? 0.2 : 0,
    };
  }

  // Read current to detect no-op writes.
  const { data: current, error: readError } = await admin
    .from('properties')
    .select('id, name, rules_text')
    .eq('organization_id', organizationId)
    .eq('id', resolved.id)
    .limit(1)
    .maybeSingle();

  if (readError || !current) {
    return {
      ok: false,
      error: readError?.message ?? 'property_not_found',
      confidence: 0,
    };
  }

  const idempotent = current.rules_text === payload.rulesText;

  if (idempotent) {
    return {
      ok: true,
      data: current,
      confidence: resolved.byId ? 1.0 : 0.8,
      reasoning: `rules_text unchanged for "${current.name}".`,
      idempotent: true,
    };
  }

  const { data, error } = await admin
    .from('properties')
    .update({ rules_text: payload.rulesText })
    .eq('organization_id', organizationId)
    .eq('id', resolved.id)
    .select('id, name, rules_text')
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? 'update_failed',
      confidence: 0,
    };
  }

  return {
    ok: true,
    data,
    confidence: resolved.byId ? 1.0 : 0.8,
    reasoning: `Updated rules_text for "${data.name}".`,
  };
}

interface RefOk {
  ok: true;
  id: string;
  byId: boolean;
}
interface RefErr {
  ok: false;
  reason: 'not_found' | 'ambiguous';
}
type RefResult = RefOk | RefErr;

async function resolvePropertyRef(
  admin: SupabaseClient<Database>,
  organizationId: string,
  payload: UpdatePropertyRulesPayload,
): Promise<RefResult> {
  const ref = payload.propertyRef;

  if ('propertyId' in ref) {
    const { data, error } = await admin
      .from('properties')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('id', ref.propertyId)
      .limit(1)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: 'not_found' };
    return { ok: true, id: data.id, byId: true };
  }

  const result = await resolveProperty(admin, organizationId, ref.propertyName);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, id: result.id, byId: false };
}
