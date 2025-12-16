import { Octokit } from '@octokit/rest';
import type { Config } from '../config.js';
import type {
  PlatformAdapter,
  PRDetails,
  PRFile,
  ExistingComment,
} from './types.js';

export class GitHubAdapter implements PlatformAdapter {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private botIdentifier: string;

  constructor(config: Config) {
    this.octokit = new Octokit({ auth: config.github.token });
    this.owner = config.github.owner;
    this.repo = config.github.repo;
    this.botIdentifier = config.botCommentIdentifier;
  }

  async getPRDetails(prNumber: number): Promise<PRDetails> {
    const { data } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });

    return {
      number: data.number,
      title: data.title,
      description: data.body || '',
      author: data.user?.login || 'unknown',
      baseBranch: data.base.ref,
      headBranch: data.head.ref,
    };
  }

  async getPRFiles(prNumber: number): Promise<PRFile[]> {
    const { data } = await this.octokit.pulls.listFiles({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      per_page: 100,
    });

    return data.map((file) => ({
      filename: file.filename,
      status: file.status as PRFile['status'],
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
    }));
  }

  async getExistingBotComments(prNumber: number): Promise<ExistingComment[]> {
    const comments: ExistingComment[] = [];

    // Get PR review comments (inline comments)
    const { data: reviewComments } = await this.octokit.pulls.listReviewComments({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      per_page: 100,
    });

    for (const comment of reviewComments) {
      if (comment.body.includes(this.botIdentifier)) {
        comments.push({
          id: comment.id,
          body: comment.body,
          path: comment.path,
          line: comment.line || undefined,
        });
      }
    }

    // Get issue comments (general comments)
    const { data: issueComments } = await this.octokit.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: prNumber,
      per_page: 100,
    });

    for (const comment of issueComments) {
      if (comment.body && comment.body.includes(this.botIdentifier)) {
        comments.push({
          id: comment.id,
          body: comment.body,
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
    const { data: pr } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });

    await this.octokit.pulls.createReviewComment({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      body: `${this.botIdentifier}\n\n${body}`,
      commit_id: pr.head.sha,
      path,
      line,
    });
  }

  async postGeneralComment(prNumber: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: prNumber,
      body: `${this.botIdentifier}\n\n${body}`,
    });
  }

  async updateComment(commentId: number | string, body: string): Promise<void> {
    const id = typeof commentId === 'string' ? parseInt(commentId, 10) : commentId;
    
    try {
      // Try updating as a review comment first
      await this.octokit.pulls.updateReviewComment({
        owner: this.owner,
        repo: this.repo,
        comment_id: id,
        body: `${this.botIdentifier}\n\n${body}`,
      });
    } catch {
      // If that fails, try updating as an issue comment
      await this.octokit.issues.updateComment({
        owner: this.owner,
        repo: this.repo,
        comment_id: id,
        body: `${this.botIdentifier}\n\n${body}`,
      });
    }
  }

  async resolveComment(commentId: number | string): Promise<void> {
    const id = typeof commentId === 'string' ? parseInt(commentId, 10) : commentId;
    
    try {
      // GitHub doesn't have a direct "resolve" API for review comments
      // We update the comment to indicate it's resolved
      await this.octokit.pulls.updateReviewComment({
        owner: this.owner,
        repo: this.repo,
        comment_id: id,
        body: `${this.botIdentifier}\n\n~~This issue has been resolved.~~`,
      });
    } catch {
      await this.octokit.issues.updateComment({
        owner: this.owner,
        repo: this.repo,
        comment_id: id,
        body: `${this.botIdentifier}\n\n~~This issue has been resolved.~~`,
      });
    }
  }
}
