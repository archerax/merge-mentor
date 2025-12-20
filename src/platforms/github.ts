import { Octokit } from "@octokit/rest";
import type { Config } from "../config.js";
import { DEFAULT_PAGE_SIZE } from "../constants.js";
import { createChildLogger } from "../logger.js";
import { withRateLimitHandling } from "../utils/rateLimitHandler.js";
import type { ExistingComment, FileStatus, PlatformAdapter, PRDetails, PRFile } from "./types.js";

/**
 * Platform adapter for GitHub pull requests.
 */
export class GitHubAdapter implements PlatformAdapter {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;
  private readonly botIdentifier: string;
  private readonly logger = createChildLogger({ component: 'GitHubAdapter' });

  constructor(config: Config) {
    this.octokit = new Octokit({ auth: config.github.token });
    this.owner = config.github.owner;
    this.repo = config.github.repo;
    this.botIdentifier = config.botCommentIdentifier;
    this.logger.info({ owner: this.owner, repo: this.repo }, 'GitHubAdapter initialized');
  }

  async getPRDetails(prNumber: number): Promise<PRDetails> {
    const { data } = await withRateLimitHandling(() =>
      this.octokit.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      })
    );

    return {
      number: data.number,
      title: data.title,
      description: data.body || "",
      author: data.user?.login || "unknown",
      baseBranch: data.base.ref,
      headBranch: data.head.ref,
    };
  }

  async getPRFiles(prNumber: number): Promise<PRFile[]> {
    const { data } = await withRateLimitHandling(() =>
      this.octokit.pulls.listFiles({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        per_page: DEFAULT_PAGE_SIZE,
      })
    );

    return data.map((file) => ({
      filename: file.filename,
      status: file.status as FileStatus,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
    }));
  }

  async getExistingBotComments(prNumber: number): Promise<ExistingComment[]> {
    const comments: ExistingComment[] = [];

    // Get PR review comments (inline comments)
    const { data: reviewComments } = await withRateLimitHandling(() =>
      this.octokit.pulls.listReviewComments({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
        per_page: DEFAULT_PAGE_SIZE,
      })
    );

    for (const comment of reviewComments) {
      if (comment.body.includes(this.botIdentifier)) {
        comments.push({
          id: comment.id,
          body: comment.body,
          path: comment.path,
          line: comment.line ?? undefined,
        });
      }
    }

    // Get issue comments (general comments)
    const { data: issueComments } = await withRateLimitHandling(() =>
      this.octokit.issues.listComments({
        owner: this.owner,
        repo: this.repo,
        issue_number: prNumber,
        per_page: DEFAULT_PAGE_SIZE,
      })
    );

    for (const comment of issueComments) {
      if (comment.body?.includes(this.botIdentifier)) {
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
    this.logger.debug({ prNumber, path, line }, 'Posting inline comment');
    
    const { data: pr } = await withRateLimitHandling(() =>
      this.octokit.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      })
    );

    try {
      await withRateLimitHandling(() =>
        this.octokit.pulls.createReviewComment({
          owner: this.owner,
          repo: this.repo,
          pull_number: prNumber,
          body: `${this.botIdentifier}\n\n${body}`,
          commit_id: pr.head.sha,
          path,
          line,
        })
      );
      this.logger.info({ prNumber, path, line }, 'Inline comment posted successfully');
    } catch (error) {
      this.logger.error({
        prNumber,
        path,
        line,
        commitSha: pr.head.sha,
        error: (error as Error).message,
        errorDetails: error
      }, 'Failed to post inline comment');
      throw error;
    }
  }

  async postGeneralComment(prNumber: number, body: string): Promise<void> {
    await withRateLimitHandling(() =>
      this.octokit.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: prNumber,
        body: `${this.botIdentifier}\n\n${body}`,
      })
    );
  }

  async updateComment(commentId: number | string, body: string): Promise<void> {
    const id = typeof commentId === "string" ? parseInt(commentId, 10) : commentId;
    this.logger.debug({ commentId: id }, 'Updating comment');

    try {
      await withRateLimitHandling(() =>
        this.octokit.pulls.updateReviewComment({
          owner: this.owner,
          repo: this.repo,
          comment_id: id,
          body: `${this.botIdentifier}\n\n${body}`,
        })
      );
      this.logger.info({ commentId: id, type: 'review' }, 'Comment updated successfully');
    } catch (error) {
      this.logger.warn({
        commentId: id,
        error: (error as Error).message
      }, 'Failed to update review comment, trying as issue comment');
      console.warn(
        `Failed to update review comment ${id}, trying as issue comment:`,
        (error as Error).message
      );
      await withRateLimitHandling(() =>
        this.octokit.issues.updateComment({
          owner: this.owner,
          repo: this.repo,
          comment_id: id,
          body: `${this.botIdentifier}\n\n${body}`,
        })
      );
      this.logger.info({ commentId: id, type: 'issue' }, 'Comment updated successfully');
    }
  }

  async resolveComment(commentId: number | string): Promise<void> {
    const id = typeof commentId === "string" ? parseInt(commentId, 10) : commentId;
    this.logger.debug({ commentId: id }, 'Resolving comment');

    try {
      await withRateLimitHandling(() =>
        this.octokit.pulls.updateReviewComment({
          owner: this.owner,
          repo: this.repo,
          comment_id: id,
          body: `${this.botIdentifier}\n\n~~This issue has been resolved.~~`,
        })
      );
      this.logger.info({ commentId: id, type: 'review' }, 'Comment resolved successfully');
    } catch (error) {
      this.logger.warn({
        commentId: id,
        error: (error as Error).message
      }, 'Failed to resolve review comment, trying as issue comment');
      console.warn(
        `Failed to resolve review comment ${id}, trying as issue comment:`,
        (error as Error).message
      );
      await withRateLimitHandling(() =>
        this.octokit.issues.updateComment({
          owner: this.owner,
          repo: this.repo,
          comment_id: id,
          body: `${this.botIdentifier}\n\n~~This issue has been resolved.~~`,
        })
      );
      this.logger.info({ commentId: id, type: 'issue' }, 'Comment resolved successfully');
    }
  }
}
