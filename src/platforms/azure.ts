import * as azdev from "azure-devops-node-api";
import type {
  Comment,
  GitPullRequestCommentThread,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import type { Config } from "../config.js";
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

  constructor(config: Config) {
    const authHandler = azdev.getPersonalAccessTokenHandler(config.azure.token);
    const orgUrl = `https://dev.azure.com/${config.azure.org}`;
    this.connection = new azdev.WebApi(orgUrl, authHandler);
    this.project = config.azure.project;
    this.repoName = config.azure.repo;
    this.botIdentifier = config.botCommentIdentifier;
  }

  async getPRDetails(prNumber: number): Promise<PRDetails> {
    const gitApi = await this.connection.getGitApi();
    const pr = await gitApi.getPullRequestById(prNumber, this.project);

    return {
      number: pr.pullRequestId || prNumber,
      title: pr.title || "",
      description: pr.description || "",
      author: pr.createdBy?.displayName || "unknown",
      baseBranch: pr.targetRefName?.replace("refs/heads/", "") || "",
      headBranch: pr.sourceRefName?.replace("refs/heads/", "") || "",
    };
  }

  async getPRFiles(prNumber: number): Promise<PRFile[]> {
    const gitApi = await this.connection.getGitApi();

    const iterations = await gitApi.getPullRequestIterations(this.repoName, prNumber, this.project);
    if (!iterations || iterations.length === 0) {
      return [];
    }

    const lastIteration = iterations[iterations.length - 1];
    const iterationId = lastIteration.id || 1;

    const changes = await gitApi.getPullRequestIterationChanges(
      this.repoName,
      prNumber,
      iterationId,
      this.project
    );

    const files: PRFile[] = [];
    for (const change of changes.changeEntries || []) {
      const item = change.item;
      if (!item?.path) continue;

      const status = this.mapChangeTypeToStatus(change.changeType);

      files.push({
        filename: item.path.startsWith("/") ? item.path.slice(1) : item.path,
        status,
        additions: 0,
        deletions: 0,
        patch: undefined,
      });
    }

    return files;
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
    const gitApi = await this.connection.getGitApi();
    const threads = await gitApi.getThreads(this.repoName, prNumber, this.project);

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

    return comments;
  }

  async postInlineComment(
    prNumber: number,
    path: string,
    line: number,
    body: string
  ): Promise<void> {
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

    await gitApi.createThread(thread, this.repoName, prNumber, this.project);
  }

  async postGeneralComment(prNumber: number, body: string): Promise<void> {
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

    await gitApi.createThread(thread, this.repoName, prNumber, this.project);
  }

  async updateComment(commentId: number | string, _body: string): Promise<void> {
    const threadId = typeof commentId === "string" ? parseInt(commentId, 10) : commentId;

    // For Azure DevOps, updating comments requires the PR number context
    // This is a simplified approach - the review engine tracks context
    console.log(`Note: Azure DevOps comment update requested for thread ${threadId}`);
  }

  async resolveComment(commentId: number | string): Promise<void> {
    const threadId = typeof commentId === "string" ? parseInt(commentId, 10) : commentId;

    // Similar limitation as updateComment - we need the PR number
    console.log(`Note: Azure DevOps comment resolve requested for thread ${threadId}`);
  }
}
