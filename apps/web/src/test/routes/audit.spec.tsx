// @vitest-environment jsdom
import type { AuditLogEntry } from "@merge-mentor/shared/audit/index.js";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithMantine } from "../renderWithMantine.js";
import { optionsOf, resetRouteState, routeState } from "../routerMock.js";

vi.mock("@tanstack/react-router", async () => (await import("../routerMock.js")).routerMock);
vi.mock("../../server/audit.functions.js", () => ({ getAuditEvents: vi.fn() }));

const { getAuditEvents } = await import("../../server/audit.functions.js");
const { Route } = await import("../../routes/audit.js");
const AuditLogPage = optionsOf(Route).component;

const entry: AuditLogEntry = {
  eventType: "review.start",
  timestamp: "2026-01-01T00:00:00.000Z",
  severity: "info",
  actor: "alice",
  resource: { type: "pr", id: "7" },
  action: "Started review",
  result: "success",
  sourceFile: "audit.log",
  lineNumber: 1,
};

describe("audit route", () => {
  beforeEach(() => {
    resetRouteState();
  });

  it("loads audit events from the server", async () => {
    vi.mocked(getAuditEvents).mockResolvedValue([entry] as never);

    await expect(optionsOf(Route).loader({ deps: {} })).resolves.toEqual([entry]);
  });

  it("explains how to generate logs when there are none", () => {
    routeState.loaderData = [];
    renderWithMantine(<AuditLogPage />);

    expect(screen.getByRole("heading", { name: "Audit Log" })).toBeInTheDocument();
    expect(screen.getByText("No audit events found")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders the audit table when events exist", () => {
    routeState.loaderData = [entry];
    renderWithMantine(<AuditLogPage />);

    expect(screen.queryByText("No audit events found")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 1 events.")).toBeInTheDocument();
  });
});
