import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

import { renderWithQuery } from "../test/renderWithQuery.test-helper.js";
import { describeRouteError, RouteError } from "./RouteError.js";

const router = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

function renderError(error: Error): string {
  return renderWithQuery(
    <RouterContextProvider router={router}>
      <RouteError error={error} reset={vi.fn()} />
    </RouterContextProvider>
  ).html;
}

describe("describeRouteError", () => {
  it("uses the error's message", () => {
    expect(describeRouteError(new Error("Audit log unreadable"))).toBe("Audit log unreadable");
  });

  it("falls back to a generic message for blank messages and non-errors", () => {
    expect(describeRouteError(new Error("  "))).toBe("An unexpected error occurred.");
    expect(describeRouteError("boom")).toBe("An unexpected error occurred.");
  });
});

describe("RouteError", () => {
  it("shows the error message in an alert", () => {
    const html = renderError(new Error("Could not read reports"));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Something went wrong loading this page");
    expect(html).toContain("Could not read reports");
  });

  it("offers a retry button", () => {
    const html = renderError(new Error("Network down"));
    expect(html).toContain("<button");
    expect(html).toContain("Try again");
  });
});
