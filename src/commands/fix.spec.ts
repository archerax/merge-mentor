import { execSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAIProvider } from "../ai/providerFactory.js";
import { executeFixCommand, validateGitWorkspace } from "./fix.js";

// Mock child_process
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

// Mock readline/promises
const mockQuestion = vi.fn();
vi.mock("node:readline/promises", () => ({
  default: {
    createInterface: vi.fn(() => ({
      question: mockQuestion,
      close: vi.fn(),
    })),
  },
}));

// Mock AI Provider Factory
const mockExecutePrompt = vi.fn();
vi.mock("../ai/providerFactory.js", () => ({
  createAIProvider: vi.fn(() => ({
    executePrompt: mockExecutePrompt,
  })),
}));

// Mock platform adapters
const mockAdapter = {
  getPRDetails: vi.fn(),
  getUnresolvedCommentThreads: vi.fn(),
  getPlatformName: () => "github" as const,
};

vi.mock("../platforms/github.js", () => ({
  GitHubAdapter: vi.fn(function GitHubAdapter() {
    return mockAdapter;
  }),
}));

vi.mock("../platforms/azure.js", () => ({
  AzureDevOpsAdapter: vi.fn(function AzureDevOpsAdapter() {
    return mockAdapter;
  }),
}));

// Mock config
vi.mock("../config.js", () => ({
  loadConfig: vi.fn(() => ({
    defaultPlatform: "github",
    github: { token: "token", owner: "owner", repo: "repo" },
    botCommentIdentifier: "bot",
    aiProvider: "claude-agent-sdk",
    aiModel: "model",
  })),
  validateConfig: vi.fn(),
}));

const mockOutput = {
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  write: vi.fn(),
};

type MockExecSync = ReturnType<typeof execSync>;

describe("validateGitWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("succeeds if workspace is clean and branch matches", async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce("" as unknown as MockExecSync) // git rev-parse inside work tree
      .mockReturnValueOnce("main" as unknown as MockExecSync) // git branch --show-current
      .mockReturnValueOnce("" as unknown as MockExecSync); // git status --porcelain

    await expect(validateGitWorkspace("main")).resolves.not.toThrow();
  });

  it("throws if not inside git repo", async () => {
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error();
    });

    await expect(validateGitWorkspace("main")).rejects.toThrow(
      "Execution aborted: Current directory is not a valid Git repository."
    );
  });

  it("throws on branch mismatch", async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce("" as unknown as MockExecSync)
      .mockReturnValueOnce("feature" as unknown as MockExecSync); // currently on feature, expected main

    await expect(validateGitWorkspace("main")).rejects.toThrow(
      "Execution aborted: Branch mismatch."
    );
  });

  it("throws on dirty workspace when not interactive and allowDirty is false", async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce("" as unknown as MockExecSync)
      .mockReturnValueOnce("main" as unknown as MockExecSync)
      .mockReturnValueOnce("M src/file.ts" as unknown as MockExecSync); // dirty

    await expect(
      validateGitWorkspace("main", { allowDirty: false, interactive: false })
    ).rejects.toThrow("Execution aborted: Local Git workspace has uncommitted changes.");
  });

  it("does not throw on dirty workspace when allowDirty is true", async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce("" as unknown as MockExecSync)
      .mockReturnValueOnce("main" as unknown as MockExecSync)
      .mockReturnValueOnce("M src/file.ts" as unknown as MockExecSync);

    await expect(
      validateGitWorkspace("main", { allowDirty: true, interactive: false, output: mockOutput })
    ).resolves.not.toThrow();
    expect(mockOutput.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "Warning: Local Git workspace has uncommitted changes, but --allow-dirty is set"
      )
    );
  });

  it("prompts user and succeeds on 'y' in interactive mode", async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce("" as unknown as MockExecSync)
      .mockReturnValueOnce("main" as unknown as MockExecSync)
      .mockReturnValueOnce("M src/file.ts" as unknown as MockExecSync);
    mockQuestion.mockResolvedValueOnce("y");

    await expect(
      validateGitWorkspace("main", { allowDirty: false, interactive: true })
    ).resolves.not.toThrow();
  });

  it("prompts user and aborts on non-'y' in interactive mode", async () => {
    vi.mocked(execSync)
      .mockReturnValueOnce("" as unknown as MockExecSync)
      .mockReturnValueOnce("main" as unknown as MockExecSync)
      .mockReturnValueOnce("M src/file.ts" as unknown as MockExecSync);
    mockQuestion.mockResolvedValueOnce("n");

    await expect(
      validateGitWorkspace("main", { allowDirty: false, interactive: true })
    ).rejects.toThrow("Execution aborted by user due to uncommitted changes.");
  });
});

