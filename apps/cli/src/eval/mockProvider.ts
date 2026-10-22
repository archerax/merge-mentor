import path from "node:path";

import type {
  AIProviderClient,
  AIResponse,
  ExecutePromptOptions,
  FastReviewResult,
} from "@merge-mentor/core/ai/types.js";
import type { CrossFileReviewResult, FileReviewResult } from "@merge-mentor/domain/platform.js";
import { CorpusEvalError } from "@merge-mentor/shared/errors/index.js";
import type { FileSystem } from "@merge-mentor/shared/ports/fileSystem.js";
import { nodeFs } from "@merge-mentor/shared/ports/fileSystem.js";

/** Options for configuring a MockAIProvider. */
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
  /** Files listed in the prompt that produced each response, so parsing can be scoped per call. */
  private readonly promptFiles = new WeakMap<AIResponse, readonly string[]>();
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

  /**
   * Executes a prompt and returns a mock AI response.
   *
   * Returns the configured in-memory mock response when set, otherwise loads
   * and parses `mock-response.json` from the scenario directory (or the
   * working directory in options). Makes no external API calls.
   *
   * @param prompt - The prompt text; only its file listing is read, so batched reviews
   *   get results scoped to the files in each call
   * @param options - Execution options providing the working directory
   * @returns The formatted mock AI response
   * @throws {CorpusEvalError} When no mock response is configured and none can be loaded
   */
  public async executePrompt(prompt: string, options?: ExecutePromptOptions): Promise<AIResponse> {
    const response = await this.loadResponse(options);
    const files = extractPromptFiles(prompt);
    if (files.length > 0) {
      this.promptFiles.set(response, files);
    }
    return response;
  }

  private async loadResponse(options?: ExecutePromptOptions): Promise<AIResponse> {
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

  /**
   * Extracts the file review result for a given filename from a mock response.
   *
   * Looks up the file in `parsed.fileResults`, falling back to `parsed.findings`
   * for single-file responses, and an empty findings list when neither is present.
   *
   * @param filename - The file to extract a review result for
   * @param response - The mock AI response
   * @returns The file review result for the requested filename
   */
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

  /**
   * Extracts the cross-file review result from a mock response.
   *
   * Returns the parsed `overallAssessment` and `findings` when present, otherwise
   * a default result indicating no cross-file issues.
   *
   * @param response - The mock AI response
   * @returns The cross-file review result
   */
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

  /**
   * Extracts the batched file review results from a mock response.
   *
   * Reads `parsed.fileResults` when present, or treats the parsed payload as a
   * direct array of file results, falling back to an empty list.
   *
   * @param response - The mock AI response
   * @returns The list of file review results
   */
  public parseBatchedFileReview(response: AIResponse): FileReviewResult[] {
    const parsed = response.parsed as Record<string, unknown> | null;
    if (parsed && Array.isArray(parsed.fileResults)) {
      return this.scopeToPromptFiles(response, parsed.fileResults as FileReviewResult[]);
    }
    if (Array.isArray(response.parsed)) {
      return this.scopeToPromptFiles(response, response.parsed as FileReviewResult[]);
    }
    return this.scopeToPromptFiles(response, []);
  }

  /**
   * Restricts file results to the files listed in the prompt that produced the
   * response and adds an empty entry for each listed file the fixture has no
   * result for, mirroring a model that reports every file. Results are returned
   * unchanged when the prompt listed no files.
   */
  private scopeToPromptFiles(
    response: AIResponse,
    results: FileReviewResult[]
  ): FileReviewResult[] {
    const files = this.promptFiles.get(response);
    if (!files) {
      return results;
    }
    const inScope = results.filter((result) => files.includes(result.filename));
    const present = new Set(inScope.map((result) => result.filename));
    return [
      ...inScope,
      ...files.filter((file) => !present.has(file)).map((filename) => ({ filename, findings: [] })),
    ];
  }

  /**
   * Extracts the fast review result from a mock response.
   *
   * Reads `parsed.fileResults` and `parsed.crossFileResult` when present, using
   * defaults for missing parts.
   *
   * @param response - The mock AI response
   * @returns The fast review result with file and cross-file results
   */
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
      return {
        fileResults: this.scopeToPromptFiles(response, fileResults),
        crossFileResult,
        reviewedFiles: [...(this.promptFiles.get(response) ?? [])],
      };
    }
    return {
      fileResults: [],
      crossFileResult: {
        overallAssessment: "No cross-file issues identified.",
        findings: [],
        recommendations: [],
      },
      reviewedFiles: [],
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

/** Matches the per-file lines of the prompt's file listing: `- path (status, +a/-d) → @diffPath`. */
const PROMPT_FILE_LINE = /^- (.+?) \(\w+, \+\d+\/-\d+\) → @/gm;

/** Extracts the changed filenames listed in a review prompt. */
function extractPromptFiles(prompt: string): string[] {
  return Array.from(prompt.matchAll(PROMPT_FILE_LINE), (match) => match[1]);
}
