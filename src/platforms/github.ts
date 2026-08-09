import { Octokit } from "@octokit/rest";
import { getAuditLogger } from "../audit/index.js";
import type { Config } from "../config.js";
import { DEFAULT_PAGE_SIZE } from "../constants.js";
import { createChildLogger } from "../logger.js";
import { extractMoSCoWTag } from "../utils/moscow.js";
import { withRateLimitHandling } from "../utils/rateLimitHandler.js";
import type {
  ExistingComment,
  FileStatus,
  PBIDetails,
  PlatformAdapter,
  PRDetails,
  PRFile,
  ProjectDetails,
  RepoInfo,
  UnresolvedComment,
  UnresolvedCommentThread,
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

  /**
   * Returns the repository name used as the project identifier.
   * @returns Repository name
   */
  getProjectIdentifier(): string {
    return this.repo;
  }

  /**
   * Returns the platform name for dispatching platform-specific logic.
   * @returns "github"
   */
  getPlatformName(): "github" {
    return "github";
  }

  /**
   * Returns repository information for context loading.
   * @returns Repository owner, name, and platform
   */
  getRepoInfo(): RepoInfo {
    return {
      owner: this.owner,
      repo: this.repo,
      platform: "github",
    };
  }

  /**
   * Gets the authentication token for Git operations.
   * @returns GitHub personal access token
   */
  getToken(): string {
    return this.token;
  }

  /**
   * Retrieves pull request details from the GitHub API.
   * @param prNumber - The PR number to fetch
   * @returns Details about the pull request
   * @throws If the pull request cannot be fetched
   */
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

  /**
   * Retrieves files changed in a pull request via paginated listing.
   * @param prNumber - The PR number
   * @param _ignorePatterns - Optional glob patterns; unused because the GitHub API returns all changed files
   * @returns Array of files changed in the pull request
   */
  async getPRFiles(prNumber: number, _ignorePatterns?: string[]): Promise<PRFile[]> {
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

  /**
   * Gets existing bot comments on a PR, including inline review comments and general issue comments.
   * @param prNumber - The PR number
   * @returns Comments written by the bot
   */
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

  /**
   * Retrieves a specific comment thread by comment or thread ID.
   * Falls back to the REST API when the GraphQL lookup fails.
   * @param prNumber - The PR number
   * @param commentId - The comment or thread ID
   * @returns The matching comment thread
   * @throws If the thread cannot be found on the PR
   */
  async getCommentThread(
    prNumber: number,
    commentId: string | number
  ): Promise<UnresolvedCommentThread> {
    const stringId = commentId.toString();

    const query = `
      query FetchAllThreads($owner: String!, $repo: String!, $pr: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pr) {
            reviewThreads(first: 100) {
              nodes {
                id
                isResolved
                path
                line
                comments(first: 50) {
                  nodes {
                    id
                    databaseId
                    createdAt
                    author {
                      login
                    }
                    body
                  }
                }
              }
            }
          }
        }
      }
    `;

    interface GraphQLResponse {
      repository?: {
        pullRequest?: {
          reviewThreads?: {
            nodes?: Array<{
              id: string | number;
              isResolved: boolean;
              path: string;
              line: number;
              comments?: {
                nodes?: Array<{
                  id?: string | number;
                  databaseId?: number;
                  createdAt?: string;
                  author?: {
                    login?: string;
                  };
                  body?: string;
                }>;
              };
            }>;
          };
        };
      };
    }

    try {
      const response = (await withRateLimitHandling(() =>
        this.octokit.graphql(query, {
          owner: this.owner,
          repo: this.repo,
          pr: prNumber,
        })
      )) as GraphQLResponse;

      const threads = response?.repository?.pullRequest?.reviewThreads?.nodes || [];
      const match = threads.find((t) => {
        if (t.id?.toString() === stringId) return true;
        return t.comments?.nodes?.some(
          (c) => c.id?.toString() === stringId || c.databaseId?.toString() === stringId
        );
      });

      if (match?.path && match.line) {
        const mappedComments: UnresolvedComment[] =
          match.comments?.nodes?.map(
            (c): UnresolvedComment => ({
              id: c.databaseId ?? c.id,
              author: c.author?.login ?? "unknown",
              body: c.body || "",
              createdAt: c.createdAt,
              isBot:
                (c.author?.login ?? "").endsWith("[bot]") ||
                (c.body || "").includes(this.botIdentifier),
            })
          ) ?? [];

        const firstComment = mappedComments[0];

        return {
          id: match.id,
          path: match.path,
          line: match.line,
          status: match.isResolved ? "resolved" : "active",
          botInitiated: firstComment ? firstComment.isBot : false,
          comments: mappedComments,
        };
      }
    } catch (error) {
      this.logger.warn(
        { prNumber, commentId, error: (error as Error).message },
        "GraphQL query for comment thread failed, falling back to REST"
      );
    }

    if (/^\d+$/.test(stringId)) {
      try {
        const { data: comment } = await withRateLimitHandling(() =>
          this.octokit.pulls.getReviewComment({
            owner: this.owner,
            repo: this.repo,
            comment_id: Number(commentId),
          })
        );

        return {
          id: comment.in_reply_to_id ?? comment.id,
          path: comment.path,
          line: comment.line ?? 1,
          status: "active",
          botInitiated: (comment.body || "").includes(this.botIdentifier),
          comments: [
            {
              id: comment.id,
              author: comment.user?.login ?? "unknown",
              body: comment.body,
              createdAt: comment.created_at,
              isBot:
                (comment.user?.login ?? "").endsWith("[bot]") ||
                (comment.body || "").includes(this.botIdentifier),
            },
          ],
        };
      } catch (error) {
        this.logger.error(
          { prNumber, commentId, error: (error as Error).message },
          "Failed to fetch review comment via REST"
        );
        throw error;
      }
    }

    throw new Error(`Comment thread "${commentId}" not found on PR #${prNumber}`);
  }

  /**
   * Retrieves all unresolved/active PR comment threads via the GraphQL API.
   * @param prNumber - The PR number
   * @returns Array of unresolved comment threads
   */
  async getUnresolvedCommentThreads(prNumber: number): Promise<UnresolvedCommentThread[]> {
    try {
      const query = `
        query FetchUnresolvedThreads($owner: String!, $repo: String!, $pr: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $pr) {
              reviewThreads(first: 100) {
                nodes {
                  id
                  isResolved
                  path
                  line
                  comments(first: 50) {
                    nodes {
                      id
                      databaseId
                      createdAt
                      author {
                        login
                      }
                      body
                    }
                  }
                }
              }
            }
          }
        }
      `;

      interface GraphQLResponse {
        repository?: {
          pullRequest?: {
            reviewThreads?: {
              nodes?: Array<{
                id: string | number;
                isResolved: boolean;
                path: string;
                line: number;
                comments?: {
                  nodes?: Array<{
                    id?: string | number;
                    databaseId?: number;
                    createdAt?: string;
                    author?: {
                      login?: string;
                    };
                    body?: string;
                  }>;
                };
              }>;
            };
          };
        };
      }

      const response = (await withRateLimitHandling(() =>
        this.octokit.graphql(query, {
          owner: this.owner,
          repo: this.repo,
          pr: prNumber,
        })
      )) as GraphQLResponse;

      const threads = response?.repository?.pullRequest?.reviewThreads?.nodes || [];

      return threads
        .filter((t) => !t.isResolved && t.path && t.line)
        .map((t) => {
          const mappedComments: UnresolvedComment[] =
            t.comments?.nodes?.map((c): UnresolvedComment => {
              const isBot =
                (c.author?.login ?? "").endsWith("[bot]") ||
                (c.body || "").includes(this.botIdentifier);
              return {
                author: c.author?.login ?? "unknown",
                body: c.body || "",
                ...(c.databaseId || c.id ? { id: c.databaseId ?? c.id } : {}),
                ...(c.createdAt ? { createdAt: c.createdAt } : {}),
                ...(isBot ? { isBot: true } : {}),
              };
            }) ?? [];

          const firstComment = mappedComments[0];
          const botInitiated = firstComment ? Boolean(firstComment.isBot) : false;

          return {
            id: t.id,
            path: t.path,
            line: t.line,
            comments: mappedComments,
            ...(t.isResolved ? { status: "resolved" } : {}),
            ...(botInitiated ? { botInitiated: true } : {}),
          };
        });
    } catch (error) {
      this.logger.error(
        { prNumber, error: (error as Error).message },
        "Failed to fetch unresolved comment threads"
      );
      throw error;
    }
  }

  /**
   * Posts a reply to an existing PR comment thread.
   * Uses the REST API for numeric comment IDs and the GraphQL mutation for thread IDs.
   * @param prNumber - The PR number
   * @param threadId - The target thread ID
   * @param body - The reply message body
   */
  async postCommentReply(prNumber: number, threadId: string | number, body: string): Promise<void> {
    const stringId = threadId.toString();
    this.logger.debug({ prNumber, threadId, stringId }, "Posting comment reply");

    try {
      if (/^\d+$/.test(stringId)) {
        await withRateLimitHandling(() =>
          this.octokit.pulls.createReplyForReviewComment({
            owner: this.owner,
            repo: this.repo,
            pull_number: prNumber,
            comment_id: Number(threadId),
            body,
          })
        );
      } else {
        const mutation = `
          mutation AddReply($threadId: ID!, $body: String!) {
            addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
              comment {
                id
              }
            }
          }
        `;
        await withRateLimitHandling(() =>
          this.octokit.graphql(mutation, {
            threadId: stringId,
            body,
          })
        );
      }

      this.logger.info({ prNumber, threadId }, "Comment reply posted successfully");
      this.auditLogger.logInlineCommentPost(prNumber, "thread", 0, "github", "success");
    } catch (error) {
      this.logger.error(
        { prNumber, threadId, error: (error as Error).message },
        "Failed to post comment reply"
      );
      this.auditLogger.logInlineCommentPost(
        prNumber,
        "thread",
        0,
        "github",
        "failure",
        (error as Error).message
      );
      throw error;
    }
  }

  /**
   * Resolves an unresolved PR comment thread.
   * @param prNumber - The PR number
   * @param threadId - The target thread ID
   */
  async resolveCommentThread(prNumber: number, threadId: string | number): Promise<void> {
    this.logger.debug({ prNumber, threadId }, "Resolving comment thread");

    let nodeThreadId = threadId.toString();

    if (/^\d+$/.test(nodeThreadId)) {
      try {
        const thread = await this.getCommentThread(prNumber, threadId);
        nodeThreadId = thread.id.toString();
      } catch (err) {
        this.logger.warn(
          { prNumber, threadId, error: (err as Error).message },
          "Could not convert numeric commentId to GraphQL Node ID"
        );
      }
    }

    try {
      const mutation = `
        mutation ResolveThread($threadId: ID!) {
          resolveReviewThread(input: { threadId: $threadId }) {
            thread {
              isResolved
            }
          }
        }
      `;
      await withRateLimitHandling(() =>
        this.octokit.graphql(mutation, {
          threadId: nodeThreadId,
        })
      );
      this.logger.info({ prNumber, threadId }, "Comment thread resolved successfully");
    } catch (error) {
      this.logger.error(
        { prNumber, threadId, error: (error as Error).message },
        "Failed to resolve comment thread"
      );
      throw error;
    }
  }

  /**
   * Posts an inline comment on a specific file line of the PR head commit.
   * @param prNumber - The PR number
   * @param path - File path
   * @param line - Line number
   * @param body - Comment body
   * @param startLine - Optional first line of a multi-line comment range
   */
  async postInlineComment(
    prNumber: number,
    path: string,
    line: number,
    body: string,
    startLine?: number
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
          side: "RIGHT",
          ...(startLine !== undefined && startLine !== line
            ? { start_line: startLine, start_side: "RIGHT" }
            : {}),
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

  /**
   * Posts a general (issue) comment on the PR.
   * @param prNumber - The PR number
   * @param body - Comment body
   */
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

  /**
   * Retrieves GitHub issue details as PBI data, including comments and a MoSCoW tag,
   * with acceptance criteria and story points parsed from the description.
   * @param id - The issue number
   * @returns Details about the issue
   * @throws If the issue number is invalid
   */
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
      const labelNames = (issue.labels || [])
        .map((label) => {
          if (typeof label === "string") {
            return label;
          }
          return label.name || "";
        })
        .filter(Boolean);
      const moscowTag = extractMoSCoWTag(labelNames);

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
        moscowTag,
      };
    } catch (error) {
      this.logger.error(
        { id, error: (error as Error).message },
        "Failed to fetch GitHub PBI details"
      );
      throw error;
    }
  }

  /**
   * Identifies issues linked to a PR by scanning its title and description for issue references.
   * @param prNumber - The PR number
   * @returns Array of linked issue numbers
   */
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

  /**
   * Posts a new comment on an issue, or updates an existing one when commentId is provided.
   * @param id - The issue number
   * @param body - Comment body
   * @param commentId - Optional comment ID to update an existing comment in-place
   */
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

  /**
   * Updates the title and body of a pull request.
   * @param prNumber - The PR number
   * @param details - The new title and/or body to apply
   */
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

  /**
   * Retrieves hierarchical project details.
   * @param _id - The root work item ID
   * @throws Always, because GitHub project review is not yet supported
   */
  async getProjectDetails(_id: string): Promise<ProjectDetails> {
    throw new Error("GitHub project review is not yet supported in this version.");
  }
}

/**
 * Extracts the acceptance criteria section from an issue description.
 * @param body - The issue description to parse
 * @returns The trimmed acceptance criteria text, or undefined if not found
 */
function parseAcceptanceCriteria(body: string | null): string | undefined {
  if (!body) return undefined;
  const match = body.match(
    /(?:^|\n)(?:[#*_\s]*acceptance\s+criteria[#*_\s]*)\r?\n([\s\S]*?)(?=(?:\n\s*#{1,6}\s|\n\s*\*+\s*|$))/i
  );
  return match ? match[1].trim() : undefined;
}

/**
 * Extracts the story points estimate from an issue description.
 * @param body - The issue description to parse
 * @returns The parsed story points number, or undefined if not found
 */
function parseStoryPoints(body: string | null): number | undefined {
  if (!body) return undefined;
  const match = body.match(/(?:story\s+points?|sp|points?)\s*[:=-]\s*(\d+(?:\.\d+)?)/i);
  return match ? Number.parseFloat(match[1]) : undefined;
}
