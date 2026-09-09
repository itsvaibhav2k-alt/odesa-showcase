import type { MapperResult } from './types';

export interface ImportValidationIssue {
  row: number | null;
  field: string | null;
  code: 'invalid_headers' | 'empty_file' | 'required_row_invalid';
  message: string;
  severity: 'error';
}

function fieldFromMessage(message: string): string | null {
  const candidates = [
    'property_name', 'unit_label', 'tenant_phone', 'lease_rent',
    'lease_due_day', 'Property Name', 'Unit Number', 'Property', 'Unit',
    'Tenant Phone', 'Phone', 'rent',
  ];
  return candidates.find((candidate) => message.includes(candidate)) ?? null;
}

/**
 * Mapper warnings currently all mean a source row was skipped. A skipped row
 * is not a soft success for a required portfolio import, so normalize them to
 * structured blocking issues at both preview and commit boundaries.
 */
export function importValidationIssues(result: MapperResult): ImportValidationIssue[] {
  if (!result.ok || !result.plan) {
    return [{
      row: null,
      field: null,
      code: 'invalid_headers',
      message: result.error ?? 'Mapper produced no import plan',
      severity: 'error',
    }];
  }

  return (result.warnings ?? []).map((message) => {
    const rowMatch = /^Row (\d+):/.exec(message);
    return {
      row: rowMatch ? Number(rowMatch[1]) : null,
      field: fieldFromMessage(message),
      code: message === 'CSV had no data rows' ? 'empty_file' : 'required_row_invalid',
      message,
      severity: 'error' as const,
    };
  });
}
