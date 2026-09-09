/**
 * Documents list query — powers `/documents`.
 *
 * Reads the `documents` table (org-scoped via RLS) and maps each row to the
 * `DocumentRow` view-model the list view already renders. Lease documents use
 * an explicit documents.lease_id relationship; historical unlinked files are
 * shown as Needs review and never satisfy a current lease's Missing check.
 */

import { createServerClient } from '@/lib/supabase/server';
import type {
  DocumentsList,
  DocumentRow,
  DocumentType,
  DocumentFacetId,
  FacetSpec,
} from '@/lib/properties/mock-portfolio-views';

interface DocumentRecord {
  id: string;
  type: DocumentType;
  title: string;
  expiry_date: string | null;
  property_id: string | null;
  unit_id: string | null;
  tenant_id: string | null;
  vendor_id: string | null;
  lease_id: string | null;
  created_at: string;
}

interface LeaseRecord {
  id: string;
  unit_id: string;
  tenant_id: string;
  status: 'active' | 'pending' | 'expired' | 'terminated';
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

const BADGE_BY_TYPE: Record<Exclude<DocumentType, 'lease'>, string> = {
  inspection: 'Inspection',
  insurance: 'Insurance',
  notice: 'Notice',
  tax: 'Tax',
  hoa: 'HOA',
};

const DOCUMENT_PAGE_SIZE = 500;
const ID_CHUNK_SIZE = 200;
const EXPIRING_WINDOW_DAYS = 60;

interface ReadResult<Row> {
  data: Row[] | null;
  error: { message: string } | null;
}

const DOCUMENT_REGISTRY_COLUMNS =
  'id, type, title, expiry_date, property_id, unit_id, tenant_id, vendor_id, lease_id, created_at';
const LEGACY_DOCUMENT_REGISTRY_COLUMNS =
  'id, type, title, expiry_date, property_id, unit_id, tenant_id, vendor_id, created_at';

async function readAll<Row>(
  label: string,
  page: (from: number, to: number) => PromiseLike<ReadResult<Row>>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += DOCUMENT_PAGE_SIZE) {
    const { data, error } = await page(from, from + DOCUMENT_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to load documents ${label}: ${error.message}`);
    if (!data) throw new Error(`Failed to load documents ${label}: query returned no data`);
    rows.push(...data);
    if (data.length < DOCUMENT_PAGE_SIZE) return rows;
  }
}

const EMPTY: DocumentsList = {
  header: { summary: '0 files', total: 0 },
  facets: [
    { id: 'all', label: 'All', count: 0 },
    { id: 'leases', label: 'Leases', count: 0 },
    { id: 'inspections', label: 'Inspections', count: 0 },
    { id: 'insurance', label: 'Insurance', count: 0 },
    { id: 'notices', label: 'Notices', count: 0 },
  ],
  rows: [],
};

function expirySpan(date: string | null): string {
  if (!date) return '—';
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return `Exp ${d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
}

interface ListDocumentsOptions {
  /**
   * Restrict the list to a single property. Docs whose `property_id` matches are
   * returned; docs linked only to a tenant/vendor with a null `property_id` will
   * not match (acceptable — property scoping is honest, not inferred).
   */
  propertyId?: string;
}

export interface LeaseDocumentOption {
  id: string;
  label: string;
}

export async function listCurrentLeaseDocumentOptions(
  opts: ListDocumentsOptions = {},
): Promise<LeaseDocumentOption[]> {
  const supabase = await createServerClient();
  const propertyUnitIds = opts.propertyId
    ? await unitIdsForProperty(supabase, opts.propertyId)
    : null;
  const leases = (await loadCurrentLeases(supabase, propertyUnitIds)).filter(
    (lease) => lease.status === 'active' || lease.status === 'pending',
  );
  if (leases.length === 0) return [];

  const unitIds = unique(leases.map((lease) => lease.unit_id));
  const tenantIds = unique(leases.map((lease) => lease.tenant_id));
  const [unitLabels, unitToProperty, tenantNames] = await Promise.all([
    nameMap(supabase, 'units', unitIds, 'label'),
    unitPropertyMap(supabase, unitIds),
    nameMap(supabase, 'tenants', tenantIds, 'full_name'),
  ]);
  const propertyNames = await nameMap(
    supabase,
    'properties',
    unique(Array.from(unitToProperty.values())),
    'name',
  );

  return leases
    .map((lease) => {
      const propertyId = unitToProperty.get(lease.unit_id);
      const status =
        lease.status === 'pending'
          ? 'Pending move-in'
          : lease.end_date
            ? `Active through ${monthYear(lease.end_date)}`
            : 'Active · open-ended';
      return {
        id: lease.id,
        label: [
          propertyId ? propertyNames.get(propertyId) : null,
          unitLabels.get(lease.unit_id),
          tenantNames.get(lease.tenant_id),
          status,
        ]
          .filter(Boolean)
          .join(' · '),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export async function listDocuments(
  opts: ListDocumentsOptions = {},
): Promise<DocumentsList> {
  const supabase = await createServerClient();

  const data = await loadDocumentRegistry(supabase, opts);

  const propertyUnitIds = opts.propertyId
    ? await unitIdsForProperty(supabase, opts.propertyId)
    : null;
  const leases = await loadCurrentLeases(supabase, propertyUnitIds);

  if (data.length === 0 && leases.length === 0) return EMPTY;

  // Resolve related-entity labels in batched follow-up reads (RLS-scoped).
  const propertyIds = unique([
    ...data.map((d) => d.property_id),
    opts.propertyId ?? null,
  ]);
  const unitIds = unique([
    ...data.map((d) => d.unit_id),
    ...leases.map((lease) => lease.unit_id),
  ]);
  const tenantIds = unique([
    ...data.map((d) => d.tenant_id),
    ...leases.map((lease) => lease.tenant_id),
  ]);
  const vendorIds = unique(data.map((d) => d.vendor_id));

  const [propNames, unitLabels, unitToProperty, tenantNames, vendorNames] =
    await Promise.all([
      nameMap(supabase, 'properties', propertyIds, 'name'),
      nameMap(supabase, 'units', unitIds, 'label'),
      unitPropertyMap(supabase, unitIds),
      nameMap(supabase, 'tenants', tenantIds, 'full_name'),
      nameMap(supabase, 'vendors', vendorIds, 'name'),
    ]);
  const inferredPropertyNames = await nameMap(
    supabase,
    'properties',
    unique(Array.from(unitToProperty.values())),
    'name',
  );
  for (const [id, name] of inferredPropertyNames) propNames.set(id, name);

  const leaseById = new Map(leases.map((lease) => [lease.id, lease]));
  const newestLeaseDocumentId = new Map<string, string>();
  for (const document of data) {
    if (document.type !== 'lease' || !document.lease_id) continue;
    if (!newestLeaseDocumentId.has(document.lease_id)) {
      newestLeaseDocumentId.set(document.lease_id, document.id);
    }
  }

  const rows: DocumentRow[] = data.map((d) => {
    const linkedLease = d.lease_id ? leaseById.get(d.lease_id) : undefined;
    const effectiveDocument: DocumentRecord = linkedLease
      ? {
          ...d,
          unit_id: d.unit_id ?? linkedLease.unit_id,
          tenant_id: d.tenant_id ?? linkedLease.tenant_id,
          property_id:
            d.property_id ?? unitToProperty.get(linkedLease.unit_id) ?? null,
        }
      : d;
    const { related, href } = relatedFor(effectiveDocument, {
      propNames,
      unitLabels,
      unitToProperty,
      tenantNames,
      vendorNames,
    });
    return {
      title: d.title,
      type: d.type,
      badge:
        d.type === 'lease'
          ? leaseDocumentBadge(d, leaseById, newestLeaseDocumentId)
          : BADGE_BY_TYPE[d.type],
      related,
      span:
        d.type === 'lease'
          ? (() => {
              const lease = d.lease_id ? leaseById.get(d.lease_id) : undefined;
              return lease ? leaseSpan(lease) : expirySpan(d.expiry_date);
            })()
          : expirySpan(d.expiry_date),
      href,
    };
  });

  for (const lease of leases) {
    if (lease.status !== 'active' && lease.status !== 'pending') continue;
    if (newestLeaseDocumentId.has(lease.id)) continue;
    const propertyId = unitToProperty.get(lease.unit_id);
    const property = propertyId ? propNames.get(propertyId) : null;
    const unit = unitLabels.get(lease.unit_id);
    const tenant = tenantNames.get(lease.tenant_id) ?? 'Tenant';
    rows.push({
      title: `Lease document missing — ${tenant}`,
      type: 'lease',
      badge: 'Missing',
      related: [property, unit].filter(Boolean).join(' · ') || tenant,
      span: leaseSpan(lease),
      href: `/tenants/${lease.tenant_id}`,
    });
  }

  const counts = (t: DocumentType) => rows.filter((r) => r.type === t).length;
  const facets: FacetSpec<DocumentFacetId>[] = [
    { id: 'all', label: 'All', count: rows.length },
    { id: 'leases', label: 'Leases', count: counts('lease') },
    { id: 'inspections', label: 'Inspections', count: counts('inspection') },
    { id: 'insurance', label: 'Insurance', count: counts('insurance') },
    { id: 'notices', label: 'Notices', count: counts('notice') },
  ];

  const missing = rows.filter((r) => r.badge === 'Missing').length;
  const summary = `${data.length} files · ${counts('lease')} lease records · ${missing} missing`;

  return { header: { summary, total: rows.length }, facets, rows };
}

async function loadDocumentRegistry(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  opts: ListDocumentsOptions,
): Promise<DocumentRecord[]> {
  const load = (columns: string) =>
    readAll<DocumentRecord>('registry', (from, to) => {
      let query = supabase.from('documents').select(columns);
      if (opts.propertyId) query = query.eq('property_id', opts.propertyId);
      return query
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
        .returns<DocumentRecord[]>();
    });

  try {
    return await load(DOCUMENT_REGISTRY_COLUMNS);
  } catch (error) {
    if (!isMissingLeaseIdSchemaError(error)) throw error;
    const legacy = await load(LEGACY_DOCUMENT_REGISTRY_COLUMNS);
    return legacy.map((document) => ({ ...document, lease_id: null }));
  }
}

function isMissingLeaseIdSchemaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('lease_id') &&
    (message.includes('does not exist') ||
      message.includes('schema cache') ||
      message.includes('could not find'))
  );
}

function leaseDocumentBadge(
  document: DocumentRecord,
  leaseById: Map<string, LeaseRecord>,
  newestDocumentId: Map<string, string>,
): 'Active' | 'Pending' | 'Expiring' | 'Expired' | 'Superseded' | 'Needs review' {
  if (!document.lease_id) return unlinkedLeaseDocumentBadge(document);
  if (newestDocumentId.get(document.lease_id) !== document.id) return 'Superseded';

  const lease = leaseById.get(document.lease_id);
  if (!lease) return 'Needs review';
  if (lease.status === 'pending') return 'Pending';
  const endDate = lease?.end_date ?? document.expiry_date;
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const end = endDate ? new Date(`${endDate}T00:00:00Z`) : null;
  if (lease?.status === 'expired' || lease?.status === 'terminated') return 'Expired';
  if (end && !Number.isNaN(end.getTime())) {
    const days = Math.ceil((end.getTime() - today.getTime()) / 86_400_000);
    if (days < 0) return 'Expired';
    if (days <= EXPIRING_WINDOW_DAYS) return 'Expiring';
  }
  return 'Active';
}

function unlinkedLeaseDocumentBadge(
  document: DocumentRecord,
): 'Expiring' | 'Expired' | 'Needs review' {
  if (!document.expiry_date) return 'Needs review';
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${document.expiry_date}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return 'Needs review';
  const days = Math.ceil((end.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return 'Expired';
  if (days <= EXPIRING_WINDOW_DAYS) return 'Expiring';
  return 'Needs review';
}

function leaseSpan(lease: LeaseRecord): string {
  const start = lease.start_date ? monthYear(lease.start_date) : '—';
  const end = lease.end_date ? monthYear(lease.end_date) : 'Open-ended';
  return `${start} – ${end}`;
}

function monthYear(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? '—'
    : parsed.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

async function unitIdsForProperty(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  propertyId: string,
): Promise<string[]> {
  const rows = await readAll<{ id: string }>('property units', (from, to) =>
    supabase
      .from('units')
      .select('id')
      .eq('property_id', propertyId)
      .order('id', { ascending: true })
      .range(from, to),
  );
  return rows.map((row) => row.id);
}

async function loadCurrentLeases(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  unitIds: string[] | null,
): Promise<LeaseRecord[]> {
  if (unitIds && unitIds.length === 0) return [];
  return readAll<LeaseRecord>('leases', (from, to) => {
    let query = supabase
      .from('leases')
      .select('id, unit_id, tenant_id, status, start_date, end_date, created_at')
      .in('status', ['active', 'pending', 'expired', 'terminated']);
    if (unitIds) query = query.in('unit_id', unitIds);
    return query.order('id', { ascending: true }).range(from, to);
  });
}

interface RelatedMaps {
  propNames: Map<string, string>;
  unitLabels: Map<string, string>;
  unitToProperty: Map<string, string>;
  tenantNames: Map<string, string>;
  vendorNames: Map<string, string>;
}

function relatedFor(
  d: DocumentRecord,
  m: RelatedMaps,
): { related: string; href: string } {
  if (d.tenant_id) {
    const unit = d.unit_id ? m.unitLabels.get(d.unit_id) : null;
    const prop = d.property_id ? m.propNames.get(d.property_id) : null;
    const where = [prop, unit].filter(Boolean).join(' · ');
    return {
      related: where || m.tenantNames.get(d.tenant_id) || 'Tenant record',
      href: `/tenants/${d.tenant_id}`,
    };
  }
  if (d.vendor_id) {
    return {
      related: `${m.vendorNames.get(d.vendor_id) ?? 'Vendor'} record`,
      href: `/vendors/${d.vendor_id}`,
    };
  }
  if (d.unit_id) {
    const propId = m.unitToProperty.get(d.unit_id);
    const prop = propId ? m.propNames.get(propId) : null;
    const unit = m.unitLabels.get(d.unit_id);
    return {
      related: [prop, unit].filter(Boolean).join(' · ') || 'Unit record',
      href: propId ? `/properties/${propId}/units/${d.unit_id}` : '/properties',
    };
  }
  if (d.property_id) {
    return {
      related: m.propNames.get(d.property_id) ?? 'Property record',
      href: `/properties/${d.property_id}`,
    };
  }
  return { related: 'Portfolio', href: '/documents' };
}

function unique(ids: Array<string | null>): string[] {
  return Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
}

async function nameMap(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  table: 'properties' | 'units' | 'tenants' | 'vendors',
  ids: string[],
  column: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  for (let offset = 0; offset < ids.length; offset += ID_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + ID_CHUNK_SIZE);
    const rows = await readAll<Record<string, string>>(table, (from, to) =>
      supabase
        .from(table)
        .select(`id, ${column}`)
        .in('id', chunk)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<ReadResult<Record<string, string>>>,
    );
    for (const row of rows) out.set(row.id, row[column]);
  }
  return out;
}

async function unitPropertyMap(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  unitIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (unitIds.length === 0) return out;
  for (let offset = 0; offset < unitIds.length; offset += ID_CHUNK_SIZE) {
    const chunk = unitIds.slice(offset, offset + ID_CHUNK_SIZE);
    const rows = await readAll<{ id: string; property_id: string }>(
      'unit properties',
      (from, to) =>
        supabase
          .from('units')
          .select('id, property_id')
          .in('id', chunk)
          .order('id', { ascending: true })
          .range(from, to),
    );
    for (const row of rows) out.set(row.id, row.property_id);
  }
  return out;
}
