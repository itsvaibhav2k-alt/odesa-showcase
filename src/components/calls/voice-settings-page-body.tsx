/**
 * VoiceSettingsPageBody — `/calls/settings`. The voice connection + operator
 * knowledge editor, an honest "changes don't auto-sync to production calls" label,
 * and the effective agent prompt kept collapsed under advanced settings (off
 * the main overview by design).
 *
 * `hmacStatus` and `effectivePrompt` are derived server-side here from the same
 * signals VoiceReadinessStrip uses (Retell API key + enforcement env + DB flag) — the
 * editor shows HMAC read-only; enforcement is env-driven, never a UI toggle.
 */

import type { CSSProperties } from 'react';
import Link from 'next/link';

import type { VoiceSettings } from '@/lib/voice/settings';
import { buildVoiceAgentPrompt } from '@/lib/voice/agent-prompt';
import { signatureEnforced } from '@/lib/voice/readiness';

import { VoiceConfigEditor } from './voice-config-editor';
import { TextExportActions } from './text-export-actions';
import { sectionHeadStyle, sectionTitleStyle, sectionMetaStyle } from './calls-styles';

export interface VoiceSettingsPageBodyProps {
  voiceSettings: VoiceSettings;
}

const syncNoteStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
  border: '1px solid var(--gold-border, var(--hairline))',
  background: 'rgba(210, 160, 60, 0.08)',
  borderRadius: 12,
  padding: '11px 13px',
  margin: '0 0 18px',
  fontSize: '12.5px',
  lineHeight: 1.5,
  color: 'var(--ink-2)',
  maxWidth: 720,
};

const syncIconStyle: CSSProperties = {
  fontSize: 15,
  lineHeight: 1.2,
  flexShrink: 0,
};

const setupLinkStyle: CSSProperties = {
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  fontSize: '11px',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--terracotta)',
  textDecoration: 'none',
};

const promptDetailsStyle: CSSProperties = {
  marginTop: 20,
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  background: 'var(--panel-lift)',
  padding: '12px 14px',
};

const promptSummaryStyle: CSSProperties = {
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  fontSize: '11px',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  cursor: 'pointer',
};

const promptNoteStyle: CSSProperties = {
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--ink-3)',
  margin: '10px 0 0',
};

const promptPreStyle: CSSProperties = {
  marginTop: 10,
  maxHeight: 320,
  overflowY: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  fontSize: '11.5px',
  lineHeight: 1.5,
  color: 'var(--ink-2)',
  background: 'var(--panel-clean)',
  border: '1px solid var(--hairline)',
  borderRadius: 10,
  padding: '12px 13px',
};

export function VoiceSettingsPageBody({ voiceSettings }: VoiceSettingsPageBodyProps) {
  const requireSignature =
    process.env.RETELL_REQUIRE_SIGNATURE === 'true' ||
    process.env.RETELL_REQUIRE_SIGNATURE === '1';
  const hmacStatus = signatureEnforced({
    retellApiKeyPresent: Boolean(process.env.RETELL_API_KEY),
    requireSignature,
    hmacVerificationEnabled: voiceSettings.hmacVerificationEnabled,
  })
    ? 'HMAC enforcement configured'
    : 'Signature enforcement not fully configured';

  const effectivePrompt = buildVoiceAgentPrompt(voiceSettings);

  return (
    <div data-testid="calls-settings-page">
      <div style={sectionHeadStyle}>
        <h2 style={sectionTitleStyle}>Voice configuration</h2>
        <span style={sectionMetaStyle}>What Odesa knows and may say</span>
      </div>

      <div style={syncNoteStyle} data-testid="voice-settings-sync-note">
        <span aria-hidden="true" style={syncIconStyle}>
          ⚠
        </span>
        <span>
          Changes here are saved to Odesa, but do <strong>not</strong> automatically sync to production
          calls. To apply them, paste the effective agent prompt below into your{' '}
          <Link href="/onboarding/voice" style={setupLinkStyle}>
            Retell agent
          </Link>
          .
        </span>
      </div>

      <VoiceConfigEditor settings={voiceSettings} hmacStatus={hmacStatus} />

      <details style={promptDetailsStyle}>
        <summary style={promptSummaryStyle}>View effective agent prompt</summary>
        <p style={promptNoteStyle}>
          This is what Odesa is configured to say. Paste it into your Retell agent configuration —
          changes here do not sync to production calls automatically.
        </p>
        <pre style={promptPreStyle}>{effectivePrompt}</pre>
        <div style={{ marginTop: 10 }}>
          <TextExportActions
            text={effectivePrompt}
            filename="odesa-agent-prompt.txt"
            idPrefix="agent-prompt"
          />
        </div>
      </details>
    </div>
  );
}
