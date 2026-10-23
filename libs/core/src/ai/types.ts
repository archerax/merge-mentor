import type { ReasoningEffort } from "@merge-mentor/config/config.js";
import type { TokenUsage } from "@merge-mentor/domain/ai.js";
import type { CrossFileReviewResult, FileReviewResult } from "@merge-mentor/domain/platform.js";
import type { Clock } from "@merge-mentor/shared/ports/clock.js";
import type { ExecutableFinder } from "@merge-mentor/shared/ports/executableFinder.js";
import type { FileSystem } from "@merge-mentor/shared/ports/fileSystem.js";
import type { OutputWriter } from "@merge-mentor/shared/ports/outputWriter.js";
import type { ProcessRunner } from "@merge-mentor/shared/ports/processRunner.js";

/** Combined result from fast review (single-pass file + cross-file analysis). */
export interface FastReviewResult {
  /** Per-file review results split from the flat findings list. */
  readonly fileResults: FileReviewResult[];
  /** Cross-file review result built from the non-file findings and summary. */
  readonly crossFileResult: CrossFileReviewResult;
  /**
   * Files the model returned a `file_results` entry for, used to verify per-file
   * coverage. Empty means the model reported no files, which the engine treats as
   * nothing reviewed.
   */
  readonly reviewedFiles: string[];
}

export type { AIProviderType, ReasoningEffort } from "@merge-mentor/config/config.js";
export type { TokenUsage } from "@merge-mentor/domain/ai.js";

/** Response from executing an AI prompt. */
export interface AIResponse {
  /** Raw text returned by the AI provider. */
  readonly raw: string;
  /** Parsed JSON extracted from the raw response, or null when parsing failed. */
  readonly parsed: unknown;
  /** Token usage statistics accumulated across attempts, when available. */
  readonly tokenUsage?: TokenUsage;
}

/** Options for configuring AI providers. */
export interface AIProviderOptions {
  /** Maximum number of attempts per prompt execution. Defaults to DEFAULT_MAX_RETRIES. */
  readonly maxRetries?: number;
  /** Per-operation timeout in milliseconds. Defaults to DEFAULT_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Model identifier; defaults to provider-specific auto-selection. */
  readonly model?: string;
  /** Optional authentication token (e.g. a GitHub PAT) for the provider. */
  readonly token?: string;
  /** Generic OpenAI-compatible BYOK base URL for AI providers that support it. */
  readonly aiBaseUrl?: string;
  /** Generic BYOK API key for AI providers that support it. */
  readonly aiApiKey?: string;
  /** Base path for temporary files (temp, transcripts). */
  readonly tempPath?: string;
  /** Finds executables on PATH (defaults to system finder). */
  readonly executableFinder?: ExecutableFinder;
  /** Runs child processes (defaults to node child_process). */
  readonly processRunner?: ProcessRunner;
  /** Filesystem operations (defaults to node fs/promises). */
  readonly fileSystem?: FileSystem;
  /** System clock (defaults to real clock). */
  readonly clock?: Clock;
  /** Output writer for console/terminal output. */
  readonly output?: OutputWriter;
  /** Enable postComment tool for structured output (via --experimental-tools flag). */
  readonly experimentalTools?: boolean;
  /** Pin the session to the long-context tier when the selected model supports it. */
  readonly longContext?: boolean;
  /** Reasoning effort level for models that support it. */
  readonly reasoningEffort?: ReasoningEffort;
  /** Enable write and execution tools for agentic tasks. */
  readonly enableWriteTools?: boolean;
  /**
   * Enable shell/bash execution tools for agentic tasks. Defaults to false.
   * Must never be enabled when the prompt contains untrusted input (e.g. PR
   * review comments in the fix flow): auto-approved shell execution combined
   * with prompt injection is a remote-code-execution vector.
   */
  readonly enableShellTools?: boolean;
}

