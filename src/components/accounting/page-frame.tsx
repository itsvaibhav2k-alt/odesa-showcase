import type { ReactElement, ReactNode } from 'react';

export function AccountantPageFrame({
  eyebrow,
  title,
  subtitle,
  periodLabel,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  periodLabel?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className="accountant-page-frame"
      data-testid="accountant-page"
      data-persona="accountant"
    >
      <header className="accountant-page-header">
        <div className="accountant-page-title-copy">
          <div className="accountant-page-identity">
            <span>Accountant</span>
            <span aria-hidden>·</span>
            <span>{eyebrow}</span>
          </div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="accountant-page-status">
          {periodLabel ? <strong>{periodLabel}</strong> : null}
          <span>
            <i aria-hidden />
            Read-only evidence
          </span>
        </div>
      </header>
      <div className="accountant-page-content">{children}</div>
      <style>{PAGE_FRAME_CSS}</style>
    </div>
  );
}

const PAGE_FRAME_CSS = `
  .accountant-page-frame {
    --accountant-paper: #f7f1e5;
    --accountant-cream: #fffdf8;
    --accountant-ink: #211d18;
    --accountant-muted: #776b5e;
    --accountant-border: #ded3bf;
    min-height: 100%;
    padding: 22px clamp(14px, 2.5vw, 30px) 34px;
    background:
      radial-gradient(circle at 92% 2%, rgba(185, 119, 80, .07), transparent 28%),
      var(--accountant-paper);
    color: var(--accountant-ink);
    font-family: var(--font-sans-operator), 'IBM Plex Sans', sans-serif;
  }
  .accountant-page-header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 22px;
    max-width: 1320px;
    margin: 0 auto 17px;
    padding: 0 1px 14px;
    border-bottom: 1px solid var(--accountant-border);
  }
  .accountant-page-title-copy { min-width: 0; }
  .accountant-page-identity {
    display: flex;
    gap: 7px;
    align-items: center;
    color: #9a5d43;
    font: 600 9.5px var(--font-mono-operator), 'IBM Plex Mono', monospace;
    letter-spacing: .13em;
    text-transform: uppercase;
  }
  .accountant-page-header h1 {
    margin: 5px 0 2px;
    font: 500 clamp(27px, 3vw, 38px)/1.05 var(--font-serif-display), 'Instrument Serif', Georgia, serif;
    letter-spacing: -.018em;
  }
  .accountant-page-header p {
    max-width: 720px;
    margin: 0;
    color: var(--accountant-muted);
    font-size: 12px;
    line-height: 1.45;
  }
  .accountant-page-status {
    display: grid;
    justify-items: end;
    gap: 7px;
    flex: none;
  }
  .accountant-page-status strong {
    color: var(--accountant-ink);
    font: 500 11px var(--font-mono-operator), 'IBM Plex Mono', monospace;
  }
  .accountant-page-status span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--accountant-border);
    border-radius: 999px;
    padding: 5px 8px;
    background: rgba(255, 253, 248, .76);
    color: var(--accountant-muted);
    font: 500 9.5px var(--font-mono-operator), 'IBM Plex Mono', monospace;
    letter-spacing: .04em;
  }
  .accountant-page-status i {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: #62805f;
    box-shadow: 0 0 0 2px rgba(98, 128, 95, .12);
  }
  .accountant-page-content { max-width: 1320px; margin: 0 auto; }
  @media (max-width: 680px) {
    .accountant-page-frame { padding-inline: 10px; padding-top: 15px; }
    .accountant-page-header { align-items: start; gap: 12px; }
    .accountant-page-status strong { display: none; }
    .accountant-page-status span { font-size: 0; padding: 6px; }
    .accountant-page-status i { width: 7px; height: 7px; }
    .accountant-page-header h1 { font-size: 29px; }
  }
`;