describe("executeFixCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exits early if no unresolved comments", async () => {
    mockAdapter.getPRDetails.mockResolvedValue({ headBranch: "main" });
    mockAdapter.getUnresolvedCommentThreads.mockResolvedValue([]);
    vi.mocked(execSync)
      .mockReturnValueOnce("" as unknown as MockExecSync) // git rev-parse inside work tree
      .mockReturnValueOnce("main" as unknown as MockExecSync) // git branch --show-current
      .mockReturnValueOnce("" as unknown as MockExecSync); // git status --porcelain

    await executeFixCommand({ pr: 123, ci: false, interactive: false }, { output: mockOutput });

    expect(mockOutput.log).toHaveBeenCalledWith(
      expect.stringContaining("No active/unresolved review comments found")
    );
  });

  it("runs fixing loop for unresolved comments", async () => {
    mockAdapter.getPRDetails.mockResolvedValue({ headBranch: "main" });
    mockAdapter.getUnresolvedCommentThreads.mockResolvedValue([
      {
        id: "thread-1",
        path: "src/file.ts",
        line: 10,
        comments: [{ author: "reviewer", body: "Please fix this." }],
      },
    ]);
    vi.mocked(execSync)
      .mockReturnValueOnce("" as unknown as MockExecSync) // git rev-parse inside work tree
      .mockReturnValueOnce("main" as unknown as MockExecSync) // git branch --show-current
      .mockReturnValueOnce("" as unknown as MockExecSync) // git status --porcelain
      .mockReturnValueOnce("diff content" as unknown as MockExecSync); // git diff

    mockExecutePrompt.mockResolvedValueOnce({});

    await executeFixCommand({ pr: 123, ci: false, interactive: false }, { output: mockOutput });

    expect(createAIProvider).toHaveBeenCalledWith(
      "claude-agent-sdk",
      expect.objectContaining({
        enableWriteTools: true,
      })
    );
    expect(mockExecutePrompt).toHaveBeenCalledWith(
      expect.stringContaining("FILE TO EDIT: src/file.ts"),
      expect.objectContaining({ workingDirectory: expect.any(String) })
    );
    expect(mockOutput.log).toHaveBeenCalledWith(expect.stringContaining("Generated Diff"));
    expect(mockOutput.log).toHaveBeenCalledWith(
      expect.stringContaining("Fix accepted automatically.")
    );
  });

  it("handles interactive selections (accept, retry, discard)", async () => {
    mockAdapter.getPRDetails.mockResolvedValue({ headBranch: "main" });
    mockAdapter.getUnresolvedCommentThreads.mockResolvedValue([
      {
        id: "thread-1",
        path: "src/file.ts",
        line: 10,
        comments: [{ author: "reviewer", body: "Fix this." }],
      },
    ]);
    vi.mocked(execSync)
      .mockReturnValueOnce("" as unknown as MockExecSync) // git rev-parse inside work tree
      .mockReturnValueOnce("main" as unknown as MockExecSync) // git branch --show-current
      .mockReturnValueOnce("" as unknown as MockExecSync) // git status --porcelain
      .mockReturnValueOnce("diff content" as unknown as MockExecSync); // git diff

    mockExecutePrompt.mockResolvedValue({});

    // Question answers:
    // 1. "Do you want to fix this issue? (y/n/q) " -> "y"
    // 2. "Accept fix, retry, or discard changes? (a/r/d) " -> "a"
    mockQuestion.mockResolvedValueOnce("y").mockResolvedValueOnce("a");

    await executeFixCommand({ pr: 123, ci: false, interactive: true }, { output: mockOutput });

    expect(mockOutput.log).toHaveBeenCalledWith(
      expect.stringContaining("Fix kept! (Unstaged for your review)")
    );
  });
});
