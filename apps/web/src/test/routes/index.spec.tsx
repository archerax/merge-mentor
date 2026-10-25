// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithMantine } from "../renderWithMantine.js";
import { optionsOf } from "../routerMock.js";

vi.mock("@tanstack/react-router", async () => (await import("../routerMock.js")).routerMock);

const { Route } = await import("../../routes/index.js");
const Home = optionsOf(Route).component;

describe("home route", () => {
  it("renders the hero with its primary actions", () => {
    renderWithMantine(<Home />);

    expect(
      screen.getByRole("heading", { name: "Review pull requests and backlogs with confidence" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run a PR review" })).toHaveAttribute(
      "href",
      "/review"
    );
    expect(screen.getByRole("link", { name: "Browse reports" })).toHaveAttribute(
      "href",
      "/reports"
    );
  });

  it.each([
    ["PR Review", "Run a PR review →", "/review"],
    ["PBI Review", "Run a PBI review →", "/pbi"],
    ["Project Review", "Run a project review →", "/project"],
    ["PRD / FRD Review", "Review a document →", "/prd"],
    ["Review Reports", "View reports →", "/reports"],
    ["Audit Log", "View audit log →", "/audit"],
    ["Configuration", "View configuration →", "/config"],
  ])("offers a %s card linking to its page", (title, action, href) => {
    renderWithMantine(<Home />);

    const card = screen.getByRole("heading", { name: title }).closest(".mantine-Card-root");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByRole("link", { name: action })).toHaveAttribute(
      "href",
      href
    );
  });
});
