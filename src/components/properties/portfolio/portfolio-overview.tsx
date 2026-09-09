import type {
  PortfolioProperty,
  PortfolioSummary,
} from "@/lib/properties/mock-portfolio";
import styles from "./assigned-properties-workspace.module.css";

interface PortfolioOverviewProps {
  properties: PortfolioProperty[];
  summary: PortfolioSummary;
}

export function PortfolioOverview({
  properties,
  summary,
}: PortfolioOverviewProps) {
  const occupied = occupiedDisplay(properties, summary);

  return (
    <section
      className={styles.overview}
      aria-labelledby="operational-overview-heading"
    >
      <div className={styles.overviewLead}>
        <span className={styles.eyebrow}>Portfolio pulse</span>
        <h2 id="operational-overview-heading">Operational overview</h2>
        <p>Current record snapshot</p>
      </div>

      <div className={styles.overviewMetrics}>
        <OverviewMetric
          label="Properties"
          value={String(summary.properties)}
          note="Assigned"
          testId="portfolio-property-count"
        />
        <OverviewMetric
          label="Units"
          value={String(summary.units)}
          note="Recorded"
          testId="portfolio-unit-count"
        />
        <OverviewMetric
          label="Occupied"
          value={occupied.value}
          note={occupied.note}
          tone="good"
          testId="portfolio-occupancy"
        />
        <OverviewMetric
          label="Open work"
          value={String(summary.attention.maintenance)}
          note="Open orders"
          tone={summary.attention.maintenance > 0 ? "warn" : undefined}
        />
        <OverviewMetric
          label="Lease watch"
          value={String(summary.attention.leasing)}
          note="Within 60 days"
          tone={summary.attention.leasing > 0 ? "warn" : undefined}
        />
        <OverviewMetric
          label="Rent attention"
          value={String(summary.attention.rent)}
          note="Current cycle"
          tone={summary.attention.rent > 0 ? "alert" : undefined}
        />
      </div>
    </section>
  );
}

function OverviewMetric({
  label,
  value,
  note,
  tone,
  testId,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "good" | "warn" | "alert";
  testId?: string;
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
    <div className={styles.overviewMetric}>
      <span>{label}</span>
      <strong className={toneClass} data-testid={testId}>
        {value}
      </strong>
      <small>{note}</small>
    </div>
  );
}

function occupiedDisplay(
  properties: PortfolioProperty[],
  summary: PortfolioSummary,
): { value: string; note: string } {
  const hasExactCounts = properties.every(
    (property) => property.occupiedUnitCount !== undefined,
  );
  if (!hasExactCounts) {
    return { value: summary.occupancy, note: "Portfolio rate" };
  }

  const occupied = properties.reduce(
    (sum, property) => sum + (property.occupiedUnitCount ?? 0),
    0,
  );
  return { value: `${occupied}/${summary.units}`, note: summary.occupancy };
}
