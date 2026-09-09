/**
 * Context MCP — read-only property lookup for the operator dispatcher.
 *
 * Four tools, all derived from `PropertyContext` loaded on-demand per
 * tool call (cached within the dispatcher run via `propertyContextCache`).
 * `recent_activity` always hits the DB — it's the only tool that wants
 * data outside the snapshot.
 *
 * Each tool accepts `propertyName` (a model-supplied substring) and
 * resolves it to a `PropertySummary` via `resolvePropertyName`. On
 * no-match or multiple-match the tool returns a model-readable
 * clarification string so the model can ask the operator which property
 * they meant.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { Database } from '@/types/database';
import {
  loadPropertyContext,
  type SupabaseLike,
} from '@/lib/agent/worker/context-loader';
import type {
  PropertyContext,
  ContextTenantSummary,
  ContextVendorSummary,
} from '@/lib/agent/worker/types';
import type { OrganizationContext } from '../org-context';
import {
  resolvePropertyName,
} from '../property-resolver';

const RULES_TEXT_MAX = 500;
const RECENT_ACTIVITY_LIMIT = 10;

export interface CreateContextMcpDeps {
  admin: SupabaseClient<Database>;
  organizationId: string;
  orgContext: OrganizationContext;
  /**
   * Per-dispatcher-run cache keyed by propertyId. Tools populate it on
   * first load and await the cached promise on subsequent calls to avoid
   * duplicate round trips within a single turn.
   */
  propertyContextCache: Map<string, Promise<PropertyContext>>;
}

export function createContextMcp(deps: CreateContextMcpDeps) {
  return createSdkMcpServer({
    name: 'odesa-operator-context',
    version: '0.1.0',
    // 16 tools total — always in the prompt; deferral behind ToolSearch
    // costs a full model round trip per fresh conversation.
    alwaysLoad: true,
    tools: [
      tool(
        'get_property',
        'Return high-level property facts: name, address, timezone, autonomy level, privacy mode, truncated rulebook, unit count.',
        {
          propertyName: z
            .string()
            .describe('Name (or substring) of the property to look up.'),
        },
        async (args) => {
          const resolved = resolvePropertyName(
            deps.orgContext.properties,
            args.propertyName,
          );
          if (resolved.kind !== 'unique') {
            return textResult(buildResolveError(resolved, args.propertyName, deps.orgContext));
          }
          const ctx = await getOrLoadContext(deps, resolved.property.id);
          const summary = {
            name: ctx.property.name,
            addressLine: ctx.property.addressLine,
            timezone: ctx.property.timezone,
            autonomyLevel: ctx.property.autonomyLevel,
            privacyMode: ctx.property.privacyMode,
            rulesText: truncate(ctx.property.rulesText, RULES_TEXT_MAX),
            unitCount: countUnits(ctx.tenants),
          };
          return textResult(JSON.stringify(summary));
        },
      ),
      tool(
        'list_tenants',
        'List the active tenants on a property. Returns each tenant with their unit label and rent status.',
        {
          propertyName: z
            .string()
            .describe('Name (or substring) of the property.'),
        },
        async (args) => {
          const resolved = resolvePropertyName(
            deps.orgContext.properties,
            args.propertyName,
          );
          if (resolved.kind !== 'unique') {
            return textResult(buildResolveError(resolved, args.propertyName, deps.orgContext));
          }
          const ctx = await getOrLoadContext(deps, resolved.property.id);
          const tenants = ctx.tenants.map((t) => ({
            fullName: t.fullName,
            unitLabel: t.unitLabel,
            rentStatus: t.rentStatus,
          }));
          return textResult(JSON.stringify(tenants));
        },
      ),
      tool(
        'list_vendors',
        'List vendors available to a property. Filter by category (e.g. "plumber", "hvac") to narrow.',
        {
          propertyName: z
            .string()
            .describe('Name (or substring) of the property.'),
          category: z
            .string()
            .optional()
            .describe('Optional category filter (case-insensitive substring).'),
        },
        async (args) => {
          const resolved = resolvePropertyName(
            deps.orgContext.properties,
            args.propertyName,
          );
          if (resolved.kind !== 'unique') {
            return textResult(buildResolveError(resolved, args.propertyName, deps.orgContext));
          }
          const ctx = await getOrLoadContext(deps, resolved.property.id);
          const filter = args.category?.toLowerCase().trim() ?? '';
          const vendors = ctx.vendors
            .filter((v) =>
              filter ? (v.category ?? '').toLowerCase().includes(filter) : true,
            )
            .map((v) => ({
              name: v.name,
              category: v.category,
              acceptanceRate: v.acceptanceRate,
            }));
          return textResult(JSON.stringify(vendors));
        },
      ),
      tool(
        'recent_activity',
        'Return the last 10 action proposals for a property within the past N days. Use this to answer "what happened recently?" and "did the AI text Jane back?" questions.',
        {
          propertyName: z
            .string()
            .describe('Name (or substring) of the property.'),
          daysBack: z
            .number()
            .int()
            .positive()
            .max(90)
            .optional()
            .default(7)
            .describe('How many days of history to scan. Default 7.'),
        },
        async (args) => {
          const resolved = resolvePropertyName(
            deps.orgContext.properties,
            args.propertyName,
          );
          if (resolved.kind !== 'unique') {
            return textResult(buildResolveError(resolved, args.propertyName, deps.orgContext));
          }
          const days = args.daysBack ?? 7;
          const sinceIso = isoSince(days);
          const { data, error } = await deps.admin
            .from('action_proposals')
            .select(
              'action_type, status, gate_decision, reasoning, created_at',
            )
            .eq('property_id', resolved.property.id)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(RECENT_ACTIVITY_LIMIT);
          if (error) {
            return textResult(`recent_activity failed: ${error.message}`);
          }
          return textResult(JSON.stringify(data ?? []));
        },
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOrLoadContext(
  deps: CreateContextMcpDeps,
  propertyId: string,
): Promise<PropertyContext> {
  const cached = deps.propertyContextCache.get(propertyId);
  if (cached) return cached;
  const promise = loadPropertyContext(
    deps.admin as unknown as SupabaseLike,
    propertyId,
  );
  deps.propertyContextCache.set(propertyId, promise);
  return promise;
}

function buildResolveError(
  result: ReturnType<typeof resolvePropertyName>,
  name: string,
  orgContext: OrganizationContext,
): string {
  const allNames = orgContext.properties.map((p) => p.name).join(', ');
  if (result.kind === 'none') {
    return `No property matches '${name}'. Org has: ${allNames}.`;
  }
  // multiple
  const matchNames = (result as { kind: 'multiple'; matches: typeof orgContext.properties }).matches
    .map((m) => m.name)
    .join(', ');
  return `Multiple properties match '${name}': ${matchNames}. Be more specific.`;
}

function textResult(text: string): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return { content: [{ type: 'text' as const, text }] };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function countUnits(tenants: ReadonlyArray<ContextTenantSummary>): number {
  const labels = new Set<string>();
  for (const t of tenants) {
    if (t.unitLabel) labels.add(t.unitLabel);
  }
  return labels.size;
}

function isoSince(daysBack: number): string {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - daysBack);
  return since.toISOString();
}

// Re-export filtered helper shape for tests that want to verify the
// vendor-filter contract without calling through the MCP wrapper.
export type FilteredVendor = Pick<
  ContextVendorSummary,
  'name' | 'category' | 'acceptanceRate'
>;
