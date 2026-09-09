import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigationMocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigationMocks.push }),
}));

import { TenantsDirectory } from "./tenants-directory";
import type { ResidentDirectoryRow } from "@/lib/tenants/directory-types";
import type {
  FacetSpec,
  TenantFacetId,
} from "@/lib/properties/mock-portfolio-views";

const ROWS: ResidentDirectoryRow[] = [
  {
    slug: "resident-a",
    initial: "A",
    name: "Avery Stone",
    property: "Oakwood Commons",
    unit: "101",
    rentLabel: "$1,750/mo",
    statusPill: { variant: "current", label: "Current" },
    href: "/tenants/resident-a",
    hasActiveLease: true,
    leaseEndDate: "2099-01-31",
  },
  {
    slug: "resident-b",
    initial: "B",
    name: "Blair Park",
    property: "Maple House",
    unit: "2B",
    rentLabel: "$1,420/mo",
    statusPill: { variant: "plan", label: "Payment plan" },
    href: "/tenants/resident-b",
    hasActiveLease: true,
    leaseEndDate: null,
  },
  {
    slug: "resident-c",
    initial: "C",
    name: "Casey Lin",
    property: "Oakwood Commons",
    unit: "202",
    rentLabel: "$1,680/mo",
    statusPill: { variant: "renewal", label: "Renewal due" },
    href: "/tenants/resident-c",
    hasActiveLease: true,
    leaseEndDate: "2099-02-15",
  },
];

const FACETS: FacetSpec<TenantFacetId>[] = [
  { id: "all", label: "All", count: 3 },
  { id: "attention", label: "Needs attention", count: 1 },
  { id: "plan", label: "On a plan", count: 1 },
  { id: "renewals", label: "Renewals", count: 1 },
];

const EMPTY_FACETS: FacetSpec<TenantFacetId>[] = FACETS.map((facet) => ({
  ...facet,
  count: 0,
}));

function renderDirectory(rows: readonly ResidentDirectoryRow[] = ROWS) {
  return render(
    <TenantsDirectory
      rows={rows}
      facets={rows.length ? FACETS : EMPTY_FACETS}
      header={{ total: rows.length, summary: `${rows.length} tenants` }}
      role="manager"
    />,
  );
}

afterEach(() => {
  cleanup();
  navigationMocks.push.mockReset();
});

describe("TenantsDirectory", () => {
  it("renders the populated operational roster with real links, status, and lease dates", () => {
    renderDirectory();

    expect(
      screen.getByRole("heading", { name: "Assigned residents" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId(/^tenant-dir-/)).toHaveLength(3);

    const avery = screen.getByTestId("tenant-dir-resident-a");
    expect(within(avery).getByRole("link")).toHaveAttribute(
      "href",
      "/tenants/resident-a",
    );
    expect(within(avery).getByText("Current")).toBeInTheDocument();
    expect(within(avery).getByText("Oakwood Commons")).toBeInTheDocument();
    expect(within(avery).getByText("Unit 101")).toBeInTheDocument();
    expect(
      within(avery).getByText("Lease end · Jan 31, 2099"),
    ).toBeInTheDocument();
    expect(within(avery).getByText("Inspect / draft")).toBeInTheDocument();
    expect(within(avery).getByText("Owner approval")).toBeInTheDocument();
  });

  it("searches loaded resident fields and preserves the existing facet controls", () => {
    renderDirectory();

    fireEvent.change(
      screen.getByPlaceholderText("Search residents, properties, or units…"),
      {
        target: { value: "Maple House" },
      },
    );
    expect(screen.getAllByTestId(/^tenant-dir-/)).toHaveLength(1);
    expect(screen.getByTestId("tenant-dir-resident-b")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Clear resident search"));
    fireEvent.click(screen.getByTestId("filter-btn-renewals"));
    expect(screen.getByTestId("filter-btn-renewals")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByTestId(/^tenant-dir-/)).toHaveLength(1);
    expect(screen.getByTestId("tenant-dir-resident-c")).toBeInTheDocument();
  });

  it("shows a recoverable no-match state", () => {
    renderDirectory();

    fireEvent.change(
      screen.getByPlaceholderText("Search residents, properties, or units…"),
      {
        target: { value: "not a resident" },
      },
    );

    expect(screen.getByTestId("tenants-directory-empty")).toHaveTextContent(
      "No residents match this view",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Clear search and filters" }),
    );
    expect(screen.getAllByTestId(/^tenant-dir-/)).toHaveLength(3);
  });

  it("renders an explicit assigned-scope zero state", () => {
    renderDirectory([]);

    expect(screen.getByTestId("tenants-directory-empty")).toHaveTextContent(
      "No assigned residents yet",
    );
    expect(screen.queryAllByTestId(/^tenant-dir-/)).toHaveLength(0);
    expect(
      screen.getByText(/No resident, lease, property, or activity records/),
    ).toBeInTheDocument();
  });

  it("omits unsupported inbox and activity modules", () => {
    renderDirectory();

    expect(
      screen.queryByText("Inbox needing response"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Resident activity")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent activity")).not.toBeInTheDocument();
    expect(screen.queryByText(/inspection scheduled/i)).not.toBeInTheDocument();
  });

  it("routes Ask Odesa with resident scope intact", () => {
    renderDirectory();

    const input = screen.getByTestId("ask-odesa-bar-input");
    fireEvent.change(input, { target: { value: "Which leases end first?" } });
    fireEvent.submit(input.closest("form")!);

    expect(navigationMocks.push).toHaveBeenCalledWith(
      "/assistant?q=About%20assigned%20residents%3A%20Which%20leases%20end%20first%3F",
    );
  });
});
