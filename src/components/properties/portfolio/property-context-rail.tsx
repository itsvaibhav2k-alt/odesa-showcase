import Link from "next/link";
import { CalendarDays, CircleDot, Wrench } from "lucide-react";
import type {
  PortfolioProperty,
  PortfolioUnit,
  PropertyStatus,
} from "@/lib/properties/mock-portfolio";
import { formatDate } from "./unit-ledger";
import styles from "./assigned-properties-workspace.module.css";

export function PropertyContextRail({
  property,
}: {
  property: PortfolioProperty;
}) {
  const units = property.units ?? [];
  const workRows = units
    .filter((unit) => unit.openWorkCount > 0)
    .sort(
      (left, right) =>
        right.openWorkCount - left.openWorkCount ||
        left.label.localeCompare(right.label, undefined, { numeric: true }),
    );
  const linkedWorkCount = workRows.reduce(
    (sum, unit) => sum + unit.openWorkCount,
    0,
  );
  const unassignedWorkCount = Math.max(
    property.maintenanceOpenCount - linkedWorkCount,
    0,
  );
  const leaseGroups = groupLeaseEnds(units);
  const noActiveLeaseCount = units.filter(
    (unit) => unit.occupancy !== "occupied",
  ).length;

  return (
    <aside
      className={styles.contextRail}
      aria-label="Property operating context"
    >
      <section className={styles.contextCard}>
        <div className={styles.contextHeader}>
          <div>
            <span className={styles.contextIcon} aria-hidden="true">
              <CircleDot size={14} />
            </span>
            <h3>Current record</h3>
          </div>
          <span
            className={`${styles.contextStatus} ${statusClassName(property.status)}`}
          >
            <span aria-hidden="true" />
            {property.statusLabel}
          </span>
        </div>
        <div className={styles.recordSummary}>
          {property.summaryLead ? (
            <strong>{property.summaryLead}</strong>
          ) : null}
          <p>{property.summaryRest}</p>
        </div>
        <dl className={styles.recordFacts}>
          <div>
            <dt>Rent attention</dt>
            <dd>{property.rentIssueCount}</dd>
          </div>
          <div>
            <dt>No active lease</dt>
            <dd>{noActiveLeaseCount}</dd>
          </div>
          {property.outstandingCents > 0 ? (
            <div className={styles.wideFact}>
              <dt>Recorded current-cycle balance</dt>
              <dd>{formatCents(property.outstandingCents)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className={styles.contextCard}>
        <div className={styles.contextHeader}>
          <div>
            <span className={styles.contextIcon} aria-hidden="true">
              <Wrench size={14} />
            </span>
            <h3>Open work summary</h3>
          </div>
          <strong className={styles.contextTotal}>
            {property.maintenanceOpenCount}
          </strong>
        </div>
        {workRows.length > 0 || unassignedWorkCount > 0 ? (
          <div className={styles.contextRows}>
            {workRows.map((unit) => (
              <WorkContextRow
                key={unit.id}
                propertyId={property.id}
                unit={unit}
              />
            ))}
            {unassignedWorkCount > 0 ? (
              <div className={styles.contextRow}>
                <span>
                  <strong>Unit not recorded</strong>
                  <small>Category not available</small>
                </span>
                <b>{unassignedWorkCount}</b>
              </div>
            ) : null}
          </div>
        ) : (
          <p className={styles.contextEmpty}>No open work orders recorded.</p>
        )}
      </section>

      <section className={styles.contextCard}>
        <div className={styles.contextHeader}>
          <div>
            <span className={styles.contextIcon} aria-hidden="true">
              <CalendarDays size={14} />
            </span>
            <h3>Recorded lease ends</h3>
          </div>
          <strong className={styles.contextTotal}>
            {leaseGroups.reduce((sum, group) => sum + group.units.length, 0)}
          </strong>
        </div>
        {leaseGroups.length > 0 ? (
          <div className={styles.contextRows}>
            {leaseGroups.map((group) => (
              <div className={styles.leaseGroup} key={group.date}>
                <time dateTime={group.date}>{formatDate(group.date)}</time>
                <span>
                  Units {group.units.join(", ")} ·{" "}
                  {pluralize(group.units.length, "lease")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.contextEmpty}>
            No active lease end dates are recorded.
          </p>
        )}
      </section>
    </aside>
  );
}

function WorkContextRow({
  propertyId,
  unit,
}: {
  propertyId: string;
  unit: PortfolioUnit;
}) {
  return (
    <Link
      className={`${styles.contextRow} ${styles.contextRowLink}`}
      href={`/properties/${propertyId}/units/${unit.id}`}
      aria-label={`Open unit ${unit.label} with ${pluralize(unit.openWorkCount, "open order")}`}
    >
      <span>
        <strong>Unit {unit.label}</strong>
        <small>
          {unit.openIssue
            ? `Recorded category · ${unit.openIssue}`
            : "Category not recorded"}
        </small>
      </span>
      <b>{unit.openWorkCount}</b>
    </Link>
  );
}

function groupLeaseEnds(units: PortfolioUnit[]): Array<{
  date: string;
  units: string[];
}> {
  const groups = new Map<string, string[]>();
  for (const unit of units) {
    if (!unit.leaseEnd) continue;
    const date = unit.leaseEnd.slice(0, 10);
    const labels = groups.get(date) ?? [];
    labels.push(unit.label);
    groups.set(date, labels);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, labels]) => ({
      date,
      units: labels.sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true }),
      ),
    }));
}

function statusClassName(status: PropertyStatus): string {
  if (status === "atrisk") return styles.statusRisk;
  if (status === "watching") return styles.statusWatching;
  if (status === "leasing") return styles.statusLeasing;
  return styles.statusCalm;
}

function formatCents(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
