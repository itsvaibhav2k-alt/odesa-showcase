import { describe, expect, it } from 'vitest';

import { rentAssistantHref } from '@/app/(dashboard)/rent/rent-ledger';

describe('Rent Ask Odesa handoff', () => {
  it('preserves the ledger period and a review-first boundary', () => {
    const href = rentAssistantHref(
      'August 2026',
      'Draft overdue reminders for owner review. Do not send them.',
    );
    const query = decodeURIComponent(href.replace('/assistant?q=', ''));

    expect(query).toBe(
      'Rent context — August 2026: Draft overdue reminders for owner review. Do not send them.',
    );
    expect(query).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  });
});
