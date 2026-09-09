/**
 * Landlord Preferences — Settings section 3.
 *
 * Three toggles + a contact-hours picker. There is no backing store yet:
 * the `user.notification_preferences` JSONB column has not landed, so
 * these controls cannot round-trip to the server. Rather than fake a
 * "Saved" badge, we render the current defaults as a disabled, read-only
 * state and say plainly that saving is not connected. When the column
 * lands, re-enable the controls and wire an onChange server action.
 */

interface Preferences {
  callForEmergencies: boolean;
  textForHighValueWorkOrders: boolean;
  draftLateFeeNotices: boolean;
  contactHoursFrom: string;
  contactHoursTo: string;
}

const DEFAULT_PREFS: Preferences = {
  callForEmergencies: true,
  textForHighValueWorkOrders: false,
  draftLateFeeNotices: false,
  contactHoursFrom: '09:00',
  contactHoursTo: '18:00',
};

export function PreferencesCard() {
  const prefs = DEFAULT_PREFS;

  return (
    <section
      data-testid="settings-preferences-section"
      className="flex flex-col gap-0"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa)',
        overflow: 'hidden',
      }}
    >
      <PreferenceToggle
        testId="settings-pref-emergencies"
        label="Call me for emergencies"
        description="Odesa flags emergency evidence for immediate attention. No vendor dispatch, access promise, or cost commitment is made without owner confirmation."
        value={prefs.callForEmergencies}
      />

      <PreferenceToggle
        testId="settings-pref-high-value-wos"
        label="Text me for work orders over $500"
        description="A proposed vendor commitment over $500 stays in Owner Queue and can be surfaced for your review."
        value={prefs.textForHighValueWorkOrders}
      />

      <PreferenceToggle
        testId="settings-pref-auto-late-fees"
        label="Draft late-fee notices"
        description="Odesa can draft late-fee notices for owner review after the grace period. No charge or tenant-facing message is sent without approval."
        value={prefs.draftLateFeeNotices}
      />

      <div
        data-testid="settings-pref-contact-hours"
        className="flex flex-col gap-2"
        style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--ink-200)',
        }}
      >
        <div className="flex flex-col gap-1">
          <p
            style={{
              fontSize: '14px',
              lineHeight: 1.4,
              color: 'var(--ink-800)',
            }}
          >
            Contact hours
          </p>
          <p
            style={{
              fontSize: '13px',
              lineHeight: 1.5,
              color: 'var(--ink-600)',
            }}
          >
            This shapes when we ping you for non-emergency approvals — within
            your configured hours.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TimePill
            testId="settings-pref-contact-from"
            label="From"
            value={prefs.contactHoursFrom}
          />
          <span
            className="meta-label"
            style={{ color: 'var(--ink-500)', textTransform: 'none' }}
          >
            to
          </span>
          <TimePill
            testId="settings-pref-contact-to"
            label="To"
            value={prefs.contactHoursTo}
          />
        </div>
      </div>

      <p
        data-testid="settings-pref-not-connected"
        style={{
          padding: '14px 24px',
          fontSize: '13px',
          lineHeight: 1.5,
          color: 'var(--ink-500)',
        }}
      >
        Preference saving is not connected yet.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Internal primitives
// ---------------------------------------------------------------------------

interface PreferenceToggleProps {
  testId: string;
  label: string;
  description: string;
  value: boolean;
}

function PreferenceToggle({
  testId,
  label,
  description,
  value,
}: PreferenceToggleProps) {
  return (
    <div
      data-testid={`${testId}-row`}
      className="flex flex-col gap-2"
      style={{
        padding: '20px 24px',
        borderBottom: '1px solid var(--ink-200)',
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p
            style={{
              fontSize: '14px',
              lineHeight: 1.4,
              color: 'var(--ink-800)',
            }}
          >
            {label}
          </p>
          <p
            style={{
              fontSize: '13px',
              lineHeight: 1.5,
              color: 'var(--ink-600)',
              maxWidth: '50ch',
            }}
          >
            {description}
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={value}
          disabled
          data-testid={testId}
          data-state={value ? 'on' : 'off'}
          className="relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full cursor-not-allowed"
          style={{
            background: value ? 'var(--navy-700)' : 'var(--paper-300)',
            opacity: 0.55,
          }}
        >
          <span className="sr-only">{label}</span>
          <span
            aria-hidden
            className="inline-block size-5 rounded-full bg-white shadow-sm"
            style={{
              transform: value ? 'translateX(22px)' : 'translateX(2px)',
            }}
          />
        </button>
      </div>
    </div>
  );
}

interface TimePillProps {
  testId: string;
  label: string;
  value: string;
}

function TimePill({ testId, label, value }: TimePillProps) {
  return (
    <label
      className="inline-flex items-center gap-2 rounded-md px-3 py-1.5"
      style={{
        background: 'var(--paper-50)',
        border: '1px solid var(--ink-200)',
        opacity: 0.7,
      }}
    >
      <span
        className="meta-label"
        style={{ color: 'var(--ink-500)', textTransform: 'none' }}
      >
        {label}
      </span>
      <input
        data-testid={testId}
        type="time"
        value={value}
        readOnly
        disabled
        className="tabular-nums cursor-not-allowed"
        style={{
          background: 'transparent',
          border: 'none',
          outline: 'none',
          fontFamily:
            "var(--font-mono-metrics), 'JetBrains Mono', monospace",
          fontSize: '13px',
          color: 'var(--ink-800)',
        }}
      />
    </label>
  );
}
