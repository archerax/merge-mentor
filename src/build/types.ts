import type { AIProviderClient } from "../ai/types.js";

/** Supported CI platforms that can be analyzed. */
export type BuildPlatform = "github" | "azure";
/**
 * Category of build failure.
 *
 * Used to classify the root cause of a failed build and to drive the
 * confidence of the associated diagnosis.
 */
export type FailureType =
  | "compilation"
  | "test"
  | "lint"
  | "dependency"
  | "infrastructure"
  | "timeout"
  | "unknown";

/**
 * Identifies a single CI build to analyze.
 *
 * Normalizes GitHub Actions workflow runs and Azure Pipelines builds into one
 * shape the analysis engine can consume.
 */
export interface BuildReference {
  /** The CI platform the build ran on. */
  readonly platform: BuildPlatform;
  /** Platform-specific build ID (GitHub workflow run ID or Azure build ID). */
  readonly id: string;
  /** Repository owner or organization (GitHub) or organization (Azure). */
  readonly ownerOrOrg: string;
  /** Repository name within the owner or organization. */
  readonly repository: string;
  /** Azure DevOps project name; only set for Azure builds. */
  readonly project?: string;
}

/**
 * Summary metadata for a CI build.
 *
 * Normalizes platform-specific build state into a common status/result model.
 */
export interface BuildSummary {
  /** Platform-specific build ID. */
  readonly id: string;
  /** Human-readable build name or build number. */
  readonly name: string;
  /** Whether the build is still running, finished, or in an unknown state. */
  readonly status: "completed" | "inProgress" | "unknown";
  /** Overall outcome of a finished build. */
  readonly result: "failed" | "partiallySucceeded" | "succeeded" | "unknown";
  /** Branch the build ran against, when known. */
  readonly sourceBranch?: string;
  /** Commit SHA the build ran against, when known. */
  readonly commitSha?: string;
  /** URL to the build's page on the platform, when available. */
  readonly webUrl?: string;
  /** ISO timestamp of when the build started, when known. */
  readonly startedAt?: string;
  /** ISO timestamp of when the build finished, when known. */
  readonly finishedAt?: string;
}

/**
 * A portion of a failed build's log output.
 *
 * A chunk represents one isolated unit of log content (for example, one failed
 * Azure log entry or one failed GitHub Actions job) tagged with enough context
 * to trace it back to the original build.
 */
export interface BuildLogChunk {
  /** Name of the CI job the chunk came from, when known. */
  readonly jobName?: string;
  /** Name of the pipeline stage the chunk came from, when known. */
  readonly stageName?: string;
  /** Name of the step or task the chunk came from, when known. */
  readonly stepName?: string;
  /** Ordering index of the chunk within the build logs. */
  readonly sequence?: number;
  /** The raw log text of the chunk. */
  readonly content: string;
  /** Whether the platform flagged this chunk as related to the failure. */
  readonly isFailureCandidate: boolean;
}

/**
 * Adapter interface for fetching build summaries and failure logs from a CI platform.
 */
export interface BuildAnalysisProvider {
  /** Fetches summary metadata for the referenced build. */
  getBuildSummary(reference: BuildReference): Promise<BuildSummary>;
  /** Fetches the log chunks most relevant to the build's failure. */
  getFailedLogs(reference: BuildReference): Promise<BuildLogChunk[]>;
}

/**
 * A single curated piece of evidence extracted from the build logs.
 *
 * Evidence blocks are deduplicated, redacted, and classified snippets of log
 * output that are handed to the AI provider for diagnosis.
 */
export interface EvidenceBlock {
  /** Stable identifier (e.g. `E1`) used to cite the block in a diagnosis. */
  readonly id: string;
  /** Failure category the block was classified into. */
  readonly category: FailureType;
  /** Confidence (0..1) that the block relates to the failure. */
  readonly confidence: number;
  /** The redacted log snippet. */
  readonly content: string;
  /** Job the block came from, when known. */
  readonly jobName?: string;
  /** Ordering index of the source chunk within the build logs. */
  readonly sequence?: number;
}

/**
 * The evidence prepared for analysis after normalization.
 */
export interface PreparedEvidence {
  /** The curated evidence blocks, in priority order. */
  readonly blocks: readonly EvidenceBlock[];
  /** Whether evidence was truncated to fit the byte budget. */
  readonly truncated: boolean;
  /** Whether any secrets were redacted from the evidence. */
  readonly redacted: boolean;
}

/**
 * A persisted copy of a build log chunk stored on disk.
 */
export interface LogArtifact {
  /** Filename of the artifact within the artifact directory. */
  readonly filename: string;
  /** Absolute path to the stored log file. */
  readonly path: string;
  /** Job the artifact came from, when known. */
  readonly jobName?: string;
  /** Pipeline stage the artifact came from, when known. */
  readonly stageName?: string;
  /** Step or task the artifact came from, when known. */
  readonly stepName?: string;
  /** Ordering index of the source chunk within the build logs. */
  readonly sequence?: number;
  /** A redacted tail of the log content for inline prompt context. */
  readonly tail: string;
}

/**
 * The final diagnosis of a failed build.
 *
 * Produced by the AI provider when available, or by the deterministic
 * fallback when it is not.
 */
export interface BuildDiagnosis {
  /** Category of the failure. */
  readonly failureType: FailureType;
  /** Confidence (0..1) in the diagnosis. */
  readonly confidence: number;
  /** Short human-readable summary of the failure. */
  readonly summary: string;
  /** Explanation of the underlying root cause. */
  readonly rootCause: string;
  /** Evidence IDs and artifact citations that support the diagnosis. */
  readonly evidence: readonly string[];
  /** Files implicated by the failure. */
  readonly affectedFiles: readonly { path: string; line?: number; column?: number }[];
  /** Suggested next steps for fixing the failure. */
  readonly recommendations: readonly string[];
  /** Known gaps or caveats of the diagnosis. */
  readonly limitations: readonly string[];
}

/**
 * The complete result of a build analysis.
 */
export interface BuildAnalysisResult {
  /** Summary metadata of the analyzed build. */
  readonly summary: BuildSummary;
  /** The evidence prepared for and presented to the analysis. */
  readonly evidence: PreparedEvidence;
  /** The diagnosis reached for the build. */
  readonly diagnosis: BuildDiagnosis;
  /** The rendered markdown report. */
  readonly report: string;
  /** Directory where log artifacts were stored, when any were written. */
  readonly logDirectory?: string;
}

/**
 * Options controlling how a build analysis is executed.
 */
export interface BuildAnalysisOptions {
  /** Maximum number of log bytes to capture as evidence. */
  readonly maxLogBytes?: number;
  /** AI provider used to produce the diagnosis; when omitted a fallback diagnosis is used. */
  readonly aiProvider?: AIProviderClient;
  /** Directory under which log artifacts are stored. */
  readonly tempPath?: string;
  /** Number of trailing log lines kept per stored artifact. */
  readonly initialTailLines?: number;
  /** Maximum number of tail bytes kept per stored artifact. */
  readonly initialTailBytes?: number;
  /** File system abstraction used for artifact storage; defaults to `node:fs`. */
  readonly fileSystem?: import("../ports/index.js").FileSystem;
}
