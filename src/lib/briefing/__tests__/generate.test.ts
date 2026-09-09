import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import type {
  ActionProposal,
  WorkerModelProvider,
} from '@/lib/agent/worker/types';

vi.mock('@/lib/agent/worker/providers/select', () => ({
  selectProvider: vi.fn(),
}));
vi.mock('@/lib/agent/worker/spawn', () => ({
  spawnPropertyWorker: vi.fn(),
}));
vi.mock('@/lib/agent/proposals/record', () => ({
  recordProposal: vi.fn(),
}));

import { selectProvider } from '@/lib/agent/worker/providers/select';
import { spawnPropertyWorker } from '@/lib/agent/worker/spawn';
import { generateBriefingText } from '../generate';
import type { BriefingMetrics } from '../types';

const TEST_PROPERTY_ID = '00000000-0000-0000-0000-000000000001';

const provider: WorkerModelProvider = {
  name: 'test-provider',
  supportsPromptCaching: () => false,
  call: vi.fn(),
  healthCheck: vi.fn(),
};

function makeAdmin(): SupabaseClient<Database> {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({
      data: {
        privacy_mode: 'hosted',
        ollama_host: null,
        autonomy_level: 0.5,
      },
      error: null,
    }),
  };
  return {
    from: vi.fn(() => builder),
  } as unknown as SupabaseClient<Database>;
}

function baseMetrics(overrides: Partial<BriefingMetrics> = {}): BriefingMetrics {
  return {
    weekStartDate: '2026-04-20',
    occupancyPct: 94,
    unitsOccupied: 113,
    unitsTotal: 120,
    rentCollectedDollars: 28400,
    rentDueDollars: 29000,
    rentCollectedPct: 98,
    workOrdersOpenedCount: 3,
    workOrdersClosedCount: 1,
    workOrdersOpenCount: 2,
    lateTenantsCount: 0,
    expiringLeasesCount: 0,
    expiringLeases: [],
    belowMarketUnits: [],
    ...overrides,
  };
}

describe('generateBriefingText', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('renders the headline in the spec §7.5 shape', async () => {
    const b = await generateBriefingText(baseMetrics(), TEST_PROPERTY_ID);
    expect(b.briefingText).toContain('Week of Apr 20');
    expect(b.briefingText).toContain('94% occupied');
    expect(b.briefingText).toContain('$28.4k collected');
    expect(b.briefingText).toContain('98% of due');
    expect(b.briefingText).toContain('2 open work orders');
  });

  it('flags below-market rent when present', async () => {
    const b = await generateBriefingText(
      baseMetrics({
        belowMarketUnits: [
          {
            leaseId: 'l1',
            tenantName: 'Marcus',
            unitLabel: '204',
            currentRent: 2275,
            medianRent: 2500,
            deltaDollars: 225,
          },
        ],
        expiringLeasesCount: 1,
        expiringLeases: [
          {
            leaseId: 'l1',
            tenantName: 'Marcus',
            unitLabel: '204',
            endDate: '2026-06-30',
            rentAmount: 2275,
          },
        ],
      }),
      TEST_PROPERTY_ID,
    );
    expect(b.briefingText).toContain('Unit 204');
    expect(b.briefingText).toContain('$225 below market');
    expect(b.briefingText).toContain('Marcus');
    expect(b.recommendation).not.toBeNull();
  });

  it('falls back to expiring-lease heads-up when no below-market flag', async () => {
    const b = await generateBriefingText(
      baseMetrics({
        expiringLeasesCount: 1,
        expiringLeases: [
          {
            leaseId: 'l1',
            tenantName: 'Priya',
            unitLabel: '12A',
            endDate: '2026-06-15',
            rentAmount: 2400,
          },
        ],
      }),
      TEST_PROPERTY_ID,
    );
    expect(b.briefingText).toContain("Priya's lease");
    expect(b.briefingText).toContain('Unit 12A');
  });

  it('falls back to late-tenant heads-up when no flags', async () => {
    const b = await generateBriefingText(
      baseMetrics({ lateTenantsCount: 2 }),
      TEST_PROPERTY_ID,
    );
    expect(b.briefingText).toContain('2 tenants are past due');
  });

  it('returns null recommendation for a clean week', async () => {
    const b = await generateBriefingText(baseMetrics(), TEST_PROPERTY_ID);
    expect(b.recommendation).toBeNull();
    expect(b.briefingText.endsWith('.')).toBe(true);
  });

  it('renders singular "work order" and small-dollar amounts correctly', async () => {
    const b = await generateBriefingText(
      baseMetrics({
        workOrdersOpenCount: 1,
        rentCollectedDollars: 800,
      }),
      TEST_PROPERTY_ID,
    );
    expect(b.briefingText).toContain('1 open work order.');
    expect(b.briefingText).toContain('$800 collected');
  });

  it('selects the polish_briefing action policy when prose AI is enabled', async () => {
    vi.stubEnv('ODESA_BRIEFING_PROSE', 'true');
    vi.mocked(selectProvider).mockReturnValue(provider);
    vi.mocked(spawnPropertyWorker).mockResolvedValue({
      id: null,
      organizationId: '00000000-0000-0000-0000-0000000000aa',
      propertyId: TEST_PROPERTY_ID,
      workerModel: 'claude-sonnet-4-6',
      action_type: 'polish_briefing',
      payload: { prose: 'Polished weekly briefing.' },
      routing: null,
      reasoning: 'polished deterministic metrics',
      confidence: 0.9,
      context_fact_ids: [],
      gate_decision: null,
      status: 'proposed',
      createdAt: '2026-04-20T00:00:00.000Z',
    } satisfies ActionProposal);

    await generateBriefingText(baseMetrics(), TEST_PROPERTY_ID, {
      admin: makeAdmin(),
    });

    expect(selectProvider).toHaveBeenCalledWith(
      { privacyMode: 'hosted', ollamaHost: null },
      { actionType: 'polish_briefing' },
    );
  });
});
