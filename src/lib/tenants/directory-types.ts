import type {
  FacetSpec,
  TenantDirectoryRow,
  TenantFacetId,
  TenantsDirectoryHeader,
} from "@/lib/properties/mock-portfolio-views";

/**
 * Truthful fields carried by the live resident directory query in addition to
 * the legacy list-row contract. Only active leases are represented here.
 */
export interface ResidentDirectoryRow extends TenantDirectoryRow {
  hasActiveLease: boolean;
  /** ISO YYYY-MM-DD from leases.end_date, or null when none is recorded. */
  leaseEndDate: string | null;
}

export interface ResidentDirectoryData {
  header: TenantsDirectoryHeader;
  facets: readonly FacetSpec<TenantFacetId>[];
  rows: readonly ResidentDirectoryRow[];
}
