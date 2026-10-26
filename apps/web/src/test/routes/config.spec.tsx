// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigView } from "../../server/config.types.js";
import { renderWithMantine } from "../renderWithMantine.js";
import { optionsOf, resetRouteState, routeIdOf, routeState } from "../routerMock.js";

vi.mock("@tanstack/react-router", async () => (await import("../routerMock.js")).routerMock);
vi.mock("../../server/config.functions.js", () => ({ getConfig: vi.fn(), saveConfig: vi.fn() }));
vi.mock("../../components/ConfigViewer.js", () => ({
  ConfigViewer: ({ view }: { view: ConfigView }) => (
    <div>{`viewer:${view.sections.length}:${view.warnings.length}:${String(view.error)}`}</div>
  ),
}));

const { getConfig } = await import("../../server/config.functions.js");
const { Route } = await import("../../routes/config.js");
const ConfigPage = optionsOf(Route).component;

describe("config route", () => {
  it("registers the /config path", () => {
    expect(routeIdOf(Route)).toBe("/config");
  });

  beforeEach(() => {
    resetRouteState();
  });

  it("loads the configuration from the server", async () => {
    const view: ConfigView = { sections: [], warnings: [], error: null };
    vi.mocked(getConfig).mockResolvedValue(view as never);

    await expect(optionsOf(Route).loader({ deps: {} })).resolves.toBe(view);
  });

  it("renders the editor for a loaded configuration", () => {
    routeState.loaderData = {
      sections: [{ title: "General", description: "", fields: [] }],
      warnings: [],
      error: null,
    };
    renderWithMantine(<ConfigPage />);

    expect(screen.getByRole("heading", { name: "Configuration" })).toBeInTheDocument();
    expect(screen.getByText("viewer:1:0:null")).toBeInTheDocument();
  });

  it("shows the load error instead of the editor", () => {
    routeState.loaderData = { sections: [], warnings: [], error: "Cannot read .env" };
    renderWithMantine(<ConfigPage />);

    expect(screen.getByText("Configuration could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("Cannot read .env")).toBeInTheDocument();
    expect(screen.queryByText(/^viewer:/)).not.toBeInTheDocument();
  });
});
