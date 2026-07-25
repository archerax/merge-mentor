import path from "node:path";
import type {
  AIProviderClient,
  AIResponse,
  ExecutePromptOptions,
  FastReviewResult,
} from "../ai/types.js";
import { CorpusEvalError } from "../errors/index.js";
import type { CrossFileReviewResult, FileReviewResult } from "../platforms/types.js";
import type { FileSystem } from "../ports/fileSystem.js";
import { nodeFs } from "../ports/fileSystem.js";

export interface MockAIProviderOptions {
  /** Directory of the scenario containing mock-response.json. */
  readonly scenarioDir?: string;
  /** In-memory mock response object or JSON string to return. */
  readonly mockResponse?: unknown;
  /** Custom FileSystem implementation. */
  readonly fileSystem?: FileSystem;
}

/**
 * Mock AI provider for deterministic evaluation harness test runs.
 *
 * Reads fixture responses from `mock-response.json` within scenario directories
 * or returns pre-configured mock responses without making external API calls.
 */
export class MockAIProvider implements AIProviderClient {
  private readonly scenarioDir?: string;
  private mockResponse?: unknown;
  private readonly fileSystem: FileSystem;

  constructor(options?: MockAIProviderOptions) {
    this.scenarioDir = options?.scenarioDir;
    this.mockResponse = options?.mockResponse;
    this.fileSystem = options?.fileSystem ?? nodeFs;
  }

  /** Explicitly set or override the mock response object or raw string. */
  public setMockResponse(response: unknown): void {
    this.mockResponse = response;
  }

  public async executePrompt(_prompt: string, options?: ExecutePromptOptions): Promise<AIResponse> {
    if (this.mockResponse !== undefined) {
      return this.formatResponse(this.mockResponse);
    }

    const dirPath = this.scenarioDir ?? options?.workingDirectory;
    if (!dirPath) {
      throw new CorpusEvalError(
        undefined,
        "MockAIProvider requires scenarioDir or workingDirectory in options to load mock-response.json"
      );
    }

    const mockFilePath = path.join(dirPath, "mock-response.json");
    try {
      const content = await this.fileSystem.readFile(mockFilePath, "utf-8");
      const parsed = JSON.parse(content);
      return this.formatResponse(parsed);
    } catch (error) {
      if (error instanceof CorpusEvalError) {
        throw error;
      }
      throw new CorpusEvalError(
        path.basename(dirPath),
        `Failed to load mock response from "${mockFilePath}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  public parseFileReview(filename: string, response: AIResponse): FileReviewResult {
    const parsed = response.parsed as Record<string, unknown> | null;
    if (parsed && Array.isArray(parsed.fileResults)) {
      const match = parsed.fileResults.find(
        (fr: unknown) =>
          typeof fr === "object" &&
          fr !== null &&
          "filename" in fr &&
          (fr as { filename: string }).filename === filename
      );
      if (match) {
        return match as FileReviewResult;
      }
    }
    if (parsed && Array.isArray(parsed.findings)) {
      return {
        filename,
        findings: parsed.findings as FileReviewResult["findings"],
      };
    }
    return {
      filename,
      findings: [],
    };
  }

  public parseCrossFileReview(response: AIResponse): CrossFileReviewResult {
    const parsed = response.parsed as Record<string, unknown> | null;
    if (parsed && typeof parsed.overallAssessment === "string" && Array.isArray(parsed.findings)) {
      return {
        overallAssessment: parsed.overallAssessment,
        findings: parsed.findings as CrossFileReviewResult["findings"],
        recommendations: Array.isArray(parsed.recommendations)
          ? (parsed.recommendations as string[])
          : [],
      };
    }
    return {
      overallAssessment: "No cross-file issues identified.",
      findings: [],
      recommendations: [],
    };
  }

  public parseBatchedFileReview(response: AIResponse): FileReviewResult[] {
    const parsed = response.parsed as Record<string, unknown> | null;
    if (parsed && Array.isArray(parsed.fileResults)) {
      return parsed.fileResults as FileReviewResult[];
    }
    if (Array.isArray(response.parsed)) {
      return response.parsed as FileReviewResult[];
    }
    return [];
  }

  public parseFastReview(response: AIResponse): FastReviewResult {
    const parsed = response.parsed as Record<string, unknown> | null;
    if (parsed) {
      const fileResults = Array.isArray(parsed.fileResults)
        ? (parsed.fileResults as FileReviewResult[])
        : [];
      const crossFileResult =
        parsed.crossFileResult && typeof parsed.crossFileResult === "object"
          ? (parsed.crossFileResult as CrossFileReviewResult)
          : {
              overallAssessment: "No cross-file issues identified.",
              findings: [],
              recommendations: [],
            };
      return { fileResults, crossFileResult };
    }
    return {
      fileResults: [],
      crossFileResult: {
        overallAssessment: "No cross-file issues identified.",
        findings: [],
        recommendations: [],
      },
    };
  }

  private formatResponse(data: unknown): AIResponse {
    const raw = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    let parsed: unknown = data;
    if (typeof data === "string") {
      try {
        parsed = JSON.parse(data);
      } catch {
        parsed = { raw: data };
      }
    }
    return {
      raw,
      parsed,
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 50,
        model: "mock-eval-model",
      },
    };
  }
}
