import { describe, expect, it } from 'vitest';

import { parseAccountantExportRequest } from '../export-request';

describe('parseAccountantExportRequest', () => {
  it('accepts the exact filter contracts emitted by each Accountant register', () => {
    expect(
      parseAccountantExportRequest(
        new URLSearchParams(
          'kind=reconciliation&cycle=2026-08&property=property-1&issue=matching&q=Marcus',
        ),
      ),
    ).toEqual({
      ok: true,
      value: {
        kind: 'reconciliation',
        cycleMonth: '2026-08-01',
        propertyId: 'property-1',
        issueFilter: 'matching',
        query: 'Marcus',
      },
    });

    expect(
      parseAccountantExportRequest(
        new URLSearchParams(
          'kind=payment-history&from=2026-08-01&to=2026-08-31&state=timestamp_missing',
        ),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        kind: 'payment-history',
        fromDate: '2026-08-01',
        toDate: '2026-08-31',
        state: 'timestamp_missing',
      },
    });
  });

  it('rejects malformed identifiers and filters instead of broadening them', () => {
    expect(
      parseAccountantExportRequest(
        new URLSearchParams(
          'kind=rent-ledger&cycle=2026-08&property=%2A&state=outstanding',
        ),
      ),
    ).toMatchObject({ ok: false });
    expect(
      parseAccountantExportRequest(
        new URLSearchParams(
          'kind=document-index&type=private&property=property-1',
        ),
      ),
    ).toMatchObject({ ok: false });
  });

  it('rejects year zero, reversed dates, duplicate keys, and unknown parameters', () => {
    for (const query of [
      'kind=rent-ledger&cycle=0000-08',
      'kind=rent-ledger&cycle=9999-12',
      'kind=payment-history&from=9999-12-01&to=9999-12-31',
      'kind=payment-history&from=2020-01-01&to=2026-08-31',
      'kind=payment-history&from=2026-08-31&to=2026-08-01',
      'kind=document-index&type=lease&type=property',
      'kind=document-index&type=lease&page=2',
    ]) {
      expect(
        parseAccountantExportRequest(new URLSearchParams(query)),
      ).toMatchObject({ ok: false });
    }
  });
});
