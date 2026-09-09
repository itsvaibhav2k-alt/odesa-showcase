import { TodayPageShell } from './today-page-shell';
import { TodayTopbar } from './today-topbar';

interface VaEmptyShiftProps {
  dateLabel: string;
}

/** Truthful boundary when no properties are visible in the assistant's scope. */
export function VaEmptyShift({ dateLabel }: VaEmptyShiftProps) {
  return (
    <TodayPageShell>
      <TodayTopbar
        title="My shift"
        dateLabel={dateLabel}
        propertiesCount={0}
        tenantsCount={0}
        checkedAgoLabel="just now"
      />
      <section
        data-testid="va-empty-shift"
        aria-labelledby="va-empty-shift-title"
        style={{
          maxWidth: 720,
          padding: '28px 30px',
          background: 'var(--panel)',
          border: '1px solid var(--hairline)',
          borderRadius: 10,
          boxShadow: '0 10px 28px rgba(67, 51, 31, 0.06)',
        }}
      >
        <p
          className="font-mono"
          style={{
            margin: 0,
            fontFamily: 'var(--font-mono-operator)',
            fontSize: 10,
            letterSpacing: '0.13em',
            color: 'var(--terracotta)',
          }}
        >
          OWNER ACTION REQUIRED
        </p>
        <h2
          id="va-empty-shift-title"
          style={{
            margin: '8px 0 6px',
            fontFamily: 'var(--font-sans-operator)',
            fontSize: 22,
            fontWeight: 600,
            color: 'var(--ink)',
          }}
        >
          No shift queue yet
        </h2>
        <p
          style={{
            margin: 0,
            maxWidth: 590,
            fontFamily: 'var(--font-sans-operator)',
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--ink-2)',
          }}
        >
          Your account has no property records in scope, so there is no work
          queue to triage. An owner needs to assign property access or complete
          portfolio setup before Operations Assistant work can begin.
        </p>
        <p
          style={{
            margin: '16px 0 0',
            paddingTop: 14,
            borderTop: '1px solid var(--hairline-faint)',
            fontFamily: 'var(--font-sans-operator)',
            fontSize: 12,
            color: 'var(--ink-3)',
          }}
        >
          No setup controls are available in the Operations Assistant
          workspace.
        </p>
      </section>
    </TodayPageShell>
  );
}
