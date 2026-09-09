import type { ReactElement, ReactNode } from 'react';

export function RegisterSummary({
  values,
}: {
  values: ReadonlyArray<{ label: string; value: string }>;
}): ReactElement {
  return (
    <dl className="accounting-route-summary">
      {values.map((value) => (
        <div key={value.label}>
          <dt>{value.label}</dt>
          <dd>{value.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RegisterPagination({
  from,
  to,
  total,
  previousHref,
  nextHref,
}: {
  from: number;
  to: number;
  total: number;
  previousHref: string | null;
  nextHref: string | null;
}): ReactElement {
  return (
    <nav className="accounting-pagination" aria-label="Register pages">
      <span>
        {from}–{to} of {total}
      </span>
      <div>
        {previousHref ? <a href={previousHref}>← Previous</a> : <span>← Previous</span>}
        {nextHref ? <a href={nextHref}>Next →</a> : <span>Next →</span>}
      </div>
    </nav>
  );
}

export function RegisterBoundary({ children }: { children: ReactNode }) {
  return <aside className="accounting-route-boundary">{children}</aside>;
}

export const ACCOUNTING_REGISTER_CSS = `
  .accounting-route-register {
    --ar-ink: #241f19;
    --ar-muted: #796d60;
    --ar-border: #ded3bf;
    --ar-soft: #ebe3d4;
    --ar-panel: #fffdf8;
    --ar-lift: #f8f3e8;
    display: grid;
    gap: 14px;
    color: var(--ar-ink);
    font-family: var(--font-sans-operator), 'IBM Plex Sans', sans-serif;
  }
  .accounting-route-summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin: 0;
    border: 1px solid var(--ar-border);
    border-radius: 10px;
    background: var(--ar-panel);
    overflow: hidden;
  }
  .accounting-route-summary > div { padding: 14px 15px; border-left: 1px solid var(--ar-soft); }
  .accounting-route-summary > div:first-child { border-left: 0; }
  .accounting-route-summary dt, .accounting-route-filters label > span, .accounting-route-sheet header span, .accounting-route-dossier dt {
    color: var(--ar-muted);
    font: 9.5px var(--font-mono-operator), 'IBM Plex Mono', monospace;
    letter-spacing: .1em;
    text-transform: uppercase;
  }
  .accounting-route-summary dd { margin: 5px 0 0; font: 500 14px var(--font-mono-operator), monospace; font-variant-numeric: tabular-nums; }
  .accounting-route-filters {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
    gap: 8px;
    align-items: end;
    padding: 10px;
    border: 1px solid var(--ar-border);
    border-radius: 10px;
    background: var(--ar-panel);
  }
  .accounting-route-filters form { display: flex; gap: 5px; align-items: end; min-width: 0; }
  .accounting-route-filters label { display: grid; gap: 4px; min-width: 0; width: 100%; }
  .accounting-route-filters input, .accounting-route-filters select {
    width: 100%; height: 34px; border: 1px solid var(--ar-border); border-radius: 6px;
    background: #fffefa; padding: 0 8px; color: var(--ar-ink); font-size: 12px;
  }
  .accounting-route-filters button, .accounting-route-export {
    min-height: 34px; border: 1px solid var(--ar-border); border-radius: 6px;
    padding: 8px 10px; background: var(--ar-lift); color: var(--ar-ink);
    font-size: 11px; font-weight: 550; text-decoration: none; white-space: nowrap;
  }
  .accounting-route-export { background: #172b4d; border-color: #172b4d; color: #fffdf8; }
  .accounting-route-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
  .accounting-route-tabs a {
    border: 1px solid var(--ar-border); border-radius: 999px; padding: 6px 10px;
    background: var(--ar-panel); color: #675b4e; font-size: 11px; text-decoration: none;
  }
  .accounting-route-tabs a[aria-current='page'] { background: #29251f; border-color: #29251f; color: #fffdf8; }
  .accounting-route-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start; }
  .accounting-route-layout.has-selection { grid-template-columns: minmax(0, 1.7fr) minmax(280px, .8fr); }
  .accounting-route-sheet, .accounting-route-dossier {
    min-width: 0; border: 1px solid var(--ar-border); border-radius: 10px;
    background: var(--ar-panel); overflow: hidden;
  }
  .accounting-route-sheet > header {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    padding: 13px 15px; border-bottom: 1px solid var(--ar-soft); background: var(--ar-lift);
  }
  .accounting-route-sheet h2 { margin: 3px 0 0; font-size: 16px; font-weight: 600; }
  .accounting-route-sheet header > strong { color: var(--ar-muted); font: 10.5px var(--font-mono-operator), monospace; }
  .accounting-route-table-wrap { overflow-x: auto; }
  .accounting-route-table { width: 100%; min-width: 820px; border-collapse: collapse; }
  .accounting-route-table th, .accounting-route-table td { padding: 11px 12px; border-top: 1px solid var(--ar-soft); font-size: 11.5px; text-align: left; }
  .accounting-route-table thead th { border-top: 0; color: var(--ar-muted); font: 9px var(--font-mono-operator), monospace; letter-spacing: .08em; text-transform: uppercase; }
  .accounting-route-table tbody th { font-size: 12.5px; font-weight: 600; }
  .accounting-route-table .numeric { text-align: right; font-family: var(--font-mono-operator), monospace; font-variant-numeric: tabular-nums; }
  .accounting-route-table a { color: inherit; text-decoration: none; }
  .accounting-route-table tr[data-selected='true'] { background: #fbf6eb; }
  .accounting-route-secondary { display: block; margin-top: 2px; color: var(--ar-muted); font-size: 10.5px; font-weight: 400; }
  .accounting-route-empty { margin: 0; padding: 24px 15px; color: var(--ar-muted); font-size: 12px; }
  .accounting-route-dossier { align-self: start; position: sticky; top: 12px; padding: 16px; }
  .accounting-route-dossier h2 { margin: 4px 0 6px; font-size: 16px; }
  .accounting-route-dossier > p { color: var(--ar-muted); font-size: 11.5px; line-height: 1.5; }
  .accounting-route-dossier dl { display: grid; gap: 0; margin: 14px 0; border: 1px solid var(--ar-soft); border-radius: 7px; overflow: hidden; }
  .accounting-route-dossier dl > div { display: grid; grid-template-columns: .8fr 1.2fr; gap: 9px; padding: 9px; border-top: 1px solid var(--ar-soft); }
  .accounting-route-dossier dl > div:first-child { border-top: 0; }
  .accounting-route-dossier dd { margin: 0; font-size: 11.5px; overflow-wrap: anywhere; }
  .accounting-route-dossier > a { color: #1b3a6b; font-size: 11.5px; text-decoration: none; }
  .accounting-route-dossier > .accounting-route-dossier-close {
    display: block; margin: 0 0 10px auto; width: fit-content;
  }
  .accounting-route-dossier-backdrop {
    position: fixed; inset: 0; z-index: 80; display: flex; align-items: end;
    background: rgba(34, 28, 21, .32);
  }
  .accounting-route-dossier.accounting-route-dossier-sheet {
    position: static; width: 100%; max-height: min(86dvh, 760px); overflow-y: auto;
    border-radius: 16px 16px 0 0; box-shadow: 0 -16px 42px rgba(34, 28, 21, .2);
  }
  .accounting-pagination { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 12px; border-top: 1px solid var(--ar-soft); color: var(--ar-muted); font: 10.5px var(--font-mono-operator), monospace; }
  .accounting-pagination > div { display: flex; gap: 12px; }
  .accounting-pagination a { color: #1b3a6b; text-decoration: none; }
  .accounting-pagination div > span { opacity: .45; }
  .accounting-route-boundary { padding: 11px 13px; border: 1px solid var(--ar-soft); border-radius: 8px; background: var(--ar-lift); color: var(--ar-muted); font-size: 11.5px; line-height: 1.5; }
  .accounting-route-boundary strong { color: var(--ar-ink); }
  @media (max-width: 860px) {
    .accounting-route-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .accounting-route-summary > div:nth-child(3) { border-left: 0; border-top: 1px solid var(--ar-soft); }
    .accounting-route-summary > div:nth-child(4) { border-top: 1px solid var(--ar-soft); }
    .accounting-route-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .accounting-route-layout.has-selection { grid-template-columns: minmax(0, 1fr); }
    .accounting-route-dossier { position: static; }
  }
  @media (max-width: 560px) {
    .accounting-route-filters { grid-template-columns: minmax(0, 1fr); }
    .accounting-route-filters form { display: grid; grid-template-columns: minmax(0, 1fr) auto; }
    .accounting-route-export { text-align: center; }
  }
`;
