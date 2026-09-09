/**
 * CSV importer library — barrel for routes + tests (Wave 7 Stream C).
 *
 * Routes consume this module via:
 *   import { runMapper, parseCsvBytes } from '@/lib/import';
 *
 * Tests can also reach the per-source mappers directly via the named
 * imports below.
 */

import { parse } from 'csv-parse/sync';

import { mapAppfolioCsv } from './appfolio';
import { mapBuildiumCsv } from './buildium';
import { mapGenericCsv } from './generic';
import { mapRentrediCsv } from './rentredi';
import type { ImportSource, MapperResult } from './types';

export type {
  ImportAction,
  ImportItem,
  ImportPlan,
  ImportSource,
  LeaseDraft,
  MapperResult,
  PropertyDraft,
  TenantDraft,
  UnitDraft,
} from './types';
export { IMPORT_SOURCES } from './types';
export { mapAppfolioCsv } from './appfolio';
export { mapBuildiumCsv } from './buildium';
export { mapGenericCsv } from './generic';
export { mapRentrediCsv } from './rentredi';
export { getTemplateCsv } from './templates';

/**
 * Parse raw CSV bytes/string into header-keyed row objects.
 *
 * `csv-parse` `columns: true` reads the first row as headers; trims and
 * preserves the rest as { [header]: string }.
 */
export function parseCsvText(text: string): Record<string, string>[] {
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];
  return rows;
}

/**
 * Dispatch to a source-specific mapper.  Returns `{ ok: false, error }`
 * if the source isn't recognized.
 */
export function runMapper(
  source: ImportSource,
  rows: ReadonlyArray<Record<string, string>>,
): MapperResult {
  switch (source) {
    case 'appfolio':
      return mapAppfolioCsv(rows);
    case 'buildium':
      return mapBuildiumCsv(rows);
    case 'rentredi':
      return mapRentrediCsv(rows);
    case 'generic':
      return mapGenericCsv(rows);
    default: {
      const exhaustive: never = source;
      return { ok: false, error: `Unknown source: ${String(exhaustive)}` };
    }
  }
}
