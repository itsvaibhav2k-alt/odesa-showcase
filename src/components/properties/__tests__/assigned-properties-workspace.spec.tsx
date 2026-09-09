import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { UserRole } from "@/types/database";

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/app/(dashboard)/properties/actions", () => ({
  createPortfolioProperty: vi.fn(),
  deletePortfolioProperty: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: navigationMocks.refresh,
    push: navigationMocks.push,
  }),
}));

import { PropertiesClient } from "@/components/properties/portfolio/properties-client";
import { createPortfolioProperty } from "@/app/(dashboard)/properties/actions";
import type {
  PortfolioProperty,
  PortfolioSummary,
  PortfolioUnit,
} from "@/lib/properties/mock-portfolio";

const OAKWOOD_ID = "33333333-3333-3333-3333-333333333301";
const ROW_ID = "33333333-3333-3333-3333-333333333302";
const MAPLE_ID = "33333333-3333-3333-3333-333333333303";
const mockCreatePortfolioProperty = vi.mocked(createPortfolioProperty);

const SUMMARY: PortfolioSummary = {
  properties: 1,
  units: 7,
  occupancy: "100%",
  mrr: "$8,400",
  attention: {
    rent: 0,
    maintenance: 3,
    leasing: 3,
    vacant: 0,
    total: 6,
  },
};

const OAKWOOD_UNITS: PortfolioUnit[] = [
  {
    id: "unit-101",
    label: "101",
    tenantName: "Marcus Alvarez",
    occupancy: "occupied",
    leaseEnd: "2026-09-26",
    rentState: "current",
    openWorkCount: 1,
    openIssue: "Plumbing",
  },
  {
    id: "unit-102",
    label: "102",
    tenantName: "Priya Banerjee",
    occupancy: "occupied",
    leaseEnd: "2026-08-26",
    rentState: "current",
    openWorkCount: 0,
    openIssue: null,
  },
  {
    id: "unit-103",
    label: "103",
    tenantName: "Jordan Chen",
    occupancy: "occupied",
    leaseEnd: "2026-09-09",
    rentState: "current",
    openWorkCount: 1,
    openIssue: "HVAC",
  },
  {
    id: "unit-201",
    label: "201",
    tenantName: "Linda Diallo",
    occupancy: "occupied",
    leaseEnd: "2026-08-26",
    rentState: "current",
    openWorkCount: 0,
    openIssue: null,
  },
  {
    id: "unit-202",
    label: "202",
    tenantName: "Ethan Ellis",
    occupancy: "occupied",
    leaseEnd: "2026-08-26",
    rentState: "current",
    openWorkCount: 0,
    openIssue: null,
  },
  {
    id: "unit-203",
    label: "203",
    tenantName: "Fatima Farid",
    occupancy: "occupied",
    leaseEnd: "2026-09-09",
    rentState: "current",
    openWorkCount: 1,
    openIssue: "Appliance",
  },
  {
    id: "unit-204",
    label: "204",
    tenantName: "Gavin Huang",
    occupancy: "occupied",
    leaseEnd: "2026-09-26",
    rentState: "current",
    openWorkCount: 0,
    openIssue: null,
  },
];

function makeProperty(
  overrides: Partial<PortfolioProperty> = {},
): PortfolioProperty {
  return {
    id: OAKWOOD_ID,
    name: "Oakwood Commons",
    address: "1400 Oakwood Dr · Arlington, VA 22201",
    location: "Arlington, VA · 7 units",
    status: "watching",
    statusLabel: "Watching",
    summaryLead: "Work order open",
    summaryRest: "Open work order recorded",
    stats: [
      { label: "Occupancy", value: "7/7", tone: "good" },
      { label: "Aug collected", value: "100%", tone: "good" },
      { label: "Active items", value: "6" },
    ],
    issues: [{ tone: "amber", glyph: "!", text: "Plumbing · Unit 101" }],
    activeItems: 6,
    signals: {
      needsAttention: true,
      rentLate: false,
      maintenanceOpen: true,
      vacant: false,
      leaseEnding: true,
    },
    outstandingCents: 0,
    rentIssueCount: 0,
    maintenanceOpenCount: 3,
    unitCount: 7,
    occupiedUnitCount: 7,
    searchText:
      "oakwood commons 1400 oakwood dr arlington va 22201 101 102 103 201 202 203 204 marcus alvarez",
    units: OAKWOOD_UNITS,
    ...overrides,
  };
}

