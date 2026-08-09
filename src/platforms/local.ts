/**
 * Local platform adapter — synthesizes the PR-shaped inputs `ReviewEngine`
 * expects from a local git working tree instead of a remote platform API.
 *
 * Used by the `merge-mentor stage` command. The adapter exposes no network
 * credentials: comment-related methods are no-ops because there is no remote to
 * comment on, and findings are surfaced as a local report instead.
 *
 * @module
 */

import path from "node:path";
import type { GitClient, GitFileChange } from "../review/gitClient.js";
import type {
  ExistingComment,
  PBIDetails,
  PlatformAdapter,
  PRDetails,
  PRFile,
  ProjectDetails,
  RepoInfo,
  UnresolvedCommentThread,
} from "./types.js";

/** Options for constructing a `LocalPlatformAdapter`. */
export interface LocalPlatformOptions {
  /** Absolute path to the local repository working tree. */
  readonly repoPath: string;
  /** Git client used to diff the working tree. */
  readonly gitClient: GitClient;
  /** Base ref to diff against (default: `HEAD`). */
  readonly baseRef?: string;
  /** Head ref for ref-to-ref diffs; when set, the working tree is ignored. */
  readonly headRef?: string;
  /** When true, only staged (index) changes are reviewed. */
  readonly stagedOnly?: boolean;
  /**
   * Pre-parsed repository identity. When omitted, the repository name is
   * derived from the directory name.
   */
  readonly repoInfo?: RepoInfo;
}

/** Parses a remote URL into owner/repo/platform parts. */
export function parseRemoteUrl(url: string): Pick<RepoInfo, "owner" | "repo" | "platform"> {
  const platform: "github" | "azure" = url.includes("dev.azure.com") ? "azure" : "github";
  const cleaned = url.replace(/\.git$/, "");

  let pathPart = "";
  const protocolMatch = cleaned.match(/^[^/]+:\/\/(?:[^/@\s]+@)?[^/\s]+\/(.*)$/);
  if (protocolMatch) {
    pathPart = protocolMatch[1];
  } else {
    const sshMatch = cleaned.match(/^(?:[^@\s]+@)?[^/\s:]+:(.+)$/);
    pathPart = sshMatch ? sshMatch[1] : "";
  }

  const parts = pathPart.split("/").filter((part) => part.length > 0);
  if (platform === "azure") {
    const gitIndex = parts.indexOf("_git");
    const repo = gitIndex >= 0 ? (parts[gitIndex + 1] ?? "") : (parts[parts.length - 1] ?? "");
    return { platform, owner: parts[0] ?? "", repo };
  }

  if (parts.length >= 2) {
    return { platform, owner: parts[parts.length - 2], repo: parts[parts.length - 1] };
  }
  return { platform, owner: "", repo: parts[0] ?? "" };
}

/** Maps a git file change to the `PRFile` shape the review engine expects. */
export function toPRFile(change: GitFileChange): PRFile {
  return {
    filename: change.path,
    status: change.status,
    additions: change.additions,
    deletions: change.deletions,
    patch: change.patch,
    sha: change.sha,
  };
}

/**
 * Platform adapter over a local git working tree.
 *
 * `getPRDetails` reports a pseudo-PR with number `-1` (the branch may have no
 * remote counterpart yet), `getPRFiles` derives files from the local diff, and
 * all comment/posting methods are no-ops.
 */
export class LocalPlatformAdapter implements PlatformAdapter {
  private readonly repoPath: string;
  private readonly gitClient: GitClient;
  private readonly baseRef: string;
  private readonly headRef?: string;
  private readonly stagedOnly: boolean;
  private readonly repoInfo: RepoInfo;

  constructor(options: LocalPlatformOptions) {
    this.repoPath = options.repoPath;
    this.gitClient = options.gitClient;
    this.baseRef = options.baseRef ?? "HEAD";
    this.headRef = options.headRef;
    this.stagedOnly = options.stagedOnly ?? false;
    this.repoInfo = options.repoInfo ?? {
      platform: "github",
      owner: "",
      repo: path.basename(options.repoPath),
    };
  }

  /**
   * Returns the repository name used as the project identifier.
   * @returns Repository name
   */
  getProjectIdentifier(): string {
    return this.repoInfo.repo;
  }

  /**
   * Returns the platform name for dispatching platform-specific logic.
   * @returns The platform declared in the local repository info
   */
  getPlatformName(): "github" | "azure" {
    return this.repoInfo.platform;
  }

  /**
   * Returns repository information for context loading.
   * @returns Repository owner, name, and platform
   */
  getRepoInfo(): RepoInfo {
    return this.repoInfo;
  }

  /**
   * Gets the authentication token for Git operations.
   * @returns Empty string; local mode exposes no credentials
   */
  getToken(): string {
    return "";
  }

