import type { FileReviewResult } from "../../../platforms/types.js";

/**
 * Language types supported by specialist reviews.
 */
type SupportedLanguage = "csharp" | "typescript" | "unknown";

/**
 * Base context shared by all cross-file specialist reviews.
 */
export interface BaseCrossFileContext {
  readonly filesSummary: string;
  readonly fileReviewResults: readonly FileReviewResult[];
}

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
export interface TestingCrossFileContext extends BaseCrossFileContext {
  /** Mapping of production files to their test counterparts */
  readonly productionToTestMap: ReadonlyMap<string, string | undefined>;
  /** List of all changed files */
  readonly allChangedFiles: readonly string[];
}
