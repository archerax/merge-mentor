import type {
  PlatformAdapter,
  PRDetails,
  PRFile,
  FileReviewResult,
  CrossFileReviewResult,
  CommentAction,
} from '../platforms/types.js';
import { CopilotClient } from '../copilot/client.js';
import {
  buildFileReviewPrompt,
  buildCrossFilePrompt,
  buildFilesSummary,
} from '../copilot/prompts.js';
import { CommentManager } from './commentManager.js';
import { ValidationError } from '../errors/index.js';

/** File extensions to skip during review (binary, generated, etc). */
const SKIP_EXTENSIONS = [
  '.lock',
  '.min.js',
  '.min.css',
  '.map',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
] as const;

/** Result of a complete PR review. */
export interface ReviewResult {
  readonly prDetails: PRDetails;
  readonly filesReviewed: number;
  readonly fileResults: readonly FileReviewResult[];
  readonly crossFileResult: CrossFileReviewResult;
  readonly commentsCreated: number;
  readonly commentsUpdated: number;
  readonly commentsResolved: number;
  readonly commentErrors: readonly string[];
}

/** Options for configuring the review engine. */
export interface ReviewEngineOptions {
  readonly verbose?: boolean;
  readonly dryRun?: boolean;
  readonly copilotModel?: string;
}

/**
 * Orchestrates the PR review process.
 * Coordinates between platform adapters, Copilot client, and comment management.
 */
export class ReviewEngine {
  private readonly platform: PlatformAdapter;
  private readonly copilot: CopilotClient;
  private readonly commentManager: CommentManager;
  private readonly options: ReviewEngineOptions;

  constructor(
    platform: PlatformAdapter,
    botIdentifier: string,
    options?: ReviewEngineOptions
  ) {
    this.platform = platform;
    this.copilot = new CopilotClient({ model: options?.copilotModel });
    this.commentManager = new CommentManager(botIdentifier);
    this.options = options ?? {};
  }

  /**
   * Reviews a pull request and posts/updates comments.
   * 
   * @param prNumber - The PR number to review
   * @returns Complete review results including findings and comment stats
   * @throws {ValidationError} When prNumber is invalid
   * 
   * @example
   * ```typescript
   * const engine = new ReviewEngine(githubAdapter, '[Bot]', { dryRun: true });
   * const result = await engine.reviewPR(123);
   * console.log(`Reviewed ${result.filesReviewed} files`);
   * console.log(`Found ${result.fileResults.reduce((sum, r) => sum + r.findings.length, 0)} issues`);
   * ```
   */
  async reviewPR(prNumber: number): Promise<ReviewResult> {
    if (prNumber <= 0 || !Number.isInteger(prNumber)) {
      throw new ValidationError('prNumber', 'Must be a positive integer');
    }

    this.log(`Starting review of PR #${prNumber}...`);

    const { prDetails, files } = await this.fetchPRData(prNumber);
    const existingComments = await this.fetchExistingComments(prNumber);
    const fileResults = await this.reviewFiles(files);
    const crossFileResult = await this.performCrossFileAnalysis(prDetails, files, fileResults);
    
    const actions = this.commentManager.determineActions(
      existingComments,
      fileResults,
      crossFileResult
    );

    const commentStats = await this.executeCommentActions(prNumber, actions);

    if (commentStats.commentErrors.length > 0) {
      this.log(`\n⚠️  ${commentStats.commentErrors.length} comment(s) failed to post`);
    }

    return {
      prDetails,
      filesReviewed: fileResults.length,
      fileResults,
      crossFileResult,
      ...commentStats,
    };
  }

  private async fetchPRData(prNumber: number): Promise<{ prDetails: PRDetails; files: PRFile[] }> {
    this.log('Fetching PR details...');
    const prDetails = await this.platform.getPRDetails(prNumber);
    const files = await this.platform.getPRFiles(prNumber);
    this.log(`Found ${files.length} changed files`);
    return { prDetails, files };
  }

  private async fetchExistingComments(prNumber: number) {
    this.log('Fetching existing bot comments...');
    const existingComments = await this.platform.getExistingBotComments(prNumber);
    this.log(`Found ${existingComments.length} existing bot comments`);
    return existingComments;
  }

