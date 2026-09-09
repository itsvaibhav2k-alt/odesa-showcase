/**
 * Today v2 briefing orbit motif — now data-driven.
 *
 * Server component. The 6 outer dots map to the six operational channels
 * (cardinal + diagonals); each one's fill darkens as activity accrues
 * (muted → medium → strong). The single channel with the highest count
 * earns the gold "in attention" ring + a subtle CSS pulse defined in
 * `globals.css` under `.today-theme`. When nothing is urgent the orbit
 * renders a calm steady state — all dots muted, no gold ring.
 *
 * Inner satellites and the dashed/solid ring scaffolding are preserved
 * verbatim from the mockup; only the outer dots and the attention ring
 * react to data.
 */
import type { WatchChannel } from '@/types/today';

export interface TodayBriefingOrbitProps {
  /** Items-per-channel; drives outer dot intensity. */
  channelCounts: Record<WatchChannel, number>;
  /** Channel that should wear the gold attention ring + pulse, or null. */
  attentionChannel: WatchChannel | null;
  /** Number under the orbit caption (e.g. portfolio property count). */
  portfolioCount: number;
}

interface OrbitPosition {
  cx: number;
  cy: number;
}

const CHANNEL_POSITIONS: Readonly<Record<WatchChannel, OrbitPosition>> = {
  maintenance: { cx: 90, cy: 20 }, // N
  rent: { cx: 150.6, cy: 55 }, // NE
  vendor: { cx: 150.6, cy: 125 }, // SE
  inbox: { cx: 90, cy: 160 }, // S
  lease: { cx: 29.4, cy: 125 }, // SW
  documents: { cx: 29.4, cy: 55 }, // NW
};

const CHANNEL_ORDER: ReadonlyArray<WatchChannel> = [
  'maintenance',
  'rent',
  'vendor',
  'inbox',
  'lease',
  'documents',
];

/** Fill color tier for an outer dot, given its activity count. */
function fillForCount(count: number): string {
  if (count <= 0) return '#B5A88F'; // var(--ink-4) — muted
  if (count <= 2) return '#56493A'; // var(--ink-2) — medium
  return '#1B1712'; // var(--ink) — strong
}

export function TodayBriefingOrbit({
  channelCounts,
  attentionChannel,
  portfolioCount,
}: TodayBriefingOrbitProps) {
  const attentionPos = attentionChannel
    ? CHANNEL_POSITIONS[attentionChannel]
    : null;

  return (
    <div
      data-orbit="true"
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'flex-start',
        paddingTop: '6px',
      }}
    >
      <svg
        viewBox="0 0 180 180"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ width: '180px', height: '180px', position: 'relative' }}
      >
        {/* outer orbit */}
        <circle
          cx="90"
          cy="90"
          r="70"
          fill="none"
          stroke="#D4C9B5"
          strokeWidth="0.75"
          strokeDasharray="2 4"
        />
        {/* inner orbit */}
        <circle
          cx="90"
          cy="90"
          r="42"
          fill="none"
          stroke="#E0D6BE"
          strokeWidth="0.75"
        />

        {/* center: odesa */}
        <circle cx="90" cy="90" r="6" fill="#B85731" />
        <circle
          cx="90"
          cy="90"
          r="13"
          fill="none"
          stroke="#B85731"
          strokeWidth="0.5"
          opacity="0.35"
        />

        {/* 6 channels around the outer ring — fills track activity */}
        {CHANNEL_ORDER.map((channel) => {
          const pos = CHANNEL_POSITIONS[channel];
          const count = channelCounts[channel] ?? 0;
          return (
            <circle
              key={channel}
              data-orbit-channel={channel}
              data-orbit-count={count}
              cx={pos.cx}
              cy={pos.cy}
              r={count > 0 ? 4 : 3.5}
              fill={fillForCount(count)}
            />
          );
        })}

        {/* attention ring + pulse on the highest-count channel */}
        {attentionPos ? (
          <g data-orbit-attention={attentionChannel}>
            <circle
              cx={attentionPos.cx}
              cy={attentionPos.cy}
              r="6"
              fill="none"
              stroke="#B4842A"
              strokeWidth="1.2"
            />
            <circle
              cx={attentionPos.cx}
              cy={attentionPos.cy}
              r="9"
              fill="none"
              stroke="#B4842A"
              strokeWidth="0.6"
              className="today-orbit-pulse"
            />
          </g>
        ) : null}

        {/* inner ring satellites: tenants/vendors/etc — static for now */}
        <g fill="#87796A">
          <circle cx="132" cy="90" r="2" />
          <circle cx="48" cy="90" r="2" />
          <circle cx="90" cy="48" r="2" />
          <circle cx="90" cy="132" r="2" />
        </g>

        {/* subtle label */}
        <text
          x="90"
          y="178"
          textAnchor="middle"
          fontFamily="IBM Plex Mono, monospace"
          fontSize="8"
          letterSpacing="2"
          fill="#87796A"
        >
          PORTFOLIO · {portfolioCount}
        </text>
      </svg>
    </div>
  );
}
