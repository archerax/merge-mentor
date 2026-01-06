import * as azdev from "azure-devops-node-api";
import type { IGitApi } from "azure-devops-node-api/GitApi.js";
import type {
  Comment,
  FileDiff,
  FileDiffsCriteria,
  GitPullRequestCommentThread,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import { getAuditLogger } from "../audit/index.js";
import type { Config } from "../config.js";
import { createChildLogger } from "../logger.js";
import { withRateLimitHandling } from "../utils/rateLimitHandler.js";
import type { ExistingComment, FileStatus, PlatformAdapter, PRDetails, PRFile } from "./types.js";

/** Azure DevOps change type values. */
const AzureChangeType = {
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

  constructor(config: Config) {
    const authHandler = azdev.getPersonalAccessTokenHandler(config.azure.token);
    const orgUrl = `https://dev.azure.com/${config.azure.org}`;
    this.connection = new azdev.WebApi(orgUrl, authHandler);
    this.project = config.azure.project;
    this.repoName = config.azure.repo;
    this.botIdentifier = config.botCommentIdentifier;
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

      const pr = await withRateLimitHandling(() =>
        gitApi.getPullRequestById(prNumber, this.project)
      );

      if (!pr.lastMergeSourceCommit?.commitId || !pr.lastMergeTargetCommit?.commitId) {
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
      const iterationId = lastIteration.id || 1;

      const changes = await withRateLimitHandling(() =>
        gitApi.getPullRequestIterationChanges(this.repoName, prNumber, iterationId, this.project)
      );

      if (!changes.changeEntries || changes.changeEntries.length === 0) {
        this.auditLogger.logPRFilesFetch(prNumber, "azure", 0);
        return [];
      }

      // Get proper diffs with line numbers from Azure DevOps API
      // Azure DevOps API limits getFileDiffs to 10 files per request, so we batch them
      const BATCH_SIZE = 10;
      const filePaths = changes.changeEntries
        .filter((change) => change.item?.path)
        .map((change) => ({
          path: change.item!.path!,
        }));

      const fileDiffMap = new Map<string, FileDiff>();

      for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        const batch = filePaths.slice(i, i + BATCH_SIZE);

        const fileDiffsCriteria: FileDiffsCriteria = {
          baseVersionCommit: pr.lastMergeTargetCommit.commitId,
          targetVersionCommit: pr.lastMergeSourceCommit.commitId,
          fileDiffParams: batch,
        };

        const fileDiffs = await withRateLimitHandling(() =>
          gitApi.getFileDiffs(fileDiffsCriteria, this.project, this.repoName)
        );

        for (const diff of fileDiffs || []) {
          if (diff.path) {
            const normalizedPath = diff.path.startsWith("/") ? diff.path.slice(1) : diff.path;
            fileDiffMap.set(normalizedPath, diff);
          }
        }
      }

      const files: PRFile[] = [];
      for (const change of changes.changeEntries) {
        const item = change.item;
        if (!item?.path) continue;

        const status = this.mapChangeTypeToStatus(change.changeType);
        const path = item.path.startsWith("/") ? item.path.slice(1) : item.path;

        const fileDiff = fileDiffMap.get(path);
        const patch = fileDiff
          ? await this.convertFileDiffToUnifiedPatch(path, fileDiff, item.objectId, gitApi)
          : undefined;

        files.push({
          filename: path,
          status,
          additions: 0,
          deletions: 0,
          patch,
          sha: item.objectId,
        });
      }

      this.auditLogger.logPRFilesFetch(prNumber, "azure", files.length);
      return files;
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
   * Converts Azure DevOps FileDiff to a unified diff patch format.
   * Fetches actual file content to generate a proper diff for code review.
   */
  private async convertFileDiffToUnifiedPatch(
    filename: string,
    fileDiff: FileDiff,
    blobSha: string | undefined,
    gitApi: IGitApi
  ): Promise<string> {
    if (!fileDiff.lineDiffBlocks || fileDiff.lineDiffBlocks.length === 0) {
      return "";
    }

    const header = `diff --git a/${filename} b/${filename}\n--- a/${filename}\n+++ b/${filename}\n`;
    let patch = header;

    // Fetch actual file content if we have a blob SHA
    let fileLines: string[] = [];
    if (blobSha) {
      try {
        const contentStream = await withRateLimitHandling(() =>
          gitApi.getBlobContent(this.repoName, blobSha, this.project)
        );
        const chunks: Buffer[] = [];
        for await (const chunk of contentStream) {
          chunks.push(Buffer.from(chunk));
        }
        const content = Buffer.concat(chunks).toString("utf-8");
        fileLines = content.split("\n");
      } catch (error) {
        this.logger.warn(
          { filename, error: (error as Error).message },
          "Could not fetch blob content"
        );
      }
    }

    for (const block of fileDiff.lineDiffBlocks) {
      const oldStart = block.originalLineNumberStart || 1;
      const oldCount = block.originalLinesCount || 0;
      const newStart = block.modifiedLineNumberStart || 1;
      const newCount = block.modifiedLinesCount || 0;

      // Generate hunk header
      patch += `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n`;

      // Add actual file lines if available
      if (fileLines.length > 0 && newCount > 0) {
        for (let i = 0; i < newCount; i++) {
          const lineIndex = newStart - 1 + i;
          if (lineIndex < fileLines.length) {
            patch += `+${fileLines[lineIndex]}\n`;
          } else {
            patch += `+\n`;
          }
        }
      } else if (newCount > 0) {
        // Fallback: empty lines to maintain line count
        for (let i = 0; i < newCount; i++) {
          patch += `+\n`;
        }
      }
    }

    return patch;
  }

  private mapChangeTypeToStatus(changeType: number | undefined): FileStatus {
    switch (changeType) {
      case AzureChangeType.ADD:
        return "added";
      case AzureChangeType.EDIT:
        return "modified";
      case AzureChangeType.DELETE:
        return "deleted";
      case AzureChangeType.RENAME:
        return "renamed";
      default:
        return "modified";
    }
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
