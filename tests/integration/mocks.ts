/**
 * Mock factories for integration tests.
 * Provides mock implementations of external dependencies.
 */

import { vi } from "vitest";
import type { Config } from "../../src/config.js";
import type {
  CrossFileReviewResult,
  ExistingComment,
  FileReviewResult,
  PlatformAdapter,
  PRDetails,
  PRFile,
} from "../../src/platforms/types.js";
import {
  createCopilotCrossFileResponse,
  createCopilotFileResponse,
  createEmptyReviewResponse,
  sampleCrossFileResult,
  sampleExistingComments,
  sampleFileReviewResults,
  samplePRDetails,
  samplePRFiles,
} from "./fixtures.js";

/**
 * Creates a mock PlatformAdapter for testing.
 */
export function createMockPlatformAdapter(options?: {
  prDetails?: PRDetails;
  prFiles?: PRFile[];
  existingComments?: ExistingComment[];
  postInlineCommentError?: Error;
  postGeneralCommentError?: Error;
}): PlatformAdapter & {
  calls: {
    getPRDetails: number[];
    getPRFiles: number[];
    getExistingBotComments: number[];
    postInlineComment: Array<{ prNumber: number; path: string; line: number; body: string }>;
    postGeneralComment: Array<{ prNumber: number; body: string }>;
    updateComment: Array<{ commentId: number | string; body: string }>;
    resolveComment: Array<{ commentId: number | string }>;
  };
} {
  const calls = {
    getPRDetails: [] as number[],
    getPRFiles: [] as number[],
    getExistingBotComments: [] as number[],
    postInlineComment: [] as Array<{ prNumber: number; path: string; line: number; body: string }>,
    postGeneralComment: [] as Array<{ prNumber: number; body: string }>,
    updateComment: [] as Array<{ commentId: number | string; body: string }>,
    resolveComment: [] as Array<{ commentId: number | string }>,
  };

  return {
    calls,
    getProjectIdentifier: vi.fn(() => "test-project"),
    getPRDetails: vi.fn(async (prNumber: number) => {
      calls.getPRDetails.push(prNumber);
      return options?.prDetails ?? samplePRDetails;
    }),
    getPRFiles: vi.fn(async (prNumber: number) => {
      calls.getPRFiles.push(prNumber);
      return options?.prFiles ?? samplePRFiles;
    }),
    getExistingBotComments: vi.fn(async (prNumber: number) => {
      calls.getExistingBotComments.push(prNumber);
      return options?.existingComments ?? [];
    }),
    postInlineComment: vi.fn(async (prNumber: number, path: string, line: number, body: string) => {
      calls.postInlineComment.push({ prNumber, path, line, body });
      if (options?.postInlineCommentError) {
        throw options.postInlineCommentError;
      }
    }),
    postGeneralComment: vi.fn(async (prNumber: number, body: string) => {
      calls.postGeneralComment.push({ prNumber, body });
      if (options?.postGeneralCommentError) {
        throw options.postGeneralCommentError;
      }
    }),
    updateComment: vi.fn(async (commentId: number | string, body: string) => {
      calls.updateComment.push({ commentId, body });
    }),
    resolveComment: vi.fn(async (commentId: number | string) => {
      calls.resolveComment.push({ commentId });
    }),
  };
}

/**
 * Creates a mock CopilotClient for testing.
 * Uses vi.mock to intercept the actual CopilotClient.
 */
interface MockCopilotBehavior {
  fileReviewResponses?: Map<string, string>;
  crossFileResponse?: string;
  shouldFail?: boolean;
  failureMessage?: string;
}

/**
 * Sets up Copilot CLI mock via child_process spawn.
 */
function setupCopilotMock(behavior?: MockCopilotBehavior) {
  const responses: string[] = [];
  let responseIndex = 0;

  // Pre-populate responses based on behavior
  if (behavior?.fileReviewResponses) {
    for (const response of behavior.fileReviewResponses.values()) {
      responses.push(response);
    }
  } else {
    // Default: add sample file responses
    responses.push(createCopilotFileResponse("src/auth/login.ts"));
    responses.push(createCopilotFileResponse("src/auth/middleware.ts"));
    responses.push(createEmptyReviewResponse()); // For README.md
  }

  // Add cross-file response
  responses.push(behavior?.crossFileResponse ?? createCopilotCrossFileResponse());

  return {
    getNextResponse: () => {
      if (behavior?.shouldFail) {
        throw new Error(behavior.failureMessage ?? "Copilot CLI failed");
      }
      const response = responses[responseIndex] ?? createEmptyReviewResponse();
      responseIndex++;
      return response;
    },
    reset: () => {
      responseIndex = 0;
    },
    getCallCount: () => responseIndex,
  };
}

/**
 * Creates a test configuration.
 */
export function createTestConfig(overrides?: Partial<Config>): Config {
  return {
    defaultPlatform: "github",
    botCommentIdentifier: "[TestBot]",
    github: {
      token: "test-github-token",
      owner: "test-owner",
      repo: "test-repo",
    },
    azure: {
      token: "test-azure-token",
      org: "test-org",
      project: "test-project",
      repo: "test-repo",
    },
    copilotModel: "gpt-4",
    copilotTimeoutMs: 30000,
    commentFilter: {
      minConfidence: "high",
      skipPreExisting: true,
      postResolutionComments: true,
    },
    ...overrides,
  };
}

/**
 * Mock for child_process.spawn used by CopilotClient.
 */
function _createSpawnMock(copilotMock: ReturnType<typeof setupCopilotMock>) {
  return vi.fn((_command: string, _args: string[]) => {
    const stdout = {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === "data") {
          try {
            const response = copilotMock.getNextResponse();
            callback(Buffer.from(response));
          } catch (_error) {
            // Error will be handled in the close event
          }
        }
      }),
    };
    const stderr = {
      on: vi.fn(),
    };

    return {
      stdout,
      stderr,
      on: vi.fn((event: string, callback: (code: number | null) => void) => {
        if (event === "close") {
          // Simulate async behavior
          setTimeout(() => callback(0), 10);
        }
      }),
    };
  });
}

/**
 * Creates expected review results for assertions.
 */
function _getExpectedFileResults(): FileReviewResult[] {
  return sampleFileReviewResults;
}

function _getExpectedCrossFileResult(): CrossFileReviewResult {
  return sampleCrossFileResult;
}

function _getExpectedExistingComments(): ExistingComment[] {
  return sampleExistingComments;
}
