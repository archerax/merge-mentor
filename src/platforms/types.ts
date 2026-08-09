/** Details about a pull request. */
export interface PRDetails {
  /** Pull request number on the platform. */
  readonly number: number;
  /** Title of the pull request. */
  readonly title: string;
  /** Markdown description/body of the pull request. */
  readonly description: string;
  /** Login or display name of the pull request author. */
  readonly author: string;
  /** Branch the pull request merges into. */
  readonly baseBranch: string;
  /** Branch the pull request sources changes from. */
  readonly headBranch: string;
}

/** File status in a pull request. */
export type FileStatus = "added" | "modified" | "deleted" | "renamed";

/** A file changed in a pull request. */
export interface PRFile {
  /** Path of the file in the repository. */
  readonly filename: string;
  /** How the file changed relative to the base branch. */
  readonly status: FileStatus;
  /** Number of added lines. */
  readonly additions: number;
  /** Number of deleted lines. */
  readonly deletions: number;
  /** Unified diff patch for the file, when available. */
  readonly patch?: string;
  /** Blob SHA of the file, when available. */
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
  /** Line number in the file where the issue occurs. */
  readonly line: number;
  /** Optional first line of a native replacement suggestion. */
  readonly startLine?: number;
  /** Optional last line of a native replacement suggestion. */
  readonly endLine?: number;
  /** How severe the issue is. */
  readonly severity: FindingSeverity;
  /** Confidence that the finding is correct. */
  readonly confidence: FindingConfidence;
  /** Category of the issue (bug, security, quality, etc.). */
  readonly category: FindingCategory;
  /** Human-readable description of the issue. */
  readonly message: string;
  /** Suggested fix or improvement for the issue. */
  readonly suggestion: string;
  /** Replacement code for a native platform suggestion comment. */
  readonly replacement?: string;
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
  /** How severe the issue is. */
  readonly severity: FindingSeverity;
  /** Confidence that the finding is correct. */
  readonly confidence: FindingConfidence;
  /** Category of the issue (bug, security, quality, etc.). */
  readonly category: FindingCategory;
  /** Human-readable description of the issue. */
  readonly message: string;
  /**
   * Concise evidence-based rationale explaining why this is a cross-file issue.
   * Should cite the affected files, their relationship, and the concrete system impact.
   */
  readonly reasoning: string;
  /** Paths of the files involved in the cross-file issue. */
  readonly affectedFiles: readonly string[];
}

/** Result of reviewing a single file. */
export interface FileReviewResult {
  /** Path of the reviewed file. */
  readonly filename: string;
  /** Findings identified in the file. */
  readonly findings: readonly FileFinding[];
}

/** Result of cross-file analysis. */
export interface CrossFileReviewResult {
  /** High-level assessment of the changes across files. */
  readonly overallAssessment: string;
  /** Cross-file findings identified during review. */
  readonly findings: readonly CrossFileFinding[];
  /** Suggested actions to address the cross-file findings. */
  readonly recommendations: readonly string[];
}

/** An existing bot comment on a PR. */
export interface ExistingComment {
  /** Platform comment identifier. */
  readonly id: number | string;
  /** Comment text. */
  readonly body: string;
  /** File path the comment is attached to, for inline comments. */
  readonly path?: string;
  /** Line number the comment is attached to, for inline comments. */
  readonly line?: number;
  /** Whether the comment thread has been resolved. */
  readonly isResolved?: boolean;
}

/** An unresolved comment thread on a file line. */
export interface UnresolvedComment {
  /** Author of the comment. */
  readonly author: string;
  /** Comment text. */
  readonly body: string;
  /** Platform comment identifier, when available. */
  readonly id?: string | number;
  /** ISO timestamp of when the comment was created. */
  readonly createdAt?: string;
  /** Whether the comment was written by the bot. */
  readonly isBot?: boolean;
}

/** A thread of comments on a specific file line that is not yet resolved. */
export interface UnresolvedCommentThread {
  /** Platform identifier of the thread. */
  readonly id: string | number;
  /** File path the thread is attached to. */
  readonly path: string;
  /** Line number the thread is attached to. */
  readonly line: number;
  /** Comments in the thread, in chronological order. */
  readonly comments: readonly UnresolvedComment[];
  /** Current state of the thread. */
  readonly status?: "active" | "resolved";
  /** Whether the thread was started by the bot. */
  readonly botInitiated?: boolean;
}

/** Action types for comment management. */
type CommentActionType = "create";

/** An action to perform on a comment. */
export interface CommentAction {
  /** The action to perform on the comment. */
  readonly type: CommentActionType;
  /** ID of an existing comment to act on, when updating. */
  readonly existingCommentId?: number | string;
  /** File path for inline comment actions. */
  readonly path?: string;
  /** Line number for inline comment actions. */
  readonly line?: number;
  /** Start line of the range for multi-line inline comment actions. */
  readonly startLine?: number;
  /** Comment body. */
  readonly body?: string;
}

