import type { AIProviderType } from "../ai/types.js";
import type { FileSystem } from "../ports/fileSystem.js";
import type { OutputWriter } from "../ports/outputWriter.js";

/** Specification of an expected ground truth finding in a corpus scenario. */
export interface ExpectedFinding {
  /** Unique identifier of the expected finding. */
  readonly id: string;
  /** File path where the finding is expected to be reported. */
  readonly filePath: string;
  /** Finding category (e.g. bug, security, performance). */
  readonly category: string;
  /** Minimum severity that still counts as a match (default: any). */
  readonly minSeverity?: string;
  /** Keywords that must appear in the reported finding text. */
  readonly containsKeywords?: readonly string[];
}

/** Specification of a forbidden false-positive finding in a corpus scenario. */
export interface ForbiddenFinding {
  /** Unique identifier of the forbidden finding. */
  readonly id: string;
  /** File path where the finding must not be reported. */
  readonly filePath: string;
  /** Explanation of why this finding must not be reported. */
  readonly reason: string;
}

/** Specification of a multi-pass re-review step in a scenario. */
interface ScenarioPassConfig {
  /** Zero-based index of the review pass. */
  readonly passIndex: number;
  /** Directory containing the diff used for this pass. */
  readonly diffDir: string;
  /** Number of findings expected to be suppressed in this pass. */
  readonly expectedSuppressedCount?: number;
}

/** Full ground truth definition for a corpus evaluation scenario. */
export interface GroundTruth {
  /** Unique identifier of the scenario. */
  readonly scenarioId: string;
  /** Human-readable name of the scenario. */
  readonly name: string;
  /** Description of the scenario being evaluated. */
  readonly description: string;
  /** Expected findings that must be caught for the scenario to pass. */
  readonly expectedFindings: readonly ExpectedFinding[];
  /** Forbidden false-positive findings that must not be reported. */
  readonly forbiddenFindings: readonly ForbiddenFinding[];
  /** Maximum number of duplicate findings tolerated before failing. */
  readonly maxAllowedDuplicates: number;
  /** Optional multi-pass re-review configuration. */
  readonly passes?: readonly ScenarioPassConfig[];
}

/** Evaluation result for a single corpus scenario. */
export interface ScenarioEvalResult {
  /** Unique identifier of the evaluated scenario. */
  readonly scenarioId: string;
  /** Human-readable name of the evaluated scenario. */
  readonly name: string;
  /** Whether the scenario passed all thresholds and constraints. */
  readonly passed: boolean;
  /** Fraction of expected findings that were caught (0.0 - 1.0). */
  readonly recall: number;
  /** Fraction of reported findings that were correct (0.0 - 1.0). */
  readonly precision: number;
  /** Number of duplicate findings reported. */
  readonly duplicateCount: number;
  /** IDs of expected findings that were correctly reported. */
  readonly caughtFindings: readonly string[];
  /** IDs of expected findings that were missed. */
  readonly missedFindings: readonly string[];
  /** IDs of findings that were reported but not expected. */
  readonly falsePositives: readonly string[];
}

/** Aggregated evaluation report across all scenarios in the corpus. */
export interface FullEvalReport {
  /** ISO timestamp of when the evaluation ran. */
  readonly timestamp: string;
  /** Whether the overall evaluation passed across all scenarios. */
  readonly overallPassed: boolean;
  /** Mean recall across all scenarios (0.0 - 1.0). */
  readonly meanRecall: number;
  /** Mean precision across all scenarios (0.0 - 1.0). */
  readonly meanPrecision: number;
  /** Total number of duplicate findings across all scenarios. */
  readonly totalDuplicates: number;
  /** Evaluation results for each scenario in the corpus. */
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
