import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetIdentity = vi.fn();

vi.mock("@merge-mentor/core/ai/providers/copilot-sdk.js", () => ({
  getCopilotAuthIdentity: mockGetIdentity,
}));
vi.mock("./env.server.js", () => ({
  refreshEnv: vi.fn(),
  resolveTempPath: () => "/tmp/mm-ai-status",
}));

const { loadAiStatus } = await import("./aiStatus.server.js");

const ENV_KEYS = [
  "MM_AI_PROVIDER",
  "MM_AI_BASE_URL",
  "MM_AI_API_KEY",
  "MM_COPILOT_TOKEN",
  "COPILOT_CLI_PATH",
];

describe("aiStatus.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("reports the Copilot user from the SDK", async () => {
    mockGetIdentity.mockResolvedValue({
      isAuthenticated: true,
      login: "octocat",
      authType: "gh-cli",
      host: "https://github.com",
    });
    const status = await loadAiStatus(true);
    expect(status).toEqual({
      kind: "copilot",
      login: "octocat",
      authType: "gh-cli",
      host: "https://github.com",
      usesConfiguredToken: false,
    });
    expect(mockGetIdentity).toHaveBeenCalledWith({ token: undefined });
  });

  it("passes the configured token to the SDK and never returns it", async () => {
    process.env.MM_COPILOT_TOKEN = "github_pat_secret";
    mockGetIdentity.mockResolvedValue({ isAuthenticated: true, login: "work-bot" });
    const status = await loadAiStatus(true);
    expect(mockGetIdentity).toHaveBeenCalledWith({ token: "github_pat_secret" });
    expect(status).toMatchObject({ kind: "copilot", usesConfiguredToken: true });
    expect(JSON.stringify(status)).not.toContain("github_pat_secret");
  });

  it("reports BYOK without starting Copilot and strips credentials from the URL", async () => {
    process.env.MM_AI_BASE_URL = "https://user:pw@llm.example.com/v1?key=abc";
    process.env.MM_AI_API_KEY = "sk-secret";
    const status = await loadAiStatus(true);
    expect(status).toEqual({
      kind: "byok",
      endpoint: "https://llm.example.com/v1",
      hasApiKey: true,
    });
    expect(mockGetIdentity).not.toHaveBeenCalled();
    expect(JSON.stringify(status)).not.toMatch(/sk-secret|pw|abc/);
  });

  it("reports an unauthenticated Copilot", async () => {
    mockGetIdentity.mockResolvedValue({ isAuthenticated: false, statusMessage: "Not logged in" });
    expect(await loadAiStatus(true)).toEqual({
      kind: "copilot-unauthenticated",
      message: "Not logged in",
    });
  });

  it("reports SDK failures as an error status", async () => {
    mockGetIdentity.mockRejectedValue(new Error("Client not connected"));
    expect(await loadAiStatus(true)).toEqual({
      kind: "copilot-error",
      message: "Client not connected",
    });
  });

  it("reports non-Copilot providers without probing Copilot", async () => {
    process.env.MM_AI_PROVIDER = "opencode-sdk";
    expect(await loadAiStatus(true)).toEqual({ kind: "other-provider", provider: "opencode-sdk" });
    expect(mockGetIdentity).not.toHaveBeenCalled();
  });

  it("caches until forced or settings change", async () => {
    mockGetIdentity.mockResolvedValue({ isAuthenticated: true, login: "a" });
    await loadAiStatus(true);
    await loadAiStatus();
    expect(mockGetIdentity).toHaveBeenCalledTimes(1);

    process.env.MM_COPILOT_TOKEN = "github_pat_other";
    await loadAiStatus();
    expect(mockGetIdentity).toHaveBeenCalledTimes(2);

    await loadAiStatus(true);
    expect(mockGetIdentity).toHaveBeenCalledTimes(3);
  });
});
