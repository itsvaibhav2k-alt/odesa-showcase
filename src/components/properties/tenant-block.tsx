import type { UnitDetail } from '@/lib/properties/queries';

/**
 * Tenant block for the unit-detail page.
 *
 * Design:
 * - Name in Fraunces display-sm
 * - Phone + email in JetBrains Mono, rendered as tel:/mailto: links
 * - "since [lease.start_date]" meta (uppercase, tracked) — the lease
 *   is accepted as a parameter so the start_date travels through the
 *   single-source-of-truth path.
 */

export interface TenantBlockProps {
  tenant: NonNullable<UnitDetail['tenant']>;
  lease: UnitDetail['lease'];
}

export function TenantBlock({ tenant, lease }: TenantBlockProps) {
  const sinceLabel = formatSince(lease?.startDate ?? null);

  return (
    <section
      data-testid="unit-detail-tenant"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <p className="meta-label" style={{ color: 'var(--ink-500)' }}>
        Tenant
      </p>
      <h2
        data-testid="unit-detail-tenant-name"
        className="font-serif-display"
        style={{
          fontSize: '28px',
          lineHeight: 1.2,
          letterSpacing: '-0.01em',
          color: 'var(--ink-900)',
        }}
      >
        {tenant.fullName}
      </h2>

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'max-content 1fr',
          gap: '10px 18px',
          alignItems: 'baseline',
          fontSize: '14px',
        }}
      >
        <dt className="meta-label" style={{ color: 'var(--ink-500)' }}>
          Phone
        </dt>
        <dd style={{ margin: 0 }}>
          <a
            data-testid="unit-detail-tenant-phone"
            href={`tel:${tenant.phoneE164}`}
            className="tabular-nums"
            style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--navy-700)',
              textDecoration: 'none',
              fontSize: '14px',
            }}
          >
            {formatPhone(tenant.phoneE164)}
          </a>
        </dd>

        <dt className="meta-label" style={{ color: 'var(--ink-500)' }}>
          Email
        </dt>
        <dd style={{ margin: 0 }}>
          {tenant.email ? (
            <a
              data-testid="unit-detail-tenant-email"
              href={`mailto:${tenant.email}`}
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--navy-700)',
                textDecoration: 'none',
                fontSize: '14px',
              }}
            >
              {tenant.email}
            </a>
          ) : (
            <span style={{ color: 'var(--ink-400)', fontSize: '14px' }}>—</span>
          )}
        </dd>
      </dl>

      {sinceLabel ? (
        <p
          data-testid="unit-detail-tenant-since"
          className="meta-label"
          style={{ color: 'var(--ink-500)' }}
        >
          Since {sinceLabel}
        </p>
      ) : null}
    </section>
  );
}

function formatSince(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d
    .toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    .toLowerCase();
}

/**
 * Formats an E.164 phone number like "+15715550201" as "(571) 555-0201"
 * for US numbers. Non-US numbers fall through to the raw value.
 */
function formatPhone(e164: string): string {
  if (!e164.startsWith('+1') || e164.length !== 12) return e164;
  const digits = e164.slice(2);
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
