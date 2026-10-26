// @vitest-environment jsdom
import type { AuditLogEntry } from "@merge-mentor/shared/audit/index.js";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithMantine } from "../test/renderWithMantine.js";
import { AuditLogTable } from "./AuditLogTable.js";

function entry(overrides: Partial<AuditLogEntry> & { lineNumber: number }): AuditLogEntry {
  return {
    eventType: "review.start",
    timestamp: "2026-01-01T00:00:00.000Z",
    severity: "info",
    actor: "alice",
    resource: { type: "pr", id: "7" },
    action: "Started review",
    result: "success",
    sourceFile: "audit.log",
    ...overrides,
  };
}

const entries: readonly AuditLogEntry[] = [
  entry({ lineNumber: 1 }),
  entry({
    lineNumber: 2,
    severity: "warn",
    eventType: "pr.details.fetch",
    actor: "bob",
    resource: { type: "pr", id: "42" },
    action: "Fetched PR details",
    result: "partial",
  }),
  entry({
    lineNumber: 3,
    severity: "error",
    eventType: "comment.post",
    actor: "carol",
    resource: { type: "pr", id: "99" },
    action: "Posted comment",
    result: "failure",
  }),
];

function bodyRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1);
}

describe("AuditLogTable", () => {
  it("renders every entry with a total count", () => {
    renderWithMantine(<AuditLogTable entries={entries} />);

    expect(bodyRows()).toHaveLength(3);
    expect(screen.getByText("Showing 3 of 3 events.")).toBeInTheDocument();
    expect(screen.getByText("pr:42")).toBeInTheDocument();
  });

  it("filters by severity", async () => {
    const user = userEvent.setup();
    renderWithMantine(<AuditLogTable entries={entries} />);

    await user.click(screen.getByText("Warn"));

    expect(bodyRows()).toHaveLength(1);
    expect(within(bodyRows()[0]).getByText("pr.details.fetch")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 3 events.")).toBeInTheDocument();

    await user.click(screen.getByText("All"));
    expect(bodyRows()).toHaveLength(3);
  });

  it.each([
    ["event type", "comment.post", "carol"],
    ["action", "fetched pr", "bob"],
    ["actor", "ALICE", "alice"],
    ["resource id", "99", "carol"],
  ])("searches by %s, case-insensitively", async (_label, query, expectedActor) => {
    const user = userEvent.setup();
    renderWithMantine(<AuditLogTable entries={entries} />);

    await user.type(screen.getByPlaceholderText("Search events..."), query);

    expect(bodyRows()).toHaveLength(1);
    expect(within(bodyRows()[0]).getByText(expectedActor)).toBeInTheDocument();
  });

  it("ignores surrounding whitespace in the search query", async () => {
    const user = userEvent.setup();
    renderWithMantine(<AuditLogTable entries={entries} />);

    await user.type(screen.getByPlaceholderText("Search events..."), "   ");

    expect(bodyRows()).toHaveLength(3);
  });

  it("combines severity and search filters and shows an empty state", async () => {
    const user = userEvent.setup();
    renderWithMantine(<AuditLogTable entries={entries} />);

    await user.click(screen.getByText("Error"));
    await user.type(screen.getByPlaceholderText("Search events..."), "bob");

    expect(screen.queryAllByRole("row")).toHaveLength(1);
    expect(screen.getByText("No events match the current filters.")).toBeInTheDocument();
  });

  it("shows the empty state when there are no entries", () => {
    renderWithMantine(<AuditLogTable entries={[]} />);

    expect(screen.getByText("No events match the current filters.")).toBeInTheDocument();
  });
});
