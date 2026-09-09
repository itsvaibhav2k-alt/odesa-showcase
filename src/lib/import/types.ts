/**
 * Shared types for the CSV importer (Wave 7 Stream C).
 *
 * Each source-specific mapper (`appfolio`, `buildium`, `rentredi`, `generic`)
 * normalizes its CSV rows into an `ImportPlan`. The plan is a flat tagged
 * representation that downstream code can:
 *
 *   - render in a "preview" view (counts, sample rows, will_insert /
 *     will_skip / will_update tags after the route handler diffs against
 *     existing DB rows), or
 *   - apply via UPSERT in dependency order on `commit`.
 *
 * Every draft is intentionally minimal — only the columns the importer
 * actually writes. Any other DB defaults (timestamps, RLS-derived org id,
 * confidence/source enums, etc.) are filled at write time by the route
 * handler, not the mapper.
 */
export type ImportSource = 'appfolio' | 'buildium' | 'rentredi' | 'generic';

export const IMPORT_SOURCES: readonly ImportSource[] = [
  'appfolio',
  'buildium',
  'rentredi',
  'generic',
] as const;

export type ImportAction = 'will_insert' | 'will_skip' | 'will_update';

export interface PropertyDraft {
  name: string;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
}

export interface UnitDraft {
  /** Natural foreign key — points to `PropertyDraft.name`. */
  propertyName: string;
  label: string;
  bedrooms: number | null;
  bathrooms: number | null;
}

export interface TenantDraft {
  fullName: string;
  phoneE164: string;
  email: string | null;
  dateOfBirth: string | null;
}

export interface LeaseDraft {
  /** Natural foreign keys — point at PropertyDraft.name + UnitDraft.label. */
  propertyName: string;
  unitLabel: string;
  /** Tenant resolved by E.164 phone (or email fallback). */
  tenantPhoneE164: string | null;
  tenantEmail: string | null;
  rentAmount: number;
  rentDueDay: number;
  startDate: string | null;
  endDate: string | null;
  status: 'active' | 'pending' | 'expired' | 'terminated';
}

export interface ImportItem<T> {
  /** Stable string used to dedupe within the same plan + diff against DB. */
  naturalKey: string;
  data: T;
  /** Resolved on the server during `csv` (preview) and reused on `commit`. */
  existingId?: string;
  action: ImportAction;
}

export interface ImportPlan {
  properties: ImportItem<PropertyDraft>[];
  units: ImportItem<UnitDraft>[];
  tenants: ImportItem<TenantDraft>[];
  leases: ImportItem<LeaseDraft>[];
}

export interface MapperResult {
  ok: boolean;
  plan?: ImportPlan;
  /** Human-readable error string when ok===false (e.g. missing columns). */
  error?: string;
  /**
   * Soft warnings — rows that couldn't be parsed (e.g. bad phone) but
   * the importer still produced a plan from the remaining rows.
   */
  warnings?: string[];
}
