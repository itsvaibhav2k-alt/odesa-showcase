/**
 * Unit tests for the context MCP.
 *
 * Factory now receives { admin, organizationId, orgContext, propertyContextCache }
 * instead of { admin, propertyId, contextCache }. Each tool resolves
 * propertyName via orgContext.properties before loading PropertyContext.
 * `recent_activity` always hits the DB; we mock the admin client's
 * `.from('action_proposals').select(...).eq(...).gte(...).order(...).limit(...)`
 * chain to return scripted rows.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createContextMcp, type CreateContextMcpDeps } from '../../mcps/context';
import type { PropertyContext } from '@/lib/agent/worker/types';
import type { OrganizationContext } from '../../org-context';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

// -----------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------

vi.mock('@/lib/agent/worker/context-loader', () => ({
  loadPropertyContext: vi.fn(),
}));

import { loadPropertyContext } from '@/lib/agent/worker/context-loader';
const mockLoadPropertyContext = vi.mocked(loadPropertyContext);

// -----------------------------------------------------------------------
// Types / helpers
// -----------------------------------------------------------------------

interface ToolDefShape {
  name?: string;
  handler: (
    args: Record<string, unknown>,
    extra: unknown,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

interface McpServerShape {
  instance?: { _registeredTools?: Record<string, ToolDefShape> };
  tools?: ToolDefShape[];
}

function getHandler(server: unknown, name: string): ToolDefShape['handler'] {
  const s = server as McpServerShape;
  const fromInstance = s.instance?._registeredTools?.[name];
  if (fromInstance) return fromInstance.handler;
  const fromTools = s.tools?.find((t) => t.name === name);
  if (fromTools) return fromTools.handler;
  throw new Error(`${name} handler not found`);
}

function makePropertyContext(overrides: Partial<PropertyContext['property']> = {}): PropertyContext {
  return {
    property: {
      id: 'prop-1',
      organizationId: 'org-1',
      name: 'Oakwood Commons',
      addressLine: '123 Main St, Brooklyn, NY 11201',
      timezone: 'America/New_York',
      rulesText: 'Be polite. Late fees apply after grace.',
      autonomyLevel: 0.6,
      privacyMode: 'hosted',
      ...overrides,
    },
    facts: [],
    recentTurns: [],
    vendors: [
      { id: 'v1', name: 'Acme Plumbing', category: 'plumber', acceptanceRate: 0.9 },
      { id: 'v2', name: 'Cool HVAC', category: 'hvac', acceptanceRate: 0.85 },
      { id: 'v3', name: 'Quick Plumb', category: 'plumber', acceptanceRate: 0.7 },
    ],
    tenants: [
      { id: 't1', fullName: 'Jane Doe', unitLabel: 'Apt 4', rentStatus: 'paid', rentAmount: 1800 },
      { id: 't2', fullName: 'John Smith', unitLabel: 'Apt 7', rentStatus: 'late', rentAmount: 2100 },
      { id: 't3', fullName: 'Sam Lee', unitLabel: 'Apt 4', rentStatus: 'paid', rentAmount: null },
    ],
    loadedAt: '2026-05-04T00:00:00Z',
  };
}

/**
 * Build a two-property OrganizationContext fixture.
 * prop-1 = 'Oakwood Commons', prop-2 = 'Galaxy Lofts'.
 */
function makeOrgContext(): OrganizationContext {
  return {
    organization: { id: 'org-1', name: 'Galaxy Estates', assistantName: 'Odesa' },
    properties: [
      {
        id: 'prop-1',
        name: 'Oakwood Commons',
        address: '123 Main St, Brooklyn, NY',
        timezone: 'America/New_York',
        autonomyLevel: 0.6,
        privacyMode: 'hosted',
      },
      {
        id: 'prop-2',
        name: 'Galaxy Lofts',
        address: '456 Loft Ave, Brooklyn, NY',
        timezone: 'America/New_York',
        autonomyLevel: 0.4,
        privacyMode: 'anonymous',
      },
    ],
    loadedAt: '2026-05-04T00:00:00Z',
  };
}

function makeAdmin(activityRows: unknown[] = []): {
  admin: SupabaseClient<Database>;
  fromMock: ReturnType<typeof vi.fn>;
  limitMock: ReturnType<typeof vi.fn>;
} {
  const limit = vi.fn(async () => ({ data: activityRows, error: null }));
  const order = vi.fn(() => ({ limit }));
  const gte = vi.fn(() => ({ order }));
  const eq = vi.fn(() => ({ gte }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return {
    admin: { from } as unknown as SupabaseClient<Database>,
    fromMock: from,
    limitMock: limit,
  };
}

function makeDeps(
  orgContextOverride?: Partial<OrganizationContext>,
  activityRows: unknown[] = [],
): { deps: CreateContextMcpDeps; cache: Map<string, Promise<PropertyContext>> } {
  const admin = makeAdmin(activityRows);
  const orgContext = { ...makeOrgContext(), ...orgContextOverride };
  const cache = new Map<string, Promise<PropertyContext>>();
  return {
    deps: {
      admin: admin.admin,
      organizationId: 'org-1',
      orgContext,
      propertyContextCache: cache,
    },
    cache,
  };
}

async function readJson(
  handler: ToolDefShape['handler'],
  args: Record<string, unknown>,
): Promise<unknown> {
  const res = await handler(args, {});
  const text = res.content[0]?.text ?? '';
  if (
    text.startsWith('No property') ||
    text.startsWith('Multiple properties') ||
    text.startsWith('recent_activity failed')
  ) {
    return text;
  }
  return JSON.parse(text);
}

// -----------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadPropertyContext.mockResolvedValue(makePropertyContext());
});

