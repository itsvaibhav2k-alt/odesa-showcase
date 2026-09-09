/**
 * Galaxy v1.5 fixture extension — property workers, memory, autonomy.
 *
 * Layered on top of `./galaxy.ts` (v1 fixture). v1.5 introduces three
 * new tables (memory_facts, action_proposals, meta_insights) plus four
 * column additions to `properties` (rules_text, autonomy_level,
 * privacy_mode, ollama_host). This module:
 *
 *   - Provisions a fresh org + owner + N seeded properties.
 *   - Seeds 5 memory_facts per property covering the four canonical
 *     fact_types (vendor_relationship, tenant_pattern, building_quirk,
 *     derived_rule, owner_rule) so worker context-loading specs can
 *     exercise every branch.
 *   - Seeds 10 action_proposals per fixture, evenly distributed across
 *     the five status values (proposed, committed, rejected, edited,
 *     expired) so the proposals-feed and reflection specs have a
 *     realistic mix to operate on.
 *   - Defaults every seeded property to autonomy_level=0.5 (the gate
 *     boundary the matrix spec exercises in both directions).
 *
 * Why a separate file vs editing `galaxy.ts`:
 *   The v1 fixture is consumed by 30+ existing specs that don't know
 *   about workers/memory. Adding the v1.5 columns there would (a)
 *   bloat every teardown and (b) couple v1 specs to the v1.5 migration
 *   running. Extending here keeps v1 stable and makes the v1.5
 *   surface explicit at every callsite.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '../../src/types/database';

import { GALAXY } from './galaxy';

// =====================================================================
// Environment resolution (mirrors messaging/helpers.ts)
// =====================================================================

export const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  '';

export const HAVE_SUPABASE = Boolean(
  SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY,
);

export function createAdmin(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// =====================================================================
// Constants
// =====================================================================

/** Default autonomy level; sits at the gate boundary on purpose. */
export const DEFAULT_AUTONOMY_LEVEL = 0.5;

/** Number of memory_facts seeded per property. */
export const FACTS_PER_PROPERTY = 5;

/** Number of action_proposals seeded per fixture. */
export const PROPOSALS_PER_FIXTURE = 10;

/** The five canonical fact_type values (matches migration CHECK). */
export const FACT_TYPES = [
  'vendor_relationship',
  'tenant_pattern',
  'building_quirk',
  'derived_rule',
  'owner_rule',
] as const;
export type FactType = (typeof FACT_TYPES)[number];

/** The five proposal status values (matches migration CHECK). */
export const PROPOSAL_STATUSES = [
  'proposed',
  'committed',
  'rejected',
  'edited',
  'expired',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Privacy modes (matches migration CHECK). */
export const PRIVACY_MODES = ['hosted', 'on_prem'] as const;
export type PrivacyMode = (typeof PRIVACY_MODES)[number];

// =====================================================================
// Types
// =====================================================================

export interface SeededFactHandle {
  id: string;
  factType: FactType;
  propertyId: string;
}

export interface SeededProposalHandle {
  id: string;
  propertyId: string;
  status: ProposalStatus;
  actionType: string;
  confidence: number;
  gateDecision: 'auto' | 'review' | 'block';
}

export interface SeededProperty {
  id: string;
  name: string;
  rulesText: string;
  autonomyLevel: number;
  privacyMode: PrivacyMode;
  ollamaHost: string | null;
}

export interface GalaxyV15Fixture {
  owner: {
    userId: string;
    email: string;
    password: string;
  };
  organizationId: string;
  properties: readonly SeededProperty[];
  facts: readonly SeededFactHandle[];
  proposals: readonly SeededProposalHandle[];
  /** Cleans up everything this fixture inserted. Idempotent. */
  teardown: () => Promise<void>;
}

export interface ProvisionV15Options {
  /** How many properties to seed. Defaults to 5 (cross-property meta-insight gate). */
  propertyCount?: number;
  /** Override default autonomy level for every property. */
  autonomyLevel?: number;
  /** Override privacy mode for every property. */
  privacyMode?: PrivacyMode;
  /** When privacy_mode='on_prem', override the ollama_host URL. */
  ollamaHost?: string;
  /** Pre-baked rules text written into rules_text on every property. */
  rulesText?: string;
}

// =====================================================================
// Internal helpers
// =====================================================================

let counter = 0;

function uniqDigits(): string {
  counter += 1;
  return String(Date.now()).slice(-6) + String(counter).padStart(4, '0');
}

async function createUserWithRetry(
  admin: SupabaseClient<Database>,
  email: string,
  password: string,
  orgName: string,
): Promise<{ id: string }> {
  const maxAttempts = 4;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          organization_name: orgName,
          full_name: 'Galaxy v1.5 Owner',
        },
      });
      if (error || !data.user) {
        lastError = error ?? new Error('no user returned');
      } else {
        return { id: data.user.id };
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`createUser failed after ${maxAttempts} attempts: ${message}`);
}

