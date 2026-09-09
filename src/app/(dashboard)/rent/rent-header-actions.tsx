'use client';

import { CalendarDays, Download } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

import { exportToCsv } from '@/lib/csv-export';
import type { RentLedgerRow } from '@/lib/properties/mock-portfolio-views';

import styles from './rent-console.module.css';

interface RentHeaderActionsProps {
  cycleValue: string;
  period: string;
  rows: readonly RentLedgerRow[];
}

interface RentCsvRow extends Record<string, unknown> {
  resident: string;
  property: string;
  unit: string;
  amount: string;
  due: string;
  status: string;
}

const CSV_COLUMNS = [
  { key: 'resident', header: 'Resident' },
  { key: 'property', header: 'Property' },
  { key: 'unit', header: 'Unit' },
  { key: 'amount', header: 'Amount billed' },
  { key: 'due', header: 'Due' },
  { key: 'status', header: 'Status' },
] as const;

export function RentHeaderActions({
  cycleValue,
  period,
  rows,
}: RentHeaderActionsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function changeCycle(nextCycle: string) {
    if (!/^\d{4}-\d{2}$/.test(nextCycle)) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('cycle', nextCycle);
    router.push(`/rent?${params.toString()}`);
  }

  function exportLedger() {
    const exportRows: RentCsvRow[] = rows.map((row) => ({
      resident: row.tenantName,
      property: row.property,
      unit: row.unit,
      amount: row.amount,
      due: row.when,
      status: row.statusPill.label,
    }));
    exportToCsv(exportRows, CSV_COLUMNS, `odesa-rent-${period.toLowerCase().replace(/\s+/g, '-')}`);
  }

  return (
    <div className={styles.headerActions}>
      <label className={styles.monthControl}>
        <CalendarDays size={13} aria-hidden="true" />
        <span className="sr-only">Ledger month</span>
        <input
          className={styles.monthInput}
          type="month"
          value={cycleValue}
          onChange={(event) => changeCycle(event.target.value)}
          aria-label="Ledger month"
        />
      </label>
      <button
        type="button"
        className={styles.exportButton}
        onClick={exportLedger}
        disabled={rows.length === 0}
        data-testid="export-csv-btn"
      >
        <Download size={13} aria-hidden="true" />
        Export
      </button>
    </div>
  );
}
