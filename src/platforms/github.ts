import { Octokit } from "@octokit/rest";
import { getAuditLogger } from "../audit/index.js";
import type { Config } from "../config.js";
import { DEFAULT_PAGE_SIZE } from "../constants.js";
import { createChildLogger } from "../logger.js";
import { withRateLimitHandling } from "../utils/rateLimitHandler.js";
import type {
  ExistingComment,
  FileStatus,
  PlatformAdapter,
  PRDetails,
  PRFile,
  RepoInfo,
} from "./types.js";

/**
 * Platform adapter for GitHub pull requests.
 */
export class GitHubAdapter implements PlatformAdapter {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string;
  private readonly botIdentifier: string;
  private readonly logger = createChildLogger({ component: "GitHubAdapter" });
  private readonly auditLogger = getAuditLogger();

  constructor(config: Config) {
    this.octokit = new Octokit({ auth: config.github.token });
    this.owner = config.github.owner;
    this.repo = config.github.repo;
    this.token = config.github.token;
    this.botIdentifier = config.botCommentIdentifier;
    this.logger.info({ owner: this.owner, repo: this.repo }, "GitHubAdapter initialized");
  }

  getProjectIdentifier(): string {
    return this.repo;
  }

  getRepoInfo(): RepoInfo {
    return {
      owner: this.owner,
      repo: this.repo,
      platform: "github",
    };
  }

  getToken(): string {
    return this.token;
  }

  async getPRDetails(prNumber: number): Promise<PRDetails> {
    try {
      const { data } = await withRateLimitHandling(() =>
        this.octokit.pulls.get({
          owner: this.owner,
          repo: this.repo,
          pull_number: prNumber,
        })
      );

      const details = {
        number: data.number,
        title: data.title,
        description: data.body || "",
        author: data.user?.login || "unknown",
        baseBranch: data.base.ref,
        headBranch: data.head.ref,
      };

      this.auditLogger.logPRDetailsFetch(prNumber, "github", "success");
      return details;
    } catch (error) {
      this.auditLogger.logPRDetailsFetch(prNumber, "github", "failure", (error as Error).message);
      throw error;
    }
  }

  async getPRFiles(prNumber: number): Promise<PRFile[]> {
    try {
      const { data } = await withRateLimitHandling(() =>
        this.octokit.pulls.listFiles({
          owner: this.owner,
          repo: this.repo,
          pull_number: prNumber,
          per_page: DEFAULT_PAGE_SIZE,
        })
      );

      const files = data.map((file) => ({
        filename: file.filename,
        status: file.status as FileStatus,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
        sha: file.sha ?? undefined,
      }));

      this.auditLogger.logPRFilesFetch(prNumber, "github", files.length);
      return files;
    } catch (error) {
      this.auditLogger.logPRFilesFetch(
        prNumber,
        "github",
        undefined,
        "failure",
        (error as Error).message
      );
      throw error;
    }
  }

  async getExistingBotComments(prNumber: number): Promise<ExistingComment[]> {
    try {
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

      this.auditLogger.logCommentsFetch(prNumber, "github", comments.length);
      return comments;
    } catch (error) {
      this.auditLogger.logCommentsFetch(
        prNumber,
        "github",
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
    this.logger.debug({ prNumber, path, line }, "Posting inline comment");

    try {
      const { data: pr } = await withRateLimitHandling(() =>
        this.octokit.pulls.get({
          owner: this.owner,
          repo: this.repo,
          pull_number: prNumber,
        })
      );

      await withRateLimitHandling(() =>
        this.octokit.pulls.createReviewComment({
          owner: this.owner,
          repo: this.repo,
          pull_number: prNumber,
          body,
          commit_id: pr.head.sha,
          path,
          line,
        })
      );
      this.logger.info({ prNumber, path, line }, "Inline comment posted successfully");
      this.auditLogger.logInlineCommentPost(prNumber, path, line, "github", "success");
    } catch (error) {
      this.logger.error(
        {
          prNumber,
          path,
          line,
          error: (error as Error).message,
          errorDetails: error,
        },
        "Failed to post inline comment"
      );
      this.auditLogger.logInlineCommentPost(
        prNumber,
        path,
        line,
        "github",
        "failure",
        (error as Error).message
      );
      throw error;
    }
  }

  async postGeneralComment(prNumber: number, body: string): Promise<void> {
    try {
      await withRateLimitHandling(() =>
        this.octokit.issues.createComment({
          owner: this.owner,
          repo: this.repo,
          issue_number: prNumber,
          body,
        })
      );
      this.auditLogger.logGeneralCommentPost(prNumber, "github", "success");
    } catch (error) {
      this.auditLogger.logGeneralCommentPost(
        prNumber,
        "github",
        "failure",
        (error as Error).message
      );
      throw error;
    }
  }
}
