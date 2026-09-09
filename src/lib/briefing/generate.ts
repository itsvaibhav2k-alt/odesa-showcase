/**
 * Briefing text generator.
 *
 * v1 uses a deterministic template (no Claude call) so the flow is
 * testable and cheap. v1.5 layers in optional prose polish via
 * `polish_briefing` workers when `ODESA_BRIEFING_PROSE=true`. The
 * deterministic template always runs first and is the fallback.
 *
 * Briefing metrics are intentionally org-scoped (matches v1 cron),
 * but the worker call wants a property context for voice/voiceNotes
 * grounding. Callers therefore pass an "anchor property" — the first
 * property in the org by name asc — to provide that context.
 * Documented at each call site.
 *
 * Template layout matches spec §7.5:
 *   1. One-line headline: "Week of {date}: {occ}% occupied, ${rent}
 *      collected ({pct}% of due), {N} open work orders."
 *   2. Optional "Heads up:" paragraph flagging the highest-impact item
 *      (below-market flag, expiring lease, or late tenant).
 *   3. CTA link placeholder (no real URL yet).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { recordProposal } from '@/lib/agent/proposals/record';
import { selectProvider } from '@/lib/agent/worker/providers/select';
import { spawnPropertyWorker } from '@/lib/agent/worker/spawn';
import type {
  PolishBriefingInput,
  PolishBriefingPayload,
  WorkerModelProvider,
} from '@/lib/agent/worker/types';

import type { BriefingMetrics, GeneratedBriefing } from './types';

/** Below this confidence we keep the deterministic template. */
const PROSE_CONFIDENCE_THRESHOLD = 0.7;

export interface GenerateBriefingDeps {
  /** Required when `ODESA_BRIEFING_PROSE=true`. Read-only Supabase access. */
  admin?: SupabaseClient<Database>;
  /** Provider override for tests; defaults to selectProvider per property. */
  provider?: WorkerModelProvider;
}

/**
 * Generate the briefing text for the given metrics.
 *
 * @param metrics    Org-scoped briefing metrics.
 * @param propertyId Anchor property — provides per-property worker
 *                   context for prose polish; metrics remain org-scoped.
 *                   Callers (briefing trigger route + Inngest cron)
 *                   currently pick the alphabetically-first property
 *                   in the org. Known limitation: for multi-property
 *                   orgs (Galaxy at 130 properties) the polish always
 *                   uses that one property's rulebook + voice cues.
 *                   v1.6 will replace with an org-level
 *                   `default_property_id` setting.
 * @param deps       Optional admin client + provider for the worker
 *                   path. When `ODESA_BRIEFING_PROSE=true` AND
 *                   `deps.admin` is provided, the worker polishes the
 *                   text. Otherwise the template path runs unchanged.
 */
export async function generateBriefingText(
  metrics: BriefingMetrics,
  propertyId: string,
  deps: GenerateBriefingDeps = {},
): Promise<GeneratedBriefing> {
  const headline = formatHeadline(metrics);
  const recommendation = buildRecommendation(metrics);
  const templateBody = recommendation
    ? `${headline} ${recommendation}`
    : headline;

  const enablePolish =
    process.env.ODESA_BRIEFING_PROSE === 'true' && deps.admin !== undefined;

  if (!enablePolish) {
    return {
      metrics,
      briefingText: templateBody,
      recommendation: recommendation ? stripLeadingHeadsUp(recommendation) : null,
      generatedAt: new Date().toISOString(),
    };
  }

  const polished = await tryPolish(
    deps.admin!,
    propertyId,
    metrics,
    templateBody,
    deps.provider,
  );

  if (!polished) {
    return {
      metrics,
      briefingText: templateBody,
      recommendation: recommendation ? stripLeadingHeadsUp(recommendation) : null,
      generatedAt: new Date().toISOString(),
    };
  }

  return {
    metrics,
    briefingText: polished,
    recommendation: stripLeadingHeadsUp(polished),
    generatedAt: new Date().toISOString(),
  };
}

