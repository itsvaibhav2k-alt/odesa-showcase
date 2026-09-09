'use client';

/**
 * Settings → Integrations — Poke setup instructions card.
 *
 * Static three-step guide for the operator pasting Odesa's MCP URL +
 * key into Poke. Renders below the integration cards on
 * /settings/integrations so the next move after generating a key is
 * obvious without leaving the page.
 *
 * Pure presentation; no hooks, no state.
 */

interface PokeSetupCardProps {
  /** The MCP SSE URL the operator pastes into Poke. */
  mcpUrl: string;
}

export function PokeSetupCard({ mcpUrl }: PokeSetupCardProps) {
  return (
    <section
      data-testid="poke-setup-card"
      aria-labelledby="poke-setup-heading"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa)',
        padding: '28px 32px',
      }}
    >
      <header style={{ marginBottom: '20px' }}>
        <p className="meta-label" style={{ color: 'var(--ink-500)' }}>
          Setup
        </p>
        <h3
          id="poke-setup-heading"
          className="font-serif-display"
          style={{
            fontSize: '20px',
            lineHeight: 1.2,
            letterSpacing: '-0.01em',
            color: 'var(--ink-900)',
            marginTop: '4px',
          }}
        >
          Add Odesa to Poke in three steps.
        </h3>
      </header>

      <ol
        data-testid="poke-setup-steps"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          margin: 0,
          padding: 0,
          listStyle: 'none',
          counterReset: 'poke-step',
        }}
      >
        <Step number={1} title="Open Poke">
          Visit{' '}
          <span
            style={{
              fontFamily: "var(--font-mono-metrics), 'JetBrains Mono', monospace",
              color: 'var(--ink-800)',
            }}
          >
            poke.com
          </span>{' '}
          and sign in.
        </Step>

        <Step number={2} title="Open the integrations panel">
          In Poke, go to{' '}
          <span style={{ color: 'var(--ink-800)' }}>
            Settings → Integrations → Add Custom MCP
          </span>
          .
        </Step>

        <Step number={3} title="Paste the URL and key">
          Use{' '}
          <span
            data-testid="poke-setup-url"
            style={{
              fontFamily: "var(--font-mono-metrics), 'JetBrains Mono', monospace",
              fontSize: '13px',
              color: 'var(--ink-800)',
              wordBreak: 'break-all',
            }}
          >
            {mcpUrl}
          </span>{' '}
          as the URL and the Poke key you generated above as the bearer token.
        </Step>
      </ol>
    </section>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: '16px',
        alignItems: 'flex-start',
      }}
    >
      <div
        aria-hidden
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '999px',
          background: 'var(--paper-200)',
          color: 'var(--ink-700)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '13px',
          fontWeight: 600,
          fontFamily: "var(--font-mono-metrics), 'JetBrains Mono', monospace",
        }}
      >
        {number}
      </div>
      <div>
        <p
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--ink-900)',
            margin: 0,
            marginBottom: '4px',
          }}
        >
          {title}
        </p>
        <p
          style={{
            fontSize: '14px',
            lineHeight: 1.55,
            color: 'var(--ink-600)',
            margin: 0,
            maxWidth: '60ch',
          }}
        >
          {children}
        </p>
      </div>
    </li>
  );
}
