"use client";

import {
  CalendarDays,
  ChevronRight,
  Search,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import type {
  FacetSpec,
  TenantFacetId,
  TenantsDirectoryHeader,
  TenantStatusVariant,
} from "@/lib/properties/mock-portfolio-views";
import type { ResidentDirectoryRow } from "@/lib/tenants/directory-types";
import type { UserRole } from "@/types/database";

import styles from "./tenants-workspace.module.css";

export interface TenantsDirectoryProps {
  rows: readonly ResidentDirectoryRow[];
  facets: readonly FacetSpec<TenantFacetId>[];
  header: TenantsDirectoryHeader;
  role: UserRole | null;
}

type ResidentSort = "key-date" | "resident" | "property" | "standing";

const ASK_PROMPTS = [
  "Who needs attention?",
  "Show upcoming lease ends",
  "Summarize resident standing",
];

const STATUS_PRIORITY: Record<TenantStatusVariant, number> = {
  watching: 0,
  plan: 1,
  renewal: 2,
  current: 3,
};

function inFacet(facet: TenantFacetId, row: ResidentDirectoryRow): boolean {
  switch (facet) {
    case "all":
      return true;
    case "attention":
      return (
        row.statusPill.variant === "watching" ||
        row.statusPill.variant === "renewal"
      );
    case "plan":
      return row.statusPill.variant === "plan";
    case "renewals":
      return row.statusPill.variant === "renewal";
  }
}

function compareRows(
  a: ResidentDirectoryRow,
  b: ResidentDirectoryRow,
  sort: ResidentSort,
) {
  if (sort === "key-date") {
    const aDate = a.leaseEndDate
      ? Date.parse(`${a.leaseEndDate}T12:00:00Z`)
      : Number.MAX_SAFE_INTEGER;
    const bDate = b.leaseEndDate
      ? Date.parse(`${b.leaseEndDate}T12:00:00Z`)
      : Number.MAX_SAFE_INTEGER;
    return aDate - bDate || a.name.localeCompare(b.name);
  }
  if (sort === "property") {
    return (
      `${a.property} ${a.unit}`.localeCompare(`${b.property} ${b.unit}`) ||
      a.name.localeCompare(b.name)
    );
  }
  if (sort === "standing") {
    return (
      STATUS_PRIORITY[a.statusPill.variant] -
        STATUS_PRIORITY[b.statusPill.variant] || a.name.localeCompare(b.name)
    );
  }
  return a.name.localeCompare(b.name);
}

function roleLabel(role: UserRole | null): string {
  if (role === "owner") return "Property owner";
  if (role === "manager") return "Property manager";
  if (role === "va") return "Operations assistant";
  return "Property operator";
}

function boundaryFor(role: UserRole | null) {
  if (role === "owner")
    return { action: "Review / act", limit: "Owner authority" };
  if (role === "va") return { action: "View / prepare", limit: "Owner acts" };
  return { action: "Inspect / draft", limit: "Owner approval" };
}

function pluralize(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}

function dateNote(iso: string) {
  const target = Date.parse(`${iso}T12:00:00Z`);
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12,
  );
  const days = Math.ceil((target - today) / 86_400_000);
  if (days < 0) return "Recorded date passed";
  if (days === 0) return "Today";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function statusClass(variant: TenantStatusVariant) {
  if (variant === "watching") return styles.statusWatching;
  if (variant === "plan") return styles.statusPlan;
  if (variant === "renewal") return styles.statusRenewal;
  return styles.statusCurrent;
}

export function TenantsDirectory({
  rows,
  facets,
  header,
  role,
}: TenantsDirectoryProps) {
  const router = useRouter();
  const [activeFacet, setActiveFacet] = useState<TenantFacetId>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ResidentSort>("key-date");
  const [askValue, setAskValue] = useState("");

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleRows = useMemo(
    () =>
      rows
        .filter((row) => inFacet(activeFacet, row))
        .filter((row) => {
          if (!normalizedQuery) return true;
          return [row.name, row.property, row.unit, row.statusPill.label]
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalizedQuery);
        })
        .slice()
        .sort((a, b) => compareRows(a, b, sort)),
    [activeFacet, normalizedQuery, rows, sort],
  );

  const totals = useMemo(() => {
    const count = (variant: TenantStatusVariant) =>
      rows.filter((row) => row.statusPill.variant === variant).length;
    return {
      activeLeases: rows.filter((row) => row.hasActiveLease).length,
      properties: new Set(
        rows.filter((row) => row.property !== "—").map((row) => row.property),
      ).size,
      recordedEnds: rows.filter((row) => row.leaseEndDate).length,
      current: count("current"),
      watching: count("watching"),
      plan: count("plan"),
      renewal: count("renewal"),
    };
  }, [rows]);

  const recordedEnds = useMemo(
    () =>
      rows
        .filter((row): row is ResidentDirectoryRow & { leaseEndDate: string } =>
          Boolean(row.leaseEndDate),
        )
        .slice()
        .sort((a, b) => a.leaseEndDate.localeCompare(b.leaseEndDate))
        .slice(0, 5),
    [rows],
  );

  const boundary = boundaryFor(role);
  const attentionCount =
    facets.find((facet) => facet.id === "attention")?.count ?? 0;

  function clearRosterControls() {
    setQuery("");
    setActiveFacet("all");
  }

  function askOdesa(prompt: string) {
    const value = prompt.trim();
    if (!value) return;
    router.push(
      `/assistant?q=${encodeURIComponent(`About assigned residents: ${value}`)}`,
    );
  }

  function submitAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    askOdesa(askValue);
  }

  return (
    <main
      className={`today-theme ${styles.page}`}
      data-testid="tenants-page"
      data-roster-mode={
        rows.length === 0 ? "zero" : rows.length === 1 ? "one" : "many"
      }
    >
      <div className={styles.pageInner}>
        <header className={styles.intro}>
          <div className={styles.introCopy}>
            <span className={styles.eyebrow}>Operations · Residents</span>
            <h1>Assigned residents</h1>
            <p>
              Lease standing, assigned homes, and recorded key dates in one
              operating view.
            </p>
          </div>
          <div className={styles.scope} aria-label="Current access scope">
            <span>Signed in as</span>
            <strong>{roleLabel(role)}</strong>
            <small>
              {pluralize(totals.properties, "property")} ·{" "}
              {pluralize(rows.length, "resident")} · assigned scope
            </small>
          </div>
        </header>

        <section
          className={styles.overview}
          aria-labelledby="resident-overview-title"
        >
          <div className={styles.overviewLead}>
            <div>
              <span className={styles.eyebrow}>Portfolio signal</span>
              <h2 id="resident-overview-title">Operational overview</h2>
              <p>{header.summary}</p>
            </div>
            <span className={styles.liveSignal}>
              <span aria-hidden="true" />
              Current records
            </span>
          </div>
          <div className={styles.overviewMetrics}>
            <OverviewMetric
              label="Residents"
              value={rows.length}
              note="In assigned scope"
            />
            <OverviewMetric
              label="Active leases"
              value={totals.activeLeases}
              note="Recorded as active"
              tone="good"
            />
            <OverviewMetric
              label="Needs attention"
              value={attentionCount}
              note="Watching or renewal"
              tone={attentionCount ? "alert" : "good"}
            />
            <OverviewMetric
              label="Payment plans"
              value={totals.plan}
              note="Current cycle"
              tone={totals.plan ? "warn" : undefined}
            />
            <OverviewMetric
              label="Lease ends"
              value={totals.recordedEnds}
              note="Dates recorded"
            />
          </div>
        </section>

        <div className={styles.workspace}>
          <section
            className={styles.rosterPanel}
            data-testid="tenants-directory"
            aria-labelledby="resident-roster-title"
          >
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.eyebrow}>Assigned scope</span>
                <h2 id="resident-roster-title">Resident roster</h2>
              </div>
              <span className={styles.panelCount} aria-live="polite">
                {visibleRows.length === rows.length
                  ? pluralize(rows.length, "resident")
                  : `${visibleRows.length} of ${rows.length}`}
              </span>
            </div>

            <div className={styles.toolbar}>
              <label className={styles.searchShell}>
                <span className="sr-only">Search residents</span>
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search residents, properties, or units…"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear resident search"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </label>

              <label className={styles.sortShell}>
                <span>Sort by</span>
                <select
                  value={sort}
                  onChange={(event) =>
                    setSort(event.target.value as ResidentSort)
                  }
                >
                  <option value="key-date">Next key date</option>
                  <option value="resident">Resident A–Z</option>
                  <option value="property">Property / unit</option>
                  <option value="standing">Standing</option>
                </select>
              </label>
            </div>

            <div
              className={styles.filters}
              data-testid="filter-bar"
              role="group"
              aria-label="Resident filters"
            >
              {facets.map((facet) => (
                <button
                  key={facet.id}
                  type="button"
                  data-testid={`filter-btn-${facet.id}`}
                  aria-pressed={activeFacet === facet.id}
                  onClick={() => setActiveFacet(facet.id)}
                >
                  {facet.label} <span>{facet.count}</span>
                </button>
              ))}
            </div>

            {visibleRows.length ? (
              <div
                className={styles.rosterTable}
                role="list"
                aria-label="Assigned residents"
              >
                <div className={styles.columnHead} aria-hidden="true">
                  <span>Resident</span>
                  <span>Property / unit</span>
                  <span>Lease / standing</span>
                  <span>Next recorded key date</span>
                  <span>Authority / boundary</span>
                  <span />
                </div>
                {visibleRows.map((row) => (
                  <article
                    key={row.slug}
                    className={styles.residentRow}
                    data-testid={`tenant-dir-${row.slug}`}
                  >
                    <Link
                      href={row.href}
                      className={styles.rowLink}
                      aria-label={`Open resident record for ${row.name}, ${row.statusPill.label}`}
                    >
                      <span className={styles.residentCell}>
                        <span
                          className={styles.identityMark}
                          aria-hidden="true"
                        >
                          {row.initial}
                        </span>
                        <span className={styles.cellStack}>
                          <strong>{row.name}</strong>
                          <small>Resident record</small>
                        </span>
                      </span>

                      <span
                        className={`${styles.cellStack} ${styles.homeCell}`}
                        data-label="Property / unit"
                      >
                        <strong>{row.property}</strong>
                        <small>
                          {row.unit === "—"
                            ? "No unit recorded"
                            : `Unit ${row.unit}`}
                        </small>
                      </span>

                      <span
                        className={styles.statusCell}
                        data-label="Lease / standing"
                      >
                        <span
                          className={`${styles.statusPill} ${statusClass(row.statusPill.variant)}`}
                        >
                          <span aria-hidden="true" />
                          {row.statusPill.label}
                        </span>
                        <small>
                          {row.hasActiveLease ? "Active lease" : "No active lease"}
                        </small>
                      </span>

                      <span
                        className={`${styles.keyDateCell} ${styles.cellStack}`}
                        data-label="Next recorded key date"
                      >
                        {row.leaseEndDate ? (
                          <>
                            <strong>
                              <CalendarDays size={13} aria-hidden="true" />
                              Lease end · {formatDate(row.leaseEndDate)}
                            </strong>
                            <small>{dateNote(row.leaseEndDate)}</small>
                          </>
                        ) : (
                          <>
                            <strong>No lease end recorded</strong>
                            <small>
                              {row.hasActiveLease
                                ? "Open-ended in current record"
                                : "No active lease"}
                            </small>
                          </>
                        )}
                      </span>

                      <span
                        className={`${styles.boundaryCell} ${styles.cellStack}`}
                        data-label="Authority / boundary"
                      >
                        <strong>{boundary.action}</strong>
                        <small>{boundary.limit}</small>
                      </span>

                      <ChevronRight
                        className={styles.rowArrow}
                        size={16}
                        aria-hidden="true"
                      />
                    </Link>
                  </article>
                ))}
              </div>
            ) : (
              <div
                className={styles.emptyState}
                data-testid="tenants-directory-empty"
              >
                <span className={styles.emptyMark} aria-hidden="true">
                  {rows.length ? "0" : "—"}
                </span>
                <div>
                  <h3>
                    {rows.length
                      ? "No residents match this view"
                      : "No assigned residents yet"}
                  </h3>
                  <p>
                    {rows.length
                      ? "Clear the search or return to all residents to restore the roster."
                      : "No resident, lease, property, or activity records are shown outside the current assigned scope."}
                  </p>
                  {rows.length ? (
                    <button type="button" onClick={clearRosterControls}>
                      Clear search and filters
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </section>

          <aside className={styles.rail} aria-label="Resident context">
            <section
              className={styles.railCard}
              aria-labelledby="lease-ends-title"
            >
              <div className={styles.railHeader}>
                <div>
                  <span className={styles.eyebrow}>Lease record</span>
                  <h2 id="lease-ends-title">Recorded lease ends</h2>
                </div>
                <CalendarDays size={16} aria-hidden="true" />
              </div>
              {recordedEnds.length ? (
                <div className={styles.railRows}>
                  {recordedEnds.map((row) => (
                    <Link
                      key={row.slug}
                      href={row.href}
                      className={styles.railRow}
                    >
                      <span className={styles.railDate}>
                        {formatDate(row.leaseEndDate)}
                      </span>
                      <span className={styles.railCopy}>
                        <strong>{row.name}</strong>
                        <small>
                          {row.property} · {row.unit}
                        </small>
                      </span>
                      <span className={styles.railNote}>
                        {dateNote(row.leaseEndDate)}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className={styles.railEmpty}>
                  No lease end dates are recorded for residents in this scope.
                </p>
              )}
            </section>

            <section
              className={styles.railCard}
              aria-labelledby="standing-title"
            >
              <div className={styles.railHeader}>
                <div>
                  <span className={styles.eyebrow}>Recorded state</span>
                  <h2 id="standing-title">Resident standing</h2>
                </div>
                <ShieldCheck size={16} aria-hidden="true" />
              </div>
              <dl className={styles.standingList}>
                <StandingRow
                  label="Current"
                  value={totals.current}
                  tone="good"
                />
                <StandingRow
                  label="Watching"
                  value={totals.watching}
                  tone="alert"
                />
                <StandingRow
                  label="Payment plan"
                  value={totals.plan}
                  tone="warn"
                />
                <StandingRow
                  label="Renewal due"
                  value={totals.renewal}
                  tone="gold"
                />
              </dl>
              <p className={styles.boundaryNote}>
                <span aria-hidden="true" />
                {boundary.action}. Actions remain within the recorded role
                boundary.
              </p>
            </section>
          </aside>
        </div>

        <form
          className={styles.askStrip}
          onSubmit={submitAsk}
          aria-label="Ask Odesa about assigned residents"
        >
          <div className={styles.askInputRow}>
            <span className={styles.askGlyph} aria-hidden="true">
              ⌘
            </span>
            <label className="sr-only" htmlFor="ask-assigned-residents">
              Ask Odesa about assigned residents
            </label>
            <input
              id="ask-assigned-residents"
              data-testid="ask-odesa-bar-input"
              value={askValue}
              onChange={(event) => setAskValue(event.target.value)}
              placeholder="Ask Odesa about assigned residents…"
            />
            <button
              type="submit"
              disabled={!askValue.trim()}
              aria-label="Ask Odesa"
            >
              <Send size={14} aria-hidden="true" />
              Ask Odesa
            </button>
          </div>
          <div className={styles.askPrompts}>
            <span>
              <span aria-hidden="true" />
              In context · assigned residents
            </span>
            {ASK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => askOdesa(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        </form>
      </div>
    </main>
  );
}

function OverviewMetric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: number;
  note: string;
  tone?: "good" | "warn" | "alert";
}) {
  return (
    <div className={styles.overviewMetric} data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function StandingRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div>
      <dt>
        <span
          className={styles.standingDot}
          data-tone={tone}
          aria-hidden="true"
        />
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
