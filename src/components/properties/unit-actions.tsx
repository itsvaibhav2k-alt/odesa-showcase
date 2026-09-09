'use client';

/**
 * Placeholder action bar at the bottom of the unit-detail page.
 *
 * Phase 2 stops at UI affordance only — each button triggers a small
 * `alert()` noting which phase will wire the underlying flow.
 *
 * Phase 4 (messaging) wires "Send Message". Phase 5 (maintenance) wires
 * "Create Work Order". Phase 6+ wires "Renew Lease". The test hooks
 * are stable so the specs can assert the right copy surfaces today and
 * the real handlers can be swapped in later without renaming selectors.
 */

export function UnitActions() {
  return (
    <section
      data-testid="unit-detail-actions"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        paddingTop: '8px',
      }}
    >
      <ActionButton
        testId="unit-detail-action-send-message"
        label="Send Message"
        phaseMessage="Coming in Phase 4"
      />
      <ActionButton
        testId="unit-detail-action-create-work-order"
        label="Create Work Order"
        phaseMessage="Coming in Phase 4"
      />
      <ActionButton
        testId="unit-detail-action-renew-lease"
        label="Renew Lease"
        phaseMessage="Coming in Phase 4"
      />
    </section>
  );
}

interface ActionButtonProps {
  label: string;
  testId: string;
  phaseMessage: string;
}

function ActionButton({ label, testId, phaseMessage }: ActionButtonProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => {
        if (typeof window !== 'undefined') {
          window.alert(phaseMessage);
        }
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '10px 18px',
        border: '1px solid var(--navy-700)',
        background: 'transparent',
        color: 'var(--navy-700)',
        fontFamily: 'inherit',
        fontSize: '14px',
        fontWeight: 500,
        letterSpacing: '0.01em',
        borderRadius: 'var(--radius-sm-odesa)',
        cursor: 'pointer',
        transition: 'background-color 180ms var(--ease-smooth)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--navy-100)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {label}
    </button>
  );
}
