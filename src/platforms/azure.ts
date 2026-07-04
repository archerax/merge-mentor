import * as azdev from "azure-devops-node-api";
import type {
  Comment,
  GitPullRequestCommentThread,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import * as Diff from "diff";
import { getAuditLogger } from "../audit/index.js";
import type { Config } from "../config.js";
import { DIFF_CONTEXT_LINES } from "../constants.js";
import { PlatformApiError } from "../errors/index.js";
import { createChildLogger } from "../logger.js";
import { withRateLimitHandling } from "../utils/rateLimitHandler.js";
import type {
  ExistingComment,
  FileStatus,
  PBIComment,
  PBIDetails,
  PlatformAdapter,
  PRDetails,
  PRFile,
  RepoInfo,
} from "./types.js";

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
  private readonly logger = createChildLogger({
    component: "AzureDevOpsAdapter",
  });
  private readonly token: string;
  private readonly orgUrl: string;
  private readonly org: string;

  constructor(config: Pick<Config, "azure" | "botCommentIdentifier">) {
    const authHandler = azdev.getPersonalAccessTokenHandler(config.azure.token);
    this.orgUrl = `https://dev.azure.com/${config.azure.org}`;
    this.connection = new azdev.WebApi(this.orgUrl, authHandler);
    this.project = config.azure.project;
    this.repoName = config.azure.repo;
    this.botIdentifier = config.botCommentIdentifier;
    this.token = config.azure.token;
    this.org = config.azure.org;
    this.logger.info(
      { project: this.project, repo: this.repoName },
      "AzureDevOpsAdapter initialized"
    );
  }

  getProjectIdentifier(): string {
    return `${this.org}/${this.project}/${this.repoName}`;
  }

  getPlatformName(): "azure" {
    return "azure";
  }

  getRepoInfo(): RepoInfo {
    return {
      owner: this.org,
      repo: this.repoName,
      platform: "azure",
      org: this.org,
      project: this.project,
    };
  }

  getToken(): string {
    return this.token;
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
      const { patch, additions, deletions } = await this.generateDiffFromBlobs(
        repositoryId,
        path,
        baseCommitId,
        headCommitId,
        status
      );

      files.push({
        filename: path,
        status,
        additions,
        deletions,
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

      const response = await withRateLimitHandling(async () => {
        const res = await fetch(url, {
          headers: {
            Authorization: `Basic ${Buffer.from(`:${this.token}`).toString("base64")}`,
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) {
          const errorText = await res.text();
          this.logger.error(
            {
              status: res.status,
              statusText: res.statusText,
              errorText,
            },
            "Failed to fetch PR iteration changes via REST API"
          );
          throw new PlatformApiError(
            "azure",
            "fetch-iteration-changes",
            `Azure DevOps API error: ${res.status} ${res.statusText}`,
            undefined,
            res.status
          );
        }
        return res;
      });

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

  private mapIterationChangeTypeToStatus(changeType?: number): FileStatus {
    if (changeType === undefined) {
      return "modified";
    }
    // Delete
    if ((changeType & 16) !== 0) {
      return "deleted";
    }
    // Rename, SourceRename, or TargetRename
    if ((changeType & 8) !== 0 || (changeType & 1024) !== 0 || (changeType & 2048) !== 0) {
      return "renamed";
    }
    // Add
    if (changeType === 1 || changeType === 3) {
      return "added";
    }
    return "modified";
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
  ): Promise<{ patch: string; additions: number; deletions: number }> {
    try {
      let baseContent = "";
      let targetContent = "";

      // Fetch base version content (if not added)
      if (status !== "added") {
        try {
          baseContent = await this.fetchFileContentAtCommit(repositoryId, filePath, baseCommitId);
        } catch (error) {
          if ((error as Error).message.includes("Binary file")) {
            throw error;
          }
          if (error instanceof PlatformApiError && error.status === 404) {
            this.logger.debug(
              { filePath, commit: baseCommitId, error: (error as Error).message },
              "Could not fetch base content (file may be new)"
            );
          } else {
            throw error;
          }
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
          if ((error as Error).message.includes("Binary file")) {
            throw error;
          }
          if (error instanceof PlatformApiError && error.status === 404) {
            this.logger.debug(
              {
                filePath,
                commit: targetCommitId,
                error: (error as Error).message,
              },
              "Could not fetch target content (file may be deleted)"
            );
          } else {
            throw error;
          }
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

      // Format as git-style unified diff and count changed lines
      let patch = `diff --git a/${filePath} b/${filePath}\n`;
      patch += `--- a/${filePath}\n`;
      patch += `+++ b/${filePath}\n`;

      let additions = 0;
      let deletions = 0;

      for (const hunk of structuredDiff.hunks) {
        patch += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`;
        for (const line of hunk.lines) {
          patch += `${line}\n`;
          if (line.startsWith("+")) additions++;
          else if (line.startsWith("-")) deletions++;
        }
      }

      if (structuredDiff.hunks.length === 0) {
        this.logger.warn(
          {
            filePath,
            baseLength: baseContent.length,
            targetLength: targetContent.length,
          },
          "No diff hunks generated - files may be identical"
        );
      } else {
        this.logger.info(
          { filePath, hunksCount: structuredDiff.hunks.length },
          "Generated diff successfully"
        );
      }

      return { patch, additions, deletions };
    } catch (error) {
      if ((error as Error).message.includes("Binary file")) {
        this.logger.info({ filePath }, "Skipping binary file in diff generation");
        return {
          patch: "",
          additions: 0,
          deletions: 0,
        };
      }
      if (error instanceof PlatformApiError && error.status === 404) {
        this.logger.warn(
          { filePath, error: (error as Error).message },
          "Expected file content not found (404) during diff generation"
        );
        return {
          patch: this.createEmptyDiffHeader(filePath),
          additions: 0,
          deletions: 0,
        };
      }
      this.logger.error(
        { filePath, error: (error as Error).message },
        "Unexpected error generating diff from blobs"
      );
      throw error;
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

    const response = await withRateLimitHandling(async () => {
      const res = await fetch(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`:${this.token}`).toString("base64")}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        throw new PlatformApiError(
          "azure",
          "fetch-file-content",
          `Failed to fetch file content: ${res.status} ${res.statusText}`,
          undefined,
          res.status
        );
      }
      return res;
    });

    const data = (await response.json()) as {
      content?: string;
      contentType?: string;
      versionControlContentType?: string;
    };

    const type = (data.contentType || data.versionControlContentType)?.toLowerCase();
    if (type === "base64encoded") {
      throw new Error(`Binary file: base64Encoded content type detected for ${filePath}`);
    }

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
            content: body,
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
            content: body,
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

  async getPBIDetails(id: string): Promise<PBIDetails> {
    const workItemId = Number.parseInt(id, 10);
    if (Number.isNaN(workItemId)) {
      throw new Error(`Invalid Azure DevOps work item ID: "${id}"`);
    }

    try {
      const witApi = await this.connection.getWorkItemTrackingApi();
      const workItem = await withRateLimitHandling(
        () => witApi.getWorkItem(workItemId, undefined, undefined, 4) // WorkItemExpand.All = 4
      );

      if (!workItem?.fields) {
        throw new Error(`Work item with ID ${id} not found.`);
      }

      const title = (workItem.fields["System.Title"] as string) || "";
      const rawDescription = (workItem.fields["System.Description"] as string) || "";
      const rawAcceptanceCriteria =
        (workItem.fields["Microsoft.VSTS.Common.AcceptanceCriteria"] as string) || "";

      const storyPointsValue =
        workItem.fields["Microsoft.VSTS.Scheduling.StoryPoints"] ??
        workItem.fields["Microsoft.VSTS.Scheduling.Effort"];
      const storyPoints =
        storyPointsValue !== undefined && storyPointsValue !== null
          ? Number.parseFloat(storyPointsValue.toString())
          : undefined;

      const description = stripHtml(rawDescription);
      const acceptanceCriteria = stripHtml(rawAcceptanceCriteria);

      const commentsList = await withRateLimitHandling(() =>
        witApi.getComments(this.project, workItemId)
      );

      const comments: PBIComment[] = (commentsList.comments || []).map((c) => ({
        id: c.id ?? "",
        body: stripHtml(c.text || ""),
      }));

      const workItemType = workItem.fields["System.WorkItemType"] as string;

      if (workItemType === "Task") {
        const parentRelation = workItem.relations?.find(
          (rel) => rel.rel === "System.LinkTypes.Hierarchy-Reverse"
        );
        if (parentRelation?.url) {
          const match = parentRelation.url.match(/\/workItems\/(\d+)(?:\?|$)/);
          if (match) {
            const parentId = match[1];
            try {
              const parentDetails = await this.getPBIDetails(parentId);
              const combinedTitle = `Task: ${title} (Parent PBI #${parentId}: ${parentDetails.title})`;

              const combinedDescription = [
                "Task Description:",
                description || "(No description)",
                "Parent PBI Description:",
                parentDetails.description || "(No description)",
              ].join("\n\n");

              const taskAC = acceptanceCriteria;
              const parentAC = parentDetails.acceptanceCriteria;
              let combinedAcceptanceCriteria: string | undefined;
              if (taskAC && parentAC) {
                combinedAcceptanceCriteria = `Task Acceptance Criteria:\n${taskAC}\n\nParent PBI Acceptance Criteria:\n${parentAC}`;
              } else if (taskAC) {
                combinedAcceptanceCriteria = `Task Acceptance Criteria:\n${taskAC}`;
              } else if (parentAC) {
                combinedAcceptanceCriteria = `Parent PBI Acceptance Criteria:\n${parentAC}`;
              }

              const combinedComments = [...comments, ...parentDetails.comments];

              return {
                id,
                platform: "azure",
                title: combinedTitle,
                description: combinedDescription,
                acceptanceCriteria: combinedAcceptanceCriteria,
                storyPoints: storyPoints ?? parentDetails.storyPoints,
                comments: combinedComments,
              };
            } catch (parentError) {
              this.logger.warn(
                { id, parentId, error: (parentError as Error).message },
                "Failed to fetch parent PBI details for task; using task details only."
              );
            }
          }
        }
      }

      return {
        id,
        platform: "azure",
        title,
        description,
        acceptanceCriteria: acceptanceCriteria || undefined,
        storyPoints,
        comments,
      };
    } catch (error) {
      this.logger.error(
        { id, error: (error as Error).message },
        "Failed to fetch Azure DevOps work item details"
      );
      throw error;
    }
  }

  async postPBIComment(id: string, body: string, commentId?: number | string): Promise<void> {
    const workItemId = Number.parseInt(id, 10);
    if (Number.isNaN(workItemId)) {
      throw new Error(`Invalid Azure DevOps work item ID: "${id}"`);
    }

    try {
      const witApi = await this.connection.getWorkItemTrackingApi();
      if (commentId !== undefined) {
        const numericCommentId =
          typeof commentId === "string" ? Number.parseInt(commentId, 10) : commentId;
        const routeValues = {
          project: this.project,
          workItemId,
          commentId: numericCommentId,
        };
        const verData = await (
          witApi as unknown as {
            vsoClient: {
              getVersioningData: (
                apiVersion: string,
                area: string,
                locationId: string,
                routeValues: Record<string, unknown>
              ) => Promise<{ requestUrl: string; apiVersion: string }>;
            };
          }
        ).vsoClient.getVersioningData(
          "7.1",
          "wit",
          "608aac0a-32e1-4493-a863-b9cf4566d257",
          routeValues
        );
        const url = `${verData.requestUrl}?format=Markdown`;
        const options = (
          witApi as unknown as {
            createRequestOptions: (type: string, apiVersion?: string) => unknown;
          }
        ).createRequestOptions("application/json", verData.apiVersion);

        await withRateLimitHandling(() =>
          (
            witApi as unknown as {
              rest: {
                update: (url: string, data: unknown, options: unknown) => Promise<unknown>;
              };
            }
          ).rest.update(url, { text: body }, options)
        );
        this.logger.info({ id, commentId }, "Work item comment updated successfully");
      } else {
        const routeValues = {
          project: this.project,
          workItemId,
        };
        const verData = await (
          witApi as unknown as {
            vsoClient: {
              getVersioningData: (
                apiVersion: string,
                area: string,
                locationId: string,
                routeValues: Record<string, unknown>
              ) => Promise<{ requestUrl: string; apiVersion: string }>;
            };
          }
        ).vsoClient.getVersioningData(
          "7.1",
          "wit",
          "608aac0a-32e1-4493-a863-b9cf4566d257",
          routeValues
        );
        const url = `${verData.requestUrl}?format=Markdown`;
        const options = (
          witApi as unknown as {
            createRequestOptions: (type: string, apiVersion?: string) => unknown;
          }
        ).createRequestOptions("application/json", verData.apiVersion);

        await withRateLimitHandling(() =>
          (
            witApi as unknown as {
              rest: {
                create: (url: string, data: unknown, options: unknown) => Promise<unknown>;
              };
            }
          ).rest.create(url, { text: body }, options)
        );
        this.logger.info({ id }, "Work item comment created successfully");
      }
    } catch (error) {
      this.logger.error(
        { id, commentId, error: (error as Error).message },
        "Failed to post/update Azure DevOps comment"
      );
      throw error;
    }
  }

  async getLinkedPBIIds(prNumber: number): Promise<readonly string[]> {
    try {
      const gitApi = await this.connection.getGitApi();
      const pr = await withRateLimitHandling(() =>
        gitApi.getPullRequestById(prNumber, this.project)
      );

      const repositoryId = pr.repository?.id;
      if (!repositoryId) {
        this.logger.warn({ prNumber }, "Could not find repository ID for PR");
        return [];
      }

      const workItemRefs = (await withRateLimitHandling(() =>
        gitApi.getPullRequestWorkItemRefs(repositoryId, prNumber, this.project)
      )) as Array<{ id?: string | number }> | null | undefined;

      if (!workItemRefs) {
        return [];
      }

      const ids = workItemRefs
        .map((ref) => ref.id)
        .filter((id): id is string | number => id !== undefined && id !== null)
        .map((id) => id.toString());

      return ids;
    } catch (error) {
      this.logger.error(
        { prNumber, error: (error as Error).message },
        "Failed to fetch linked work items for PR"
      );
      throw error;
    }
  }

  async updatePRDetails(
    prNumber: number,
    details: { readonly title?: string; readonly body?: string }
  ): Promise<void> {
    try {
      const gitApi = await this.connection.getGitApi();
      const pr = await withRateLimitHandling(() =>
        gitApi.getPullRequestById(prNumber, this.project)
      );
      const repositoryId = pr.repository?.id;
      if (!repositoryId) {
        throw new Error(`Could not find repository ID for PR #${prNumber}`);
      }

      const updateData: { title?: string; description?: string } = {};
      if (details.title !== undefined) updateData.title = details.title;
      if (details.body !== undefined) updateData.description = details.body;

      await withRateLimitHandling(() =>
        gitApi.updatePullRequest(updateData, repositoryId, prNumber, this.project)
      );
      this.auditLogger.logPRDetailsUpdate(prNumber, "azure", "success");
    } catch (error) {
      this.auditLogger.logPRDetailsUpdate(prNumber, "azure", "failure", (error as Error).message);
      throw error;
    }
  }
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";

  // Temporarily store HTML comments in a placeholder map to keep them from being stripped
  const comments: string[] = [];
  const placeholderHtml = html.replace(/<!--[\s\S]*?-->/g, (match) => {
    comments.push(match);
    return `__HTML_COMMENT_PLACEHOLDER_${comments.length - 1}__`;
  });

  let stripped = placeholderHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<li>/gi, "\n- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .trim();

  // Restore the original HTML comments
  for (let i = 0; i < comments.length; i++) {
    stripped = stripped.replace(`__HTML_COMMENT_PLACEHOLDER_${i}__`, comments[i]);
  }

  return stripped;
}
