import type { AIProviderType } from "../ai/types.js";
import type { FileSystem } from "../ports/fileSystem.js";
import type { OutputWriter } from "../ports/outputWriter.js";

/** Specification of an expected ground truth finding in a corpus scenario. */
export interface ExpectedFinding {
  readonly id: string;
  readonly filePath: string;
  readonly category: string;
  readonly minSeverity?: string;
  readonly containsKeywords?: readonly string[];
}

/** Specification of a forbidden false-positive finding in a corpus scenario. */
export interface ForbiddenFinding {
  readonly id: string;
  readonly filePath: string;
  readonly reason: string;
}

/** Specification of a multi-pass re-review step in a scenario. */
interface ScenarioPassConfig {
  readonly passIndex: number;
  readonly diffDir: string;
  readonly expectedSuppressedCount?: number;
}

/** Full ground truth definition for a corpus evaluation scenario. */
export interface GroundTruth {
  readonly scenarioId: string;
  readonly name: string;
  readonly description: string;
  readonly expectedFindings: readonly ExpectedFinding[];
  readonly forbiddenFindings: readonly ForbiddenFinding[];
  readonly maxAllowedDuplicates: number;
  readonly passes?: readonly ScenarioPassConfig[];
}

/** Evaluation result for a single corpus scenario. */
export interface ScenarioEvalResult {
  readonly scenarioId: string;
  readonly name: string;
  readonly passed: boolean;
  readonly recall: number;
  readonly precision: number;
  readonly duplicateCount: number;
  readonly caughtFindings: readonly string[];
  readonly missedFindings: readonly string[];
  readonly falsePositives: readonly string[];
}

/** Aggregated evaluation report across all scenarios in the corpus. */
export interface FullEvalReport {
  readonly timestamp: string;
  readonly overallPassed: boolean;
  readonly meanRecall: number;
  readonly meanPrecision: number;
  readonly totalDuplicates: number;
  readonly scenarioResults: readonly ScenarioEvalResult[];
}

/** Options for executing the evaluation harness. */
export interface EvalHarnessOptions {
  /** Path to the evaluation corpus root directory. */
  readonly corpusDir?: string;
  /** AI provider to use during evaluation (mock, copilot-sdk, opencode-sdk). */
  readonly provider?: AIProviderType | "mock";
  /** Minimum required recall threshold (0.0 - 1.0). Defaults to 0.90. */
  readonly minRecall?: number;
  /** Minimum required precision threshold (0.0 - 1.0). Defaults to 0.85. */
  readonly minPrecision?: number;
  /** Output raw JSON report. */
  readonly json?: boolean;
  /** Write report JSON to specified output path. */
  readonly outputFile?: string;
  /** Custom FileSystem implementation (for testing/mocking). */
  readonly fileSystem?: FileSystem;
  /** Custom OutputWriter for log writing. */
  readonly output?: OutputWriter;
}
