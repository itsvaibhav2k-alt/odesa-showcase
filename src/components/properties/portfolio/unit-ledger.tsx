import Link from "next/link";
import { ChevronRight, DoorOpen } from "lucide-react";
import type {
  PortfolioProperty,
  PortfolioUnit,
} from "@/lib/properties/mock-portfolio";
import styles from "./assigned-properties-workspace.module.css";

export function UnitLedger({ property }: { property: PortfolioProperty }) {
  const units = property.units
    ? [...property.units].sort((left, right) =>
        left.label.localeCompare(right.label, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      )
    : undefined;

  return (
    <section
      className={styles.unitLedger}
      aria-labelledby="unit-ledger-heading"
      data-testid="unit-ledger"
    >
      <div className={styles.panelHeader}>
        <div>
          <span className={styles.eyebrow}>Primary operating evidence</span>
          <h3 id="unit-ledger-heading">Unit ledger</h3>
        </div>
        <span className={styles.panelCount}>
          {units
            ? pluralize(units.length, "recorded unit")
            : "Availability limited"}
        </span>
      </div>

      {units === undefined ? (
        <LedgerEmpty
          title="Unit rows are unavailable"
          copy="This property record did not include unit-level operating data. Open the property for the available record."
        />
      ) : units.length === 0 ? (
        <LedgerEmpty
          title="No units recorded"
          copy="Add units from the property record before lease, rent, or work states can appear here."
        />
      ) : (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th scope="col">Unit</th>
                <th scope="col">Resident</th>
                <th scope="col">Lease record</th>
                <th scope="col">Rent record</th>
                <th scope="col">Open work</th>
                <th scope="col">
                  <span className="sr-only">Open unit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {units.map((unit) => (
                <UnitRow key={unit.id} property={property} unit={unit} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function UnitRow({
  property,
  unit,
}: {
  property: PortfolioProperty;
  unit: PortfolioUnit;
}) {
  const hasActiveLease = unit.occupancy === "occupied";
  const rent = rentDisplay(unit);
  const workDetail = unit.openIssue
    ? `Recorded category · ${unit.openIssue}${unit.openWorkCount > 1 ? ` + ${unit.openWorkCount - 1} more` : ""}`
    : unit.openWorkCount > 0
      ? "Category not recorded"
      : "No open work recorded";

  return (
    <tr data-testid="unit-ledger-row" data-unit-id={unit.id}>
      <td data-label="Unit">
        <span className={styles.unitLabel}>{unit.label}</span>
      </td>
      <td data-label="Resident">
        <span className={styles.cellStack}>
          <strong>
            {hasActiveLease
              ? (unit.tenantName ?? "Name not recorded")
              : "Not recorded"}
          </strong>
          <small>{hasActiveLease ? "Active lease" : "No active lease"}</small>
        </span>
      </td>
      <td data-label="Lease record">
        <span className={styles.cellStack}>
          <span
            className={`${styles.leaseState} ${
              hasActiveLease ? styles.leaseRecorded : styles.leaseMissing
            }`}
          >
            <span aria-hidden="true" />
            {hasActiveLease ? "Active lease" : "No active lease"}
          </span>
          <small>
            {hasActiveLease && unit.leaseEnd
              ? `Recorded end · ${formatDate(unit.leaseEnd)}`
              : hasActiveLease
                ? "End date not recorded"
                : "Lease record unavailable"}
          </small>
        </span>
      </td>
      <td data-label="Rent record">
        <span className={styles.cellStack}>
          <span className={`${styles.rentState} ${styles[rent.tone]}`}>
            <span aria-hidden="true" />
            {rent.label}
          </span>
          <small>{rent.detail}</small>
        </span>
      </td>
      <td data-label="Open work">
        <span className={styles.cellStack}>
          <strong>
            {unit.openWorkCount > 0
              ? pluralize(unit.openWorkCount, "open order")
              : "None open"}
          </strong>
          <small>{workDetail}</small>
        </span>
      </td>
      <td data-label="Action" className={styles.unitActionCell}>
        <Link
          href={`/properties/${property.id}/units/${unit.id}`}
          className={styles.unitLink}
          aria-label={`Open ${unit.label} at ${property.name}`}
        >
          Open
          <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </td>
    </tr>
  );
}

function LedgerEmpty({ title, copy }: { title: string; copy: string }) {
  return (
    <div className={styles.ledgerEmpty}>
      <DoorOpen size={20} aria-hidden="true" />
      <span>
        <strong>{title}</strong>
        <small>{copy}</small>
      </span>
    </div>
  );
}

function rentDisplay(unit: PortfolioUnit): {
  label: string;
  detail: string;
  tone: "rentGood" | "rentWarn" | "rentAlert" | "rentMuted";
} {
  if (unit.occupancy !== "occupied") {
    return {
      label: "Not applicable",
      detail: "No active lease",
      tone: "rentMuted",
    };
  }

  if (unit.rentState === "current") {
    return {
      label: "Current",
      detail: "No current-cycle balance",
      tone: "rentGood",
    };
  }
  if (unit.rentState === "outstanding") {
    return {
      label: "Outstanding",
      detail: "Current-cycle balance remains",
      tone: "rentWarn",
    };
  }
  if (unit.rentState === "late") {
    return {
      label: "Late",
      detail: "Past due with recorded balance",
      tone: "rentAlert",
    };
  }
  return {
    label: "Not recorded",
    detail: "No current-cycle rent event",
    tone: "rentMuted",
  };
}

export function formatDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Date not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
