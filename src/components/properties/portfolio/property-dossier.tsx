import Link from "next/link";
import { ArrowUpRight, MapPin } from "lucide-react";
import type {
  PortfolioProperty,
  PropertyStatus,
} from "@/lib/properties/mock-portfolio";
import { propertyHref } from "@/lib/properties/mock-portfolio";
import { PropertyContextRail } from "./property-context-rail";
import { UnitLedger } from "./unit-ledger";
import styles from "./assigned-properties-workspace.module.css";

export function PropertyDossier({
  property,
  mode,
}: {
  property: PortfolioProperty;
  mode: "single" | "many";
}) {
  const counts = propertyCounts(property);
  const collected =
    property.stats.find((stat) => /collected/i.test(stat.label)) ?? null;
  const occupancyRate =
    counts.total > 0 ? Math.round((counts.occupied / counts.total) * 100) : 0;

  return (
    <section
      className={`${styles.dossier} ${
        mode === "many" ? styles.dossierMany : styles.dossierSingle
      }`}
      aria-labelledby="selected-property-heading"
      data-testid="selected-property-dossier"
      data-dossier-mode={mode}
    >
      <header className={styles.propertyHeader}>
        <div className={styles.propertyIdentity}>
          <span className={styles.propertyMonogram} aria-hidden="true">
            {initials(property.name)}
          </span>
          <div className={styles.propertyIdentityCopy}>
            <div className={styles.identityEyebrow}>
              <span>Selected property</span>
              <span
                className={`${styles.statusPill} ${statusClassName(property.status)}`}
              >
                <span aria-hidden="true" />
                {property.statusLabel}
              </span>
            </div>
            <h2 id="selected-property-heading">{property.name}</h2>
            <p>
              <MapPin size={14} aria-hidden="true" />
              {property.address ?? property.location}
            </p>
            {property.address ? (
              <small>{pluralize(counts.total, "recorded unit")}</small>
            ) : null}
          </div>
        </div>

        <Link href={propertyHref(property.id)} className={styles.detailButton}>
          Open property
          <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </header>

      <div className={styles.selectedMetrics}>
        <SelectedMetric
          label="Occupancy"
          value={`${counts.occupied}/${counts.total}`}
          note={
            counts.total > 0
              ? `${occupancyRate}% of recorded units`
              : "No units recorded"
          }
          tone="good"
        />
        <SelectedMetric
          label={collected?.label ?? "Current cycle"}
          value={collected?.value ?? "Not recorded"}
          note="Recorded rent events"
        />
        <SelectedMetric
          label="Open work"
          value={String(property.maintenanceOpenCount)}
          note="Open work orders"
          tone={property.maintenanceOpenCount > 0 ? "warn" : undefined}
        />
        <SelectedMetric
          label="Rent attention"
          value={String(property.rentIssueCount)}
          note="Current-cycle balances"
          tone={property.rentIssueCount > 0 ? "alert" : undefined}
        />
      </div>

      <div className={styles.dossierColumns}>
        <UnitLedger property={property} />
        <PropertyContextRail property={property} />
      </div>
    </section>
  );
}

function SelectedMetric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "good" | "warn" | "alert";
}) {
  const toneClass =
    tone === "good"
      ? styles.metricGood
      : tone === "warn"
        ? styles.metricWarn
        : tone === "alert"
          ? styles.metricAlert
          : "";

  return (
    <div>
      <span>{label}</span>
      <strong className={toneClass}>{value}</strong>
      <small>{note}</small>
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

  const occupancy = property.stats.find((stat) =>
    /occupancy/i.test(stat.label),
  );
  const match = occupancy?.value.match(/^(\d+)\s*\/\s*(\d+)$/);
  return match
    ? { occupied: Number(match[1]), total: Number(match[2]) }
    : { occupied: 0, total: 0 };
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
