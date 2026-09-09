import type { ReactNode } from 'react';

/**
 * Today v2 page shell.
 *
 * Server component. Provides the `.today-theme` token scope and the two-column
 * grid (sticky left sidebar slot + main content slot) per the mockup shell.
 *
 * Composition is the team lead's job — agents only build their slice. The lead
 * wires `<TodayTopbar>`, `<TodayBriefing>`, the queue, the rail, the handling
 * panel, and the AskOdesa command into the `children` slot of this shell from
 * `src/app/(dashboard)/today/page.tsx`.
 *
 * The `sidebar` slot is left open so the existing app sidebar (or a v2 port of
 * it) can be passed in later. For PR-2 it is unused — pages may render only the
 * main content while real navigation lands in a future PR.
 */
interface TodayPageShellProps {
  children: ReactNode;
  sidebar?: ReactNode;
}

export function TodayPageShell({ children, sidebar }: TodayPageShellProps) {
  const baseStyle = {
    background: 'var(--canvas)',
    color: 'var(--ink)',
    fontSize: '13px',
    lineHeight: 1.5,
    minHeight: '100vh',
  } as const;

  if (!sidebar) {
    return (
      <div
        data-testid="today-page"
        data-theme="today"
        className="today-theme"
        style={baseStyle}
      >
        <main
          data-section="main"
          className="today-page-main"
          style={{ padding: '22px 36px 56px', minWidth: 0 }}
        >
          {children}
        </main>
      </div>
    );
  }

  return (
    <div
      data-theme="today"
      className="today-theme"
      style={{
        ...baseStyle,
        display: 'grid',
        gridTemplateColumns: '224px 1fr',
        maxWidth: '1440px',
        margin: '0 auto',
      }}
    >
      <aside
        data-section="sidebar-slot"
        style={{
          borderRight: '1px solid var(--hairline)',
          background: 'var(--canvas)',
          position: 'sticky',
          top: 0,
          height: '100vh',
          padding: '22px 16px 18px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {sidebar}
      </aside>

      <main
        data-section="main"
        className="today-page-main"
        style={{
          padding: '22px 36px 56px',
          minWidth: 0,
        }}
      >
        {children}
      </main>
    </div>
  );
}
