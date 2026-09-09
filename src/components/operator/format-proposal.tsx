/**
 * Action-payload renderers for ProposedActionCard.
 *
 * Each `WorkerActionPayload` variant gets a tiny renderer that surfaces
 * the operator-meaningful fields. Centralised here so the card stays
 * dumb and we can evolve copy independently of the card chrome.
 *
 * Internal enums, UUID references, and raw JSON never render here. The
 * proposal row remains complete for audit; this is customer-facing copy.
 */

import type { ActionProposal } from '@/lib/agent/worker/types';

export interface ProposalSummary {
  /** One-line title, e.g. "Draft SMS to Jane (Unit 3B)". */
  title: string;
  /** Optional preview body — the actual SMS text, the dispatch note, etc. */
  preview: string | null;
}

export function formatProposalPayload(
  proposal: ActionProposal,
): ProposalSummary {
  const payload = asRecord(proposal.payload);
  switch (proposal.action_type) {
    case 'draft_sms_reply': {
      return {
        title: 'Draft SMS reply',
        preview: readString(payload, 'body'),
      };
    }
    case 'dispatch_vendor': {
      return {
        title: 'Vendor dispatch for review',
        preview: readString(payload, 'smsBody'),
      };
    }
    case 'classify_intent': {
      return {
        title: 'Message assessment',
        preview: null,
      };
    }
    case 'confirm_emergency': {
      return {
        title: payload['isEmergency'] === true
          ? 'Emergency confirmed'
          : 'Emergency not confirmed',
        preview: null,
      };
    }
    case 'polish_briefing': {
      return {
        title: 'Polish weekly briefing',
        preview: readString(payload, 'prose'),
      };
    }
    case 'update_rulebook': {
      return {
        title: 'Property guidance update',
        preview: readString(payload, 'diffSummary'),
      };
    }
    case 'create_property':
      return {
        title: withSubject('Add property', readString(payload, 'name')),
        preview: joinNonEmpty([
          readString(payload, 'addressStreet'),
          joinNonEmpty(
            [
              readString(payload, 'addressCity'),
              readString(payload, 'addressState'),
              readString(payload, 'addressZip'),
            ],
            ' ',
          ),
        ]),
      };
    case 'add_unit':
      return {
        title: withSubject('Add unit', readString(payload, 'label')),
        preview: null,
      };
    case 'add_tenant':
      return {
        title: withSubject('Add tenant', readString(payload, 'fullName')),
        preview: null,
      };
    case 'set_lease_terms':
      return {
        title: withSubject(
          'Set lease terms',
          readNestedString(payload, 'leaseRef', 'tenantName'),
        ),
        preview: moneyPreview(payload, 'rentAmount'),
      };
    case 'update_rent':
      return {
        title: withSubject(
          'Rent change for review',
          readNestedString(payload, 'leaseRef', 'tenantName'),
        ),
        preview: moneyPreview(payload, 'rentAmount'),
      };
    case 'waive_rent':
      return {
        title: withSubject(
          'Rent waiver for review',
          readNestedString(payload, 'leaseRef', 'tenantName'),
        ),
        preview: readString(payload, 'reason'),
      };
    case 'send_tenant_message':
      return {
        title: withSubject(
          'Tenant message for review',
          readNestedString(payload, 'tenantRef', 'tenantName'),
        ),
        preview: readString(payload, 'body'),
      };
    case 'log_maintenance_ticket':
      return {
        title: 'Log maintenance ticket',
        preview: readString(payload, 'summary'),
      };
    case 'update_property_rules':
      return {
        title: 'Property rules update',
        preview: readString(payload, 'rulesText'),
      };
    case 'archive_lease':
      return {
        title: withSubject(
          'Archive lease for review',
          readNestedString(payload, 'leaseRef', 'tenantName'),
        ),
        preview: readString(payload, 'reason'),
      };
    case 'add_appliance':
      return {
        title: withSubject('Add appliance', humanize(readString(payload, 'type'))),
        preview: joinNonEmpty([
          readString(payload, 'make'),
          readString(payload, 'model'),
        ], ' '),
      };
    case 'update_appliance':
      return {
        title: 'Update appliance record',
        preview: joinNonEmpty([
          readString(payload, 'make'),
          readString(payload, 'model'),
        ], ' '),
      };
    case 'set_property_vendor':
      return {
        title: withSubject(
          'Preferred vendor change',
          readNestedString(payload, 'vendorRef', 'vendorName'),
        ),
        preview: humanize(readString(payload, 'category')),
      };
    case 'update_tenant_preference':
      return {
        title: withSubject(
          'Tenant preference update',
          readNestedString(payload, 'tenantRef', 'tenantName'),
        ),
        preview: null,
      };
    case 'request_rent_payment':
      return {
        title: withSubject(
          'Rent payment request for review',
          readNestedString(payload, 'tenantRef', 'tenantName'),
        ),
        preview:
          typeof payload['amountCents'] === 'number'
            ? `$${(payload['amountCents'] / 100).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`
            : null,
      };
    case 'schedule_calendar_event':
      return {
        title: withSubject(
          'Calendar event for review',
          readString(payload, 'summary'),
        ),
        preview: readString(payload, 'startIso'),
      };
    case 'cancel_calendar_event':
      return { title: 'Calendar cancellation for review', preview: null };
    case 'health_flag':
      return {
        title: 'Property health review',
        preview: readString(payload, 'summary'),
      };
    case 'voice_call_review':
      return {
        title: 'Call outcome for review',
        preview: readString(payload, 'summary'),
      };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? candidate.trim()
    : null;
}

function readNestedString(
  value: Record<string, unknown>,
  outer: string,
  inner: string,
): string | null {
  return readString(asRecord(value[outer]), inner);
}

function withSubject(label: string, subject: string | null): string {
  return subject ? `${label}: ${subject}` : label;
}

function moneyPreview(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const amount = value[key];
  return typeof amount === 'number' && Number.isFinite(amount)
    ? `$${amount.toLocaleString('en-US')}`
    : null;
}

function joinNonEmpty(
  values: Array<string | null>,
  separator = ', ',
): string | null {
  const joined = values.filter((value): value is string => Boolean(value)).join(separator);
  return joined.length > 0 ? joined : null;
}

function humanize(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
