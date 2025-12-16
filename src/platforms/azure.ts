import * as azdev from 'azure-devops-node-api';
import type { GitPullRequestCommentThread, Comment } from 'azure-devops-node-api/interfaces/GitInterfaces.js';
import type { Config } from '../config.js';
import type {
  PlatformAdapter,
  PRDetails,
  PRFile,
  ExistingComment,
} from './types.js';

export class AzureDevOpsAdapter implements PlatformAdapter {
  private connection: azdev.WebApi;
  private org: string;
  private project: string;
  private repoName: string;
  private botIdentifier: string;

  constructor(config: Config) {
    const authHandler = azdev.getPersonalAccessTokenHandler(config.azure.token);
    const orgUrl = `https://dev.azure.com/${config.azure.org}`;
    this.connection = new azdev.WebApi(orgUrl, authHandler);
    this.org = config.azure.org;
    this.project = config.azure.project;
    this.repoName = config.azure.repo;
    this.botIdentifier = config.botCommentIdentifier;
  }

  async getPRDetails(prNumber: number): Promise<PRDetails> {
    const gitApi = await this.connection.getGitApi();
    const pr = await gitApi.getPullRequestById(prNumber, this.project);

    return {
      number: pr.pullRequestId || prNumber,
      title: pr.title || '',
      description: pr.description || '',
      author: pr.createdBy?.displayName || 'unknown',
      baseBranch: pr.targetRefName?.replace('refs/heads/', '') || '',
      headBranch: pr.sourceRefName?.replace('refs/heads/', '') || '',
    };
  }

  async getPRFiles(prNumber: number): Promise<PRFile[]> {
    const gitApi = await this.connection.getGitApi();
    
    // Get the PR iterations to get file changes
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

      let status: PRFile['status'] = 'modified';
      const changeType = change.changeType;
      if (changeType === 1) status = 'added'; // Add
      else if (changeType === 2) status = 'modified'; // Edit
      else if (changeType === 16) status = 'deleted'; // Delete
      else if (changeType === 8) status = 'renamed'; // Rename

      files.push({
        filename: item.path.startsWith('/') ? item.path.slice(1) : item.path,
        status,
        additions: 0, // Azure DevOps doesn't provide this directly
        deletions: 0,
        patch: undefined, // Would need additional API calls to get diff
      });
    }

    return files;
  }

  async getExistingBotComments(prNumber: number): Promise<ExistingComment[]> {
    const gitApi = await this.connection.getGitApi();
    const threads = await gitApi.getThreads(this.repoName, prNumber, this.project);

    const comments: ExistingComment[] = [];
    for (const thread of threads || []) {
      const firstComment = thread.comments?.[0];
      if (firstComment?.content?.includes(this.botIdentifier)) {
        comments.push({
          id: thread.id?.toString() || '',
          body: firstComment.content || '',
          path: thread.threadContext?.filePath,
          line: thread.threadContext?.rightFileStart?.line,
          isResolved: thread.status === 2, // Fixed status
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
          commentType: 1, // Text
        } as Comment,
      ],
      threadContext: {
        filePath: path.startsWith('/') ? path : `/${path}`,
        rightFileStart: { line, offset: 1 },
        rightFileEnd: { line, offset: 1 },
      },
      status: 1, // Active
    };

    await gitApi.createThread(thread, this.repoName, prNumber, this.project);
  }

  async postGeneralComment(prNumber: number, body: string): Promise<void> {
    const gitApi = await this.connection.getGitApi();

    const thread: GitPullRequestCommentThread = {
      comments: [
        {
          content: `${this.botIdentifier}\n\n${body}`,
          commentType: 1, // Text
        } as Comment,
      ],
      status: 1, // Active
    };

    await gitApi.createThread(thread, this.repoName, prNumber, this.project);
  }

  async updateComment(commentId: number | string, _body: string): Promise<void> {
    const threadId = typeof commentId === 'string' ? parseInt(commentId, 10) : commentId;

    // For Azure DevOps, updating comments requires the PR number context
    // This is a simplified approach - the review engine tracks context
    console.log(`Note: Azure DevOps comment update requested for thread ${threadId}`);
  }

  async resolveComment(commentId: number | string): Promise<void> {
    const threadId = typeof commentId === 'string' ? parseInt(commentId, 10) : commentId;

    // Similar limitation as updateComment - we need the PR number
    console.log(`Note: Azure DevOps comment resolve requested for thread ${threadId}`);
  }
}
