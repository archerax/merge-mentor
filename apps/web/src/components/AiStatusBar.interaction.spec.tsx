// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiStatus } from "../server/aiStatus.types.js";
import { deferred } from "../test/deferred.js";
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

  it("shows the loading state while a refresh is in flight and clears it once settled", async () => {
    const user = userEvent.setup();
    const refreshed = deferred<AiStatus>();
    vi.mocked(getAiStatus)
      .mockResolvedValueOnce({ kind: "other-provider", provider: "opencode" })
      .mockReturnValueOnce(refreshed.promise);
    renderWithMantine(<AiStatusBar />);
    await screen.findByText("AI provider: opencode");
    const refresh = screen.getByRole("button", { name: "Refresh AI account status" });

    await user.click(refresh);
    await waitFor(() => expect(refresh).toHaveAttribute("data-loading"));

    refreshed.resolve({ kind: "copilot", login: "hubot", usesConfiguredToken: false });
    expect(await screen.findByText("Copilot: hubot")).toBeInTheDocument();
    await waitFor(() => expect(refresh).not.toHaveAttribute("data-loading"));
  });
});
