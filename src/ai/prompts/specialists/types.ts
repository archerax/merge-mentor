import type { FileReviewResult } from "../../../platforms/types.js";

/**
 * Language types supported by specialist reviews.
 */
type SupportedLanguage = "csharp" | "typescript" | "unknown";

/**
 * Context for testing specialist reviews.
 */
export interface TestingReviewContext {
  /** The production file being reviewed */
  readonly filename: string;
  /** Corresponding test file(s) if they exist */
  readonly testFiles: readonly string[];
  /** Language of the file */
  readonly language: SupportedLanguage;
  /** All changed files in the PR for reference */
  readonly allChangedFiles: readonly string[];
}

/**
 * Context for cross-file testing analysis.
 */
export interface TestingCrossFileContext {
  /** Results from individual file reviews */
  readonly fileReviewResults: readonly FileReviewResult[];
  /** Mapping of production files to their test counterparts */
  readonly productionToTestMap: ReadonlyMap<string, string | undefined>;
  /** List of all changed files */
  readonly allChangedFiles: readonly string[];
  /** Summary of files changed in the PR */
  readonly filesSummary: string;
}
