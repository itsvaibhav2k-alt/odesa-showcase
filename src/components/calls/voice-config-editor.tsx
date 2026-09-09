'use client';

/**
 * VoiceConfigEditor — the write half of the /calls Voice configuration
 * surface. Two independent cards (Connection, Organization knowledge) that
 * each save ONLY their own fields via the `updateVoiceSettings` server action,
 * so one card can never clobber the other.
 *
 * Deliberately minimal (plan amendment 7): this proves the product loop — it
 * is NOT a full admin system. No field-level history, no autosave, no
 * multi-user conflict UX. Visuals share the warm-paper tokens used across the
 * calls section (see calls-styles.ts).
 *
 * HMAC is shown read-only: enforcement is env-derived (RETELL_WEBHOOK_SECRET),
 * so a toggle here would claim control the UI does not have. `hmacStatus` is a
 * server-derived string; this component never writes it.
 *
 * VoiceSettings is imported TYPE-ONLY — settings.ts is server code and must
 * never be pulled into a client bundle at runtime.
 */

import { useState, useTransition } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { updateVoiceSettings } from '@/app/(dashboard)/calls/actions';
import type { VoiceSettings } from '@/lib/voice/settings';

export interface VoiceConfigEditorProps {
  settings: VoiceSettings;
  hmacStatus: string;
}

// --- shared styles (warm-paper tokens used across the calls section) ---------

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 12,
};

const panelStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 14,
  background: 'var(--panel-lift)',
  padding: '15px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const eyebrowStyle: CSSProperties = {
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontSize: '16px',
  fontWeight: 400,
  color: 'var(--ink)',
  margin: '2px 0 0',
};

const fieldLabelStyle: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: 5,
};

const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--hairline)',
  borderRadius: 10,
  background: 'var(--panel-clean)',
  padding: '8px 10px',
  fontSize: '13px',
  lineHeight: 1.45,
  color: 'var(--ink)',
  fontFamily: 'inherit',
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 78,
  resize: 'vertical',
};

const checkRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: '12.5px',
  color: 'var(--ink-2)',
  lineHeight: 1.4,
  cursor: 'pointer',
};

const checkboxStyle: CSSProperties = {
  accentColor: 'var(--terracotta)',
  width: 15,
  height: 15,
  flexShrink: 0,
};

const readonlyRowStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 10,
  background: 'rgba(62, 45, 32, 0.03)',
  padding: '9px 11px',
};

const mutedStyle: CSSProperties = {
  color: 'var(--ink-3)',
  fontSize: '11.5px',
  lineHeight: 1.45,
  margin: '4px 0 0',
};

const footerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginTop: 2,
};

const saveButtonStyle: CSSProperties = {
  background: 'var(--green-bg)',
  color: 'var(--green-ink)',
  border: '1px solid var(--green-border)',
  borderRadius: 10,
  padding: '9px 15px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const saveButtonDisabledStyle: CSSProperties = {
  ...saveButtonStyle,
  opacity: 0.5,
  cursor: 'not-allowed',
};

const savedStyle: CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--green-ink)',
};

const errorStyle: CSSProperties = {
  marginTop: 12,
  padding: '9px 12px',
  background: 'var(--clay-bg)',
  color: 'var(--clay-ink)',
  border: '1px solid var(--clay-border)',
  borderRadius: 8,
  fontSize: '12.5px',
  lineHeight: 1.45,
};

const fieldGroupStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

