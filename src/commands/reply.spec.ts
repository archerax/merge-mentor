import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildReplyPrompt } from "./reply/prompt.js";
import { executeReplyCommand, getCodeSnippetAtHead, parseReplyResponse } from "./reply.js";

// Mock AI Provider Factory
const mockExecutePrompt = vi.fn();
vi.mock("../ai/providerFactory.js", () => ({
  createAIProvider: vi.fn(() => ({
    executePrompt: mockExecutePrompt,
  })),
}));

// Mock platform adapter
const mockAdapter = {
  getCommentThread: vi.fn(),
  getUnresolvedCommentThreads: vi.fn(),
  postCommentReply: vi.fn(),
  resolveCommentThread: vi.fn(),
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

vi.mock("../config.js", () => ({
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
      const snippet = getCodeSnippetAtHead("src/commands/types.ts", 5);
      expect(snippet).not.toContain("not found");
      expect(snippet.length).toBeGreaterThan(0);
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
        { pr: 42, ci: false, commentId: "123", resolve: true, dryRun: false },
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

    it("logs proposed reply in dry run mode without posting", async () => {
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

      await executeReplyCommand(
        { pr: 10, ci: false, dryRun: true, resolve: true },
        { output: mockOutput }
      );

      expect(mockAdapter.postCommentReply).not.toHaveBeenCalled();
      expect(mockAdapter.resolveCommentThread).not.toHaveBeenCalled();
      expect(mockOutput.log).toHaveBeenCalledWith(
        expect.stringContaining("[DRY RUN] Proposed Reply for Thread 99:")
      );
    });
  });
});
