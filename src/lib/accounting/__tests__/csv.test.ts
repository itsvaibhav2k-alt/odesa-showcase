import { describe, expect, it } from 'vitest';

import { buildAccountantCsv, formulaSafeCell } from '../csv';

describe('accountant CSV', () => {
  it.each([
    '=SUM(A1:A2)',
    '+cmd',
    '-1+2',
    '@IMPORTXML()',
    '  =hidden',
    '\t=hidden',
    '\u00a0@hidden',
  ])(
    'neutralizes spreadsheet formula input %s',
    (value) => {
      expect(formulaSafeCell(value)).toBe(`'${value}`);
    },
  );

  it('keeps actual numeric values numeric, including negative numbers', () => {
    expect(formulaSafeCell(-100)).toBe('-100');
  });

  it('quotes delimiters and keeps null evidence blank', () => {
    const csv = buildAccountantCsv(
      [{ property: 'Cedar, LLC', paidAt: null }],
      [
        { header: 'Property', value: (row) => row.property },
        { header: 'Paid at', value: (row) => row.paidAt },
      ],
    );

    expect(csv).toBe('Property,Paid at\r\n"Cedar, LLC",');
  });

  it('applies formula safety after final quoting and newline serialization', () => {
    const csv = buildAccountantCsv(
      [{ title: '\t=HYPERLINK("https://bad.example")\nnext' }],
      [{ header: 'Document', value: (row) => row.title }],
    );

    expect(csv).toBe(
      'Document\r\n"\'\t=HYPERLINK(""https://bad.example"")\nnext"',
    );
  });
});
