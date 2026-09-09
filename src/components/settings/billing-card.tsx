/**
 * Billing section — Settings section 4.
 *
 * Billing is not connected. There is no Stripe subscription or invoice
 * data, so the figures below are PREVIEW pricing for each plan tier —
 * not the account's real charges. The card labels them as such, and the
 * plan-change control is disabled until billing is wired. Nothing here
 * round-trips to the server.
 */

import type { OrganizationPlan } from '@/types/database';

interface BillingCardProps {
  plan: OrganizationPlan;
}

interface PlanCopy {
  title: string;
  tagline: string;
  mrrLabel: string;
  mrrValue: string;
}

function planCopy(plan: OrganizationPlan): PlanCopy {
  switch (plan) {
    case 'starter':
      return {
        title: 'Starter',
        tagline: 'Voice + SMS + maintenance + briefing',
        mrrLabel: 'Monthly recurring',
        mrrValue: '$199',
      };
    case 'pro':
      return {
        title: 'Pro',
        tagline: 'Adds Stripe + Plaid rent collection + late fee automation',
        mrrLabel: 'Monthly recurring',
        mrrValue: '$299',
      };
    case 'managed':
      return {
        title: 'Managed',
        tagline: 'Ops team reviews AI decisions, handles exceptions',
        mrrLabel: 'Usage-based',
        mrrValue: '4.5%',
      };
  }
}

export function BillingCard({ plan }: BillingCardProps) {
  const copy = planCopy(plan);

  return (
    <section
      data-testid="settings-billing-section"
      className="flex flex-col gap-4"
    >
      {/* Current plan */}
      <div
        data-testid="settings-billing-current-plan"
        data-plan={plan}
        className="flex flex-col gap-3"
        style={{
          background: 'var(--paper-0)',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--radius-lg-odesa)',
          padding: '24px 28px',
        }}
      >
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-2">
            <p
              className="meta-label"
              style={{ color: 'var(--ink-500)' }}
            >
              Current plan
            </p>
            <h3
              data-testid="settings-billing-plan-title"
              className="font-serif-display"
              style={{
                fontSize: '22px',
                lineHeight: 1.2,
                color: 'var(--ink-900)',
              }}
            >
              {copy.title}
            </h3>
            <p
              style={{
                fontSize: '13px',
                lineHeight: 1.5,
                color: 'var(--ink-600)',
                maxWidth: '46ch',
              }}
            >
              {copy.tagline}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <p
              className="meta-label"
              style={{ color: 'var(--ink-500)' }}
            >
              {copy.mrrLabel}
            </p>
            <p
              data-testid="settings-billing-mrr"
              className="tabular-nums"
              style={{
                fontFamily:
                  "var(--font-mono-metrics), 'JetBrains Mono', monospace",
                fontWeight: 600,
                fontSize: '24px',
                lineHeight: 1.1,
                color: 'var(--ink-900)',
              }}
            >
              {copy.mrrValue}
            </p>
          </div>
        </div>
        <p
          data-testid="settings-billing-preview-note"
          style={{
            fontSize: '12px',
            lineHeight: 1.5,
            color: 'var(--ink-500)',
          }}
        >
          Preview pricing — billing is not connected. These figures are not
          the account&apos;s charges.
        </p>
      </div>

      {/* Payment method placeholder */}
      <div
        data-testid="settings-billing-payment-method"
        style={{
          background: 'var(--paper-0)',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--radius-lg-odesa)',
          padding: '20px 28px',
        }}
      >
        <p
          className="meta-label"
          style={{ color: 'var(--ink-500)' }}
        >
          Payment method
        </p>
        <p
          className="mt-2"
          style={{
            fontSize: '14px',
            lineHeight: 1.5,
            color: 'var(--ink-500)',
          }}
        >
          Add a payment method to enable Pro features.
        </p>
      </div>

      {/* Change plan — disabled until billing is connected */}
      <div className="flex items-center justify-end gap-3">
        <span
          data-testid="settings-billing-change-plan-note"
          style={{ fontSize: '12px', color: 'var(--ink-500)' }}
        >
          Plan changes are unavailable until billing is connected.
        </span>
        <button
          type="button"
          data-testid="settings-billing-change-plan-button"
          disabled
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium cursor-not-allowed disabled:opacity-50"
          style={{
            background: 'transparent',
            color: 'var(--navy-700)',
            border: '1px solid var(--navy-700)',
          }}
        >
          Change plan
        </button>
      </div>
    </section>
  );
}
