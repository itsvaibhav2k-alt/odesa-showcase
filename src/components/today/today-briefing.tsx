import Link from 'next/link';

import type {
  BriefingChange,
  BriefingHeaderCta,
  BriefingHeaderSentence,
  BriefingSegment,
} from '@/lib/today/briefing-summary';
import type { WatchChannel } from '@/types/today';
import { formatAgoPhrase } from '@/lib/today/format';

import { TodayBriefingOrbit } from './today-briefing-orbit';
import { BriefingChangesDisclosure } from './briefing-changes-disclosure';

/**
 * Today v2 editorial briefing card.
 *
 * Server component. All copy (eyebrow timestamp, serif sentence, bullets,
 * CTA, orbit channel counts) is driven by props from `page.tsx`'s
 * server-side data fetch. The card renders a quiet steady state when
 * nothing is urgent (italic emphasis collapses, secondary link hides).
 */

export interface TodayBriefingProps {
  /** "Nm" / "Nh" / "Nd" — wrapped in "checked … ago". */
  checkedAgoLabel: string;
  /** Three-part editorial sentence. */
  sentence: BriefingHeaderSentence;
  /** 0–3 bullets composed of typed segments. */
  bullets: BriefingSegment[][];
  /** Primary CTA — label + href to the top urgent row. */
  cta: BriefingHeaderCta;
  /** Optional secondary link (e.g. "Show all five changes"). */
  secondaryLabel: string | null;
  /** Enumerated overnight changes revealed by the secondary disclosure. */
  changes: BriefingChange[];
  /** Per-channel counts driving the orbit dots. */
  channelCounts: Record<WatchChannel, number>;
  /** Channel that should wear the gold attention ring, or null. */
  attentionChannel: WatchChannel | null;
  /** Portfolio property count (orbit caption). */
  portfolioCount: number;
  /** VA shift view hides the owner-oriented channel orbit. */
  showOrbit?: boolean;
}

export function TodayBriefing({
  checkedAgoLabel,
  sentence,
  bullets,
  cta,
  secondaryLabel,
  changes,
  channelCounts,
  attentionChannel,
  portfolioCount,
  showOrbit = true,
}: TodayBriefingProps) {
  return (
    <section
      data-section="briefing"
      style={{
        background: 'var(--panel-lift)',
        border: '1px solid var(--hairline)',
        borderRadius: '10px',
        padding: '26px 30px 22px',
        marginBottom: '22px',
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: showOrbit ? '1fr 200px' : '1fr',
        gap: '28px',
        alignItems: 'start',
      }}
    >
      <div>
        {/* eyebrow */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            fontSize: '10px',
            fontWeight: 500,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-2)',
            marginBottom: '16px',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--terracotta)',
            }}
          />
          Odesa briefing
          <span
            data-dynamic-time
            suppressHydrationWarning
            style={{
              marginLeft: '8px',
              fontWeight: 400,
              letterSpacing: '0.08em',
              color: 'var(--ink-3)',
            }}
          >
            {formatAgoPhrase('checked', checkedAgoLabel)}
          </span>
        </div>

        {/* serif sentence */}
        <div
          style={{
            fontFamily: 'var(--font-serif-display)',
            fontSize: '30px',
            lineHeight: 1.18,
            letterSpacing: '-0.015em',
            color: 'var(--ink)',
            marginBottom: '18px',
            maxWidth: '580px',
          }}
        >
          {sentence.prefix}
          {sentence.italic ? (
            <span style={{ color: 'var(--terracotta)', fontStyle: 'italic' }}>
              {sentence.italic}
            </span>
          ) : null}
          {sentence.suffix}
        </div>

        {/* bullets */}
        {bullets.length > 0 ? (
          <ul
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '7px',
              marginBottom: '20px',
              maxWidth: '620px',
              listStyle: 'none',
              padding: 0,
            }}
          >
            {bullets.map((segments, idx) => (
              <BriefingBullet key={idx} segments={segments} />
            ))}
          </ul>
        ) : null}

        {/* CTA row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            marginTop: '4px',
          }}
        >
          <Link
            href={cta.href}
            data-briefing-cta
            style={{
              background: 'var(--ink)',
              color: 'var(--panel-lift)',
              textDecoration: 'none',
              fontFamily: 'var(--font-sans-operator)',
              fontSize: '12.5px',
              fontWeight: 500,
              letterSpacing: '-0.005em',
              padding: '9px 16px',
              borderRadius: '999px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {cta.label}
            <span
              style={{
                fontFamily: 'var(--font-mono-operator)',
                fontSize: '13px',
              }}
            >
              →
            </span>
          </Link>
          {secondaryLabel && changes.length > 0 ? (
            <BriefingChangesDisclosure label={secondaryLabel} changes={changes} />
          ) : null}
        </div>
      </div>

      {showOrbit ? (
        <TodayBriefingOrbit
          channelCounts={channelCounts}
          attentionChannel={attentionChannel}
          portfolioCount={portfolioCount}
        />
      ) : null}
    </section>
  );
}

function BriefingBullet({ segments }: { segments: BriefingSegment[] }) {
  return (
    <li
      style={{
        fontSize: '13px',
        color: 'var(--ink-2)',
        paddingLeft: '16px',
        position: 'relative',
        lineHeight: 1.55,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: '9px',
          width: '5px',
          height: '1px',
          background: 'var(--ink-4)',
        }}
      />
      {segments.map((seg, idx) => {
        if (seg.kind === 'name') {
          return (
            <b key={idx} style={{ color: 'var(--ink)', fontWeight: 450 }}>
              {seg.value}
            </b>
          );
        }
        if (seg.kind === 'num') {
          return (
            <b
              key={idx}
              className="num"
              style={{ color: 'var(--ink)', fontWeight: 450 }}
            >
              {seg.value}
            </b>
          );
        }
        return <span key={idx}>{seg.value}</span>;
      })}
    </li>
  );
}