  private async reviewFiles(files: PRFile[]): Promise<FileReviewResult[]> {
    const fileResults: FileReviewResult[] = [];
    
    for (const file of files) {
      if (this.shouldSkipFile(file)) {
        this.log(`Skipping ${file.filename} (${file.status})`);
        continue;
      }

      this.log(`Reviewing ${file.filename}...`);
      const result = await this.reviewFile(file);
      fileResults.push(result);
      this.log(`  Found ${result.findings.length} issues`);
    }
    
    return fileResults;
  }

  private async reviewFile(file: PRFile): Promise<FileReviewResult> {
    if (!file.patch) {
      return { filename: file.filename, findings: [] };
    }

    const prompt = buildFileReviewPrompt(file.filename, file.patch);
    const response = await this.copilot.executePrompt(prompt);
    return this.copilot.parseFileReview(file.filename, response);
  }

  private async performCrossFileAnalysis(
    prDetails: PRDetails,
    files: PRFile[],
    fileResults: readonly FileReviewResult[]
  ): Promise<CrossFileReviewResult> {
    this.log('Performing cross-file analysis...');
    const filesSummary = buildFilesSummary(files);
    const prompt = buildCrossFilePrompt(prDetails, filesSummary, fileResults);
    const response = await this.copilot.executePrompt(prompt);
    const result = this.copilot.parseCrossFileReview(response);
    this.log(`  Overall: ${result.overallAssessment.slice(0, 100)}...`);
    return result;
  }

  private async executeCommentActions(
    prNumber: number,
    actions: CommentAction[]
  ): Promise<{ commentsCreated: number; commentsUpdated: number; commentsResolved: number; commentErrors: string[] }> {
    let commentsCreated = 0;
    let commentsUpdated = 0;
    let commentsResolved = 0;
    const commentErrors: string[] = [];

    if (!this.options.dryRun) {
      for (const action of actions) {
        try {
          await this.executeAction(prNumber, action);
          if (action.type === 'create') commentsCreated++;
          else if (action.type === 'update') commentsUpdated++;
          else if (action.type === 'resolve') commentsResolved++;
        } catch (error) {
          const errorMsg = `Failed to ${action.type} comment: ${(error as Error).message}`;
          this.log(`Warning: ${errorMsg}`);
          commentErrors.push(errorMsg);
        }
      }
    } else {
      this.logDryRunActions(actions);
      commentsCreated = actions.filter(a => a.type === 'create').length;
      commentsUpdated = actions.filter(a => a.type === 'update').length;
      commentsResolved = actions.filter(a => a.type === 'resolve').length;
    }

    return { commentsCreated, commentsUpdated, commentsResolved, commentErrors };
  }

  private async executeAction(prNumber: number, action: CommentAction): Promise<void> {
    switch (action.type) {
      case 'create':
        if (action.path && action.line) {
          await this.platform.postInlineComment(prNumber, action.path, action.line, action.body);
        } else {
          await this.platform.postGeneralComment(prNumber, action.body);
        }
        break;

      case 'update':
        if (action.existingCommentId) {
          await this.platform.updateComment(action.existingCommentId, action.body);
        }
        break;

      case 'resolve':
        if (action.existingCommentId) {
          await this.platform.resolveComment(action.existingCommentId);
        }
        break;
    }
  }

  private shouldSkipFile(file: PRFile): boolean {
    if (file.status === 'deleted') return true;
    if (!file.patch) return true;
    return SKIP_EXTENSIONS.some(ext => file.filename.endsWith(ext));
  }

  private log(message: string): void {
    if (this.options.verbose !== false) {
      console.log(message);
    }
  }

  private logDryRunActions(actions: CommentAction[]): void {
    this.log('\n📝 Dry-run mode - showing planned actions:\n');
    for (const action of actions) {
      this.logDryRunAction(action);
    }
  }

  private logDryRunAction(action: CommentAction): void {
    const separator = '-'.repeat(40);
    
    switch (action.type) {
      case 'create':
        if (action.path && action.line) {
          this.log(`[CREATE] Inline comment at ${action.path}:${action.line}`);
        } else {
          this.log('[CREATE] General/Summary comment');
        }
        this.log(separator);
        this.log(action.body);
        this.log(separator + '\n');
        break;

      case 'update':
        this.log(`[UPDATE] Comment ID: ${action.existingCommentId}`);
        if (action.path) {
          this.log(`  File: ${action.path}:${action.line ?? 'N/A'}`);
        }
        this.log(separator);
        this.log(action.body);
        this.log(separator + '\n');
        break;

      case 'resolve':
        this.log(`[RESOLVE] Comment ID: ${action.existingCommentId}`);
        this.log('');
        break;
    }
  }
}
