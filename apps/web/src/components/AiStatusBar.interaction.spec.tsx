// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithMantine } from "../test/renderWithMantine.js";

vi.mock("../server/aiStatus.functions.js", () => ({ getAiStatus: vi.fn() }));

const { getAiStatus } = await import("../server/aiStatus.functions.js");
const { AiStatusBar } = await import("./AiStatusBar.js");

describe("AiStatusBar", () => {
  beforeEach(() => {
    vi.mocked(getAiStatus).mockReset();
  });

  it("shows a placeholder while checking, then the loaded status", async () => {
    vi.mocked(getAiStatus).mockResolvedValue({
      kind: "copilot",
      login: "octocat",
      usesConfiguredToken: false,
    });
    renderWithMantine(<AiStatusBar />);

    expect(screen.getByText("Checking AI account…")).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("Copilot: octocat");
    expect(getAiStatus).toHaveBeenCalledWith({ data: { force: false } });
  });

  it("forces a re-check from the refresh button", async () => {
    const user = userEvent.setup();
    vi.mocked(getAiStatus)
      .mockResolvedValueOnce({ kind: "copilot", login: "octocat", usesConfiguredToken: false })
      .mockResolvedValueOnce({ kind: "copilot", login: "hubot", usesConfiguredToken: false });
    renderWithMantine(<AiStatusBar />);
    await screen.findByText("Copilot: octocat");

    await user.click(screen.getByRole("button", { name: "Refresh AI account status" }));

    expect(await screen.findByText("Copilot: hubot")).toBeInTheDocument();
    expect(getAiStatus).toHaveBeenLastCalledWith({ data: { force: true } });
  });

  it("shows the error as an unavailable status when loading fails", async () => {
    vi.mocked(getAiStatus).mockRejectedValue(new Error("status endpoint down"));
    renderWithMantine(<AiStatusBar />);

    expect(await screen.findByRole("status")).toHaveTextContent("Copilot: status unavailable");
  });

  it("stops showing the loading state once the request settles", async () => {
    const user = userEvent.setup();
    vi.mocked(getAiStatus).mockResolvedValue({ kind: "other-provider", provider: "opencode" });
    renderWithMantine(<AiStatusBar />);
    await screen.findByText("AI provider: opencode");

    await user.click(screen.getByRole("button", { name: "Refresh AI account status" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh AI account status" })).not.toHaveAttribute(
        "data-loading"
      )
    );
  });
});
