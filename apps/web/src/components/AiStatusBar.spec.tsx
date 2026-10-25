import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../server/aiStatus.functions.js", () => ({ getAiStatus: vi.fn() }));

const { AiStatusIndicator, describeAiStatus } = await import("./AiStatusBar.js");

const render = (ui: React.ReactNode) =>
  renderToStaticMarkup(<MantineProvider>{ui}</MantineProvider>);

describe("describeAiStatus", () => {
  it("shows the Copilot login and how it authenticated", () => {
    const display = describeAiStatus({
      kind: "copilot",
      login: "octocat",
      host: "https://github.com",
      authType: "gh-cli",
      usesConfiguredToken: false,
    });
    expect(display.label).toBe("Copilot: octocat");
    expect(display.detail).toContain("GitHub CLI login");
    expect(display.color).toBe("green");
  });

  it("includes plan and organizations so personal and company seats are distinguishable", () => {
    const display = describeAiStatus({
      kind: "copilot",
      login: "me",
      usesConfiguredToken: false,
      copilotPlan: "business",
      organizations: ["acme", "widgets"],
    });
    expect(display.label).toBe("Copilot: me (business)");
    expect(display.detail).toContain("Organizations: acme, widgets.");
  });

  it("says plainly when the user could not be identified", () => {
    const display = describeAiStatus({ kind: "copilot", usesConfiguredToken: false });
    expect(display.label).toContain("user unknown");
  });

  it("attributes the identity to MM_COPILOT_TOKEN when configured", () => {
    const display = describeAiStatus({ kind: "copilot", login: "me", usesConfiguredToken: true });
    expect(display.detail).toContain("MM_COPILOT_TOKEN");
  });

  it("flags BYOK distinctly and names the endpoint", () => {
    const display = describeAiStatus({
      kind: "byok",
      endpoint: "https://llm.example.com/v1",
      hasApiKey: true,
    });
    expect(display.label).toBe("BYOK");
    expect(display.detail).toContain("https://llm.example.com/v1");
    expect(display.detail).toContain("not GitHub Copilot");
    expect(display.color).toBe("orange");
  });

  it("reports unauthenticated and error states as red", () => {
    expect(describeAiStatus({ kind: "copilot-unauthenticated", message: "x" }).color).toBe("red");
    expect(describeAiStatus({ kind: "copilot-error", message: "boom" }).detail).toBe("boom");
  });

  it("reports other providers as not using Copilot", () => {
    const display = describeAiStatus({ kind: "other-provider", provider: "opencode-sdk" });
    expect(display.label).toContain("opencode-sdk");
    expect(display.detail).toContain("Copilot is not used");
  });
});

describe("AiStatusIndicator", () => {
  it("shows a placeholder while loading", () => {
    expect(render(<AiStatusIndicator status={undefined} />)).toContain("Checking AI account");
  });

  it("renders the label for a loaded status", () => {
    const html = render(
      <AiStatusIndicator status={{ kind: "byok", endpoint: "e", hasApiKey: false }} />
    );
    expect(html).toContain("BYOK");
  });
});