  /**
   * Retrieves pseudo pull request details from the local working tree.
   * @param _prNumber - Unused; local mode has no PR number
   * @returns A pseudo-PR with number -1 and the current branch as head
   */
  async getPRDetails(_prNumber: number): Promise<PRDetails> {
    const branch = await this.gitClient.currentBranch(this.repoPath);
    return {
      number: -1,
      title: "",
      description: "",
      author: "local",
      baseBranch: this.baseRef,
      headBranch: branch,
    };
  }

  /**
   * Retrieves files changed in the local diff.
   * @param _prNumber - Unused; local mode has no PR number
   * @param _ignorePatterns - Unused; file filtering is handled by the git client
   * @returns Array of changed files
   */
  async getPRFiles(_prNumber: number, _ignorePatterns?: string[]): Promise<PRFile[]> {
    const changes = await this.resolveChanges();
    return changes.map(toPRFile);
  }

  /**
   * Gets existing bot comments on a PR.
   * @param _prNumber - Unused
   * @returns Always an empty array; there are no remote comments in local mode
   */
  async getExistingBotComments(_prNumber: number): Promise<ExistingComment[]> {
    return [];
  }

  /**
   * Retrieves a specific comment thread by comment or thread ID.
   * @param _prNumber - Unused
   * @param _commentId - Unused
   * @throws Always, because comment threads are not available in local mode
   */
  async getCommentThread(
    _prNumber: number,
    _commentId: string | number
  ): Promise<UnresolvedCommentThread> {
    throw new Error("Comment threads are not available in local (stage) mode.");
  }

  /**
   * Retrieves all unresolved/active PR comment threads.
   * @param _prNumber - Unused
   * @returns Always an empty array; there are no remote comments in local mode
   */
  async getUnresolvedCommentThreads(_prNumber: number): Promise<UnresolvedCommentThread[]> {
    return [];
  }

  /**
   * Posts a reply to an existing PR comment thread. No-op in local mode.
   * @param _prNumber - Unused
   * @param _threadId - Unused
   * @param _body - Unused
   */
  async postCommentReply(
    _prNumber: number,
    _threadId: string | number,
    _body: string
  ): Promise<void> {
    // No remote to reply to.
  }

  /**
   * Resolves an unresolved PR comment thread. No-op in local mode.
   * @param _prNumber - Unused
   * @param _threadId - Unused
   */
  async resolveCommentThread(_prNumber: number, _threadId: string | number): Promise<void> {
    // No remote to resolve.
  }

  /**
   * Posts an inline comment on a specific file line. No-op in local mode.
   * @param _prNumber - Unused
   * @param _path - Unused
   * @param _line - Unused
   * @param _body - Unused
   * @param _startLine - Unused
   */
  async postInlineComment(
    _prNumber: number,
    _path: string,
    _line: number,
    _body: string,
    _startLine?: number
  ): Promise<void> {
    // No remote to post to.
  }

  /**
   * Posts a general comment on the PR. No-op in local mode.
   * @param _prNumber - Unused
   * @param _body - Unused
   */
  async postGeneralComment(_prNumber: number, _body: string): Promise<void> {
    // No remote to post to.
  }

  /**
   * Identifies work items, issues, or PBIs linked to a given PR.
   * @param _prNumber - Unused
   * @returns Always an empty array; there are no remote work items in local mode
   */
  async getLinkedPBIIds(_prNumber: number): Promise<readonly string[]> {
    return [];
  }

  /**
   * Retrieves Product Backlog Item / User Story / Issue details by ID.
   * @param _id - Unused
   * @throws Always, because PBI review is not available in local mode
   */
  async getPBIDetails(_id: string): Promise<PBIDetails> {
    throw new Error("PBI review is not available in local (stage) mode.");
  }

  /**
   * Retrieves hierarchical project details.
   * @param _id - Unused
   * @throws Always, because project review is not available in local mode
   */
  async getProjectDetails(_id: string): Promise<ProjectDetails> {
    throw new Error("Project review is not available in local (stage) mode.");
  }

  /**
   * Posts or updates a comment/discussion on a PBI/Issue. No-op in local mode.
   * @param _id - Unused
   * @param _body - Unused
   * @param _commentId - Unused
   */
  async postPBIComment(_id: string, _body: string, _commentId?: string | number): Promise<void> {
    // No remote to post to.
  }

  /**
   * Updates the title and description body of a pull request. No-op in local mode.
   * @param _prNumber - Unused
   * @param _details - Unused
   */
  async updatePRDetails(
    _prNumber: number,
    _details: { readonly title?: string; readonly body?: string }
  ): Promise<void> {
    // No remote to update.
  }

  /** Resolves the local diff into file changes based on the configured mode. */
  private async resolveChanges(): Promise<GitFileChange[]> {
    if (this.headRef) {
      return this.gitClient.diff(this.repoPath, this.baseRef, this.headRef);
    }
    if (this.stagedOnly) {
      return this.gitClient.stagedDiff(this.repoPath, this.baseRef);
    }
    return this.gitClient.workingTreeDiff(this.repoPath, this.baseRef);
  }
}
