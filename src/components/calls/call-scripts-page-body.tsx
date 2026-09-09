/**
 * CallScriptsPageBody — `/calls/scripts`. The call-handling playbooks: per
 * call type, Odesa's default behavior and its locked safety boundaries (which
 * mirror the deterministic policy gate), plus an editable owner-guidance field.
 *
 * Owner guidance is additive context only and can never relax a safety
 * boundary — that separation is enforced in the editor and in the agent-prompt
 * assembler, not just in the UI copy.
 */

import type { ScriptOverrides } from '@/lib/voice/scripts';

import { CallScriptsEditor } from './call-scripts-editor';
import { sectionHeadStyle, sectionTitleStyle, sectionMetaStyle, introStyle } from './calls-styles';

export interface CallScriptsPageBodyProps {
  overrides: ScriptOverrides;
}

export function CallScriptsPageBody({ overrides }: CallScriptsPageBodyProps) {
  return (
    <div data-testid="calls-scripts-page">
      <div style={sectionHeadStyle}>
        <h2 style={sectionTitleStyle}>Call handling playbooks</h2>
        <span style={sectionMetaStyle}>Scripts and boundaries</span>
      </div>

      <p style={introStyle}>
        Odesa follows these playbooks on every call. Safety boundaries mirror the policy gate and
        are locked. Add your own guidance to shape tone, follow-ups, and what to collect — it layers
        on top, but can never relax a boundary.
      </p>

      <CallScriptsEditor overrides={overrides} />
    </div>
  );
}