function renderWorkspace({
  properties = [makeProperty()],
  summary = SUMMARY,
  role = "owner",
  readOnly = false,
}: {
  properties?: PortfolioProperty[];
  summary?: PortfolioSummary;
  role?: UserRole | null;
  readOnly?: boolean;
} = {}) {
  return render(
    <PropertiesClient
      summary={summary}
      properties={properties}
      askPrompts={["Summarize open work by property"]}
      role={role}
      readOnly={readOnly}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Assigned properties workspace", () => {
  it("renders the one-property portfolio as a dense dossier without a standalone index", () => {
    const { container } = renderWorkspace({ role: "manager" });

    expect(screen.getByTestId("properties-page")).toHaveAttribute(
      "data-portfolio-mode",
      "single",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Assigned properties" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Operational overview")).toBeInTheDocument();
    expect(screen.getByTestId("portfolio-property-count")).toHaveTextContent(
      "1",
    );
    expect(screen.getByTestId("portfolio-unit-count")).toHaveTextContent("7");

    const viewSwitch = screen.getByRole("group", { name: "Property view" });
    expect(
      within(viewSwitch).getByRole("button", { name: "Operations" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(viewSwitch).getByRole("button", { name: "Map" }),
    ).toHaveAttribute("aria-pressed", "false");

    const integratedIndex = screen.getByTestId("property-index");
    expect(integratedIndex).toHaveAttribute("data-index-mode", "integrated");
    expect(
      within(integratedIndex).queryByRole("heading", {
        name: "Property index",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(integratedIndex).queryByLabelText(
        "Search property, unit, tenant, address",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(integratedIndex).queryByTestId("property-index-row"),
    ).not.toBeInTheDocument();

    const dossier = screen.getByTestId("selected-property-dossier");
    expect(dossier).toHaveAttribute("data-dossier-mode", "single");
    expect(within(dossier).getByText("Oakwood Commons")).toBeInTheDocument();
    expect(within(dossier).getByText("Open work summary")).toBeInTheDocument();
    expect(
      within(dossier).getByText("Recorded lease ends"),
    ).toBeInTheDocument();

    const ledger = screen.getByTestId("unit-ledger");
    expect(within(ledger).getAllByTestId("unit-ledger-row")).toHaveLength(7);
    expect(within(ledger).getByText("Marcus Alvarez")).toBeInTheDocument();
    expect(
      within(ledger).getByText("Recorded category · Plumbing"),
    ).toBeInTheDocument();
    expect(within(dossier).getByText("Aug 26, 2026")).toBeInTheDocument();
    expect(
      within(dossier).getByText(/Units 102, 201, 202/),
    ).toBeInTheDocument();

    expect(
      within(dossier).getByRole("link", { name: "Open property" }),
    ).toHaveAttribute("href", `/properties/${OAKWOOD_ID}`);
    expect(
      within(ledger).getByRole("link", { name: "Open 101 at Oakwood Commons" }),
    ).toHaveAttribute("href", `/properties/${OAKWOOD_ID}/units/unit-101`);

    expect(container).not.toHaveTextContent(/\b(property map|mall)\b/i);
    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector('[data-testid="property-map-stage"]'),
    ).toBeNull();
    for (const control of container.querySelectorAll("a, button")) {
      expect(control.querySelector("a, button")).toBeNull();
    }
  });

  it("switches between the default operations dossier and the real property map", () => {
    renderWorkspace();

    const viewSwitch = screen.getByRole("group", { name: "Property view" });
    const operationsButton = within(viewSwitch).getByRole("button", {
      name: "Operations",
    });
    const mapButton = within(viewSwitch).getByRole("button", { name: "Map" });

    expect(operationsButton).toHaveAttribute("aria-pressed", "true");
    expect(mapButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("selected-property-dossier")).toBeInTheDocument();
    expect(screen.queryByTestId("property-map-stage")).not.toBeInTheDocument();

    fireEvent.click(mapButton);

    expect(operationsButton).toHaveAttribute("aria-pressed", "false");
    expect(mapButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Operational overview")).toBeInTheDocument();
    const mapStage = screen.getByTestId("property-map-stage");
    expect(mapStage).toBeInTheDocument();
    expect(
      within(mapStage).getByRole("link", {
        name: "Enter Oakwood Commons, Apartment in Arlington, VA",
      }),
    ).toHaveAttribute("href", `/properties/${OAKWOOD_ID}`);
    expect(screen.queryByTestId("selected-property-dossier")).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /add property/i }),
    ).toHaveLength(1);
    expect(screen.getAllByTestId("ask-odesa-input")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Delete property" }),
    ).toBeInTheDocument();

    fireEvent.click(operationsButton);

    expect(operationsButton).toHaveAttribute("aria-pressed", "true");
    expect(mapButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("property-map-stage")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("selected-property-dossier")).getByText(
        "Oakwood Commons",
      ),
    ).toBeInTheDocument();
  });

  it.each(["manager", "va"] as const)(
    "keeps the %s map read-only while preserving real property links",
    (role) => {
      renderWorkspace({ role });

      fireEvent.click(screen.getByRole("button", { name: "Map" }));

      const mapStage = screen.getByTestId("property-map-stage");
      expect(
        within(mapStage).getByRole("link", {
          name: "Enter Oakwood Commons, Apartment in Arlington, VA",
        }),
      ).toHaveAttribute("href", `/properties/${OAKWOOD_ID}`);
      expect(
        screen.queryByRole("button", { name: /add property/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Delete property" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Pan map" }),
      ).toBeInTheDocument();
    },
  );

  it("routes a non-empty Ask Odesa prompt to the real assistant route", () => {
    renderWorkspace();
    const input = screen.getByTestId("ask-odesa-input");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigationMocks.push).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Which units are past due?" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigationMocks.push).toHaveBeenCalledWith(
      "/assistant?q=Properties%20context%20%E2%80%94%20assigned%20property%20records%3A%20Which%20units%20are%20past%20due%3F",
    );
  });

  it("scales to many properties with selection, operational filters, and tenant search", () => {
    const row = makeProperty({
      id: ROW_ID,
      name: "17th Street Row",
      address: "17 17th St · Washington, DC 20002",
      location: "Washington, DC · 1 unit",
      status: "atrisk",
      statusLabel: "At risk",
      activeItems: 1,
      signals: {
        needsAttention: true,
        rentLate: true,
        maintenanceOpen: false,
        vacant: false,
        leaseEnding: false,
      },
      outstandingCents: 225000,
      rentIssueCount: 1,
      maintenanceOpenCount: 0,
      unitCount: 1,
      occupiedUnitCount: 1,
      searchText: "17th street row washington dc unit a jordan chen",
      units: [
        {
          id: "unit-a",
          label: "A",
          tenantName: "Jordan Chen",
          occupancy: "occupied",
          leaseEnd: null,
          rentState: "late",
          openWorkCount: 0,
          openIssue: null,
        },
      ],
    });
    const maple = makeProperty({
      id: MAPLE_ID,
      name: "Maple House",
      address: "9 Maple Ave · Reston, VA 20190",
      location: "Reston, VA · 1 unit",
      unitCount: 1,
      occupiedUnitCount: 1,
      searchText: "maple house 9 maple ave reston va sam lee",
      units: [
        {
          id: "unit-m",
          label: "1",
          tenantName: "Sam Lee",
          occupancy: "occupied",
          leaseEnd: null,
          rentState: "current",
          openWorkCount: 1,
          openIssue: "HVAC",
        },
      ],
    });

    renderWorkspace({
      properties: [makeProperty(), row, maple],
      summary: {
        ...SUMMARY,
        properties: 3,
        units: 9,
        occupancy: "100%",
      },
    });

    expect(screen.getByTestId("properties-page")).toHaveAttribute(
      "data-portfolio-mode",
      "many",
    );
    expect(
      within(screen.getByTestId("property-index")).getAllByTestId(
        "property-index-row",
      ),
    ).toHaveLength(3);

    fireEvent.click(
      screen.getByRole("button", { name: "Select 17th Street Row" }),
    );
    expect(
      within(screen.getByTestId("selected-property-dossier")).getByRole(
        "heading",
        { name: "17th Street Row" },
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("property-filter-maintenance-open"));
    expect(
      within(screen.getByTestId("property-index")).getAllByTestId(
        "property-index-row",
      ),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Select 17th Street Row" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("property-filter-all"));
    const search = screen.getByLabelText(
      "Search property, unit, tenant, address",
    );
    fireEvent.change(search, { target: { value: "Jordan Chen" } });
    expect(
      within(screen.getByTestId("property-index")).getAllByTestId(
        "property-index-row",
      ),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Select 17th Street Row" }),
    ).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "9 Maple Ave" } });
    expect(
      screen.getByRole("button", { name: "Select Maple House" }),
    ).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "101" } });
    expect(
      screen.getByRole("button", { name: "Select Oakwood Commons" }),
    ).toBeInTheDocument();
  });

  it("renders an explicit, honest zero state while preserving the owner add capability", () => {
    renderWorkspace({
      properties: [],
      summary: {
        properties: 0,
        units: 0,
        occupancy: "0%",
        mrr: "$0",
        attention: { rent: 0, maintenance: 0, leasing: 0, vacant: 0, total: 0 },
      },
    });

    expect(screen.getByTestId("properties-page")).toHaveAttribute(
      "data-portfolio-mode",
      "zero",
    );
    expect(screen.getByText("No assigned properties yet")).toBeInTheDocument();
    expect(
      screen.getByText(/No sample properties, financials, activity/),
    ).toBeInTheDocument();
    const addProperty = screen.getByRole("button", { name: "Add property" });
    expect(addProperty).toBeInTheDocument();
    expect(
      screen.queryByTestId("selected-property-dossier"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Property view" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("property-map-stage")).not.toBeInTheDocument();
    expect(screen.getByTestId("ask-odesa-input")).toBeInTheDocument();

    fireEvent.click(addProperty);
    expect(screen.getByRole("dialog", { name: "Add property" })).toBeVisible();
    expect(screen.getByTestId("add-property-form")).toBeInTheDocument();
    expect(screen.getByLabelText("Unit count")).toHaveValue(1);
    expect(screen.queryByLabelText("Property type")).not.toBeInTheDocument();
  });

  it("submits the owner add form without exposing an unsaved property type", async () => {
    mockCreatePortfolioProperty.mockResolvedValue({
      success: true,
      data: { id: MAPLE_ID },
    });
    renderWorkspace({
      properties: [],
      summary: {
        properties: 0,
        units: 0,
        occupancy: "0%",
        mrr: "$0",
        attention: { rent: 0, maintenance: 0, leasing: 0, vacant: 0, total: 0 },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add property" }));
    const dialog = screen.getByRole("dialog", { name: "Add property" });
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Maple House" },
    });
    fireEvent.change(within(dialog).getByLabelText("Unit count"), {
      target: { value: "3" },
    });
    fireEvent.change(within(dialog).getByLabelText("Street"), {
      target: { value: "9 Maple Ave" },
    });
    fireEvent.change(within(dialog).getByLabelText("City"), {
      target: { value: "Reston" },
    });
    fireEvent.change(within(dialog).getByLabelText("State"), {
      target: { value: "VA" },
    });
    fireEvent.change(within(dialog).getByLabelText("ZIP"), {
      target: { value: "20190" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add property" }),
    );

    await waitFor(() => {
      expect(mockCreatePortfolioProperty).toHaveBeenCalledWith({
        name: "Maple House",
        propertyType: "single-family",
        addressStreet: "9 Maple Ave",
        addressCity: "Reston",
        addressState: "VA",
        addressZip: "20190",
        unitCount: 3,
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add property" })).toBeNull();
    });
    expect(navigationMocks.refresh).toHaveBeenCalledOnce();
  });

  it("uses the exact manager and VA scopes without exposing owner-only add", () => {
    const { rerender } = renderWorkspace({ role: "manager" });

    expect(screen.getByText("Property manager")).toBeInTheDocument();
    expect(screen.getByText(/Assigned scope/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add property" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("ask-odesa-input")).not.toBeInTheDocument();

    rerender(
      <PropertiesClient
        summary={SUMMARY}
        properties={[makeProperty()]}
        askPrompts={[]}
        role="va"
        readOnly
      />,
    );

    expect(screen.getByText("Operations assistant")).toBeInTheDocument();
    expect(screen.getByText(/Read-only scope/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add property" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("ask-odesa-input")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("selected-property-dossier")).getByRole(
        "link",
        { name: "Open property" },
      ),
    ).toHaveAttribute("href", `/properties/${OAKWOOD_ID}`);
  });

  it("labels each truthful unit rent, lease, vacancy, and work state", () => {
    const units: PortfolioUnit[] = [
      {
        id: "current",
        label: "101",
        tenantName: "Current Resident",
        occupancy: "occupied",
        leaseEnd: "2027-01-31",
        rentState: "current",
        openWorkCount: 0,
        openIssue: null,
      },
      {
        id: "outstanding",
        label: "102",
        tenantName: "Outstanding Resident",
        occupancy: "occupied",
        leaseEnd: "2027-02-28",
        rentState: "outstanding",
        openWorkCount: 1,
        openIssue: "Electrical",
      },
      {
        id: "late",
        label: "103",
        tenantName: "Late Resident",
        occupancy: "occupied",
        leaseEnd: "2027-03-31",
        rentState: "late",
        openWorkCount: 2,
        openIssue: "Plumbing",
      },
      {
        id: "missing-rent",
        label: "104",
        tenantName: null,
        occupancy: "occupied",
        leaseEnd: null,
        rentState: "not-recorded",
        openWorkCount: 0,
        openIssue: null,
      },
      {
        id: "vacant",
        label: "105",
        tenantName: null,
        occupancy: "vacant",
        leaseEnd: null,
        rentState: "not-recorded",
        openWorkCount: 0,
        openIssue: null,
      },
    ];

    renderWorkspace({
      properties: [
        makeProperty({
          unitCount: 5,
          occupiedUnitCount: 4,
          units,
        }),
      ],
      summary: { ...SUMMARY, units: 5, occupancy: "80%" },
    });

    const rows = within(screen.getByTestId("unit-ledger")).getAllByTestId(
      "unit-ledger-row",
    );
    expect(within(rows[0]!).getByText("Current")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Outstanding")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Late")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("2 open orders")).toBeInTheDocument();
    expect(
      within(rows[2]!).getByText("Recorded category · Plumbing + 1 more"),
    ).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Not recorded")).toBeInTheDocument();
    expect(
      within(rows[3]!).getByText("End date not recorded"),
    ).toBeInTheDocument();
    expect(within(rows[4]!).getByText("Not applicable")).toBeInTheDocument();
    expect(within(rows[4]!).getAllByText("No active lease")).toHaveLength(3);
  });
});
