import * as azdev from "azure-devops-node-api";
import type {
  Comment,
  GitPullRequestCommentThread,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import * as Diff from "diff";
import { getAuditLogger } from "../audit/index.js";
import type { Config } from "../config.js";
import { DIFF_CONTEXT_LINES } from "../constants.js";
import { createChildLogger } from "../logger.js";
import { withRateLimitHandling } from "../utils/rateLimitHandler.js";
import type { ExistingComment, FileStatus, PlatformAdapter, PRDetails, PRFile } from "./types.js";

/** Azure DevOps change type values. */
const _AzureChangeType = {
  ADD: 1,
  EDIT: 2,
  RENAME: 8,
  DELETE: 16,
} as const;

/** Azure DevOps thread status values. */
const AzureThreadStatus = {
  ACTIVE: 1,
  FIXED: 2,
} as const;

/** Azure DevOps comment type values. */
const AzureCommentType = {
  TEXT: 1,
} as const;

/**
 * Platform adapter for Azure DevOps pull requests.
 */
export class AzureDevOpsAdapter implements PlatformAdapter {
  private readonly connection: azdev.WebApi;
  private readonly project: string;
  private readonly repoName: string;
  private readonly botIdentifier: string;
  private readonly auditLogger = getAuditLogger();
  private readonly logger = createChildLogger({ component: "AzureDevOpsAdapter" });
  private readonly token: string;
  private readonly orgUrl: string;

  constructor(config: Config) {
    const authHandler = azdev.getPersonalAccessTokenHandler(config.azure.token);
    this.orgUrl = `https://dev.azure.com/${config.azure.org}`;
    this.connection = new azdev.WebApi(this.orgUrl, authHandler);
    this.project = config.azure.project;
    this.repoName = config.azure.repo;
    this.botIdentifier = config.botCommentIdentifier;
    this.token = config.azure.token;
    this.logger.info(
      { project: this.project, repo: this.repoName },
      "AzureDevOpsAdapter initialized"
    );
  }

  getProjectIdentifier(): string {
    return this.project;
  }

  async getPRDetails(prNumber: number): Promise<PRDetails> {
    try {
      const gitApi = await this.connection.getGitApi();
      const pr = await withRateLimitHandling(() =>
        gitApi.getPullRequestById(prNumber, this.project)
      );

      const details = {
        number: pr.pullRequestId || prNumber,
        title: pr.title || "",
        description: pr.description || "",
        author: pr.createdBy?.displayName || "unknown",
        baseBranch: pr.targetRefName?.replace("refs/heads/", "") || "",
        headBranch: pr.sourceRefName?.replace("refs/heads/", "") || "",
      };

      this.auditLogger.logPRDetailsFetch(prNumber, "azure", "success");
      return details;
    } catch (error) {
      this.auditLogger.logPRDetailsFetch(prNumber, "azure", "failure", (error as Error).message);
      throw error;
    }
  }

  async getPRFiles(prNumber: number): Promise<PRFile[]> {
    try {
      const gitApi = await this.connection.getGitApi();

      // Get PR details to find repository ID
      const pr = await withRateLimitHandling(() =>
        gitApi.getPullRequestById(prNumber, this.project)
      );

      const repositoryId = pr.repository?.id;
      if (!repositoryId) {
        this.logger.warn({ prNumber }, "Could not find repository ID for PR");
        this.auditLogger.logPRFilesFetch(prNumber, "azure", 0);
        return [];
      }

      const iterations = await withRateLimitHandling(() =>
        gitApi.getPullRequestIterations(this.repoName, prNumber, this.project)
      );
      if (!iterations || iterations.length === 0) {
        this.auditLogger.logPRFilesFetch(prNumber, "azure", 0);
        return [];
      }

      const lastIteration = iterations[iterations.length - 1];

      // Use sourceRefCommit (head) and commonRefCommit (base) from iteration for accurate diffs
      if (!lastIteration.sourceRefCommit?.commitId || !lastIteration.commonRefCommit?.commitId) {
        this.logger.warn(
          {
            prNumber,
            iterationId: lastIteration.id,
            hasSourceRef: !!lastIteration.sourceRefCommit,
            hasCommonRef: !!lastIteration.commonRefCommit,
          },
          "Missing sourceRefCommit or commonRefCommit in PR iteration"
        );
        this.auditLogger.logPRFilesFetch(prNumber, "azure", 0);
        return [];
      }

      const baseCommitId = lastIteration.commonRefCommit.commitId;
      const headCommitId = lastIteration.sourceRefCommit.commitId;
      const iterationId = lastIteration.id;

      if (!iterationId) {
        this.logger.warn({ prNumber }, "Missing iteration ID");
        this.auditLogger.logPRFilesFetch(prNumber, "azure", 0);
        return [];
      }

      this.logger.info(
        {
          prNumber,
          repositoryId,
          iterationId,
          baseCommitId,
          headCommitId,
        },
        "Fetching PR iteration changes via REST API"
      );

      // Fetch all changed files using PR Iteration Changes API (includes all files across all commits)
      const diffs = await this.fetchPRIterationChanges(
        repositoryId,
        prNumber,
        iterationId,
        baseCommitId,
        headCommitId
      );

      this.auditLogger.logPRFilesFetch(prNumber, "azure", diffs.length);
      return diffs;
    } catch (error) {
      this.auditLogger.logPRFilesFetch(
        prNumber,
        "azure",
        undefined,
        "failure",
        (error as Error).message
      );
      throw error;
    }
  }

  /**
   * Page size for paginated API requests.
   */
  private readonly CHANGES_PAGE_SIZE = 100;

  /**
   * Fetches all PR iteration changes via Azure DevOps REST API with pagination.
   * Uses the Pull Request Iteration Changes API which returns ALL files changed
   * across ALL commits in the PR, not just a single commit.
   */
  private async fetchPRIterationChanges(
    repositoryId: string,
    prNumber: number,
    iterationId: number,
    baseCommitId: string,
    headCommitId: string
  ): Promise<PRFile[]> {
    // Fetch all changes with pagination
    const allChanges = await this.fetchAllIterationChanges(repositoryId, prNumber, iterationId);

    if (allChanges.length === 0) {
      this.logger.info("No changes found in PR iteration");
      return [];
    }

    this.logger.info(
      { changesCount: allChanges.length },
      "Total changes fetched from PR Iteration Changes API"
    );

    // Filter out folder changes and process files
    const files: PRFile[] = [];
    for (const change of allChanges) {
      const item = change.item;
      if (!item?.path || item.gitObjectType === "tree") {
        continue; // Skip folders
      }

      const status = this.mapIterationChangeTypeToStatus(change.changeType);
      const path = item.path.startsWith("/") ? item.path.slice(1) : item.path;

      // Fetch file content at both commits and generate diff
      const patch = await this.generateDiffFromBlobs(
        repositoryId,
        path,
        baseCommitId,
        headCommitId,
        status
      );

      files.push({
        filename: path,
        status,
        additions: 0,
        deletions: 0,
        patch,
        sha: item.objectId,
      });
    }

    return files;
  }

  /**
   * Fetches all iteration changes with pagination support.
   * Azure DevOps API uses $top and $skip for pagination on the iteration changes endpoint.
   */
  private async fetchAllIterationChanges(
    repositoryId: string,
    prNumber: number,
    iterationId: number
  ): Promise<
    Array<{
      item?: { path?: string; objectId?: string; gitObjectType?: string };
      changeType?: number;
    }>
  > {
    const allChanges: Array<{
      item?: { path?: string; objectId?: string; gitObjectType?: string };
      changeType?: number;
    }> = [];

    let skip = 0;
    let hasMoreResults = true;

    this.logger.info(
      { prNumber, iterationId },
      "Fetching PR iteration changes via REST API with pagination"
    );

    while (hasMoreResults) {
      // Use PR Iteration Changes API - returns all files changed in the PR
      const url = `${this.orgUrl}/${encodeURIComponent(this.project)}/_apis/git/repositories/${repositoryId}/pullRequests/${prNumber}/iterations/${iterationId}/changes?$top=${this.CHANGES_PAGE_SIZE}&$skip=${skip}&api-version=7.0`;

      this.logger.debug({ skip, top: this.CHANGES_PAGE_SIZE }, "Fetching iteration changes page");

      const response = await fetch(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`:${this.token}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          { status: response.status, statusText: response.statusText, errorText },
          "Failed to fetch PR iteration changes via REST API"
        );
        throw new Error(`Azure DevOps API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        changeEntries?: Array<{
          item?: { path?: string; objectId?: string; gitObjectType?: string };
          changeType?: number;
        }>;
      };

      const pageChanges = data.changeEntries || [];
      allChanges.push(...pageChanges);

      this.logger.debug(
        { pageSize: pageChanges.length, totalSoFar: allChanges.length },
        "Received iteration changes page"
      );

      // Check if we need to fetch more pages
      // If we got fewer results than requested, we've reached the end
      if (pageChanges.length < this.CHANGES_PAGE_SIZE) {
        hasMoreResults = false;
      } else {
        skip += this.CHANGES_PAGE_SIZE;
      }
    }

    return allChanges;
  }

  /**
   * Maps PR iteration change type (numeric) to FileStatus.
   * Azure DevOps iteration changes use numeric change types.
   */
  private mapIterationChangeTypeToStatus(changeType?: number): FileStatus {
    // Azure DevOps VersionControlChangeType enum values
    // See: https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-iteration-changes
    switch (changeType) {
      case 1: // Add
        return "added";
      case 2: // Edit
        return "modified";
      case 8: // Rename
        return "renamed";
      case 16: // Delete
        return "deleted";
      default:
        return "modified";
    }
  }

  /**
   * Generates a unified diff by fetching blob content at both commits.
   */
  private async generateDiffFromBlobs(
    repositoryId: string,
    filePath: string,
    baseCommitId: string,
    targetCommitId: string,
    status: FileStatus
  ): Promise<string> {
    try {
      let baseContent = "";
      let targetContent = "";

      // Fetch base version content (if not added)
      if (status !== "added") {
        try {
          baseContent = await this.fetchFileContentAtCommit(repositoryId, filePath, baseCommitId);
        } catch (error) {
          this.logger.debug(
            { filePath, commit: baseCommitId, error: (error as Error).message },
            "Could not fetch base content (file may be new)"
          );
        }
      }

      // Fetch target version content (if not deleted)
      if (status !== "deleted") {
        try {
          targetContent = await this.fetchFileContentAtCommit(
            repositoryId,
            filePath,
            targetCommitId
          );
        } catch (error) {
          this.logger.debug(
            { filePath, commit: targetCommitId, error: (error as Error).message },
            "Could not fetch target content (file may be deleted)"
          );
        }
      }

      this.logger.debug(
        {
          filePath,
          baseLength: baseContent.length,
          targetLength: targetContent.length,
        },
        "Fetched file contents for diff generation"
      );

      // Generate unified diff using the diff library with extended context
      const structuredDiff = Diff.structuredPatch(
        filePath,
        filePath,
        baseContent,
        targetContent,
        "",
        "",
        { context: DIFF_CONTEXT_LINES }
      );

      // Format as git-style unified diff
      let patch = `diff --git a/${filePath} b/${filePath}\n`;
      patch += `--- a/${filePath}\n`;
      patch += `+++ b/${filePath}\n`;

      for (const hunk of structuredDiff.hunks) {
        patch += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`;
        for (const line of hunk.lines) {
          patch += `${line}\n`;
        }
      }

      if (structuredDiff.hunks.length === 0) {
        this.logger.warn(
          { filePath, baseLength: baseContent.length, targetLength: targetContent.length },
          "No diff hunks generated - files may be identical"
        );
      } else {
        this.logger.info(
          { filePath, hunksCount: structuredDiff.hunks.length },
          "Generated diff successfully"
        );
      }

      return patch;
    } catch (error) {
      this.logger.warn(
        { filePath, error: (error as Error).message },
        "Failed to generate diff from blobs"
      );
      return this.createEmptyDiffHeader(filePath);
    }
  }

  /**
   * Fetches file content at a specific commit using the Items API.
   */
  private async fetchFileContentAtCommit(
    repositoryId: string,
    filePath: string,
    commitId: string
  ): Promise<string> {
    const url = `${this.orgUrl}/${encodeURIComponent(this.project)}/_apis/git/repositories/${repositoryId}/items?path=${encodeURIComponent(`/${filePath}`)}&versionType=commit&version=${commitId}&includeContent=true&api-version=7.0`;

    this.logger.debug({ filePath, commitId }, "Fetching file content at commit");

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`:${this.token}`).toString("base64")}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch file content: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { content?: string };

    if (!data.content) {
      this.logger.warn({ filePath, commitId }, "No content returned from Items API");
      return "";
    }

    return data.content;
  }

  /**
   * Creates an empty diff header (no content changes).
   */
  private createEmptyDiffHeader(filename: string): string {
    return `diff --git a/${filename} b/${filename}\n--- a/${filename}\n+++ b/${filename}\n`;
  }

  async getExistingBotComments(prNumber: number): Promise<ExistingComment[]> {
    try {
      const gitApi = await this.connection.getGitApi();
      const threads = await withRateLimitHandling(() =>
        gitApi.getThreads(this.repoName, prNumber, this.project)
      );

      const comments: ExistingComment[] = [];
      for (const thread of threads || []) {
        const firstComment = thread.comments?.[0];
        if (firstComment?.content?.includes(this.botIdentifier)) {
          comments.push({
            id: thread.id?.toString() || "",
            body: firstComment.content || "",
            path: thread.threadContext?.filePath,
            line: thread.threadContext?.rightFileStart?.line,
            isResolved: thread.status === AzureThreadStatus.FIXED,
          });
        }
      }

      this.auditLogger.logCommentsFetch(prNumber, "azure", comments.length);
      return comments;
    } catch (error) {
      this.auditLogger.logCommentsFetch(
        prNumber,
        "azure",
        undefined,
        "failure",
        (error as Error).message
      );
      throw error;
    }
  }

  async postInlineComment(
    prNumber: number,
    path: string,
    line: number,
    body: string
  ): Promise<void> {
    try {
      const gitApi = await this.connection.getGitApi();

      const thread: GitPullRequestCommentThread = {
        comments: [
          {
            content: `${this.botIdentifier}\n\n${body}`,
            commentType: AzureCommentType.TEXT,
          } as Comment,
        ],
        threadContext: {
          filePath: path.startsWith("/") ? path : `/${path}`,
          rightFileStart: { line, offset: 1 },
          rightFileEnd: { line, offset: 1 },
        },
        status: AzureThreadStatus.ACTIVE,
      };

      await withRateLimitHandling(() =>
        gitApi.createThread(thread, this.repoName, prNumber, this.project)
      );
      this.auditLogger.logInlineCommentPost(prNumber, path, line, "azure", "success");
    } catch (error) {
      this.auditLogger.logInlineCommentPost(
        prNumber,
        path,
        line,
        "azure",
        "failure",
        (error as Error).message
      );
      throw error;
    }
  }

  async postGeneralComment(prNumber: number, body: string): Promise<void> {
    try {
      const gitApi = await this.connection.getGitApi();

      const thread: GitPullRequestCommentThread = {
        comments: [
          {
            content: `${this.botIdentifier}\n\n${body}`,
            commentType: AzureCommentType.TEXT,
          } as Comment,
        ],
        status: AzureThreadStatus.ACTIVE,
      };

      await withRateLimitHandling(() =>
        gitApi.createThread(thread, this.repoName, prNumber, this.project)
      );
      this.auditLogger.logGeneralCommentPost(prNumber, "azure", "success");
    } catch (error) {
      this.auditLogger.logGeneralCommentPost(
        prNumber,
        "azure",
        "failure",
        (error as Error).message
      );
      throw error;
    }
  }

  async updateComment(commentId: number | string, _body: string): Promise<void> {
    const threadId = typeof commentId === "string" ? Number.parseInt(commentId, 10) : commentId;

    this.logger.info({ threadId }, "Azure DevOps comment update requested (not implemented)");
    this.auditLogger.logCommentUpdate(threadId, 0, "azure", "success");
  }

  async resolveComment(commentId: number | string): Promise<void> {
    const threadId = typeof commentId === "string" ? Number.parseInt(commentId, 10) : commentId;

    this.logger.info({ threadId }, "Azure DevOps comment resolve requested (not implemented)");
    this.auditLogger.logCommentResolve(threadId, 0, "azure", "success");
  }
}