/** Split a textarea into a clean list: one item per line, trimmed, no empties. */
function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function VoiceConfigEditor({ settings, hmacStatus }: VoiceConfigEditorProps) {
  const router = useRouter();

  // Connection card state
  const [phone, setPhone] = useState(settings.retellPhoneNumberE164 ?? '');
  const [agentId, setAgentId] = useState(settings.retellAgentId ?? '');
  const [voiceEnabled, setVoiceEnabled] = useState(settings.voiceEnabled);
  const [liveCallsEnabled, setLiveCallsEnabled] = useState(settings.liveCallsEnabled);
  const [connSaved, setConnSaved] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [connPending, startConn] = useTransition();

  // Organization knowledge card state
  const [role, setRole] = useState(settings.operatorSummary.role);
  const [tone, setTone] = useState(settings.operatorSummary.tone);
  const [includeLease, setIncludeLease] = useState(
    settings.propertyContextPolicy.includeLeaseDetails,
  );
  const [includeMaintenance, setIncludeMaintenance] = useState(
    settings.propertyContextPolicy.includeMaintenanceHistory,
  );
  const [collectText, setCollectText] = useState(settings.informationToCollect.join('\n'));
  const [avoidText, setAvoidText] = useState(settings.topicsToAvoid.join('\n'));
  const [closing, setClosing] = useState(settings.closingGuidance);
  const [knowSaved, setKnowSaved] = useState(false);
  const [knowError, setKnowError] = useState<string | null>(null);
  const [knowPending, startKnow] = useTransition();

  const handleSaveConnection = () => {
    setConnError(null);
    setConnSaved(false);
    const trimmedPhone = phone.trim();
    const trimmedAgent = agentId.trim();
    startConn(async () => {
      const result = await updateVoiceSettings({
        retellPhoneNumberE164: trimmedPhone === '' ? null : trimmedPhone,
        retellAgentId: trimmedAgent === '' ? null : trimmedAgent,
        voiceEnabled,
        liveCallsEnabled,
      });
      if (!result.success) {
        setConnError(result.error);
        return;
      }
      setConnSaved(true);
      router.refresh();
    });
  };

  const handleSaveKnowledge = () => {
    setKnowError(null);
    setKnowSaved(false);
    startKnow(async () => {
      const result = await updateVoiceSettings({
        operatorSummary: { role: role.trim(), tone: tone.trim() },
        propertyContextPolicy: {
          includeLeaseDetails: includeLease,
          includeMaintenanceHistory: includeMaintenance,
        },
        informationToCollect: linesToList(collectText),
        topicsToAvoid: linesToList(avoidText),
        closingGuidance: closing.trim(),
      });
      if (!result.success) {
        setKnowError(result.error);
        return;
      }
      setKnowSaved(true);
      router.refresh();
    });
  };

  // Single error surface (mandated testid is singular): show whichever failed.
  const error = connError ?? knowError;

  return (
    <div data-testid="voice-config-editor">
      <div style={gridStyle}>
        {/* --- Connection card --- */}
        <section style={panelStyle}>
          <div>
            <span style={eyebrowStyle}>Config</span>
            <h3 style={titleStyle}>Connection</h3>
          </div>

          <div style={fieldGroupStyle}>
            <div>
              <label style={fieldLabelStyle} htmlFor="voice-config-phone">
                Retell phone number (E.164)
              </label>
              <input
                id="voice-config-phone"
                type="tel"
                inputMode="tel"
                placeholder="+15715550123"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={connPending}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={fieldLabelStyle} htmlFor="voice-config-agent">
                Retell agent ID
              </label>
              <input
                id="voice-config-agent"
                type="text"
                placeholder="agent_..."
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                disabled={connPending}
                style={inputStyle}
              />
            </div>

            <label style={checkRowStyle}>
              <input
                type="checkbox"
                checked={voiceEnabled}
                onChange={(e) => setVoiceEnabled(e.target.checked)}
                disabled={connPending}
                style={checkboxStyle}
              />
              <span>Voice answering enabled</span>
            </label>

            <label style={checkRowStyle}>
              <input
                type="checkbox"
                checked={liveCallsEnabled}
                onChange={(e) => setLiveCallsEnabled(e.target.checked)}
                disabled={connPending}
                style={checkboxStyle}
              />
              <span>Production call handling requested (configuration only)</span>
            </label>

            <div style={readonlyRowStyle}>
              <span style={fieldLabelStyle}>Webhook signature (HMAC)</span>
              <div style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: 600 }}>
                {hmacStatus}
              </div>
              <p style={mutedStyle}>
                Requires RETELL_API_KEY and RETELL_REQUIRE_SIGNATURE plus this organization setting. Read-only here.
              </p>
            </div>
          </div>

          <div style={footerStyle}>
            <button
              type="button"
              onClick={handleSaveConnection}
              disabled={connPending}
              style={connPending ? saveButtonDisabledStyle : saveButtonStyle}
              data-testid="voice-config-save-connection"
            >
              {connPending ? 'Saving…' : 'Save connection'}
            </button>
            {connSaved && !connPending ? <span style={savedStyle}>Saved</span> : null}
          </div>
        </section>

        {/* --- Organization knowledge card --- */}
        <section style={panelStyle}>
          <div>
            <span style={eyebrowStyle}>Config</span>
            <h3 style={titleStyle}>Organization knowledge</h3>
          </div>

          <div style={fieldGroupStyle}>
            <div>
              <label style={fieldLabelStyle} htmlFor="voice-config-role">
                Operator role
              </label>
              <input
                id="voice-config-role"
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={knowPending}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={fieldLabelStyle} htmlFor="voice-config-tone">
                Tone
              </label>
              <input
                id="voice-config-tone"
                type="text"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                disabled={knowPending}
                style={inputStyle}
              />
            </div>

            <div>
              <span style={fieldLabelStyle}>Property context</span>
              <label style={checkRowStyle}>
                <input
                  type="checkbox"
                  checked={includeLease}
                  onChange={(e) => setIncludeLease(e.target.checked)}
                  disabled={knowPending}
                  style={checkboxStyle}
                />
                <span>Include lease details</span>
              </label>
              <label style={{ ...checkRowStyle, marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={includeMaintenance}
                  onChange={(e) => setIncludeMaintenance(e.target.checked)}
                  disabled={knowPending}
                  style={checkboxStyle}
                />
                <span>Include maintenance history</span>
              </label>
            </div>

            <div>
              <label style={fieldLabelStyle} htmlFor="voice-config-collect">
                Information to collect (one per line)
              </label>
              <textarea
                id="voice-config-collect"
                value={collectText}
                onChange={(e) => setCollectText(e.target.value)}
                disabled={knowPending}
                style={textareaStyle}
              />
            </div>

            <div>
              <label style={fieldLabelStyle} htmlFor="voice-config-avoid">
                Topics to avoid (one per line)
              </label>
              <textarea
                id="voice-config-avoid"
                value={avoidText}
                onChange={(e) => setAvoidText(e.target.value)}
                disabled={knowPending}
                style={textareaStyle}
              />
            </div>

            <div>
              <label style={fieldLabelStyle} htmlFor="voice-config-closing">
                Closing guidance
              </label>
              <textarea
                id="voice-config-closing"
                value={closing}
                onChange={(e) => setClosing(e.target.value)}
                disabled={knowPending}
                style={textareaStyle}
              />
            </div>
          </div>

          <div style={footerStyle}>
            <button
              type="button"
              onClick={handleSaveKnowledge}
              disabled={knowPending}
              style={knowPending ? saveButtonDisabledStyle : saveButtonStyle}
              data-testid="voice-config-save-knowledge"
            >
              {knowPending ? 'Saving…' : 'Save knowledge'}
            </button>
            {knowSaved && !knowPending ? <span style={savedStyle}>Saved</span> : null}
          </div>
        </section>
      </div>

      {error ? (
        <div style={errorStyle} role="alert" data-testid="voice-config-error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
