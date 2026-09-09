/**
 * TestCallsPageBody — `/calls/test`. Safe, local test-call scenarios. Running
 * one builds the same honest artifacts a real call would (a voice_calls row +
 * conversation + message, all RLS-scoped) and navigates to the dossier — with
 * NO external provider contact. The three scenarios exercise the distinct
 * derived states: clean resolved, needs-review, and privacy-safe unknown caller.
 */

import type { CSSProperties } from 'react';

import { TestCallButton } from './test-call-button';
import {
  sectionHeadStyle,
  sectionTitleStyle,
  sectionMetaStyle,
  emptyStyle,
  emptyCodeHintStyle,
} from './calls-styles';

export interface TestCallsPageBodyProps {
  retellConnected: boolean;
}

const scenarioGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 12,
  marginTop: 16,
};

const scenarioCardStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 14,
  background: 'var(--panel-lift)',
  padding: '14px 15px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const scenarioTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontSize: '15px',
  fontWeight: 400,
  color: 'var(--ink)',
  margin: 0,
};

const scenarioExpectStyle: CSSProperties = {
  fontSize: '12.5px',
  lineHeight: 1.5,
  color: 'var(--ink-2)',
  margin: 0,
  flex: 1,
};

export function TestCallsPageBody({ retellConnected }: TestCallsPageBodyProps) {
  return (
    <div data-testid="calls-test-page">
      <section data-testid="calls-test-call">
        <div style={sectionHeadStyle}>
          <h2 style={sectionTitleStyle}>Test call</h2>
          <span style={sectionMetaStyle}>Safe local proof</span>
        </div>
        <div style={emptyStyle}>
          <p>
            Generate a safe test call to verify the Voice Operator system. This creates a realistic
            local call artifact — a dossier with a transcript, outcome, and any records — and opens
            it. No external provider is contacted; no tenant, vendor, or owner is called or texted.
          </p>
          <div style={scenarioGridStyle}>
            <div style={scenarioCardStyle}>
              <h3 style={scenarioTitleStyle}>Maintenance resolved</h3>
              <p style={scenarioExpectStyle}>
                A verified tenant reports a sink leak; Odesa opens a work order and closes the call
                clean.
              </p>
              <TestCallButton />
            </div>
            <div style={scenarioCardStyle}>
              <h3 style={scenarioTitleStyle}>Payment dispute — needs review</h3>
              <p style={scenarioExpectStyle}>
                A tenant claims rent was paid but the ledger disagrees; Odesa records it for your
                review without touching the balance.
              </p>
              <TestCallButton
                scenario="payment_dispute_review"
                label="Run test call"
                testId="test-call-button-dispute"
              />
            </div>
            <div style={scenarioCardStyle}>
              <h3 style={scenarioTitleStyle}>Unknown caller — privacy-safe</h3>
              <p style={scenarioExpectStyle}>
                An unidentified caller asks about a unit; Odesa discloses nothing and takes a
                message.
              </p>
              <TestCallButton
                scenario="unknown_caller_privacy"
                label="Run test call"
                testId="test-call-button-unknown"
              />
            </div>
          </div>
          <div style={emptyCodeHintStyle}>
            Local simulation only.{' '}
            {retellConnected
              ? 'A phone number is saved, but that does not prove carrier or webhook readiness.'
              : 'No Retell phone number is configured, and these scenarios do not require one.'}
          </div>
        </div>
      </section>
    </div>
  );
}
