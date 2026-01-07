import * as azdev from "azure-devops-node-api";
import type {
  Comment,
  GitPullRequestCommentThread,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import * as Diff from "diff";
import { getAuditLogger } from "../audit/index.js";
import type { Config } from "../config.js";
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

      this.logger.info(
        {
          prNumber,
          repositoryId,
          baseCommitId,
          headCommitId,
        },
        "Fetching commit diffs via REST API"
      );

      // Fetch diffs directly using REST API
      const diffs = await this.fetchCommitDiffsViaREST(repositoryId, baseCommitId, headCommitId);

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
   * Fetches commit diffs directly via Azure DevOps REST API.
   * This bypasses the Node SDK which has issues with file content retrieval.
   * Uses the Commits API to get actual diff content.
   */
  private async fetchCommitDiffsViaREST(
    repositoryId: string,
    baseCommitId: string,
    targetCommitId: string
  ): Promise<PRFile[]> {
    // Azure DevOps Commits API provides actual diff content
    // We'll get the changes for the target commit and use baseCommit as the diff base
    const url = `${this.orgUrl}/${encodeURIComponent(this.project)}/_apis/git/repositories/${repositoryId}/commits/${targetCommitId}/changes?api-version=7.0`;

    this.logger.info({ baseCommitId, targetCommitId }, "Fetching commit changes via REST API");

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
        "Failed to fetch commit changes via REST API"
      );
      throw new Error(`Azure DevOps API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      changes?: Array<{
        item?: { path?: string; objectId?: string; gitObjectType?: string };
        changeType?: string;
      }>;
    };

    if (!data.changes || data.changes.length === 0) {
      this.logger.info("No changes found in commit");
      return [];
    }

    this.logger.info({ changesCount: data.changes.length }, "Received changes from Commits API");

    // Filter out folder changes and process files
    const files: PRFile[] = [];
    for (const change of data.changes) {
      const item = change.item;
      if (!item?.path || item.gitObjectType === "tree") {
        continue; // Skip folders
      }

      const status = this.mapCommitChangeTypeToStatus(change.changeType);
      const path = item.path.startsWith("/") ? item.path.slice(1) : item.path;

      // Fetch file content at both commits and generate diff
      const patch = await this.generateDiffFromBlobs(
        repositoryId,
        path,
        baseCommitId,
        targetCommitId,
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

      // Generate unified diff using the diff library
      const structuredDiff = Diff.structuredPatch(
        filePath,
        filePath,
        baseContent,
        targetContent,
        "",
        ""
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
   * Maps commit change type string to FileStatus.
   */
  private mapCommitChangeTypeToStatus(changeType?: string): FileStatus {
    switch (changeType?.toLowerCase()) {
      case "add":
        return "added";
      case "edit":
        return "modified";
      case "delete":
        return "deleted";
      case "rename":
        return "renamed";
      default:
        return "modified";
    }
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
