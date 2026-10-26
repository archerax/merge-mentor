// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { optionsOf, resetRouteState, routeState } from "../routerMock.js";

vi.mock("@tanstack/react-router", async () => (await import("../routerMock.js")).routerMock);
vi.mock("../../styles.css?url", () => ({ default: "/app.css" }));
vi.mock("@mantine/core/styles.css?url", () => ({ default: "/mantine.css" }));
vi.mock("../../server/aiStatus.functions.js", () => ({
  getAiStatus: vi.fn().mockResolvedValue({ kind: "other-provider", provider: "opencode" }),
}));

const { Route } = await import("../../routes/__root.js");
const RootDocument = optionsOf(Route).shellComponent;

function renderShell(children: ReactNode = <p>page content</p>) {
  return render(<RootDocument>{children}</RootDocument>, { container: document });
}

describe("root route", () => {
  beforeEach(() => {
    resetRouteState();
    window.localStorage.clear();
  });

  it("declares the document head", () => {
    const head = optionsOf(Route).head();

    expect(head.meta).toEqual(
      expect.arrayContaining([
        { charSet: "utf-8" },
        { title: "Merge Mentor" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
      ])
    );
    expect(head.links).toEqual(
      expect.arrayContaining([
        { rel: "stylesheet", href: "/mantine.css" },
        { rel: "stylesheet", href: "/app.css" },
      ])
    );
  });

  it("wraps the page content in the app frame", () => {
    renderShell();

    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Merge Mentor" })).toBeInTheDocument();
    expect(screen.getByAltText("Merge Mentor logo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open repository" })).toHaveAttribute(
      "href",
      "https://github.com/archerax/merge-mentor"
    );
  });

  it.each([
    ["Home", "/"],
    ["PR Review", "/review"],
    ["PBI Review", "/pbi"],
    ["Project Review", "/project"],
    ["PRD Review", "/prd"],
    ["Reports", "/reports"],
    ["Stats", "/stats"],
    ["Audit Log", "/audit"],
    ["Configuration", "/config"],
  ])("links %s to %s", (label, href) => {
    renderShell();

    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("href", href);
  });

  it("marks the current page as active", () => {
    routeState.pathname = "/stats";
    renderShell();

    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: "Stats" })).toHaveAttribute("data-active", "true");
    expect(within(nav).getByRole("link", { name: "Home" })).not.toHaveAttribute("data-active");
  });

  it("opens the navigation from the burger and closes it after choosing a page", async () => {
    const user = userEvent.setup();
    renderShell();
    const nav = screen.getByRole("navigation");
    const burger = screen.getByRole("button", { name: "Toggle navigation" });
    // The burger icon reflects the open state; the navbar then slides into view.
    const isOpen = () => burger.firstElementChild?.getAttribute("data-opened");
    expect(isOpen()).toBeNull();
    expect(nav.style.transform).toBe("");

    await user.click(burger);
    expect(isOpen()).toBe("true");
    expect(nav.style.transform).toBe("none");

    await user.click(within(nav).getByRole("link", { name: "Reports" }));
    expect(isOpen()).toBeNull();
    expect(nav.style.transform).toBe("");
  });

  it("switches between light and dark mode", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Toggle color scheme" }));
    expect(document.documentElement).toHaveAttribute("data-mantine-color-scheme", "dark");

    await user.click(screen.getByRole("button", { name: "Toggle color scheme" }));
    expect(document.documentElement).toHaveAttribute("data-mantine-color-scheme", "light");
  });

  it("shows the AI account status in the footer", async () => {
    renderShell();

    expect(await screen.findByText("AI provider: opencode")).toBeInTheDocument();
  });
});
