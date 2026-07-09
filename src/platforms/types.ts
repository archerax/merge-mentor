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
type FindingConfidence = "high" | "medium" | "low";

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

/** An unresolved comment thread on a file line. */
export interface UnresolvedComment {
  readonly author: string;
  readonly body: string;
}

export interface UnresolvedCommentThread {
  readonly id: string | number;
  readonly path: string;
  readonly line: number;
  readonly comments: readonly UnresolvedComment[];
}

export interface ThreadComment {
  readonly id: string | number;
  readonly author: string;
  readonly body: string;
  readonly createdAt?: string;
}

export interface CommentThreadContext {
  readonly threadId: string | number;
  readonly path: string;
  readonly line: number;
  readonly comments: readonly ThreadComment[];
}

/** Action types for comment management. */
type CommentActionType = "create";

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
   * Returns the platform name for dispatching platform-specific logic.
   * @returns "github" or "azure"
   */
  getPlatformName(): "github" | "azure";

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
   * Retrieves all unresolved/active PR comment threads.
   * @param prNumber - The PR number
   */
  getUnresolvedCommentThreads(prNumber: number): Promise<UnresolvedCommentThread[]>;

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

  /**
   * Identifies work items, issues, or PBIs linked to a given PR.
   * @param prNumber - The PR number
   */
  getLinkedPBIIds(prNumber: number): Promise<readonly string[]>;

  /**
   * Retrieves Product Backlog Item / User Story / Issue details by ID.
   * @param id - The work item ID or issue number
   */
  getPBIDetails(id: string): Promise<PBIDetails>;

  /**
   * Retrieves hierarchical project details (Epics, Features, child stories/PBIs, and dependencies).
   * @param id - The root work item ID
   */
  getProjectDetails(id: string): Promise<ProjectDetails>;

  /**
   * Posts or updates a comment/discussion on a PBI/Issue.
   * @param id - The work item ID or issue number
   * @param body - Comment body
   * @param commentId - Optional comment ID to update an existing comment in-place
   */
  postPBIComment(id: string, body: string, commentId?: number | string): Promise<void>;

  /**
   * Updates the title and description body of a pull request.
   * @param prNumber - The PR number
   * @param details - The new title and/or description to apply
   */
  updatePRDetails(
    prNumber: number,
    details: { readonly title?: string; readonly body?: string }
  ): Promise<void>;

  /**
   * Fetches the entire comment thread for a specific comment ID.
   * @param prNumber - The PR number
   * @param commentId - The individual comment ID (or thread ID if known)
   * @returns The resolved inline comment thread context
   */
  getCommentThread(prNumber: number, commentId: string | number): Promise<CommentThreadContext>;

  /**
   * Posts a reply to an existing comment thread.
   * @param prNumber - The PR number
   * @param threadId - The root comment thread ID
   * @param body - The response message body
   */
  postCommentReply(prNumber: number, threadId: string | number, body: string): Promise<void>;

  /**
   * Resolves/closes an active comment thread.
   * @param prNumber - The PR number
   * @param threadId - The root comment thread ID
   */
  resolveCommentThread(prNumber: number, threadId: string | number): Promise<void>;
}

/** A comment on a Product Backlog Item / User Story / Issue. */
export interface PBIComment {
  readonly id: number | string;
  readonly body: string;
}

/** Details about a Product Backlog Item / User Story / Issue. */
export interface PBIDetails {
  readonly id: string;
  readonly platform: "github" | "azure";
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria?: string;
  readonly storyPoints?: number;
  readonly comments: readonly PBIComment[];
  readonly moscowTag?: "Must" | "Should" | "Could" | "Won't";
  readonly backlogPriority?: number;
}

/** A simple representation of a work item state/status. */
export type WorkItemState = "todo" | "inprogress" | "done" | "unknown";

/** A basic work item in a project hierarchy. */
export interface ProjectWorkItem {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly description: string;
  readonly acceptanceCriteria?: string;
  readonly state: string;
  readonly normalizedState: WorkItemState;
  readonly storyPoints?: number;
  readonly comments: readonly PBIComment[];
  readonly moscowTag?: "Must" | "Should" | "Could" | "Won't";
  readonly backlogPriority?: number;
}

/** A link representing a dependency relationship. */
export interface ProjectDependency {
  readonly sourceId: string;
  readonly targetId: string;
  readonly type: "predecessor" | "successor";
}

/** Details about a whole project/feature hierarchy. */
export interface ProjectDetails {
  readonly rootId: string;
  readonly rootTitle: string;
  readonly rootType: string;
  readonly rootDescription: string;
  readonly platform: "github" | "azure";
  readonly workItems: readonly ProjectWorkItem[];
  readonly dependencies: readonly ProjectDependency[];
}
