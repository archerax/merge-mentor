/** Details about a pull request. */
export interface PRDetails {
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly author: string;
  readonly baseBranch: string;
  readonly headBranch: string;
}

/** File status in a pull request. */
export type FileStatus = "added" | "modified" | "deleted" | "renamed";

/** A file changed in a pull request. */
export interface PRFile {
  readonly filename: string;
  readonly status: FileStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly patch?: string;
  readonly sha?: string;
}

/** Severity levels for code review findings. */
export type FindingSeverity = "critical" | "high" | "medium" | "low";

/** Categories of code review findings. */
export type FindingCategory =
  | "bug"
  | "security"
  | "performance"
  | "quality"
  | "documentation"
  | "architecture"
  | "design"
  | "testing";

/** Confidence levels for findings. */
export type FindingConfidence = "high" | "medium" | "low";

/** A finding from reviewing a specific file. */
export interface FileFinding {
  readonly line: number;
  readonly severity: FindingSeverity;
  readonly confidence: FindingConfidence;
  readonly category: FindingCategory;
  readonly message: string;
  readonly suggestion: string;
  /**
   * Concise evidence-based rationale explaining why this is an issue.
   * Should cite the changed code or checked context and the concrete impact.
   */
  readonly reasoning: string;
  /** Whether this issue existed before the PR (in the base branch). */
  readonly isPreExisting?: boolean;
}

/** A finding that spans multiple files. */
export interface CrossFileFinding {
  readonly severity: FindingSeverity;
  readonly confidence: FindingConfidence;
  readonly category: FindingCategory;
  readonly message: string;
  /**
   * Concise evidence-based rationale explaining why this is a cross-file issue.
   * Should cite the affected files, their relationship, and the concrete system impact.
   */
  readonly reasoning: string;
  readonly affectedFiles: readonly string[];
}

/** Result of reviewing a single file. */
export interface FileReviewResult {
  readonly filename: string;
  readonly findings: readonly FileFinding[];
}

/** Result of cross-file analysis. */
export interface CrossFileReviewResult {
  readonly overallAssessment: string;
  readonly findings: readonly CrossFileFinding[];
  readonly recommendations: readonly string[];
}

/** An existing bot comment on a PR. */
export interface ExistingComment {
  readonly id: number | string;
  readonly body: string;
  readonly path?: string;
  readonly line?: number;
  readonly isResolved?: boolean;
}

/** Action types for comment management. */
export type CommentActionType = "create";

/** An action to perform on a comment. */
export interface CommentAction {
  readonly type: CommentActionType;
  readonly existingCommentId?: number | string;
  readonly path?: string;
  readonly line?: number;
  readonly body?: string;
}

/** Repository information for context loading. */
export interface RepoInfo {
  readonly owner: string;
  readonly repo: string;
  readonly platform: "github" | "azure";
  /** For Azure DevOps: organization name */
  readonly org?: string;
  /** For Azure DevOps: project name */
  readonly project?: string;
}

/**
 * Platform adapter interface for GitHub and Azure DevOps.
 * Implementations handle platform-specific API interactions.
 */
export interface PlatformAdapter {
  /**
   * Gets the project identifier for this platform instance.
   * Used for generating unique cache keys and file names.
   * @returns Project identifier (repo name for GitHub, project name for Azure)
   */
  getProjectIdentifier(): string;

  /**
   * Gets repository information for cloning and context loading.
   * @returns Repository information including owner, repo, and platform type
   */
  getRepoInfo(): RepoInfo;

  /**
   * Gets the authentication token for Git operations.
   * @returns Authentication token
   */
  getToken(): string;

  /**
   * Retrieves pull request details.
   * @param prNumber - The PR number to fetch
   */
  getPRDetails(prNumber: number): Promise<PRDetails>;

  /**
   * Retrieves files changed in a pull request.
   * @param prNumber - The PR number
   */
  getPRFiles(prNumber: number): Promise<PRFile[]>;

  /**
   * Gets existing bot comments on a PR.
   * @param prNumber - The PR number
   */
  getExistingBotComments(prNumber: number): Promise<ExistingComment[]>;

  /**
   * Posts an inline comment on a specific file line.
   * @param prNumber - The PR number
   * @param path - File path
   * @param line - Line number
   * @param body - Comment body
   */
  postInlineComment(prNumber: number, path: string, line: number, body: string): Promise<void>;

  /**
   * Posts a general comment on the PR.
   * @param prNumber - The PR number
   * @param body - Comment body
   */
  postGeneralComment(prNumber: number, body: string): Promise<void>;
}
