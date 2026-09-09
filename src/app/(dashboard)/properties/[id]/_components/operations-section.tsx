/**
 * Operations section — the property interior's accountability ledger.
 *
 * Mounts the three built-but-previously-unwired v1.5 panels beneath the
 * spatial interior map: the autonomy rollup (what graduated trust Odesa has
 * earned here), the per-property privacy-mode card (where the worker model
 * runs), and the recent-decisions feed (every proposal and how the review
 * gate decided). The framing is deliberately a review gate, not an AI
 * control center — nothing here acts without passing the gate first.
 *
 * Server component: it takes already-fetched data as props so the page can
 * fan the three queries out in one `Promise.all`. It renders the client
 * `PrivacyModeCard` as a child, which is allowed from a server component.
 */

import type { CSSProperties } from 'react';
import Link from 'next/link';

import type { PropertyProposalSummary } from '@/lib/properties/queries';

import { AutonomyPanel } from '../autonomy-panel';
import { PrivacyModeCard } from '../privacy-mode-card';
import { ProposalsFeed } from '../proposals-feed';
import { roomHref } from '../_rooms/rooms-meta';

interface OperationsSectionProps {
  propertyId: string;
  autonomyLevel: number;
  privacyMode: 'hosted' | 'on_prem';
  ollamaHost: string | null;
  summary: PropertyProposalSummary;
}

const sectionStyle: CSSProperties = {
  display: 'grid',
  gap: 18,
  padding: '26px 30px 36px',
  borderTop: '1px solid var(--hairline)',
};

const headerStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  maxWidth: '74ch',
};

const eyebrowStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono-operator)',
  color: 'var(--ink-3)',
  fontSize: 10.5,
  fontWeight: 500,
  letterSpacing: '0.23em',
  textTransform: 'uppercase',
};

const sublineStyle: CSSProperties = {
  margin: 0,
  color: 'var(--ink-2)',
  fontSize: 13.5,
  lineHeight: 1.55,
};

const panelRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 16,
  alignItems: 'start',
};

const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-start',
};

const rulebookLinkStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: 12,
  letterSpacing: '0.08em',
  color: 'var(--ink-3)',
  textDecoration: 'none',
};

export function OperationsSection({
  propertyId,
  autonomyLevel,
  privacyMode,
  ollamaHost,
  summary,
}: OperationsSectionProps) {
  return (
    <section
      data-testid="property-operations-section"
      aria-labelledby="property-operations-heading"
      style={sectionStyle}
      className="property-operations-section"
    >
      <header style={headerStyle}>
        <h2 id="property-operations-heading" style={eyebrowStyle}>
          How Odesa runs this property
        </h2>
        <p style={sublineStyle}>
          An accountability ledger — what Odesa asks before acting, and the trust
          it has earned on this property so far. Nothing here happens without
          first clearing the review gate.
        </p>
      </header>

      <div style={panelRowStyle}>
        <AutonomyPanel autonomyLevel={autonomyLevel} rows={summary.autonomy} />
        <PrivacyModeCard
          propertyId={propertyId}
          initialPrivacyMode={privacyMode}
          initialOllamaHost={ollamaHost}
        />
      </div>

      <ProposalsFeed rows={summary.recent} />

      <div style={footerStyle}>
        <Link href={roomHref(propertyId, 'rulebook')} style={rulebookLinkStyle}>
          Edit rulebook →
        </Link>
      </div>
    </section>
  );
}
