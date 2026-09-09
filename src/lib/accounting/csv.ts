export interface AccountantCsvColumn<Row> {
  header: string;
  value: (row: Row) => string | number | boolean | null | undefined;
}

/** Neutralize spreadsheet formulas, including formulas after whitespace. */
export function formulaSafeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return String(value);
  const text = String(value);
  const firstMeaningful = text.trimStart().charAt(0);
  if (
    firstMeaningful === '=' ||
    firstMeaningful === '+' ||
    firstMeaningful === '-' ||
    firstMeaningful === '@'
  ) {
    return `'${text}`;
  }
  return text;
}

function quoteCsvCell(value: string): string {
  if (/[,"\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function buildAccountantCsv<Row>(
  rows: readonly Row[],
  columns: readonly AccountantCsvColumn<Row>[],
): string {
  const header = columns.map((column) => quoteCsvCell(column.header)).join(',');
  const lines = rows.map((row) =>
    columns
      .map((column) => quoteCsvCell(formulaSafeCell(column.value(row))))
      .join(','),
  );
  return [header, ...lines].join('\r\n');
}
