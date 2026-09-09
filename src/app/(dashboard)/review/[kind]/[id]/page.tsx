/**
 * /review/[kind]/[id] — Owner Review surface.
 *
 * Async server component. Auth-gates, validates `kind`, loads the normalized
 * `ReviewCase` via `getReviewCase`, and renders the static detail-kit layout
 * with a single interactive client island (`ReviewActionPanel`). Unknown kind
 * or RLS-hidden id → notFound().
 */

import { notFound, redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { getReviewCase } from '@/lib/review/queries';
import { isReviewKind, type ReviewBadgeTone } from '@/lib/review/types';
import { DetailGlobalBar } from '@/components/properties/detail/detail-global-bar';
import { DetailTitleBlock } from '@/components/properties/detail/detail-title-block';
import { DetailSection } from '@/components/properties/detail/detail-section';
import { DetailPanel } from '@/components/properties/detail/detail-panel';
import { KvGrid } from '@/components/properties/detail/kv-grid';
import { NextActionCallout } from '@/components/properties/detail/next-action-callout';
import { AskOdesaBar } from '@/components/properties/detail/ask-odesa-bar';
import { ReviewActionPanel } from '@/components/review/review-action-panel';
import type { BadgeVariant } from '@/lib/properties/mock-detail';
import type { UserRole } from '@/types/database';

export const dynamic = 'force-dynamic';

const TONE_TO_VARIANT: Record<ReviewBadgeTone, BadgeVariant> = {
  clay: 'atrisk',
  amber: 'needsaction',
  green: 'resolved',
  muted: 'watching',
};

interface ReviewPageProps {
  params: Promise<{ kind: string; id: string }>;
}

export default async function ReviewPage({ params }: ReviewPageProps) {
  const { kind, id } = await params;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: currentRole } = await supabase.rpc('current_user_role');
  const role: UserRole | null = currentRole ?? null;
  const isVa = role === 'va';

  if (!isReviewKind(kind)) notFound();

  const reviewCase = await getReviewCase(kind, id);
  if (!reviewCase) notFound();

  return (
    <div
      className="today-theme"
      data-testid="review-page"
      data-review-kind={reviewCase.kind}
      data-review-id={reviewCase.id}
      style={{
        background: 'var(--panel-clean)',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <DetailGlobalBar
        crumbs={[
          {
            label: isVa ? 'My shift' : 'Today',
            href: reviewCase.backHref,
          },
          { label: reviewCase.title },
        ]}
        freshnessText="Data current · refreshed on open"
      />

      <main style={{ flex: 1 }}>
        <div
          style={{
            maxWidth: '900px',
            margin: '0 auto',
            padding: '24px 36px 36px',
          }}
        >
          <DetailTitleBlock
            eyebrow={reviewCase.eyebrow}
            title={reviewCase.title}
            badge={{
              variant: TONE_TO_VARIANT[reviewCase.badge.tone],
              label: reviewCase.badge.label,
            }}
            meta={reviewCase.meta}
          />

          <div style={{ marginBottom: '22px' }}>
            <NextActionCallout
              body={
                isVa
                  ? 'Prepare the known facts and any draft for owner review. No tenant, money, lease, or vendor-facing action happens from this page.'
                  : reviewCase.recommendation
              }
            />
          </div>

          <ReviewActionPanel
            id={reviewCase.id}
            draft={reviewCase.draft ?? null}
            actions={reviewCase.actions}
            recommendation={reviewCase.recommendation}
            backHref={reviewCase.backHref}
            readOnly={isVa}
          />

          {reviewCase.context.map((block) => (
            <DetailSection key={block.label} label={block.label}>
              <DetailPanel>
                <KvGrid
                  cells={block.rows.map((r) => ({
                    k: r.k,
                    v: r.v,
                    mono: r.mono,
                  }))}
                />
              </DetailPanel>
            </DetailSection>
          ))}

          <AskOdesaBar
            scopeLabel={reviewCase.title}
            placeholder={`Ask Odesa about this ${reviewCase.eyebrow.toLowerCase()}…`}
            prompts={
              isVa
                ? [
                    'Summarize the known facts',
                    'What does the owner need to decide?',
                    'Draft an owner handoff',
                  ]
                : [
                    'Why did Odesa flag this?',
                    'What happens if I wait?',
                    'Draft an alternative',
                  ]
            }
          />
        </div>
      </main>
    </div>
  );
}