async function tryPolish(
  admin: SupabaseClient<Database>,
  propertyId: string,
  metrics: BriefingMetrics,
  template: string,
  providerOverride: WorkerModelProvider | undefined,
): Promise<string | null> {
  try {
    const property = await loadPropertyForGating(admin, propertyId);
    if (!property) return null;

    const provider =
      providerOverride ??
      selectProvider(
        {
          privacyMode: property.privacyMode,
          ollamaHost: property.ollamaHost,
        },
        { actionType: 'polish_briefing' },
      );

    const data: PolishBriefingInput = {
      metrics: flattenMetrics(metrics),
      template,
      voiceNotes: '',
    };

    const inMemory = await spawnPropertyWorker({
      propertyId,
      action_type: 'polish_briefing',
      data,
      deps: { client: admin, provider },
    });

    if (inMemory.confidence <= PROSE_CONFIDENCE_THRESHOLD) {
      return null;
    }

    const payload = inMemory.payload as PolishBriefingPayload;

    // Persist for audit. We do NOT call commitProposal here — the
    // briefing cron writes weekly_reports.briefing_text via persist.ts;
    // commit.ts:dispatchBriefing also writes that column, so calling
    // commit would race the cron. Recording the proposal alone gives us
    // the audit trail without double-writes.
    //
    // routing is null: polish_briefing's `weeklyReportId` only exists
    // post-persist, but we never call commitProposal here so dispatch
    // never needs to look up the row by routing.
    await recordProposal(admin, {
      organizationId: inMemory.organizationId,
      propertyId,
      workerModel: inMemory.workerModel,
      actionType: 'polish_briefing',
      payload,
      routing: null,
      reasoning: inMemory.reasoning,
      confidence: inMemory.confidence,
      contextFactIds: inMemory.context_fact_ids,
      autonomyLevel: property.autonomyLevel,
      privacyMode: property.privacyMode,
    });

    return payload.prose;
  } catch {
    return null;
  }
}

function flattenMetrics(
  m: BriefingMetrics,
): Record<string, number | string | boolean | null> {
  return {
    weekStartDate: m.weekStartDate,
    occupancyPct: m.occupancyPct,
    unitsOccupied: m.unitsOccupied,
    unitsTotal: m.unitsTotal,
    rentCollectedDollars: m.rentCollectedDollars,
    rentDueDollars: m.rentDueDollars,
    rentCollectedPct: m.rentCollectedPct,
    workOrdersOpenedCount: m.workOrdersOpenedCount,
    workOrdersClosedCount: m.workOrdersClosedCount,
    workOrdersOpenCount: m.workOrdersOpenCount,
    lateTenantsCount: m.lateTenantsCount,
    expiringLeasesCount: m.expiringLeasesCount,
    belowMarketCount: m.belowMarketUnits.length,
  };
}

interface PropertyGatingInfo {
  privacyMode: 'hosted' | 'on_prem';
  ollamaHost: string | null;
  autonomyLevel: number;
}

async function loadPropertyForGating(
  admin: SupabaseClient<Database>,
  propertyId: string,
): Promise<PropertyGatingInfo | null> {
  const { data } = await admin
    .from('properties')
    .select('privacy_mode, ollama_host, autonomy_level')
    .eq('id', propertyId)
    .maybeSingle();
  if (!data) return null;
  return {
    privacyMode: data.privacy_mode === 'on_prem' ? 'on_prem' : 'hosted',
    ollamaHost: data.ollama_host ?? null,
    autonomyLevel: data.autonomy_level,
  };
}

function formatHeadline(m: BriefingMetrics): string {
  const weekStart = formatWeekStart(m.weekStartDate);
  const rentK = m.rentCollectedDollars >= 1000
    ? `$${(m.rentCollectedDollars / 1000).toFixed(1)}k`
    : `$${Math.round(m.rentCollectedDollars)}`;
  const woWord = m.workOrdersOpenCount === 1 ? 'work order' : 'work orders';
  return `Week of ${weekStart}: ${m.occupancyPct}% occupied, ${rentK} collected (${m.rentCollectedPct}% of due), ${m.workOrdersOpenCount} open ${woWord}.`;
}

function buildRecommendation(m: BriefingMetrics): string | null {
  if (m.belowMarketUnits.length > 0 && m.expiringLeasesCount > 0) {
    const bm = m.belowMarketUnits[0];
    const expiringTenantName = m.expiringLeases[0]?.tenantName ?? bm.tenantName;
    return `Heads up: Unit ${bm.unitLabel ?? '—'} rent is $${bm.deltaDollars} below market and a lease expires ${formatShortDate(m.expiringLeases[0]?.endDate ?? '')} — worth a renewal conversation with ${expiringTenantName}.`;
  }
  if (m.belowMarketUnits.length > 0) {
    const bm = m.belowMarketUnits[0];
    return `Heads up: Unit ${bm.unitLabel ?? '—'} rent is $${bm.deltaDollars} below market for ${bm.tenantName} — worth a renewal conversation.`;
  }
  if (m.expiringLeasesCount > 0) {
    const e = m.expiringLeases[0];
    return `Heads up: ${e.tenantName}'s lease (Unit ${e.unitLabel ?? '—'}) expires ${formatShortDate(e.endDate)} — start the renewal conversation soon.`;
  }
  if (m.lateTenantsCount > 0) {
    const plural = m.lateTenantsCount === 1 ? 'tenant is' : 'tenants are';
    return `Heads up: ${m.lateTenantsCount} ${plural} past due — Odesa is handling reminders; you'll be pinged if any escalates.`;
  }
  return null;
}

function formatWeekStart(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatShortDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function stripLeadingHeadsUp(text: string): string {
  return text.replace(/^Heads up:\s*/i, '');
}
