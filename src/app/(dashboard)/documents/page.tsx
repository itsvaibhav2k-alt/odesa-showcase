/**
 * /documents — portfolio Documents list view.
 *
 * Reached from the sidebar + the command-center tab bar (Documents tab). Wraps
 * the shared ListPageShell (Portfolio / Documents breadcrumb, serif title,
 * active tab = documents) around:
 *   - UploadDocumentButton — dark pill in the title row (titleAction slot)
 *   - DocumentsFilterList — Type filter island + filtered document rows
 *   - AskOdesaBar — scoped "Ask Odesa about documents…" bar
 *
 * Each row drills into its related tenant/vendor detail page (hrefs baked into
 * the mock rows). Server component; force-dynamic so the freshness line and any
 * future live lookups never get statically cached.
 */

import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AccountantDocumentRegister } from '@/components/accounting/accountant-documents';
import { AccountantPageFrame } from '@/components/accounting/page-frame';
import { AccountantUnavailableState } from '@/components/accounting/unavailable-state';
import { ListPageShell } from '@/components/properties/list/list-page-shell';
import { AskOdesaBar } from '@/components/properties/detail/ask-odesa-bar';
import { createServerClient } from '@/lib/supabase/server';
import {
  listCurrentLeaseDocumentOptions,
  listDocuments,
} from '@/lib/documents/queries';
import { DocumentsFilterList } from './documents-filter-list';
import { UploadDocumentButton } from './upload-document-button';
import {
  resolveAccountantRouteDecision,
  type AccountantRawSearch,
} from '@/lib/accounting/canonical-search';
import {
  loadAccountantDocuments,
  type AccountantProjectionClient,
} from '@/lib/accounting/repository';
import {
  buildDocumentRegisterParams,
  normalizeDocumentRegister,
  type AccountantRegisterSearchInput,
} from '@/lib/accounting/register-state';
import { requireAccessContext } from '@/lib/authz/context';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Documents · Odesa',
};

const ASK_PROMPTS: string[] = [
  'Which leases expire in 90 days?',
  'Which leases are missing a document?',
  'Which insurance files are expiring?',
  'Find a tenant’s lease',
  'Draft a renewal notice',
];

interface DocumentsPageProps {
  // Param contract: an optional `?propertyId=<uuid>` query restricts the list
  // to one property. Absent (or an id that doesn't resolve) => full portfolio.
  searchParams: Promise<
    AccountantRawSearch &
      AccountantRegisterSearchInput & { propertyId?: string }
  >;
}

const scopedBannerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
  marginBottom: 18,
  padding: '10px 14px',
  background: 'var(--paper-50)',
  border: '1px solid var(--hairline-faint)',
  borderRadius: 8,
};

const scopedTextStyle: CSSProperties = {
  fontSize: '12.5px',
  color: 'var(--ink-2)',
};

const scopedNameStyle: CSSProperties = {
  fontWeight: 600,
  color: 'var(--ink)',
};

const viewAllStyle: CSSProperties = {
  marginLeft: 'auto',
  fontSize: '11.5px',
  color: 'var(--ink-3)',
  textDecoration: 'none',
};

async function resolvePropertyName(propertyId: string): Promise<string | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('properties')
    .select('name')
    .eq('id', propertyId)
    .maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

export default async function DocumentsPage({ searchParams }: DocumentsPageProps) {
  const raw = await searchParams;
  const { propertyId } = raw;
  const supabase = await createServerClient();
  const access = await requireAccessContext({ auth: supabase, db: supabase });
  if (!access.ok) notFound();
  if (access.context.role === 'accountant') {
    let model: Awaited<ReturnType<typeof loadAccountantDocuments>>;
    try {
      model = await loadAccountantDocuments(
        supabase as unknown as AccountantProjectionClient,
        { capabilities: access.context.capabilities },
      );
    } catch {
      if (raw.property !== undefined) notFound();
      return (
        <AccountantPageFrame
          eyebrow="Close evidence"
          title="Accounting evidence index"
          subtitle="Only explicitly owner-classified metadata is eligible; no hidden document has been inferred."
        >
          <AccountantUnavailableState label="Document evidence is unavailable" />
        </AccountantPageFrame>
      );
    }
    const register = normalizeDocumentRegister(
      raw,
      model.rows,
      40,
      new Set(model.properties.map((property) => property.propertyId)),
    );
    const decision = resolveAccountantRouteDecision(
      '/documents',
      raw,
      buildDocumentRegisterParams(register.state),
      register.unknownPropertyRequested,
    );
    if (decision.kind === 'not_found') notFound();
    if (decision.kind === 'redirect') redirect(decision.href);

    return (
      <AccountantPageFrame
        eyebrow="Close evidence"
        title="Accounting evidence index"
        subtitle="Review only owner-classified accounting metadata and missing lease evidence. File bytes, storage keys, uploads, and reclassification are unavailable."
      >
        <AccountantDocumentRegister model={model} register={register} />
      </AccountantPageFrame>
    );
  }
  const isVa = access.context.role === 'va';

  // Only scope when the property actually resolves — an unknown id falls back
  // to the full unscoped list rather than a mystery empty view.
  const resolvedName = propertyId ? await resolvePropertyName(propertyId) : null;
  const scoped =
    propertyId && resolvedName ? { id: propertyId, name: resolvedName } : null;

  const documentScope = scoped ? { propertyId: scoped.id } : {};
  const [{ header, facets, rows }, leaseOptions] = await Promise.all([
    listDocuments(documentScope),
    listCurrentLeaseDocumentOptions(documentScope),
  ]);

  const breadcrumb = scoped
    ? [
        { label: 'Portfolio', href: '/properties' },
        { label: scoped.name, href: `/properties/${scoped.id}` },
        { label: 'Documents' },
      ]
    : [{ label: 'Portfolio', href: '/properties' }, { label: 'Documents' }];

  return (
    <div data-testid="documents-page">
      <ListPageShell
        breadcrumb={breadcrumb}
        eyebrow="Property archive"
        title="Documents"
        titleMeta={header.summary.split(' · ')}
        activeTab="documents"
        audience={isVa ? 'va' : 'owner'}
        titleAction={
          isVa ? undefined : <UploadDocumentButton leaseOptions={leaseOptions} />
        }
        maxWidth={1160}
        background="var(--panel)"
      >
        {scoped ? (
          <div data-testid="documents-scoped-banner" style={scopedBannerStyle}>
            <span style={scopedTextStyle}>
              Showing documents for{' '}
              <span style={scopedNameStyle}>{scoped.name}</span>
            </span>
            <Link
              href="/documents"
              data-testid="documents-view-all"
              style={viewAllStyle}
            >
              View all documents →
            </Link>
          </div>
        ) : null}

        <DocumentsFilterList facets={facets} rows={rows} readOnly={isVa} />

        <AskOdesaBar
          scopeLabel="Documents"
          placeholder="Ask Odesa about documents…"
          prompts={ASK_PROMPTS}
        />
      </ListPageShell>
    </div>
  );
}
