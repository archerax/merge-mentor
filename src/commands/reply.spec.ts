import { beforeEach, describe, expect, it, vi } from "vitest";
import { nodeFs } from "../ports/index.js";
import { executeReplyCommand } from "./reply.js";

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
  getCommentThread: vi.fn(),
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

// Mock config
vi.mock("../config.js", () => ({
  loadConfig: vi.fn(() => ({
    defaultPlatform: "github",
    github: { token: "token", owner: "owner", repo: "repo" },
    botCommentIdentifier: "<!-- merge-mentor -->",
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

describe("executeReplyCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(nodeFs, "readFile").mockResolvedValue(
      "line 1\nline 2\nline 3\n👉 target line\nline 5"
    );
  });

  it("processes specified comment-id and resolves thread when AI says shouldResolve: true", async () => {
    mockAdapter.getCommentThread.mockResolvedValueOnce({
      threadId: "thread-123",
      path: "src/test.ts",
      line: 4,
      comments: [{ id: 1, author: "user1", body: "Could you fix this?" }],
    });

    mockExecutePrompt.mockResolvedValueOnce({
      raw: JSON.stringify({
        reply: "I have fixed it",
        shouldResolve: true,
      }),
      parsed: {
        reply: "I have fixed it",
        shouldResolve: true,
      },
    });

    await executeReplyCommand(
      {
        pr: 123,
        ci: false,
        commentId: "comment-456",
        dryRun: false,
      },
      { output: mockOutput }
    );

    expect(mockAdapter.getCommentThread).toHaveBeenCalledWith(123, "comment-456");
    expect(mockAdapter.postCommentReply).toHaveBeenCalledWith(123, "thread-123", "I have fixed it");
    expect(mockAdapter.resolveCommentThread).toHaveBeenCalledWith(123, "thread-123");
  });

  it("processes specified comment-id and does not resolve thread when AI says shouldResolve: false", async () => {
    mockAdapter.getCommentThread.mockResolvedValueOnce({
      threadId: "thread-123",
      path: "src/test.ts",
      line: 4,
      comments: [{ id: 1, author: "user1", body: "Could you fix this?" }],
    });

    mockExecutePrompt.mockResolvedValueOnce({
      raw: JSON.stringify({
        reply: "No, let's discuss this.",
        shouldResolve: false,
      }),
      parsed: {
        reply: "No, let's discuss this.",
        shouldResolve: false,
      },
    });

    await executeReplyCommand(
      {
        pr: 123,
        ci: false,
        commentId: "comment-456",
        dryRun: false,
      },
      { output: mockOutput }
    );

    expect(mockAdapter.postCommentReply).toHaveBeenCalledWith(
      123,
      "thread-123",
      "No, let's discuss this."
    );
    expect(mockAdapter.resolveCommentThread).not.toHaveBeenCalled();
  });

  it("scans unresolved comment threads and replies if bot was the initiator and user was the last commenter", async () => {
    mockAdapter.getUnresolvedCommentThreads.mockResolvedValueOnce([
      {
        id: "thread-999",
        path: "src/main.ts",
        line: 2,
        comments: [
          { author: "bot", body: "<!-- merge-mentor --> Please change this." },
          { author: "developer", body: "Okay, I modified it." },
        ],
      },
      {
        id: "thread-888",
        path: "src/utils.ts",
        line: 1,
        comments: [
          { author: "bot", body: "<!-- merge-mentor --> Clean this up." },
          { author: "bot", body: "<!-- merge-mentor --> Done." }, // Last comment is bot
        ],
      },
    ]);

    mockAdapter.getCommentThread.mockResolvedValueOnce({
      threadId: "thread-999",
      path: "src/main.ts",
      line: 2,
      comments: [
        { id: 10, author: "bot", body: "<!-- merge-mentor --> Please change this." },
        { id: 11, author: "developer", body: "Okay, I modified it." },
      ],
    });

    mockExecutePrompt.mockResolvedValueOnce({
      raw: JSON.stringify({
        reply: "Great, looks good!",
        shouldResolve: true,
      }),
      parsed: {
        reply: "Great, looks good!",
        shouldResolve: true,
      },
    });

    await executeReplyCommand(
      {
        pr: 123,
        ci: false,
        dryRun: false,
      },
      { output: mockOutput }
    );

    expect(mockAdapter.getUnresolvedCommentThreads).toHaveBeenCalledWith(123);
    expect(mockAdapter.getCommentThread).toHaveBeenCalledWith(123, "thread-999");
    expect(mockAdapter.getCommentThread).not.toHaveBeenCalledWith(123, "thread-888"); // Skipped
    expect(mockAdapter.postCommentReply).toHaveBeenCalledWith(
      123,
      "thread-999",
      "Great, looks good!"
    );
    expect(mockAdapter.resolveCommentThread).toHaveBeenCalledWith(123, "thread-999");
  });

  it("skips actual posting/resolution in dry-run mode", async () => {
    mockAdapter.getCommentThread.mockResolvedValueOnce({
      threadId: "thread-123",
      path: "src/test.ts",
      line: 4,
      comments: [{ id: 1, author: "user1", body: "Could you fix this?" }],
    });

    mockExecutePrompt.mockResolvedValueOnce({
      raw: JSON.stringify({
        reply: "I would reply this",
        shouldResolve: true,
      }),
      parsed: {
        reply: "I would reply this",
        shouldResolve: true,
      },
    });

    await executeReplyCommand(
      {
        pr: 123,
        ci: false,
        commentId: "comment-456",
        dryRun: true,
      },
      { output: mockOutput }
    );

    expect(mockAdapter.postCommentReply).not.toHaveBeenCalled();
    expect(mockAdapter.resolveCommentThread).not.toHaveBeenCalled();
  });

  it("logs JsonParseError when AI response is not valid JSON", async () => {
    mockAdapter.getCommentThread.mockResolvedValueOnce({
      threadId: "thread-123",
      path: "src/test.ts",
      line: 4,
      comments: [{ id: 1, author: "user1", body: "Could you fix this?" }],
    });

    mockExecutePrompt.mockResolvedValueOnce({
      raw: "invalid json string",
      parsed: undefined,
    });

    await executeReplyCommand(
      {
        pr: 123,
        ci: false,
        commentId: "comment-456",
        dryRun: false,
      },
      { output: mockOutput }
    );

    expect(mockOutput.log).toHaveBeenCalledWith(expect.stringContaining("Failed to parse JSON"));
  });

  it("logs ValidationError when AI response does not match the schema", async () => {
    mockAdapter.getCommentThread.mockResolvedValueOnce({
      threadId: "thread-123",
      path: "src/test.ts",
      line: 4,
      comments: [{ id: 1, author: "user1", body: "Could you fix this?" }],
    });

    mockExecutePrompt.mockResolvedValueOnce({
      raw: JSON.stringify({ wrongField: "something" }),
      parsed: undefined,
    });

    await executeReplyCommand(
      {
        pr: 123,
        ci: false,
        commentId: "comment-456",
        dryRun: false,
      },
      { output: mockOutput }
    );

    expect(mockOutput.log).toHaveBeenCalledWith(expect.stringContaining("Validation failed"));
  });
});
