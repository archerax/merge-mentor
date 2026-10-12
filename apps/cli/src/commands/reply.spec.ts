import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeReplyCommand, getCodeSnippetAtHead, parseReplyResponse } from "./reply.js";
import { buildReplyPrompt } from "./reply/prompt.js";

// Mock AI Provider Factory
const mockExecutePrompt = vi.fn();
vi.mock("@merge-mentor/core/ai/providerFactory.js", () => ({
  createAIProvider: vi.fn(() => ({
    executePrompt: mockExecutePrompt,
  })),
}));

// Mock interactive readline prompts
const mockQuestion = vi.fn();
const mockClose = vi.fn();
vi.mock("node:readline/promises", () => ({
  default: {
    createInterface: vi.fn(() => ({ question: mockQuestion, close: mockClose })),
  },
}));

// Mock platform adapter
const mockAdapter = {
  getCommentThread: vi.fn(),
  getUnresolvedCommentThreads: vi.fn(),
  postCommentReply: vi.fn(),
  resolveCommentThread: vi.fn(),
  getPlatformName: () => "github" as const,
};

vi.mock("@merge-mentor/platforms/github.js", () => ({
  GitHubAdapter: vi.fn(function GitHubAdapter() {
    return mockAdapter;
  }),
}));

vi.mock("@merge-mentor/platforms/azure.js", () => ({
  AzureDevOpsAdapter: vi.fn(function AzureDevOpsAdapter() {
    return mockAdapter;
  }),
}));

