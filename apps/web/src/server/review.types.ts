/**
 * Client-safe view models for the interactive PR reviewer.
 *
 * These types intentionally contain no server imports so route components can
 * import them without pulling the review engine or `node:fs` into the client
 * bundle.
 */

/** Input accepted by the review stream endpoint. */
export interface ReviewStreamInput {
  /** PR URL that determines platform, repository, and PR number. */
  readonly prUrl?: string;
  /** PR number, used when {@link prUrl} is not provided. */
  readonly pr?: number;
  /** Post comments to the PR. Default: `false` (dry-run). */
  readonly write?: boolean;
}

/** Input accepted by the PBI review stream endpoint. */
export interface PBIReviewStreamInput {
  /** Product Backlog Item / issue ID to review. */
  readonly id?: string;
  /** Work item URL that determines platform, repository, and item ID. */
  readonly url?: string;
  /** Post the review comment to the work item. Default: `false` (dry-run). */
  readonly write?: boolean;
}

/** Input accepted by the project review stream endpoint. */
export interface ProjectReviewStreamInput {
  /** Project root / Epic work item ID to review. */
  readonly id?: string;
  /** Work item URL that determines platform, repository, and item ID. */
  readonly url?: string;
  /** Post the review comment to the work item. Default: `false` (dry-run). */
  readonly write?: boolean;
}

/** A single finding rendered in the review result. */
export interface ReviewFindingView {
  /** File the finding applies to, when known. */
  readonly file?: string;
  /** Line number the finding refers to. */
  readonly line: number;
  /** Severity level (critical, high, medium, low). */
  readonly severity: string;
  /** Finding category (bug, security, quality, etc.). */
  readonly category: string;
  /** Human-readable description of the issue. */
  readonly message: string;
  /** Suggested fix or improvement. */
  readonly suggestion?: string;
  /** Whether the issue pre-existed the PR. */
  readonly isPreExisting?: boolean;
}

/** Final summary of a completed review. */
export interface ReviewSummary {
  /** Platform reviewed. */
  readonly platform: "github" | "azure";
  /** PR number. */
  readonly number: number;
  /** PR title. */
  readonly title: string;
  /** PR author. */
  readonly author: string;
  /** Base branch the PR merges into. */
  readonly baseBranch: string;
  /** Head branch the PR sources from. */
  readonly headBranch: string;
  /** Link to the PR on the platform. */
  readonly url: string;
  /** Number of files reviewed. */
  readonly filesReviewed: number;
  /** Number of files skipped as unchanged or without a diff. */
  readonly filesSkipped: number;
  /** Number of files excluded by ignore patterns. */
  readonly filesIgnored: number;
  /** Total lines added across reviewed files. */
  readonly linesAdded: number;
  /** Total lines deleted across reviewed files. */
  readonly linesDeleted: number;
  /** File-level findings. */
  readonly findings: readonly ReviewFindingView[];
  /** Cross-file findings. */
  readonly crossFileFindings: readonly ReviewFindingView[];
  /** High-level cross-file assessment. */
  readonly overallAssessment: string;
  /** Cross-file recommendations. */
  readonly recommendations: readonly string[];
  /** Comments created (or planned in dry-run mode). */
  readonly commentsCreated: number;
  /** Comment posting errors. */
  readonly commentErrors: readonly string[];
  /** Whether the review ran in dry-run mode. */
  readonly dryRun: boolean;
}

/**
 * Server-Sent Event payloads streamed while a review runs.
 *
 * Every frame carries one of these JSON objects under a `data:` line so the
 * client can render raw output live before the final result summary. The result
 * payload type is generic so each review kind can supply its own summary view.
 */
export type ReviewStreamEvent<TResult = ReviewSummary> =
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "log"; readonly message: string }
  | { readonly type: "chunk"; readonly text: string }
  | { readonly type: "result"; readonly summary: TResult }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "done" };

/** Final summary of a completed PBI review. */
export interface PBIReviewSummary {
  /** Work item ID that was reviewed. */
  readonly id: string;
  /** Work item title, as resolved by the platform or model. */
  readonly title: string;
  /** Holistic narrative assessment of backlog quality. */
  readonly overallAssessment: string;
  /** Actionable suggestions for improving the item. */
  readonly suggestions: readonly string[];
  /** Whether the review ran in dry-run mode. */
  readonly dryRun: boolean;
}

/** A single structured finding from a project plan review. */
export interface ProjectReviewFindingView {
  /** Work item ID the finding applies to. */
  readonly workItemId: string;
  /** Evaluation dimension (completeness, dependency, acceptance_criteria, estimation). */
  readonly dimension: string;
  /** Severity level (critical, high, medium, low). */
  readonly severity: string;
  /** Description of the issue. */
  readonly issue: string;
  /** Recommended remediation, when provided. */
  readonly recommendation: string;
}

/** Final summary of a completed project plan review. */
export interface ProjectReviewSummary {
  /** Work item ID that was reviewed. */
  readonly id: string;
  /** Plan title, as resolved by the platform or model. */
  readonly title: string;
  /** Prose rollup for plan completeness and gaps. */
  readonly completenessAssessment: string;
  /** Prose rollup for dependency and sequencing risks. */
  readonly dependencyRisks: string;
  /** Prose rollup for acceptance criteria alignment. */
  readonly acceptanceCriteriaAlignment: string;
  /** Prose rollup for estimation and scope consistency. */
  readonly estimationConsistency: string;
  /** Holistic assessment of plan health and readiness. */
  readonly overallAssessment: string;
  /** Model confidence in the assessment. */
  readonly confidence: string;
  /** Structured findings. */
  readonly findings: readonly ProjectReviewFindingView[];
  /** Actionable suggestions for improving the plan. */
  readonly suggestions: readonly string[];
  /** Whether the review ran in dry-run mode. */
  readonly dryRun: boolean;
}