/**
 * Build the body payload for a memory_fact of the given type. Each
 * fact_type gets a representative shape so spec assertions can match
 * on stable keys.
 */
function buildFactContent(factType: FactType, index: number): {
  content: Record<string, unknown>;
  source: 'observed' | 'owner_stated' | 'derived' | 'meta_learned';
  confidence: number;
} {
  switch (factType) {
    case 'vendor_relationship':
      return {
        content: {
          vendor_name: `Vendor ${index}`,
          acceptance_rate: 0.7 + index * 0.05,
          last_dispatched_at: '2026-04-01T00:00:00Z',
          notes: 'Reliably accepts plumbing dispatches within 30 minutes.',
        },
        source: 'observed',
        confidence: 0.8,
      };
    case 'tenant_pattern':
      return {
        content: {
          pattern: 'pays_late_3_days',
          observed_count: 4 + index,
          tone: 'cooperative',
        },
        source: 'observed',
        confidence: 0.65,
      };
    case 'building_quirk':
      return {
        content: {
          quirk: `Boiler #${index} requires manual reset above 90F outdoor temp`,
          first_observed_at: '2026-03-15T00:00:00Z',
        },
        source: 'observed',
        confidence: 0.9,
      };
    case 'derived_rule':
      return {
        content: {
          rule: 'Dispatch HVAC vendor preemptively when forecast > 90F',
          synthesized_from: ['observed_quirk', 'tenant_complaints'],
        },
        source: 'derived',
        confidence: 0.55,
      };
    case 'owner_rule':
      return {
        content: {
          rule: 'Never schedule non-emergency work before 10am',
          extracted_from: 'rules_text',
        },
        source: 'owner_stated',
        confidence: 1.0,
      };
  }
}

/**
 * Distribute proposals across statuses so every state machine branch
 * is represented. Index 0..9 → mostly proposed (3) and committed (3),
 * with rejected (2), edited (1), expired (1) — tuned to match the
 * realistic distribution the reflection loop spec asserts on.
 */
function statusForProposalIndex(i: number): ProposalStatus {
  if (i < 3) return 'proposed';
  if (i < 6) return 'committed';
  if (i < 8) return 'rejected';
  if (i === 8) return 'edited';
  return 'expired';
}

/**
 * Action types span the four gate categories the matrix spec exercises:
 * dispatch_vendor (high-trust), schedule_callback (medium), send_sms
 * (low), escalate_to_owner (always-review).
 */
function actionTypeForProposalIndex(i: number): string {
  const types = [
    'dispatch_vendor',
    'schedule_callback',
    'send_sms',
    'escalate_to_owner',
  ];
  return types[i % types.length]!;
}

function gateDecisionForProposalIndex(i: number): 'auto' | 'review' | 'block' {
  // 0,4,8 → auto ; 1,2,5,6,9 → review ; 3,7 → block. Mix tuned to
  // match the matrix spec's expected commit-gate output.
  if (i % 4 === 0) return 'auto';
  if (i % 4 === 3) return 'block';
  return 'review';
}

