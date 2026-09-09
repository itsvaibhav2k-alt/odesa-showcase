"use client";

import { Building2, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  PortfolioProperty,
  PortfolioSummary,
} from "@/lib/properties/mock-portfolio";
import type { UserRole } from "@/types/database";
import { AskOdesaPanel } from "./ask-odesa-panel";
import { CreatePropertyDialog } from "./create-property-dialog";
import { PortfolioOverview } from "./portfolio-overview";
import { PropertyDossier } from "./property-dossier";
import { PropertyMall } from "./property-mall";
import {
  filterPortfolioProperties,
  PropertyIndex,
  type OperationalFilter,
} from "./property-index";
import styles from "./assigned-properties-workspace.module.css";

type PortfolioView = "operations" | "map";

export interface PropertiesClientProps {
  summary: PortfolioSummary;
  properties: PortfolioProperty[];
  askPrompts: string[];
  role?: UserRole | null;
  /** Compatibility override for focused VA/read-only rendering tests. */
  readOnly?: boolean;
}

export function PropertiesClient({
  summary,
  properties,
  askPrompts,
  role = null,
  readOnly = false,
}: PropertiesClientProps) {
  const accessRole: UserRole | null = readOnly ? "va" : role;
  const canAddProperty = accessRole === "owner";
  const canUseAssistant = accessRole === "owner";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<OperationalFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(
    properties[0]?.id ?? null,
  );
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<PortfolioView>("operations");

  const visibleProperties = useMemo(
    () => filterPortfolioProperties(properties, query, filter),
    [filter, properties, query],
  );
  const selectedProperty =
    visibleProperties.find((property) => property.id === selectedId) ??
    visibleProperties[0] ??
    null;
  const mode =
    properties.length === 0
      ? "zero"
      : properties.length === 1
        ? "single"
        : "many";

  return (
    <div
      data-testid="properties-page"
      data-portfolio-mode={mode}
      className={`today-theme ${styles.page}`}
    >
      <div className={styles.pageInner}>
        <header className={styles.intro}>
          <div className={styles.introCopy}>
            <span className={styles.eyebrow}>Operations · Portfolio</span>
            <h1>Assigned properties</h1>
            <p>
              Property, unit, lease, rent, and open-work records in one
              operating view.
            </p>
          </div>

          <div className={styles.introActions}>
            <div className={styles.scope} aria-label="Current access scope">
              <span>Signed in as</span>
              <strong>{roleLabel(accessRole)}</strong>
              <small>
                {pluralize(summary.properties, "property")} ·{" "}
                {pluralize(summary.units, "unit")} · {scopeLabel(accessRole)}
              </small>
            </div>
            {mode !== "zero" ? (
              <div
                className={styles.viewSwitch}
                role="group"
                aria-label="Property view"
              >
                <button
                  type="button"
                  className={styles.viewSwitchButton}
                  aria-pressed={view === "operations"}
                  onClick={() => setView("operations")}
                >
                  Operations
                </button>
                <button
                  type="button"
                  className={styles.viewSwitchButton}
                  aria-pressed={view === "map"}
                  onClick={() => setView("map")}
                >
                  Map
                </button>
              </div>
            ) : null}
            {canAddProperty ? (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => setCreateOpen(true)}
              >
                <Plus size={15} aria-hidden="true" />
                Add property
              </button>
            ) : null}
          </div>
        </header>

        <PortfolioOverview properties={properties} summary={summary} />

        {mode === "zero" ? (
          <ZeroPortfolio role={accessRole} />
        ) : view === "map" ? (
          <div className={styles.mapWorkspace}>
            <PropertyMall
              properties={properties}
              askPrompts={askPrompts}
              readOnly={accessRole !== "owner"}
              embedded
            />
          </div>
        ) : mode === "single" ? (
          <div
            className={styles.singleWorkspace}
            data-testid="property-index"
            data-index-mode="integrated"
          >
            <span className="sr-only">
              One assigned property. Selection controls are not needed.
            </span>
            <PropertyDossier property={properties[0]!} mode="single" />
          </div>
        ) : (
          <div className={styles.manyWorkspace}>
            <PropertyIndex
              properties={visibleProperties}
              totalCount={properties.length}
              selectedId={selectedProperty?.id ?? null}
              query={query}
              filter={filter}
              onQueryChange={setQuery}
              onFilterChange={setFilter}
              onSelect={setSelectedId}
            />
            {selectedProperty ? (
              <PropertyDossier property={selectedProperty} mode="many" />
            ) : (
              <NoSelection />
            )}
          </div>
        )}

        {canUseAssistant ? (
          <section className={styles.askStrip} aria-label="Ask Odesa">
            <AskOdesaPanel
              prompts={askPrompts}
              variant="compact"
              placeholder="Ask Odesa about these property records…"
            />
          </section>
        ) : null}
      </div>

      <CreatePropertyDialog
        open={isCreateOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

function NoSelection() {
  return (
    <section
      className={styles.noSelection}
      data-testid="selected-property-dossier"
      aria-label="Selected property dossier"
    >
      <Search size={22} aria-hidden="true" />
      <h2>No property selected</h2>
      <p>Clear the search or filter to return to a property dossier.</p>
    </section>
  );
}

function ZeroPortfolio({ role }: { role: UserRole | null }) {
  return (
    <section
      className={styles.zeroState}
      data-testid="property-index"
      aria-labelledby="empty-properties-heading"
    >
      <span className={styles.zeroIcon} aria-hidden="true">
        <Building2 size={22} />
      </span>
      <div>
        <span className={styles.eyebrow}>Assigned scope</span>
        <h2 id="empty-properties-heading">No assigned properties yet</h2>
        <p>
          {role === "va"
            ? "No properties are available in this read-only scope. Ask an owner to add or assign a property."
            : role === "manager"
              ? "No properties are currently assigned to this manager scope."
              : role === "owner"
                ? "Add the first property to establish its units and begin the operating record."
                : "No properties are available in the current assigned scope."}
        </p>
        <small>
          No sample properties, financials, activity, or building records are
          shown.
        </small>
      </div>
    </section>
  );
}

function roleLabel(role: UserRole | null): string {
  if (role === "va") return "Operations assistant";
  if (role === "manager") return "Property manager";
  if (role === "owner") return "Property owner";
  return "Portfolio operator";
}

function scopeLabel(role: UserRole | null): string {
  if (role === "va") return "Read-only scope";
  if (role === "manager") return "Assigned scope";
  if (role === "owner") return "Owner scope";
  return "Assigned scope";
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
