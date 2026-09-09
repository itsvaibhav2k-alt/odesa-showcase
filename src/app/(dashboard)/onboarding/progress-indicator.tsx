/**
 * Six-dot progress indicator for the onboarding flow. Server component —
 * renders from the current step index passed in by each step page.
 *
 * Steps: Property → Unit → Tenant → Lease → Messaging → Verify.
 */

interface Props {
  step: 1 | 2 | 3 | 4 | 5 | 6;
}

const LABELS = [
  'Property',
  'Unit',
  'Tenant',
  'Lease',
  'Messaging',
  'Verify',
] as const;

export function OnboardingProgressIndicator({ step }: Props) {
  return (
    <div
      className='mb-6 flex items-center justify-between gap-1 sm:gap-2'
      data-testid='onboarding-progress'
      aria-label={`Step ${step} of ${LABELS.length}: ${LABELS[step - 1]}`}
    >
      {LABELS.map((label, idx) => {
        const stepNumber = idx + 1;
        const isActive = stepNumber === step;
        const isComplete = stepNumber < step;
        return (
          <div
            key={label}
            className='flex flex-1 flex-col items-center gap-1'
            data-testid={`onboarding-progress-step-${stepNumber}`}
            data-state={
              isActive ? 'active' : isComplete ? 'complete' : 'upcoming'
            }
          >
            <div
              className={[
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : isComplete
                    ? 'bg-[var(--color-odesa-accent-secondary)] text-[var(--color-odesa-text-primary)]'
                    : 'bg-muted text-muted-foreground',
              ].join(' ')}
            >
              {stepNumber}
            </div>
            <span
              className={[
                'text-[0.65rem] sm:text-[0.7rem] uppercase tracking-wider',
                isActive ? 'text-foreground' : 'text-muted-foreground',
              ].join(' ')}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
