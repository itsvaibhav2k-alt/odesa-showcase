/**
 * Unit tests for `listDocuments` property scoping (Pass 6 data layer).
 *
 * The only load-bearing behavior here is the optional `propertyId` filter: when
 * supplied it must add an `.eq('property_id', id)` predicate to the `documents`
 * query (BEFORE `.order`), and when absent it must not scope at all. We stub the
 * RLS-scoped SSR client with a chainable recorder that captures `.eq` calls and
 * resolves the terminal `.returns()` to an empty list, so the query
 * short-circuits to its EMPTY view-model and the follow-up label reads never
 * fire — keeping the stub tiny. The stub style mirrors
 * `src/app/(dashboard)/properties/__tests__/actions.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from '@/lib/supabase/server';
import {
  listCurrentLeaseDocumentOptions,
  listDocuments,
} from '@/lib/documents/queries';

// Seed-style id on purpose — `listDocuments` does no uuid validation, it just
// forwards the value into the predicate.
const PROPERTY_ID = '33333333-3333-3333-3333-333333333301';

interface EqCall {
  column: string;
  value: unknown;
}

type Tables = Record<string, Array<Record<string, unknown>>>;

/**
 * Stubs `createServerClient` with a single chainable query recorder. Returns the
 * captured `.eq` calls and the table names touched so the test can assert the
 * scoping predicate without standing up a full row pipeline.
 */