// =====================================================================
// Provisioner
// =====================================================================

/**
 * Provision a fresh v1.5 fixture: org + owner + N properties + memory
 * facts + action proposals. Returns a teardown closure.
 *
 * Cascades on `organizations` delete remove every dependent row, but
 * we still explicitly delete the auth user so no orphan accounts pile
 * up between test runs.
 *
 * @example
 * test.beforeEach(async () => {
 *   fixture = await provisionGalaxyV15();
 * });
 * test.afterEach(async () => {
 *   await fixture.teardown();
 * });
 */
export async function provisionGalaxyV15(
  opts: ProvisionV15Options = {},
): Promise<GalaxyV15Fixture> {
  const propertyCount = opts.propertyCount ?? 5;
  const autonomyLevel = opts.autonomyLevel ?? DEFAULT_AUTONOMY_LEVEL;
  const privacyMode = opts.privacyMode ?? 'hosted';
  const rulesText =
    opts.rulesText ??
    'Never schedule non-emergency work before 10am. Always confirm dispatch with tenant.';
  const ollamaHost =
    privacyMode === 'on_prem'
      ? opts.ollamaHost ?? 'http://127.0.0.1:11434'
      : null;

  const admin = createAdmin();
  const stamp = uniqDigits();
  const email = `galaxy.v15.${stamp}@galaxy-v15.test`;
  const password = `galaxy-v15-${stamp}`;
  const orgName = `Galaxy v1.5 ${stamp}`;

  const { id: userId } = await createUserWithRetry(
    admin,
    email,
    password,
    orgName,
  );

  const { data: userRow } = await admin
    .from('users')
    .select('organization_id')
    .eq('id', userId)
    .single();
  const organizationId = userRow?.organization_id ?? '';
  if (!organizationId) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error('Post-signup trigger did not populate users.organization_id');
  }

  // ---------------------------------------------------------------
  // Properties
  // ---------------------------------------------------------------
  const propertyRows = Array.from({ length: propertyCount }, (_, i) => ({
    organization_id: organizationId,
    name: `${GALAXY.organization.name} Building ${i + 1}`,
    address_street: `${100 + i} Test Ave`,
    address_city: 'Arlington',
    address_state: 'VA',
    address_zip: '22201',
    timezone: GALAXY.organization.timezone,
    rules_text: rulesText,
    autonomy_level: autonomyLevel,
    privacy_mode: privacyMode,
    ollama_host: ollamaHost,
  }));

  const { data: insertedProps, error: propErr } = await admin
    .from('properties')
    .insert(propertyRows)
    .select('id, name, rules_text, autonomy_level, privacy_mode, ollama_host');
  if (propErr || !insertedProps) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    await admin.from('organizations').delete().eq('id', organizationId);
    throw new Error(`property insert failed: ${propErr?.message}`);
  }

  const properties: SeededProperty[] = insertedProps.map((p) => ({
    id: p.id,
    name: p.name,
    rulesText: p.rules_text ?? '',
    autonomyLevel: Number(p.autonomy_level ?? 0),
    privacyMode: (p.privacy_mode ?? 'hosted') as PrivacyMode,
    ollamaHost: p.ollama_host ?? null,
  }));

  // ---------------------------------------------------------------
  // Memory facts (5 per property, one per fact_type)
  // ---------------------------------------------------------------
  const factRows: Database['public']['Tables']['memory_facts']['Insert'][] =
    properties.flatMap((prop, propIdx) =>
      FACT_TYPES.map((factType) => {
        const built = buildFactContent(factType, propIdx);
        return {
          organization_id: organizationId,
          property_id: prop.id,
          fact_type: factType,
          content: built.content as unknown as Json,
          confidence: built.confidence,
          source: built.source,
        };
      }),
    );

  const { data: insertedFacts, error: factErr } = await admin
    .from('memory_facts')
    .insert(factRows)
    .select('id, fact_type, property_id');
  if (factErr || !insertedFacts) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    await admin.from('organizations').delete().eq('id', organizationId);
    throw new Error(`memory_facts insert failed: ${factErr?.message}`);
  }
  const facts: SeededFactHandle[] = insertedFacts.map((f) => ({
    id: f.id,
    factType: f.fact_type as FactType,
    propertyId: f.property_id,
  }));

  // ---------------------------------------------------------------
  // Action proposals (10 across all statuses for property[0])
  // ---------------------------------------------------------------
  const targetPropertyId = properties[0]!.id;
  const proposalRows: Database['public']['Tables']['action_proposals']['Insert'][] =
    Array.from({ length: PROPOSALS_PER_FIXTURE }, (_, i) => {
      const status = statusForProposalIndex(i);
      const actionType = actionTypeForProposalIndex(i);
      const gateDecision = gateDecisionForProposalIndex(i);
      const confidence = 0.4 + (i / PROPOSALS_PER_FIXTURE) * 0.5;
      return {
        organization_id: organizationId,
        property_id: targetPropertyId,
        worker_model: i % 2 === 0 ? 'haiku-4-5' : 'ollama-llama3.3:70b',
        action_type: actionType,
        payload: { summary: `${actionType} for proposal ${i}` } as Json,
        reasoning: `Cited fact ${i}: pattern observed across recent activity.`,
        confidence,
        gate_decision: gateDecision,
        status,
        committed_at: status === 'committed' ? new Date().toISOString() : null,
        rejected_at: status === 'rejected' ? new Date().toISOString() : null,
        edit_diff:
          status === 'edited'
            ? ({ payload: { summary: 'edited summary' } } as Json)
            : null,
      };
    });

  const { data: insertedProposals, error: propsErr } = await admin
    .from('action_proposals')
    .insert(proposalRows)
    .select('id, property_id, status, action_type, confidence, gate_decision');
  if (propsErr || !insertedProposals) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    await admin.from('organizations').delete().eq('id', organizationId);
    throw new Error(`action_proposals insert failed: ${propsErr?.message}`);
  }
  const proposals: SeededProposalHandle[] = insertedProposals.map((p) => ({
    id: p.id,
    propertyId: p.property_id,
    status: p.status as ProposalStatus,
    actionType: p.action_type,
    confidence: Number(p.confidence ?? 0),
    gateDecision: p.gate_decision as 'auto' | 'review' | 'block',
  }));

  // ---------------------------------------------------------------
  // Teardown — cascade via org delete + drop the auth user.
  // ---------------------------------------------------------------
  const teardown = async (): Promise<void> => {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    await admin.from('organizations').delete().eq('id', organizationId);
  };

  return {
    owner: { userId, email, password },
    organizationId,
    properties,
    facts,
    proposals,
    teardown,
  };
}