// -----------------------------------------------------------------------
// get_property
// -----------------------------------------------------------------------

describe('createContextMcp', () => {
  describe('get_property', () => {
    it('should resolve propertyName via orgContext and return summary fields', async () => {
      const { deps } = makeDeps();
      const server = createContextMcp(deps);
      const out = (await readJson(getHandler(server, 'get_property'), {
        propertyName: 'Oakwood',
      })) as {
        name: string;
        addressLine: string;
        timezone: string;
        autonomyLevel: number;
        privacyMode: string;
        rulesText: string;
        unitCount: number;
      };
      expect(out.name).toBe('Oakwood Commons');
      expect(out.timezone).toBe('America/New_York');
      expect(out.autonomyLevel).toBe(0.6);
      expect(out.privacyMode).toBe('hosted');
      expect(out.rulesText).toContain('Be polite');
      // Two distinct unit labels: Apt 4, Apt 7
      expect(out.unitCount).toBe(2);
      expect(mockLoadPropertyContext).toHaveBeenCalledWith(
        expect.anything(),
        'prop-1',
      );
    });

    it('should truncate rulesText longer than 500 chars', async () => {
      const longRules = 'x'.repeat(1000);
      mockLoadPropertyContext.mockResolvedValueOnce(
        makePropertyContext({ rulesText: longRules }),
      );
      const { deps } = makeDeps();
      const server = createContextMcp(deps);
      const out = (await readJson(getHandler(server, 'get_property'), {
        propertyName: 'Oakwood',
      })) as { rulesText: string };
      expect(out.rulesText.length).toBe(501); // 500 chars + ellipsis
      expect(out.rulesText.endsWith('…')).toBe(true);
    });

    it('should return clarification string when propertyName matches none', async () => {
      const { deps } = makeDeps();
      const server = createContextMcp(deps);
      const out = await readJson(getHandler(server, 'get_property'), {
        propertyName: 'nonexistent place',
      });
      expect(typeof out).toBe('string');
      expect(out as string).toMatch(/No property/i);
    });

    it('should return clarification string when propertyName matches multiple', async () => {
      // Both properties contain 'a' in their name — contrived but sufficient.
      const { deps } = makeDeps();
      const server = createContextMcp(deps);
      // 'a' matches 'Oakwood Commons' AND 'Galaxy Lofts'
      const out = await readJson(getHandler(server, 'get_property'), {
        propertyName: 'a',
      });
      expect(typeof out).toBe('string');
      expect(out as string).toMatch(/Multiple properties/i);
    });
  });

  // -----------------------------------------------------------------------
  // list_tenants
  // -----------------------------------------------------------------------

  describe('list_tenants', () => {
    it('should return all tenants from the resolved property', async () => {
      const { deps } = makeDeps();
      const server = createContextMcp(deps);
      const out = (await readJson(getHandler(server, 'list_tenants'), {
        propertyName: 'Oakwood',
      })) as Array<{ fullName: string; unitLabel: string; rentStatus: string }>;
      expect(out).toHaveLength(3);
      expect(out[0]?.fullName).toBe('Jane Doe');
      expect(out[1]?.rentStatus).toBe('late');
    });

    it('should return clarification string when propertyName matches none', async () => {
      const { deps } = makeDeps();
      const server = createContextMcp(deps);
      const out = await readJson(getHandler(server, 'list_tenants'), {
        propertyName: 'nowhere',
      });
      expect(out as string).toMatch(/No property/i);
    });
  });

  // -----------------------------------------------------------------------
  // list_vendors
  // -----------------------------------------------------------------------

  describe('list_vendors', () => {
    it('should return all vendors when no category filter is passed', async () => {
      const { deps } = makeDeps();
      const server = createContextMcp(deps);
      const out = (await readJson(getHandler(server, 'list_vendors'), {
        propertyName: 'Oakwood',
      })) as Array<{ name: string; category: string }>;
      expect(out).toHaveLength(3);
    });

    it('should filter vendors case-insensitively by category', async () => {
      const { deps } = makeDeps();
      const server = createContextMcp(deps);
      const out = (await readJson(getHandler(server, 'list_vendors'), {
        propertyName: 'Oakwood',
        category: 'PLUMB',
      })) as Array<{ name: string }>;
      expect(out).toHaveLength(2);
      expect(out.map((v) => v.name)).toEqual(['Acme Plumbing', 'Quick Plumb']);
    });

    it('should return empty list when filter matches nothing', async () => {
      const { deps } = makeDeps();
      const server = createContextMcp(deps);
      const out = (await readJson(getHandler(server, 'list_vendors'), {
        propertyName: 'Oakwood',
        category: 'electrician',
      })) as unknown[];
      expect(out).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // recent_activity
  // -----------------------------------------------------------------------

  describe('recent_activity', () => {
    it('should query action_proposals for the resolved property and return rows', async () => {
      const activityRows = [
        {
          action_type: 'draft_sms_reply',
          status: 'committed',
          gate_decision: 'auto',
          reasoning: 'rent reminder',
          created_at: '2026-05-01T10:00:00Z',
        },
      ];
      const admin = makeAdmin(activityRows);
      const cache = new Map<string, Promise<PropertyContext>>();
      const deps: CreateContextMcpDeps = {
        admin: admin.admin,
        organizationId: 'org-1',
        orgContext: makeOrgContext(),
        propertyContextCache: cache,
      };
      const server = createContextMcp(deps);
      const out = (await readJson(getHandler(server, 'recent_activity'), {
        propertyName: 'Oakwood',
        daysBack: 14,
      })) as Array<{ action_type: string }>;
      expect(out).toHaveLength(1);
      expect(out[0]?.action_type).toBe('draft_sms_reply');
      expect(admin.fromMock).toHaveBeenCalledWith('action_proposals');
    });

    it('should default to 7 days when daysBack is omitted', async () => {
      const admin = makeAdmin([]);
      const cache = new Map<string, Promise<PropertyContext>>();
      const deps: CreateContextMcpDeps = {
        admin: admin.admin,
        organizationId: 'org-1',
        orgContext: makeOrgContext(),
        propertyContextCache: cache,
      };
      const server = createContextMcp(deps);
      const out = (await readJson(getHandler(server, 'recent_activity'), {
        propertyName: 'Oakwood',
      })) as unknown[];
      expect(out).toEqual([]);
      expect(admin.fromMock).toHaveBeenCalled();
    });

    it('should return error string when admin returns an error', async () => {
      const limit = vi.fn(async () => ({
        data: null,
        error: { message: 'rls denied' },
      }));
      const order = vi.fn(() => ({ limit }));
      const gte = vi.fn(() => ({ order }));
      const eq = vi.fn(() => ({ gte }));
      const select = vi.fn(() => ({ eq }));
      const from = vi.fn(() => ({ select }));
      const cache = new Map<string, Promise<PropertyContext>>();
      const deps: CreateContextMcpDeps = {
        admin: { from } as unknown as SupabaseClient<Database>,
        organizationId: 'org-1',
        orgContext: makeOrgContext(),
        propertyContextCache: cache,
      };
      const server = createContextMcp(deps);
      const out = await readJson(getHandler(server, 'recent_activity'), {
        propertyName: 'Oakwood',
        daysBack: 7,
      });
      expect(out as string).toContain('recent_activity failed');
      expect(out as string).toContain('rls denied');
    });

    it('should return clarification string when propertyName matches none', async () => {
      const { deps } = makeDeps();
      const server = createContextMcp(deps);
      const out = await readJson(getHandler(server, 'recent_activity'), {
        propertyName: 'unknown place',
        daysBack: 7,
      });
      expect(out as string).toMatch(/No property/i);
    });
  });

  // -----------------------------------------------------------------------
  // propertyContextCache (shared across calls)
  // -----------------------------------------------------------------------

  describe('propertyContextCache', () => {
    it('should reuse a cached promise for the same propertyId within a run', async () => {
      const { deps } = makeDeps();
      const server = createContextMcp(deps);
      // Call two different tools for the same property.
      await readJson(getHandler(server, 'get_property'), { propertyName: 'Oakwood' });
      await readJson(getHandler(server, 'list_tenants'), { propertyName: 'Oakwood' });
      // loadPropertyContext should only have been called once.
      expect(mockLoadPropertyContext).toHaveBeenCalledTimes(1);
    });

    it('should call loadPropertyContext separately for different properties', async () => {
      mockLoadPropertyContext
        .mockResolvedValueOnce(makePropertyContext({ id: 'prop-1', name: 'Oakwood Commons' }))
        .mockResolvedValueOnce(makePropertyContext({ id: 'prop-2', name: 'Galaxy Lofts' }));
      const { deps } = makeDeps();
      const server = createContextMcp(deps);
      await readJson(getHandler(server, 'get_property'), { propertyName: 'Oakwood' });
      await readJson(getHandler(server, 'get_property'), { propertyName: 'Galaxy' });
      expect(mockLoadPropertyContext).toHaveBeenCalledTimes(2);
    });
  });
});
