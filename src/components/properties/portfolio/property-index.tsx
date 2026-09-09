import Link from "next/link";
import { ChevronRight, Search, X } from "lucide-react";
import type {
  PortfolioProperty,
  PropertySignalFlags,
  PropertyStatus,
} from "@/lib/properties/mock-portfolio";
import { propertyHref } from "@/lib/properties/mock-portfolio";
import styles from "./assigned-properties-workspace.module.css";

export type OperationalFilter =
  | "all"
  | "needs-attention"
  | "rent-late"
  | "maintenance-open"
  | "vacant"
  | "lease-ending";

interface PropertyIndexProps {
  properties: PortfolioProperty[];
  totalCount: number;
  selectedId: string | null;
  query: string;
  filter: OperationalFilter;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: OperationalFilter) => void;
  onSelect: (propertyId: string) => void;
}

const FILTERS: ReadonlyArray<{
  id: OperationalFilter;
  label: string;
  testId: string;
}> = [
  { id: "all", label: "All", testId: "property-filter-all" },
  {
    id: "needs-attention",
    label: "Needs attention",
    testId: "property-filter-needs-attention",
  },
  { id: "rent-late", label: "Rent late", testId: "property-filter-rent-late" },
  {
    id: "maintenance-open",
    label: "Open work",
    testId: "property-filter-maintenance-open",
  },
  {
    id: "vacant",
    label: "No active lease",
    testId: "property-filter-vacant",
  },
  {
    id: "lease-ending",
    label: "Lease watch",
    testId: "property-filter-lease-ending",
  },
];

const FILTER_SIGNAL: Record<
  Exclude<OperationalFilter, "all">,
  keyof PropertySignalFlags
> = {
  "needs-attention": "needsAttention",
  "rent-late": "rentLate",
  "maintenance-open": "maintenanceOpen",
  vacant: "vacant",
  "lease-ending": "leaseEnding",
};

export function filterPortfolioProperties(
  properties: PortfolioProperty[],
  query: string,
  filter: OperationalFilter,
): PortfolioProperty[] {
  const needle = query.trim().toLowerCase();

  return properties.filter((property) => {
    if (filter !== "all" && !property.signals[FILTER_SIGNAL[filter]]) {
      return false;
    }
    if (!needle) return true;

    const corpus =
      property.searchText ||
      `${property.name} ${property.address ?? ""} ${property.location}`.toLowerCase();
    return corpus.includes(needle);
  });
}

export function PropertyIndex({
  properties,
  totalCount,
  selectedId,
  query,
  filter,
  onQueryChange,
  onFilterChange,
  onSelect,
}: PropertyIndexProps) {
  function clearAll(): void {
    onQueryChange("");
    onFilterChange("all");
  }

  return (
    <section
      className={styles.indexPanel}
      aria-labelledby="property-index-heading"
      data-testid="property-index"
    >
      <div className={styles.indexHeader}>
        <div>
          <span className={styles.eyebrow}>Assigned portfolio</span>
          <h2 id="property-index-heading">Property index</h2>
        </div>
        <span className={styles.indexCount} aria-live="polite">
          {properties.length} of {totalCount}
        </span>
      </div>

      <div className={styles.searchShell}>
        <Search size={16} aria-hidden="true" />
        <label className="sr-only" htmlFor="property-workspace-search">
          Search property, unit, tenant, address
        </label>
        <input
          id="property-workspace-search"
          type="search"
          placeholder="Property, unit, tenant, address…"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
        {query ? (
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Clear property search"
            title="Clear property search"
            onClick={() => onQueryChange("")}
          >
            <X size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className={styles.filters} aria-label="Operational filters">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={item.testId}
            aria-pressed={filter === item.id}
            className={filter === item.id ? styles.filterActive : undefined}
            onClick={() => onFilterChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className={styles.indexRows} role="list">
        {properties.map((property) => (
          <PropertyIndexRow
            key={property.id}
            property={property}
            selected={property.id === selectedId}
            onSelect={() => onSelect(property.id)}
          />
        ))}

        {properties.length === 0 ? (
          <div className={styles.noMatches}>
            <Search size={20} aria-hidden="true" />
            <strong>No matching properties</strong>
            <p>Try another property, unit, tenant, address, or filter.</p>
            <button type="button" onClick={clearAll}>
              Clear search and filters
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PropertyIndexRow({
  property,
  selected,
  onSelect,
}: {
  property: PortfolioProperty;
  selected: boolean;
  onSelect: () => void;
}) {
  const counts = propertyCounts(property);

  return (
    <div
      role="listitem"
      data-testid="property-index-row"
      className={`${styles.indexRow} ${selected ? styles.indexRowSelected : ""}`}
    >
      <button
        type="button"
        className={styles.rowSelect}
        aria-label={`Select ${property.name}`}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className={styles.propertyMark} aria-hidden="true">
          {initials(property.name)}
        </span>
        <span className={styles.rowCopy}>
          <span className={styles.rowTitleLine}>
            <strong>{property.name}</strong>
            <span
              className={`${styles.miniStatus} ${statusClassName(property.status)}`}
            >
              <span aria-hidden="true" />
              {property.statusLabel}
            </span>
          </span>
          <span className={styles.rowAddress}>
            {property.address ?? property.location}
          </span>
          <span className={styles.rowMeta}>
            {counts.occupied}/{counts.total} occupied ·{" "}
            {pluralize(property.maintenanceOpenCount, "open order")}
          </span>
        </span>
      </button>
      <Link
        href={propertyHref(property.id)}
        className={styles.rowDetailLink}
        aria-label={`Open ${property.name} property details`}
        title="Open property details"
      >
        <ChevronRight size={17} aria-hidden="true" />
      </Link>
    </div>
  );
}

function propertyCounts(property: PortfolioProperty): {
  occupied: number;
  total: number;
} {
  if (
    property.unitCount !== undefined &&
    property.occupiedUnitCount !== undefined
  ) {
    return {
      occupied: property.occupiedUnitCount,
      total: property.unitCount,
    };
  }

  if (property.units) {
    return {
      occupied: property.units.filter((unit) => unit.occupancy === "occupied")
        .length,
      total: property.units.length,
    };
  }

  return { occupied: 0, total: 0 };
}

function statusClassName(status: PropertyStatus): string {
  if (status === "atrisk") return styles.statusRisk;
  if (status === "watching") return styles.statusWatching;
  if (status === "leasing") return styles.statusLeasing;
  return styles.statusCalm;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "P";
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
