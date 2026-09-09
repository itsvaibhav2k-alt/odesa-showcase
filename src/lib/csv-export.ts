export interface CsvColumn<T> {
  readonly key: keyof T | string;
  readonly header: string;
  readonly format?: (value: unknown, row: T) => string;
}

function escapeCsvValue(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function getNestedValue<T>(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

export function buildCsvString<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): string {
  const headerRow = columns
    .map((col) => escapeCsvValue(col.header))
    .join(',');

  const dataRows = rows.map((row) =>
    columns
      .map((col) => {
        const raw = getNestedValue(row, col.key as string);
        const value = col.format
          ? col.format(raw, row)
          : raw == null
            ? ''
            : String(raw);
        return escapeCsvValue(value);
      })
      .join(','),
  );

  return [headerRow, ...dataRows].join('\n');
}

export function exportToCsv<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
  filename: string,
): void {
  const csv = buildCsvString(rows, columns);
  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
