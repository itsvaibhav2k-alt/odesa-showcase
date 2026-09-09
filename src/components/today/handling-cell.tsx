/**
 * One cell of the dark "Odesa is handling — quietly" grid.
 *
 * Server component. Renders an eyebrow (uppercase tracked), a large serif
 * number with a small sans label after it, and a quiet detail line at the
 * bottom — with an optional, even quieter status note beneath it. The number
 * carries the `.num` class for tabular figures — the dark panel's serif
 * display would otherwise read proportional.
 */

interface HandlingCellProps {
  cellKey: string;
  eyebrow: string;
  bigNumber: string;
  label: string;
  detail: string;
  statusNote?: string;
}

export function HandlingCell({
  cellKey,
  eyebrow,
  bigNumber,
  label,
  detail,
  statusNote,
}: HandlingCellProps) {
  return (
    <div
      data-handling-cell={cellKey}
      style={{
        position: 'relative',
        background: 'var(--dark-lift)',
        padding: '18px 20px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        minHeight: '128px',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-sans-operator)',
          fontSize: '10.5px',
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--dark-text-2)',
        }}
      >
        {eyebrow}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '10px',
        }}
      >
        <span
          className="num"
          style={{
            fontFamily: 'var(--font-serif-display)',
            fontSize: '34px',
            lineHeight: 1,
            color: 'var(--dark-text)',
            fontFeatureSettings: "'tnum' 1, 'lnum' 1",
            fontVariantNumeric: 'tabular-nums lining-nums',
          }}
        >
          {bigNumber}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-sans-operator)',
            fontSize: '12px',
            color: 'var(--dark-text-2)',
            letterSpacing: '0.01em',
          }}
        >
          {label}
        </span>
      </div>

      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '3px',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-sans-operator)',
            fontSize: '11.5px',
            color: 'var(--dark-text-3)',
            lineHeight: 1.5,
          }}
        >
          {detail}
        </div>

        {statusNote ? (
          <div
            style={{
              fontFamily: 'var(--font-sans-operator)',
              fontSize: '10.5px',
              color: 'var(--dark-text-2)',
              lineHeight: 1.45,
            }}
          >
            {statusNote}
          </div>
        ) : null}
      </div>
    </div>
  );
}