/** Repository information for context loading. */
export interface RepoInfo {
  /** Repository owner, or Azure DevOps organization. */
  readonly owner: string;
  /** Repository name. */
  readonly repo: string;
  /** Platform the repository lives on. */
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

  /**
   * Returns repository information for context loading.
   * @returns Repository owner, name, and platform
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
   * @param ignorePatterns - Optional glob patterns to skip fetching file content/diffs early
   */
  getPRFiles(prNumber: number, ignorePatterns?: string[]): Promise<PRFile[]>;

  /**
   * Gets existing bot comments on a PR.
   * @param prNumber - The PR number
   */
  getExistingBotComments(prNumber: number): Promise<ExistingComment[]>;

  /**
   * Retrieves a specific comment thread by comment or thread ID.
   * @param prNumber - The PR number
   * @param commentId - The comment or thread ID
   */
  getCommentThread(prNumber: number, commentId: string | number): Promise<UnresolvedCommentThread>;

  /**
   * Retrieves all unresolved/active PR comment threads.
   * @param prNumber - The PR number
   */
  getUnresolvedCommentThreads(prNumber: number): Promise<UnresolvedCommentThread[]>;

  /**
   * Posts a reply to an existing PR comment thread.
   * @param prNumber - The PR number
   * @param threadId - The target thread ID
   * @param body - The reply message body
   */
  postCommentReply(prNumber: number, threadId: string | number, body: string): Promise<void>;

  /**
   * Resolves an unresolved PR comment thread.
   * @param prNumber - The PR number
   * @param threadId - The target thread ID
   */
  resolveCommentThread(prNumber: number, threadId: string | number): Promise<void>;

  /**
   * Posts an inline comment on a specific file line.
   * @param prNumber - The PR number
   * @param path - File path
   * @param line - Line number
   * @param body - Comment body
   */
  postInlineComment(
    prNumber: number,
    path: string,
    line: number,
    body: string,
    startLine?: number
  ): Promise<void>;

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
}

/** A comment on a Product Backlog Item / User Story / Issue. */
export interface PBIComment {
  /** Platform comment identifier. */
  readonly id: number | string;
  /** Comment text. */
  readonly body: string;
}

/** Details about a Product Backlog Item / User Story / Issue. */
export interface PBIDetails {
  /** Platform identifier of the work item. */
  readonly id: string;
  /** Platform the work item lives on. */
  readonly platform: "github" | "azure";
  /** Title of the work item. */
  readonly title: string;
  /** Markdown description of the work item. */
  readonly description: string;
  /** Acceptance criteria, when available. */
  readonly acceptanceCriteria?: string;
  /** Estimated story points, when available. */
  readonly storyPoints?: number;
  /** Comments on the work item. */
  readonly comments: readonly PBIComment[];
  /** MoSCoW priority tag, when available. */
  readonly moscowTag?: "Must" | "Should" | "Could" | "Won't";
  /** Backlog priority/rank, when available. */
  readonly backlogPriority?: number;
}

/** A simple representation of a work item state/status. */
export type WorkItemState = "todo" | "inprogress" | "done" | "unknown";

/** A basic work item in a project hierarchy. */
export interface ProjectWorkItem {
  /** Platform identifier of the work item. */
  readonly id: string;
  /** Title of the work item. */
  readonly title: string;
  /** Platform-specific work item type (e.g. Epic, Feature, PBI, Task). */
  readonly type: string;
  /** Markdown description of the work item. */
  readonly description: string;
  /** Acceptance criteria, when available. */
  readonly acceptanceCriteria?: string;
  /** Raw platform state/status of the work item. */
  readonly state: string;
  /** Normalized state/status used for reporting. */
  readonly normalizedState: WorkItemState;
  /** Estimated story points, when available. */
  readonly storyPoints?: number;
  /** Comments on the work item. */
  readonly comments: readonly PBIComment[];
  /** MoSCoW priority tag, when available. */
  readonly moscowTag?: "Must" | "Should" | "Could" | "Won't";
  /** Backlog priority/rank, when available. */
  readonly backlogPriority?: number;
}

/** A link representing a dependency relationship. */
export interface ProjectDependency {
  /** ID of the work item the dependency originates from. */
  readonly sourceId: string;
  /** ID of the work item the dependency points to. */
  readonly targetId: string;
  /** Whether the source depends on the target or vice versa. */
  readonly type: "predecessor" | "successor";
}

/** Details about a whole project/feature hierarchy. */
export interface ProjectDetails {
  /** ID of the root work item of the hierarchy. */
  readonly rootId: string;
  /** Title of the root work item. */
  readonly rootTitle: string;
  /** Type of the root work item. */
  readonly rootType: string;
  /** Description of the root work item. */
  readonly rootDescription: string;
  /** Platform the project hierarchy lives on. */
  readonly platform: "github" | "azure";
  /** All work items discovered in the hierarchy. */
  readonly workItems: readonly ProjectWorkItem[];
  /** Dependency relationships between work items. */
  readonly dependencies: readonly ProjectDependency[];
}