// =====================================================================
// Seeding helpers (post-provisioning mutators)
// =====================================================================

export interface SeedExtraProposalOptions {
  propertyId: string;
  organizationId: string;
  actionType?: string;
  status?: ProposalStatus;
  confidence?: number;
  gateDecision?: 'auto' | 'review' | 'block';
  workerModel?: string;
  payload?: Record<string, unknown>;
  reasoning?: string;
  contextFactIds?: readonly string[];
}

/**
 * Insert one extra proposal into an existing fixture. Used by specs
 * that need a precise (status × action_type × confidence) row beyond
 * the default 10 the fixture seeds.
 */
export async function seedExtraProposal(
  opts: SeedExtraProposalOptions,
): Promise<SeededProposalHandle> {
  const admin = createAdmin();
  const status = opts.status ?? 'proposed';
  const insert: Database['public']['Tables']['action_proposals']['Insert'] = {
    organization_id: opts.organizationId,
    property_id: opts.propertyId,
    worker_model: opts.workerModel ?? 'haiku-4-5',
    action_type: opts.actionType ?? 'send_sms',
    payload: (opts.payload ?? { summary: 'extra proposal' }) as Json,
    reasoning: opts.reasoning ?? 'Extra seeded proposal for spec coverage.',
    confidence: opts.confidence ?? 0.7,
    context_fact_ids: opts.contextFactIds
      ? Array.from(opts.contextFactIds)
      : null,
    gate_decision: opts.gateDecision ?? 'review',
    status,
    committed_at: status === 'committed' ? new Date().toISOString() : null,
    rejected_at: status === 'rejected' ? new Date().toISOString() : null,
  };
  const { data, error } = await admin
    .from('action_proposals')
    .insert(insert)
    .select('id, property_id, status, action_type, confidence, gate_decision')
    .single();
  if (error || !data) {
    throw new Error(`seedExtraProposal failed: ${error?.message}`);
  }
  return {
    id: data.id,
    propertyId: data.property_id,
    status: data.status as ProposalStatus,
    actionType: data.action_type,
    confidence: Number(data.confidence ?? 0),
    gateDecision: data.gate_decision as 'auto' | 'review' | 'block',
  };
}

