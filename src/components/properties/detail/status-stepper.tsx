/**
 * StatusStepper — horizontal status stepper with separators.
 *
 * Mirrors the mockup's `.stepper` / `.step` / `.step-sep` / `.sc` pattern.
 * The entire stepper is role="img" with an aria-label summarising the current
 * step (e.g. "Status: Accepted"). Dots (.sc) and separators are aria-hidden.
 *
 * Step states:
 *   done    — green dot, muted ink-2 label
 *   current — amber dot with ring, ink bold label
 *   todo    — hairline-strong dot, ink-4 muted label
 */

import type { CSSProperties } from 'react';
import type { StepperStep } from '@/lib/properties/mock-detail';

export interface StatusStepperProps {
  steps: StepperStep[];
  /** Full accessible description, e.g. "Status: Accepted". */
  ariaLabel: string;
}

const stepperStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '9px 0',
};

const sepStyle: CSSProperties = {
  width: '22px',
  height: '1px',
  background: 'var(--hairline)',
  margin: '0 10px',
};

const DOT_STYLE: Record<StepperStep['state'], CSSProperties> = {
  done: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: 'var(--green)',
  },
  current: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: 'var(--amber)',
    boxShadow: '0 0 0 3px var(--amber-bg)',
  },
  todo: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: 'var(--hairline-strong)',
  },
};

const STEP_LABEL_COLOR: Record<StepperStep['state'], string> = {
  done: 'var(--ink-2)',
  current: 'var(--ink)',
  todo: 'var(--ink-4)',
};

export function StatusStepper({ steps, ariaLabel }: StatusStepperProps) {
  return (
    <div style={stepperStyle} role="img" aria-label={ariaLabel}>
      {steps.map((step, i) => {
        const stepStyle: CSSProperties = {
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          fontFamily: 'var(--font-mono-operator)',
          fontSize: '10px',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: STEP_LABEL_COLOR[step.state],
          fontWeight: step.state === 'current' ? 500 : undefined,
        };

        return (
          <span key={step.label} style={{ display: 'contents' }}>
            {i > 0 && <span style={sepStyle} aria-hidden="true" />}
            <span style={stepStyle}>
              <span style={DOT_STYLE[step.state]} aria-hidden="true" />
              {step.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}
