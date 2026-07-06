import { execSync } from "node:child_process";
import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { loadConfig } from "../config.js";
import { processEnvironment } from "../ports/index.js";
import { program } from "../program.js";
import { resolveReviewProfile } from "../review/reviewSelection.js";

// Mock dependencies
vi.mock("../config.js", () => ({
  loadConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

function createMockConfig(overrides: Partial<Config> = {}): Config {
  const {
    longContext = false,
    experimentalTools = false,
    verifyPbi = false,
    ...restOverrides
  } = overrides;
  const reviewType = overrides.reviewType ?? "general";
  const reviewProfile =
    overrides.reviewProfile ??
    resolveReviewProfile({
      reviewType,
      reviewPasses: overrides.reviewPasses,
      reviewStrategy: overrides.reviewStrategy,
    });

  return {
    defaultPlatform: "github" as const,
    github: { token: "gh-token", owner: "test-owner", repo: "test-repo" },
    azure: {
      token: "az-token",
      org: "test-org",
      project: "test-project",
      repo: "test-repo",
    },
    botCommentIdentifier: "[merge-mentor]",
    aiProvider: "copilot-sdk",
    aiModel: "claude-sonnet-4.6",
    gitBackend: "cli",
    skipPreExisting: true,
    reviewType,
    reviewPasses: reviewProfile.passes,
    reviewStrategy: reviewProfile.strategy,
    reviewProfile,
    streamingEnabled: true,
    streamingLines: 5,
    tempPath: "./.mergementor",
    longContext,
    experimentalTools,
    verifyPbi,
    ...restOverrides,
  };
}

describe("doctor command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(loadConfig).mockReturnValue(createMockConfig());
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = typeof cmd === "string" ? cmd : "";
      if (cmdStr.includes("git --version")) return "git version 2.40.1";
      if (cmdStr.includes("copilot --version")) return "copilot 2.5.0";
      if (cmdStr.includes("which copilot") || cmdStr.includes("where copilot"))
        return "/usr/local/bin/copilot";
      if (cmdStr.includes("opencode --version")) return "opencode 1.0.0";
      if (cmdStr.includes("which opencode") || cmdStr.includes("where opencode"))
        return "/usr/local/bin/opencode";
      throw new Error("command not found");
    });
  });

  it("displays system diagnostics header", async () => {
    await program.parseAsync(["node", "test", "doctor"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("merge-mentor diagnostics"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Platform:"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Architecture:"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Node.js:"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("CWD:"));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("diagnoses Git CLI tool status", async () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = typeof cmd === "string" ? cmd : "";
      if (cmdStr.includes("git --version")) return "git version 2.40.1";
      throw new Error("not found");
    });

    await program.parseAsync(["node", "test", "doctor"]);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Git CLI: ✅ Available (git version 2.40.1)")
    );
  });

  it("checks default configured provider when --provider is not specified", async () => {
    await program.parseAsync(["node", "test", "doctor"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Checking copilot-sdk (Local package):")
    );
  });

  it("checks only specified provider with --provider", async () => {
    await program.parseAsync(["node", "test", "doctor", "--provider", "copilot"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Checking copilot CLI"));
  });

  it("shows installed version when provider is found", async () => {
    await program.parseAsync(["node", "test", "doctor", "--provider", "copilot"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Installed: copilot 2.5.0"));
  });

  it("shows location when which/where succeeds", async () => {
    await program.parseAsync(["node", "test", "doctor", "--provider", "copilot"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Location: /usr/local/bin/copilot")
    );
  });

  it("shows warning when which/where fails", async () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = typeof cmd === "string" ? cmd : "";
      if (cmdStr.includes("git --version")) return "git version 2.40.1";
      if (cmdStr.includes("copilot --version")) return "copilot 2.5.0";
      throw new Error("which/where failed");
    });

    await program.parseAsync(["node", "test", "doctor", "--provider", "copilot"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Could not determine installation location")
    );
  });

  it("shows not found when provider version check fails", async () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = typeof cmd === "string" ? cmd : "";
      if (cmdStr.includes("git --version")) return "git version 2.40.1";
      throw new Error("command not found: opencode");
    });

    await program.parseAsync(["node", "test", "doctor", "--provider", "opencode"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Not found or not working"));
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("command not found: opencode")
    );
  });

  it("displays configuration details", async () => {
    vi.mocked(loadConfig).mockReturnValue(
      createMockConfig({
        defaultPlatform: "github",
        aiProvider: "copilot-sdk",
        gitBackend: "cli",
      })
    );

    await program.parseAsync(["node", "test", "doctor"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Configuration:"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Default platform: github"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("AI provider: copilot-sdk"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Git backend: cli"));
  });

  it("shows token status for GitHub and Azure", async () => {
    await program.parseAsync(["node", "test", "doctor"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("GitHub token: ✅ Set"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Azure token: ✅ Set"));
  });

  it("shows generic AI BYOK status without revealing secrets", async () => {
    vi.mocked(loadConfig).mockReturnValue(
      createMockConfig({
        aiBaseUrl: "https://bedrock.example.com/openai/v1",
        aiApiKey: "bedrock-key",
      })
    );

    await program.parseAsync(["node", "test", "doctor"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("AI base URL: ✅ Set"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("AI API key: ✅ Set"));
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining("bedrock-key"));
  });

  it("shows token not set when tokens are empty", async () => {
    vi.mocked(loadConfig).mockReturnValue(
      createMockConfig({
        github: { token: "", owner: "o", repo: "r" },
        azure: { token: "", org: "o", project: "p", repo: "r" },
      })
    );

    await program.parseAsync(["node", "test", "doctor"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("GitHub token: ❌ Not set"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Azure token: ❌ Not set"));
  });

  it("handles config loading failure gracefully", async () => {
    vi.mocked(loadConfig).mockImplementation(() => {
      throw new Error("Config file not found");
    });

    await program.parseAsync(["node", "test", "doctor"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Could not load configuration")
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Config file not found"));
  });

  it("diagnoses COPILOT_CLI_PATH environment variable if defined", async () => {
    const env = processEnvironment;
    const envSpy = vi.spyOn(env, "get").mockImplementation((key: string) => {
      if (key === "COPILOT_CLI_PATH") return "/custom/path/copilot-cli.js";
      return undefined;
    });

    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);

    vi.mocked(execSync).mockImplementation((cmd) => {
      const cmdStr = typeof cmd === "string" ? cmd : "";
      if (cmdStr.includes("git --version")) return "git version 2.40.1";
      if (cmdStr.includes("copilot-cli.js")) return "copilot 2.5.0";
      throw new Error("not found");
    });

    await program.parseAsync(["node", "test", "doctor", "--provider", "copilot"]);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Checking COPILOT_CLI_PATH")
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Configured path: /custom/path/copilot-cli.js")
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("File exists at path"));
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("CLI executes: copilot 2.5.0")
    );

    existsSpy.mockRestore();
    envSpy.mockRestore();
  });

  it("diagnoses tempPath writability successfully", async () => {
    await program.parseAsync(["node", "test", "doctor"]);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Temp path writability: ✅ Writable")
    );
  });
});
