'use client';

import { useCallback } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { exportToCsv, type CsvColumn } from '@/lib/csv-export';

interface ExportCsvButtonProps<T> {
  readonly data: readonly T[];
  readonly columns: readonly CsvColumn<T>[];
  readonly filename: string;
  readonly disabled?: boolean;
}

export function ExportCsvButton<T>({
  data,
  columns,
  filename,
  disabled = false,
}: ExportCsvButtonProps<T>) {
  const handleExport = useCallback(() => {
    exportToCsv(
      data as readonly Record<string, unknown>[],
      columns as readonly CsvColumn<Record<string, unknown>>[],
      filename,
    );
  }, [data, columns, filename]);

  return (
    <Button
      data-testid="export-csv-btn"
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={disabled || data.length === 0}
      className="border-[#E4E2DC] text-[#4A5064]"
    >
      <Download className="size-3.5" />
      Export CSV
    </Button>
  );
}