/** Options for executing a prompt with additional context. */
export interface ExecutePromptOptions {
  /** Path to cloned repository for workspace access. */
  readonly workingDirectory?: string;
  /** Paths to diff files for @file references. */
  readonly diffFiles?: string[];
  /** Optional callback invoked with streaming output data chunks. */
  readonly onStreamData?: (chunk: string) => void;
  /**
   * Image files to attach to the prompt. Only send these after
   * {@link AIProviderClient.checkImageSupport} reported support for the
   * configured model; providers attach them by path.
   */
  readonly imageFiles?: readonly PromptImageFile[];
  /**
   * Directory for this request's transcripts instead of the shared
   * `<tempPath>/transcripts`. Flows that must be able to delete everything a
   * run produced (e.g. `prd`) point this into their own run directory.
   */
  readonly transcriptDir?: string;
  /**
   * Permanently delete any session state the provider keeps for this request
   * (e.g. the Copilot runtime's on-disk conversation history) once it ends.
   * Set by flows whose prompts hold confidential content that must not
   * outlive the run (e.g. `prd`).
   */
  readonly discardSession?: boolean;
  /** Hint for the type of review prompt being sent (avoids substring inference). */
  readonly promptType?:
    | "file-review"
    | "cross-file-review"
    | "batched-file-review"
    | "fast-review"
    | "build-analysis"
    | "multi-agent-subagent"
    | "multi-agent-synthesizer"
    | "plan"
    | "project"
    | "prd-section"
    | "prd-consistency"
    | "prd-image"
    | "prd-verify";
}

/** An image file attached to a prompt. */
export interface PromptImageFile {
  /** Absolute path of the image file. */
  readonly path: string;
  /** MIME type, e.g. `image/png`. */
  readonly mimeType: string;
}

/** Whether the configured provider and model accept image input. */
export type ImageInputSupport =
  | {
      readonly supported: true;
      /** Most images the model accepts in one request, when the provider reports it. */
      readonly maxImagesPerRequest?: number;
      /** Largest image in bytes the model accepts, when the provider reports it. */
      readonly maxImageBytes?: number;
      /** MIME types the model accepts, when the provider reports them. */
      readonly mediaTypes?: readonly string[];
    }
  | {
      readonly supported: false;
      /** Plain-language reason, e.g. 'the model "x" does not accept images'. */
      readonly reason: string;
    };

/**
 * Interface for AI provider implementations.
 * All providers must implement this interface for consistent behavior.
 */
export interface AIProviderClient {
  /**
   * Executes a prompt via the AI provider CLI with automatic retries.
   *
   * @param prompt - The prompt to send to the AI provider
   * @param options - Optional execution context (working directory, diff files)
   * @returns Response containing raw output and parsed JSON
   */
  executePrompt(prompt: string, options?: ExecutePromptOptions): Promise<AIResponse>;

  /**
   * Reports whether the configured model accepts image input (used by
   * `prd --include-images`). Providers that cannot tell leave this out, which
   * callers treat as "not supported". Never throws: failures to look up the
   * model are reported as not supported, with the reason.
   */
  checkImageSupport?(): Promise<ImageInputSupport>;

  /**
   * Parses an AI response into a file review result.
   *
   * @param filename - Name of the reviewed file
   * @param response - Raw AI response
   * @returns Structured file review result
   */
  parseFileReview(filename: string, response: AIResponse): FileReviewResult;

  /**
   * Parses an AI response into a cross-file review result.
   *
   * @param response - Raw AI response
   * @returns Structured cross-file review result
   */
  parseCrossFileReview(response: AIResponse): CrossFileReviewResult;

  /**
   * Parses an AI response containing batched file reviews into multiple results.
   * Used for batched review mode where all files are reviewed in a single AI call.
   *
   * @param response - Raw AI response containing results for multiple files
   * @returns Array of structured file review results
   */
  parseBatchedFileReview(response: AIResponse): FileReviewResult[];

  /**
   * Parses an AI response from fast review (combined file + cross-file analysis).
   * Splits the flat findings list into file-level and cross-file results.
   *
   * @param response - Raw AI response containing combined findings
   * @returns Combined file and cross-file review results
   */
  parseFastReview(response: AIResponse): FastReviewResult;
}
