import { HandlingCell } from './handling-cell';

/**
 * Dark Odesa operations snapshot panel.
 *
 * Server component. Renders the full-width dark strip beneath the queue:
 * an eyebrow strip at the top, then a 4-cell grid of HandlingCell.
 *
 * CRITICAL: a radial terracotta wash is layered as a positioned overlay
 * (the JSX equivalent of `::before`) — `background: radial-gradient(ellipse
 * 600px 240px at 0% 0%, rgba(216, 130, 95, 0.06), transparent 70%)`. The
 * panel reads as a footer without it; see ref-load-bearing-details.
 */

export interface HandlingCellData {
  key: string;
  eyebrow: string;
  bigNumber: string;
  label: string;
  detail: string;
  statusNote?: string;
}

export function OdesaHandlingPanel({
  cells,
  title = 'ODESA OPERATIONS SNAPSHOT',
  statusText,
}: {
  cells: readonly HandlingCellData[];
  title?: string;
  statusText?: string;
}) {
  return (
    <section
      data-section="handling"
      className="today-handling-panel"
      style={{
        position: 'relative',
        isolation: 'isolate',
        background: 'var(--dark)',
        color: 'var(--dark-text)',
        padding: '18px 22px 22px',
        overflow: 'hidden',
        fontFamily: 'var(--font-sans-operator)',
      }}
    >
      {/* radial terracotta wash — the load-bearing detail. Without this the
          dark panel reads as a footer. Positioned overlay equivalent of the
          mockup's ::before pseudo. Pointer-events disabled so it never
          intercepts clicks; sits behind content via z-index. */}
      <div
        data-radial-wash="true"
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 600px 240px at 0% 0%, rgba(216, 130, 95, 0.06), transparent 70%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* eyebrow strip */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          paddingBottom: '14px',
          borderBottom: '1px solid var(--dark-line)',
          marginBottom: '14px',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: 'var(--font-sans-operator)',
            fontSize: '10.5px',
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--dark-text)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '999px',
              background: 'var(--dark-terracotta)',
            }}
          />
          {title}
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontFamily: 'var(--font-sans-operator)',
            fontSize: '10.5px',
            fontWeight: 500,
            letterSpacing: '0.06em',
            color: 'var(--dark-text-2)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '999px',
              background: 'var(--dark-text-2)',
            }}
          />
          {statusText ?? (
            <>
              <span
                className="num"
                style={{ fontVariantNumeric: 'tabular-nums lining-nums' }}
              >
                {cells.length}
              </span>
              &nbsp;current record groups
            </>
          )}
        </span>
      </div>

      {/* 4-cell grid. Hairlines come from a 1px gap on a dark-line background. */}
      <div
        className="today-handling-grid"
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(cells.length, 1)}, 1fr)`,
          gap: '1px',
          background: 'var(--dark-line)',
          border: '1px solid var(--dark-line)',
        }}
      >
        {cells.map((cell) => (
          <HandlingCell
            key={cell.key}
            cellKey={cell.key}
            eyebrow={cell.eyebrow}
            bigNumber={cell.bigNumber}
            label={cell.label}
            detail={cell.detail}
            statusNote={cell.statusNote}
          />
        ))}
      </div>
    </section>
  );
}
