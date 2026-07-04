import { Octokit } from "@octokit/rest";
import { getAuditLogger } from "../audit/index.js";
import type { Config } from "../config.js";
import { DEFAULT_PAGE_SIZE } from "../constants.js";
import { createChildLogger } from "../logger.js";
import { withRateLimitHandling } from "../utils/rateLimitHandler.js";
import type {
  ExistingComment,
  FileStatus,
  PBIDetails,
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

  constructor(config: Pick<Config, "github" | "botCommentIdentifier">) {
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

  getPlatformName(): "github" {
    return "github";
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
      const data = await withRateLimitHandling(() =>
        this.octokit.paginate(this.octokit.pulls.listFiles, {
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
      const reviewComments = await withRateLimitHandling(() =>
        this.octokit.paginate(this.octokit.pulls.listReviewComments, {
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
      const issueComments = await withRateLimitHandling(() =>
        this.octokit.paginate(this.octokit.issues.listComments, {
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

  async getPBIDetails(id: string): Promise<PBIDetails> {
    const issueNumber = Number.parseInt(id, 10);
    if (Number.isNaN(issueNumber)) {
      throw new Error(`Invalid GitHub issue number: "${id}"`);
    }

    try {
      const { data: issue } = await withRateLimitHandling(() =>
        this.octokit.issues.get({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
        })
      );

      const commentsData = await withRateLimitHandling(() =>
        this.octokit.paginate(this.octokit.issues.listComments, {
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber,
          per_page: DEFAULT_PAGE_SIZE,
        })
      );

      const description = issue.body || "";
      return {
        id,
        platform: "github",
        title: issue.title,
        description,
        acceptanceCriteria: parseAcceptanceCriteria(description),
        storyPoints: parseStoryPoints(description),
        comments: commentsData.map((c) => ({
          id: c.id,
          body: c.body || "",
        })),
      };
    } catch (error) {
      this.logger.error(
        { id, error: (error as Error).message },
        "Failed to fetch GitHub PBI details"
      );
      throw error;
    }
  }

  async getLinkedPBIIds(prNumber: number): Promise<readonly string[]> {
    try {
      const pr = await this.getPRDetails(prNumber);
      const text = `${pr.title}\n${pr.description}`;
      const ids = new Set<string>();

      const closingRegex =
        /(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#(\d+)/gi;
      let match = closingRegex.exec(text);
      while (match !== null) {
        ids.add(match[1]);
        match = closingRegex.exec(text);
      }

      const genericRegex = /(?:issue|task|pbi|bug|story)?\s*#(\d+)/gi;
      match = genericRegex.exec(text);
      while (match !== null) {
        ids.add(match[1]);
        match = genericRegex.exec(text);
      }

      const result = Array.from(ids);
      this.logger.debug({ prNumber, linkedIds: result }, "Identified linked GitHub issues");
      return result;
    } catch (error) {
      this.logger.error(
        { prNumber, error: (error as Error).message },
        "Failed to scan linked issues for PR"
      );
      throw error;
    }
  }

  async postPBIComment(id: string, body: string, commentId?: number | string): Promise<void> {
    const issueNumber = Number.parseInt(id, 10);
    if (Number.isNaN(issueNumber)) {
      throw new Error(`Invalid GitHub issue number: "${id}"`);
    }

    try {
      if (commentId !== undefined) {
        const numericCommentId =
          typeof commentId === "string" ? Number.parseInt(commentId, 10) : commentId;
        await withRateLimitHandling(() =>
          this.octokit.issues.updateComment({
            owner: this.owner,
            repo: this.repo,
            comment_id: numericCommentId,
            body,
          })
        );
        this.logger.info({ id, commentId }, "PBI comment updated successfully");
      } else {
        await withRateLimitHandling(() =>
          this.octokit.issues.createComment({
            owner: this.owner,
            repo: this.repo,
            issue_number: issueNumber,
            body,
          })
        );
        this.logger.info({ id }, "PBI comment created successfully");
      }
    } catch (error) {
      this.logger.error(
        { id, commentId, error: (error as Error).message },
        "Failed to post/update PBI comment"
      );
      throw error;
    }
  }

  async updatePRDetails(
    prNumber: number,
    details: { readonly title?: string; readonly body?: string }
  ): Promise<void> {
    try {
      const updateParams: {
        owner: string;
        repo: string;
        pull_number: number;
        title?: string;
        body?: string;
      } = {
        owner: this.owner,
        repo: this.repo,
        pull_number: prNumber,
      };
      if (details.title !== undefined) updateParams.title = details.title;
      if (details.body !== undefined) updateParams.body = details.body;

      await withRateLimitHandling(() => this.octokit.pulls.update(updateParams));
      this.auditLogger.logPRDetailsUpdate(prNumber, "github", "success");
    } catch (error) {
      this.auditLogger.logPRDetailsUpdate(prNumber, "github", "failure", (error as Error).message);
      throw error;
    }
  }
}

function parseAcceptanceCriteria(body: string | null): string | undefined {
  if (!body) return undefined;
  const match = body.match(
    /(?:^|\n)(?:[#*_\s]*acceptance\s+criteria[#*_\s]*)\r?\n([\s\S]*?)(?=(?:\n\s*#{1,6}\s|\n\s*\*+\s*|$))/i
  );
  return match ? match[1].trim() : undefined;
}

function parseStoryPoints(body: string | null): number | undefined {
  if (!body) return undefined;
  const match = body.match(/(?:story\s+points?|sp|points?)\s*[:=-]\s*(\d+(?:\.\d+)?)/i);
  return match ? Number.parseFloat(match[1]) : undefined;
}
