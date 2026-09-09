/**
 * VendorWorkOrderList — work-order reference list for the vendor brief.
 *
 * Mirrors the mockup's `.tickets` / `.ticket-row` / `.ticket-link` /
 * `.ticket-icon` / `.ticket-body` / `.ticket-meta` pattern (vendor-detail.html).
 * Each row is an <article> with a SINGLE overlay link to `row.href`
 * (workOrderHref(woId)). No nested interactive elements; status icon and badge
 * dot are aria-hidden so meaning is carried by text + the row's aria-label.
 *
 * Distinct from detail/ticket-list.tsx because the vendor brief's work-order
 * rows carry a free-text badge label (not a typed MaintenanceRef) and a
 * pre-built href — this component maps those labels to the shared DetailBadge.
 *
 * Server component — no interactivity.
 */

import type { CSSProperties } from 'react';
import Link from 'next/link';

import type { BadgeVariant } from '@/lib/properties/mock-detail';
import { DetailBadge } from '@/components/properties/detail/detail-badge';
import { StatusChip, type StatusChipTone } from '@/components/shared/status-chip';
import type { VendorWorkOrderRowWithChip } from '@/lib/vendors/queries';
import type { VendorLifecycleChip } from '@/lib/work-orders/vendor-lifecycle';

export interface VendorWorkOrderListProps {
  items: VendorWorkOrderRowWithChip[];
}

/** Honest lifecycle chip tone → StatusChip palette tone. */
const CHIP_TONE_TO_STATUSCHIP: Record<VendorLifecycleChip['tone'], StatusChipTone> = {
  good: 'green',
  warn: 'amber-soft',
  clay: 'clay',
  neutral: 'neutral-gold',
};

/** Map the free-text WO badge label to a typed DetailBadge variant. */
function badgeVariantFor(label: string): BadgeVariant {
  switch (label) {
    case 'Resolved':
      return 'resolved';
    case 'Accepted':
      return 'dispatched';
    case 'Owner review':
      return 'scheduled';
    case 'Vendor overdue':
      return 'open';
    default:
      return 'scheduled';
  }
}

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 13,
  padding: '13px 0',
  borderBottom: '1px solid var(--hairline-faint)',
  position: 'relative',
};

const overlayLinkStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 1,
  textDecoration: 'none',
};

const iconBaseStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  color: 'var(--terracotta)',
  paddingTop: 2,
  width: 14,
  flexShrink: 0,
  fontSize: 12,
  position: 'relative',
};

const iconCalmStyle: CSSProperties = {
  ...iconBaseStyle,
  color: 'var(--green)',
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  position: 'relative',
};

const titleStyle: CSSProperties = {
  fontSize: '13.5px',
  fontWeight: 500,
  color: 'var(--ink)',
};

const subWrapStyle: CSSProperties = {
  fontSize: '12px',
  color: 'var(--ink-2)',
  marginTop: 2,
};

const woChipStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '10.5px',
  color: 'var(--ink-3)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginRight: 8,
};

const metaStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 6,
  flexShrink: 0,
  position: 'relative',
};

export function VendorWorkOrderList({ items }: VendorWorkOrderListProps) {
  return (
    <>
      <div style={listStyle} data-vendor-wo-list>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          const finalRowStyle: CSSProperties = isLast
            ? { ...rowStyle, borderBottom: 'none' }
            : rowStyle;
          // Honest lifecycle chip wins the accessible label; badge is fallback.
          const statusText = item.chip ? item.chip.label : item.badge;
          const ariaLabel = `${item.title} — ${item.woId}, ${statusText}`;

          return (
            <article
              key={item.woId}
              style={finalRowStyle}
              aria-label={ariaLabel}
              data-testid={`vendor-wo-${item.woId}`}
            >
              {/* Single overlay link — links to the work order */}
              <Link
                href={item.href}
                aria-label={ariaLabel}
                style={overlayLinkStyle}
                className="vendor-wo-link"
                tabIndex={0}
              />

              {/* Status icon — ◆ terracotta (active) or ✓ green (resolved) */}
              <span aria-hidden="true" style={item.calm ? iconCalmStyle : iconBaseStyle}>
                {item.calm ? '✓' : '◆'}
              </span>

              {/* Body: title + WO chip + sub */}
              <div style={bodyStyle}>
                <div style={titleStyle}>{item.title}</div>
                <div style={subWrapStyle}>
                  <span style={woChipStyle}>{item.woId}</span>
                  {item.sub}
                </div>
              </div>

              {/* Meta: honest lifecycle chip (falls back to the mock badge) */}
              <div style={metaStyle}>
                {item.chip ? (
                  <StatusChip
                    tone={CHIP_TONE_TO_STATUSCHIP[item.chip.tone]}
                    label={item.chip.label}
                  />
                ) : (
                  <DetailBadge variant={badgeVariantFor(item.badge)} label={item.badge} />
                )}
              </div>
            </article>
          );
        })}
      </div>
      <VendorWorkOrderListStyles />
    </>
  );
}

function VendorWorkOrderListStyles() {
  return (
    <style precedence="vendor-wo-list">{`
      .vendor-wo-link:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
        border-radius: 6px;
      }
    `}</style>
  );
}