vi.mock("@merge-mentor/config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    defaultPlatform: "github",
    github: { token: "token", owner: "owner", repo: "repo" },
    azure: { token: "token", org: "org", project: "project", repo: "repo" },
    botCommentIdentifier: "<!-- merge-mentor -->",
    aiProvider: "copilot-sdk",
    aiModel: "gpt-4o",
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

describe("reply command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseReplyResponse", () => {
    it("parses valid JSON response", () => {
      const json = JSON.stringify({
        reply: "Looks good! Fixed in commit abc.",
        shouldResolve: true,
      });
      const result = parseReplyResponse(json);
      expect(result).toEqual({
        reply: "Looks good! Fixed in commit abc.",
        shouldResolve: true,
      });
    });

    it("strips markdown code block wrappers from JSON response", () => {
      const raw = `\`\`\`json
{
  "reply": "Refactored function to handle null.",
  "shouldResolve": false
}
\`\`\``;
      const result = parseReplyResponse(raw);
      expect(result).toEqual({
        reply: "Refactored function to handle null.",
        shouldResolve: false,
      });
    });

    it("falls back to raw string if JSON parsing fails", () => {
      const raw = "I am a plain text response without JSON.";
      const result = parseReplyResponse(raw);
      expect(result).toEqual({
        reply: "I am a plain text response without JSON.",
        shouldResolve: false,
      });
    });
  });

  describe("getCodeSnippetAtHead", () => {
    it("returns warning if file does not exist", () => {
      const snippet = getCodeSnippetAtHead("non-existent-file-12345.ts", 10);
      expect(snippet).toContain("not found in local workspace");
    });

    it("returns full file if lines count <= 100", () => {
      const snippet = getCodeSnippetAtHead("apps/cli/src/commands/types.ts", 5);
      expect(snippet).not.toContain("not found");
      expect(snippet.length).toBeGreaterThan(0);
    });

    it("returns a numbered 30-line window for files longer than 100 lines", () => {
      const snippet = getCodeSnippetAtHead("apps/cli/src/commands/reply.ts", 30);
      expect(snippet.startsWith("15: ")).toBe(true);
      expect(snippet.split("\n")).toHaveLength(31);
    });

    it("returns an error message when the file cannot be read", () => {
      const snippet = getCodeSnippetAtHead("apps/cli/src/commands", 1);
      expect(snippet).toContain("Failed to read file");
    });
  });

  describe("buildReplyPrompt", () => {
    it("formats comments with security preamble and delimiters", () => {
      const prompt = buildReplyPrompt({
        filePath: "src/index.ts",
        line: 10,
        codeSnippet: "const x = 1;",
        thread: {
          id: "thread-1",
          path: "src/index.ts",
          line: 10,
          status: "active",
          botInitiated: true,
          comments: [
            {
              author: "bot",
              body: "Please fix this bug <!-- merge-mentor -->",
              isBot: true,
            },
            {
              author: "developer",
              body: "Fixed it now",
              isBot: false,
            },
          ],
        },
      });

      expect(prompt).toContain("MERGE MENTOR SECURITY BOUNDARY");
      expect(prompt).toContain("<untrusted-comment-thread>");
      expect(prompt).toContain("<untrusted-code-snippet>");
      expect(prompt).toContain("developer");
      expect(prompt).toContain("Fixed it now");
    });
  });

  describe("executeReplyCommand", () => {
    it("throws if pr number is missing without ci", async () => {
      await expect(
        executeReplyCommand(
          { pr: undefined as unknown as number, ci: false },
          { output: mockOutput }
        )
      ).rejects.toThrow("PR number is required");
    });

    it("fetches single thread when --comment-id is provided", async () => {
      mockAdapter.getCommentThread.mockResolvedValueOnce({
        id: "123",
        path: "src/main.ts",
        line: 15,
        status: "active",
        botInitiated: true,
        comments: [
          { author: "bot", body: "Issue", isBot: true },
          { author: "dev", body: "Can you re-check?", isBot: false },
        ],
      });

      mockExecutePrompt.mockResolvedValueOnce({
        raw: JSON.stringify({
          reply: "Everything looks great now!",
          shouldResolve: true,
        }),
      });

      await executeReplyCommand(
        { pr: 42, ci: false, commentId: "123", resolve: true, write: true },
        { output: mockOutput }
      );

      expect(mockAdapter.getCommentThread).toHaveBeenCalledWith(42, "123");
      expect(mockAdapter.postCommentReply).toHaveBeenCalledWith(
        42,
        "123",
        "Everything looks great now!"
      );
      expect(mockAdapter.resolveCommentThread).toHaveBeenCalledWith(42, "123");
    });

    it("logs proposed reply in dry run mode without posting when write is omitted or false", async () => {
      mockAdapter.getUnresolvedCommentThreads.mockResolvedValueOnce([
        {
          id: "99",
          path: "src/app.ts",
          line: 20,
          status: "active",
          botInitiated: true,
          comments: [
            { author: "bot", body: "Issue <!-- merge-mentor -->", isBot: true },
            { author: "user", body: "Please take a look", isBot: false },
          ],
        },
      ]);

      mockExecutePrompt.mockResolvedValueOnce({
        raw: JSON.stringify({
          reply: "Dry run response",
          shouldResolve: true,
        }),
      });

      await executeReplyCommand({ pr: 10, ci: false, resolve: true }, { output: mockOutput });

      expect(mockAdapter.postCommentReply).not.toHaveBeenCalled();
      expect(mockAdapter.resolveCommentThread).not.toHaveBeenCalled();
      expect(mockOutput.log).toHaveBeenCalledWith(
        expect.stringContaining("[DRY RUN] Proposed Reply for Thread 99:")
      );
    });

    it("throws for an unsupported platform", async () => {
      await expect(
        executeReplyCommand({ pr: 1, ci: false, platform: "gitlab" }, { output: mockOutput })
      ).rejects.toThrow('Invalid platform "gitlab"');
    });

    it("uses the Azure adapter when the platform is azure", async () => {
      mockAdapter.getCommentThread.mockResolvedValueOnce({
        id: "5",
        path: "src/a.ts",
        line: 1,
        status: "active",
        comments: [{ author: "user", body: "check", isBot: false }],
      });
      mockExecutePrompt.mockResolvedValueOnce({
        raw: JSON.stringify({ reply: "sure", shouldResolve: false }),
      });

      await executeReplyCommand(
        { pr: 2, ci: false, platform: "azure", commentId: "5", write: true },
        { output: mockOutput }
      );

      expect(mockAdapter.postCommentReply).toHaveBeenCalledWith(2, "5", "sure");
    });

    it("logs when there are no threads awaiting reply", async () => {
      mockAdapter.getUnresolvedCommentThreads.mockResolvedValueOnce([]);

      await executeReplyCommand({ pr: 3, ci: false }, { output: mockOutput });

      expect(mockOutput.log).toHaveBeenCalledWith(
        expect.stringContaining("No matching unresolved comment threads")
      );
      expect(mockExecutePrompt).not.toHaveBeenCalled();
    });

    it("selects threads interactively and skips the rest", async () => {
      mockAdapter.getUnresolvedCommentThreads.mockResolvedValueOnce([
        {
          id: "1",
          path: "src/a.ts",
          line: 1,
          status: "active",
          botInitiated: true,
          comments: [
            { author: "bot", body: "issue", isBot: true },
            { author: "user", body: "please check", isBot: false },
          ],
        },
        {
          id: "2",
          path: "src/b.ts",
          line: 2,
          status: "active",
          botInitiated: true,
          comments: [
            { author: "bot", body: "issue", isBot: true },
            { author: "user", body: "and this", isBot: false },
          ],
        },
      ]);
      mockQuestion.mockResolvedValueOnce("y").mockResolvedValueOnce("q");
      mockExecutePrompt.mockResolvedValueOnce({
        raw: JSON.stringify({ reply: "done", shouldResolve: false }),
      });

      await executeReplyCommand({ pr: 4, ci: false, interactive: true }, { output: mockOutput });

      expect(mockQuestion).toHaveBeenCalledTimes(2);
      expect(mockOutput.log).toHaveBeenCalledWith("Quitting reply command.");
      expect(mockOutput.log).toHaveBeenCalledWith(
        expect.stringContaining("[DRY RUN] Proposed Reply for Thread 1:")
      );
    });

    it("reports when interactive selection yields no threads", async () => {
      mockAdapter.getUnresolvedCommentThreads.mockResolvedValueOnce([
        {
          id: "1",
          path: "src/a.ts",
          line: 1,
          status: "active",
          botInitiated: true,
          comments: [
            { author: "bot", body: "issue", isBot: true },
            { author: "user", body: "please check", isBot: false },
          ],
        },
      ]);
      mockQuestion.mockResolvedValueOnce("n");

      await executeReplyCommand({ pr: 5, ci: false, interactive: true }, { output: mockOutput });

      expect(mockOutput.log).toHaveBeenCalledWith("No threads selected for reply.");
    });
  });
});