function mockDocumentsClient(
  tables: Tables = {},
  errors: Record<string, string> = {},
  missingLeaseIdColumn = false,
): { eqCalls: EqCall[]; fromTables: string[] } {
  const eqCalls: EqCall[] = [];
  const fromTables: string[] = [];

  const client = {
    from(table: string) {
      fromTables.push(table);
      const predicates: Array<{ kind: 'eq' | 'in'; column: string; value: unknown }> = [];
      const orders: Array<{ column: string; ascending: boolean }> = [];
      let range: [number, number] | null = null;
      let selectedColumns = '';
      const apply = () => {
        let rows = [...(tables[table] ?? [])];
        for (const predicate of predicates) {
          rows = rows.filter((row) =>
            predicate.kind === 'eq'
              ? row[predicate.column] === predicate.value
              : (predicate.value as unknown[]).includes(row[predicate.column]),
          );
        }
        rows.sort((a, b) => {
          for (const order of orders) {
            const av = String(a[order.column] ?? '');
            const bv = String(b[order.column] ?? '');
            const compared = av.localeCompare(bv);
            if (compared) return order.ascending ? compared : -compared;
          }
          return 0;
        });
        return range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, 1000);
      };
      const result = () => {
        const message =
          errors[table] ??
          (table === 'documents' &&
          missingLeaseIdColumn &&
          selectedColumns.includes('lease_id')
            ? 'column documents.lease_id does not exist'
            : null);
        return {
          data: message ? null : apply(),
          error: message ? { message } : null,
        };
      };
      const chain: Record<string, unknown> = {
        select(columns = '') {
          selectedColumns = columns;
          return chain;
        },
        eq(column: string, value: unknown) {
          eqCalls.push({ column, value });
          predicates.push({ kind: 'eq', column, value });
          return chain;
        },
        in(column: string, value: unknown[]) {
          predicates.push({ kind: 'in', column, value });
          return chain;
        },
        order(column: string, opts?: { ascending?: boolean }) {
          orders.push({ column, ascending: opts?.ascending !== false });
          return chain;
        },
        range(from: number, to: number) {
          range = [from, to];
          return chain;
        },
        returns() { return Promise.resolve(result()); },
        then(onFulfilled?: (value: unknown) => unknown) {
          return Promise.resolve(result()).then(onFulfilled);
        },
      };
      return chain;
    },
  };

  vi.mocked(createServerClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createServerClient>>,
  );

  return { eqCalls, fromTables };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listDocuments', () => {
  describe('property scoping', () => {
    it('applies an eq(property_id, id) filter when a propertyId is supplied', async () => {
      const { eqCalls, fromTables } = mockDocumentsClient();

      await listDocuments({ propertyId: PROPERTY_ID });

      expect(fromTables).toContain('documents');
      expect(eqCalls).toContainEqual({
        column: 'property_id',
        value: PROPERTY_ID,
      });
    });

    it('does not scope by property_id when no propertyId is supplied', async () => {
      const { eqCalls } = mockDocumentsClient();

      await listDocuments();

      expect(eqCalls.some((c) => c.column === 'property_id')).toBe(false);
    });

    it('degrades to the EMPTY view-model when the query returns no rows', async () => {
      mockDocumentsClient();

      const result = await listDocuments({ propertyId: PROPERTY_ID });

      expect(result.header.total).toBe(0);
      expect(result.rows).toEqual([]);
    });

    it('surfaces a registry failure instead of presenting a truthful empty state', async () => {
      mockDocumentsClient({}, { documents: 'forced registry failure' });

      await expect(listDocuments()).rejects.toThrow(
        'Failed to load documents registry: forced registry failure',
      );
    });

    it('keeps the ledger available when lease_id has not rolled out yet', async () => {
      mockDocumentsClient(
        {
          documents: [
            {
              id: 'legacy-doc',
              type: 'insurance',
              title: 'Legacy policy',
              expiry_date: null,
              property_id: null,
              unit_id: null,
              tenant_id: null,
              vendor_id: null,
              created_at: '2026-01-01',
            },
          ],
          leases: [],
          properties: [],
          units: [],
          tenants: [],
          vendors: [],
        },
        {},
        true,
      );

      const result = await listDocuments();

      expect(result.rows).toEqual([
        expect.objectContaining({ title: 'Legacy policy', badge: 'Insurance' }),
      ]);
    });

    it('does not hide unrelated schema failures behind the legacy read', async () => {
      mockDocumentsClient({}, {
        documents: 'column documents.created_at does not exist',
      });

      await expect(listDocuments()).rejects.toThrow('created_at does not exist');
    });
  });

  it('derives Active, Expiring, Expired, Superseded, and Missing from lease/document state', async () => {
    const iso = (days: number) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    const units = Array.from({ length: 4 }, (_, i) => ({
      id: `unit-${i + 1}`,
      property_id: PROPERTY_ID,
      label: `Unit ${i + 1}`,
    }));
    const tenants = Array.from({ length: 4 }, (_, i) => ({
      id: `tenant-${i + 1}`,
      full_name: `Tenant ${i + 1}`,
    }));
    const leases = [
      { id: 'lease-1', unit_id: 'unit-1', tenant_id: 'tenant-1', status: 'active', start_date: iso(-100), end_date: iso(120), created_at: '2026-01-01' },
      { id: 'lease-2', unit_id: 'unit-2', tenant_id: 'tenant-2', status: 'active', start_date: iso(-100), end_date: iso(30), created_at: '2026-01-01' },
      { id: 'lease-3', unit_id: 'unit-3', tenant_id: 'tenant-3', status: 'active', start_date: iso(-200), end_date: iso(-1), created_at: '2026-01-01' },
      { id: 'lease-4', unit_id: 'unit-4', tenant_id: 'tenant-4', status: 'active', start_date: iso(-10), end_date: iso(365), created_at: '2026-01-01' },
    ];
    const base = {
      type: 'lease', expiry_date: null, property_id: PROPERTY_ID,
      vendor_id: null,
    };
    const documents = [
      { ...base, id: 'doc-active-old', lease_id: 'lease-1', title: 'Old active lease', unit_id: 'unit-1', tenant_id: 'tenant-1', created_at: '2026-01-01' },
      { ...base, id: 'doc-active-new', lease_id: 'lease-1', title: 'Current active lease', unit_id: 'unit-1', tenant_id: 'tenant-1', created_at: '2026-02-01' },
      { ...base, id: 'doc-expiring', lease_id: 'lease-2', title: 'Expiring lease', unit_id: 'unit-2', tenant_id: 'tenant-2', created_at: '2026-02-01' },
      { ...base, id: 'doc-expired', lease_id: 'lease-3', title: 'Expired lease', unit_id: 'unit-3', tenant_id: 'tenant-3', created_at: '2026-02-01' },
    ];
    mockDocumentsClient({
      documents,
      leases,
      units,
      tenants,
      properties: [{ id: PROPERTY_ID, name: 'Truth House' }],
      vendors: [],
    });

    const result = await listDocuments();
    const badges = new Map(result.rows.map((row) => [row.title, row.badge]));

    expect(badges.get('Current active lease')).toBe('Active');
    expect(badges.get('Old active lease')).toBe('Superseded');
    expect(badges.get('Expiring lease')).toBe('Expiring');
    expect(badges.get('Expired lease')).toBe('Expired');
    expect(result.rows).toContainEqual(
      expect.objectContaining({
        title: 'Lease document missing — Tenant 4',
        badge: 'Missing',
      }),
    );
  });

  it('loads all 1,201 label and unit-property rows beyond the response cap', async () => {
    const units = Array.from({ length: 1201 }, (_, i) => ({
      id: `unit-${String(i).padStart(4, '0')}`,
      property_id: PROPERTY_ID,
      label: i === 1200 ? 'LAST-UNIT-LABEL' : `Unit ${i}`,
    }));
    const tenants = units.map((_, i) => ({
      id: `tenant-${String(i).padStart(4, '0')}`,
      full_name: i === 1200 ? 'LAST-TENANT-NAME' : `Tenant ${i}`,
    }));
    const leases = units.map((unit, i) => ({
      id: `lease-${String(i).padStart(4, '0')}`,
      unit_id: unit.id,
      tenant_id: tenants[i]!.id,
      status: 'active',
      start_date: '2026-01-01',
      end_date: '2027-12-31',
      created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`,
    }));
    const documents = leases.map((lease, i) => ({
      id: `doc-${String(i).padStart(4, '0')}`,
      lease_id: lease.id,
      type: 'lease',
      title: i === 1200 ? 'LAST-DOCUMENT-SENTINEL' : `Lease ${i}`,
      expiry_date: null,
      property_id: PROPERTY_ID,
      unit_id: lease.unit_id,
      tenant_id: lease.tenant_id,
      vendor_id: null,
      created_at: `2026-02-01T00:00:${String(i % 60).padStart(2, '0')}Z`,
    }));
    mockDocumentsClient({
      documents,
      leases,
      units,
      tenants,
      properties: [{ id: PROPERTY_ID, name: 'Scale Truth House' }],
      vendors: [],
    });

    const result = await listDocuments();
    const sentinel = result.rows.find((row) => row.title === 'LAST-DOCUMENT-SENTINEL');

    expect(result.rows).toHaveLength(1201);
    expect(sentinel).toMatchObject({
      badge: 'Active',
      related: 'Scale Truth House · LAST-UNIT-LABEL',
      href: '/tenants/tenant-1200',
    });
  });

  it('does not let an expired renewal document satisfy a newer active lease', async () => {
    const tables = leaseIdentityFixture({
      oldTenantId: 'tenant-1',
      newTenantId: 'tenant-1',
      newStatus: 'active',
    });
    mockDocumentsClient(tables);

    const result = await listDocuments();

    expect(result.rows).toContainEqual(
      expect.objectContaining({ title: 'Prior lease document', badge: 'Expired' }),
    );
    expect(result.rows).toContainEqual(
      expect.objectContaining({ title: 'Lease document missing — Returning Tenant', badge: 'Missing' }),
    );
  });

  it('does not let an old tenant document satisfy a later re-let of the unit', async () => {
    const tables = leaseIdentityFixture({
      oldTenantId: 'tenant-old',
      newTenantId: 'tenant-new',
      newStatus: 'active',
    });
    mockDocumentsClient(tables);

    const result = await listDocuments();

    expect(result.rows).toContainEqual(
      expect.objectContaining({ title: 'Prior lease document', badge: 'Expired' }),
    );
    expect(result.rows).toContainEqual(
      expect.objectContaining({ title: 'Lease document missing — Returning Tenant', badge: 'Missing' }),
    );
  });

  it('labels a document for the newer pending lease Pending, never Active', async () => {
    const tables = leaseIdentityFixture({
      oldTenantId: 'tenant-1',
      newTenantId: 'tenant-1',
      newStatus: 'pending',
      includeNewDocument: true,
    });
    mockDocumentsClient(tables);

    const result = await listDocuments();
    const badges = new Map(result.rows.map((row) => [row.title, row.badge]));

    expect(badges.get('Pending lease document')).toBe('Pending');
    expect(badges.get('Pending lease document')).not.toBe('Active');
  });

  it('marks an unlinked historical file Needs review and still reports the current lease Missing', async () => {
    const tables = leaseIdentityFixture({
      oldTenantId: 'tenant-1',
      newTenantId: 'tenant-1',
      newStatus: 'active',
    });
    tables.documents![0]!.lease_id = null;
    mockDocumentsClient(tables);

    const result = await listDocuments();

    expect(result.rows).toContainEqual(
      expect.objectContaining({ title: 'Prior lease document', badge: 'Needs review' }),
    );
    expect(result.rows.filter((row) => row.badge === 'Missing')).toHaveLength(1);
  });
});

describe('listCurrentLeaseDocumentOptions', () => {
  it('offers only exact active/pending leases with explicit operator labels', async () => {
    mockDocumentsClient({
      leases: [
        { id: 'lease-active', unit_id: 'unit-1', tenant_id: 'tenant-1', status: 'active', start_date: '2026-01-01', end_date: '2027-07-31', created_at: '2026-01-01' },
        { id: 'lease-pending', unit_id: 'unit-2', tenant_id: 'tenant-2', status: 'pending', start_date: '2026-09-01', end_date: '2027-08-31', created_at: '2026-02-01' },
        { id: 'lease-expired', unit_id: 'unit-3', tenant_id: 'tenant-3', status: 'expired', start_date: '2024-01-01', end_date: '2024-12-31', created_at: '2024-01-01' },
      ],
      units: [
        { id: 'unit-1', property_id: PROPERTY_ID, label: '1A' },
        { id: 'unit-2', property_id: PROPERTY_ID, label: '2B' },
        { id: 'unit-3', property_id: PROPERTY_ID, label: '3C' },
      ],
      tenants: [
        { id: 'tenant-1', full_name: 'Active Resident' },
        { id: 'tenant-2', full_name: 'Pending Resident' },
        { id: 'tenant-3', full_name: 'Former Resident' },
      ],
      properties: [{ id: PROPERTY_ID, name: 'Truth House' }],
    });

    const options = await listCurrentLeaseDocumentOptions();

    expect(options).toEqual([
      {
        id: 'lease-active',
        label: 'Truth House · 1A · Active Resident · Active through Jul 2027',
      },
      {
        id: 'lease-pending',
        label: 'Truth House · 2B · Pending Resident · Pending move-in',
      },
    ]);
  });
});

function leaseIdentityFixture(opts: {
  oldTenantId: string;
  newTenantId: string;
  newStatus: 'active' | 'pending';
  includeNewDocument?: boolean;
}): Tables {
  const oldTenant = { id: opts.oldTenantId, full_name: 'Prior Tenant' };
  const newTenant = { id: opts.newTenantId, full_name: 'Returning Tenant' };
  const tenants = Array.from(new Map([oldTenant, newTenant].map((t) => [t.id, t])).values());
  const documents: Array<Record<string, unknown>> = [{
    id: 'doc-old',
    lease_id: 'lease-old',
    type: 'lease',
    title: 'Prior lease document',
    expiry_date: null,
    property_id: PROPERTY_ID,
    unit_id: 'unit-1',
    tenant_id: opts.oldTenantId,
    vendor_id: null,
    created_at: '2025-01-01',
  }];
  if (opts.includeNewDocument) {
    documents.push({
      ...documents[0],
      id: 'doc-new',
      lease_id: 'lease-new',
      title: 'Pending lease document',
      tenant_id: opts.newTenantId,
      created_at: '2026-02-01',
    });
  }
  return {
    documents,
    leases: [
      {
        id: 'lease-old', unit_id: 'unit-1', tenant_id: opts.oldTenantId,
        status: 'expired', start_date: '2024-01-01', end_date: '2024-12-31',
        created_at: '2024-01-01',
      },
      {
        id: 'lease-new', unit_id: 'unit-1', tenant_id: opts.newTenantId,
        status: opts.newStatus, start_date: '2026-08-01', end_date: '2027-07-31',
        created_at: '2026-02-01',
      },
    ],
    units: [{ id: 'unit-1', property_id: PROPERTY_ID, label: 'Unit 1' }],
    tenants,
    properties: [{ id: PROPERTY_ID, name: 'Identity House' }],
    vendors: [],
  };
}