export interface SeedExtraFactOptions {
  propertyId: string;
  organizationId: string;
  factType: FactType;
  content: Record<string, unknown>;
  confidence?: number;
  source?: 'observed' | 'owner_stated' | 'derived' | 'meta_learned';
  evidenceProposalIds?: readonly string[];
}

export async function seedExtraFact(
  opts: SeedExtraFactOptions,
): Promise<SeededFactHandle> {
  const admin = createAdmin();
  const insert: Database['public']['Tables']['memory_facts']['Insert'] = {
    organization_id: opts.organizationId,
    property_id: opts.propertyId,
    fact_type: opts.factType,
    content: opts.content as Json,
    confidence: opts.confidence ?? 0.7,
    source: opts.source ?? 'observed',
    evidence_proposal_ids: opts.evidenceProposalIds
      ? Array.from(opts.evidenceProposalIds)
      : null,
  };
  const { data, error } = await admin
    .from('memory_facts')
    .insert(insert)
    .select('id, fact_type, property_id')
    .single();
  if (error || !data) {
    throw new Error(`seedExtraFact failed: ${error?.message}`);
  }
  return {
    id: data.id,
    factType: data.fact_type as FactType,
    propertyId: data.property_id,
  };
}

/**
 * Set the autonomy_level for one property (commit gate matrix and
 * autonomy graduation specs flip this between gates).
 */
export async function setPropertyAutonomy(
  propertyId: string,
  autonomyLevel: number,
): Promise<void> {
  const admin = createAdmin();
  const { error } = await admin
    .from('properties')
    .update({ autonomy_level: autonomyLevel })
    .eq('id', propertyId);
  if (error) {
    throw new Error(`setPropertyAutonomy failed: ${error.message}`);
  }
}

/**
 * Switch one property's privacy_mode (privacy round-trip spec uses
 * this to flip 'hosted' → 'on_prem' and confirm worker routing.)
 */
export async function setPropertyPrivacyMode(
  propertyId: string,
  privacyMode: PrivacyMode,
  ollamaHost: string | null = null,
): Promise<void> {
  const admin = createAdmin();
  const { error } = await admin
    .from('properties')
    .update({ privacy_mode: privacyMode, ollama_host: ollamaHost })
    .eq('id', propertyId);
  if (error) {
    throw new Error(`setPropertyPrivacyMode failed: ${error.message}`);
  }
}

/**
 * Update rules_text on one property. The rulebook → worker context
 * spec asserts the new rule shows up in the next worker's reasoning.
 */
export async function setPropertyRulesText(
  propertyId: string,
  rulesText: string,
): Promise<void> {
  const admin = createAdmin();
  const { error } = await admin
    .from('properties')
    .update({ rules_text: rulesText })
    .eq('id', propertyId);
  if (error) {
    throw new Error(`setPropertyRulesText failed: ${error.message}`);
  }
}
