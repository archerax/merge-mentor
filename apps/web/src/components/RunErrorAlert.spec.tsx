import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { renderWithQuery } from "../test/renderWithQuery.test-helper.js";
import { RunErrorAlert } from "./RunErrorAlert.js";

const router = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

function renderAlert(message: string): string {
  return renderWithQuery(
    <RouterContextProvider router={router}>
      <RunErrorAlert title="Review failed" message={message} />
    </RouterContextProvider>
  ).html;
}

describe("RunErrorAlert", () => {
  it("shows the title and message", () => {
    const html = renderAlert("Enter a PR URL or number.");
    expect(html).toContain("Review failed");
    expect(html).toContain("Enter a PR URL or number.");
  });

  it("links to the configuration page for configuration errors", () => {
    const html = renderAlert("Configuration error for MM_AZURE_TOKEN: Required.");
    expect(html).toContain('href="/config"');
    expect(html).toContain("Check the");
  });

  it("does not link to configuration for other errors", () => {
    expect(renderAlert("The AI provider timed out.")).not.toContain('href="/config"');
  });
});
