import type {
  PlatformAdapter,
  PRDetails,
  PRFile,
  FileReviewResult,
  CrossFileReviewResult,
} from '../platforms/types.js';
import { CopilotClient } from '../copilot/client.js';
import {
  buildFileReviewPrompt,
  buildCrossFilePrompt,
  buildFilesSummary,
} from '../copilot/prompts.js';
import { CommentManager } from './commentManager.js';

export interface ReviewResult {
  prDetails: PRDetails;
  filesReviewed: number;
  fileResults: FileReviewResult[];
  crossFileResult: CrossFileReviewResult;
  commentsCreated: number;
  commentsUpdated: number;
  commentsResolved: number;
}

export interface ReviewEngineOptions {
  verbose?: boolean;
  dryRun?: boolean;
}

export class ReviewEngine {
  private platform: PlatformAdapter;
  private copilot: CopilotClient;
  private commentManager: CommentManager;
  private options: ReviewEngineOptions;

  constructor(
    platform: PlatformAdapter,
    botIdentifier: string,
    options?: ReviewEngineOptions
  ) {
    this.platform = platform;
    this.copilot = new CopilotClient();
    this.commentManager = new CommentManager(botIdentifier);
    this.options = options ?? {};
  }

  async reviewPR(prNumber: number): Promise<ReviewResult> {
    this.log(`Starting review of PR #${prNumber}...`);

    // Step 1: Get PR details and files
    this.log('Fetching PR details...');
    const prDetails = await this.platform.getPRDetails(prNumber);
    const files = await this.platform.getPRFiles(prNumber);
    this.log(`Found ${files.length} changed files`);

    // Step 2: Get existing bot comments
    this.log('Fetching existing bot comments...');
    const existingComments = await this.platform.getExistingBotComments(prNumber);
    this.log(`Found ${existingComments.length} existing bot comments`);

    // Step 3: Review each file
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

    // Step 4: Cross-file analysis
    this.log('Performing cross-file analysis...');
    const crossFileResult = await this.performCrossFileAnalysis(
      prDetails,
      files,
      fileResults
    );
    this.log(`  Overall: ${crossFileResult.overallAssessment.slice(0, 100)}...`);

    // Step 5: Determine comment actions
    const actions = this.commentManager.determineActions(
      existingComments,
      fileResults,
      crossFileResult
    );

    // Step 6: Execute comment actions
    let commentsCreated = 0;
    let commentsUpdated = 0;
    let commentsResolved = 0;

    if (!this.options.dryRun) {
      for (const action of actions) {
        try {
          switch (action.type) {
            case 'create':
              if (action.path && action.line) {
                await this.platform.postInlineComment(
                  prNumber,
                  action.path,
                  action.line,
                  action.body
                );
              } else {
                await this.platform.postGeneralComment(prNumber, action.body);
              }
              commentsCreated++;
              break;

            case 'update':
              if (action.existingCommentId) {
                await this.platform.updateComment(
                  action.existingCommentId,
                  action.body
                );
                commentsUpdated++;
              }
              break;

            case 'resolve':
              if (action.existingCommentId) {
                await this.platform.resolveComment(action.existingCommentId);
                commentsResolved++;
              }
              break;
          }
        } catch (error) {
          this.log(`Warning: Failed to ${action.type} comment: ${(error as Error).message}`);
        }
      }
    } else {
      this.log('Dry run mode - no comments posted');
      commentsCreated = actions.filter(a => a.type === 'create').length;
      commentsUpdated = actions.filter(a => a.type === 'update').length;
      commentsResolved = actions.filter(a => a.type === 'resolve').length;
    }

    return {
      prDetails,
      filesReviewed: fileResults.length,
      fileResults,
      crossFileResult,
      commentsCreated,
      commentsUpdated,
      commentsResolved,
    };
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
    fileResults: FileReviewResult[]
  ): Promise<CrossFileReviewResult> {
    const filesSummary = buildFilesSummary(files);
    const prompt = buildCrossFilePrompt(prDetails, filesSummary, fileResults);
    const response = await this.copilot.executePrompt(prompt);
    return this.copilot.parseCrossFileReview(response);
  }

  private shouldSkipFile(file: PRFile): boolean {
    // Skip deleted files and binary files
    if (file.status === 'deleted') return true;
    if (!file.patch) return true;

    // Skip certain file types
    const skipExtensions = [
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
    ];

    return skipExtensions.some(ext => file.filename.endsWith(ext));
  }

  private log(message: string): void {
    if (this.options.verbose !== false) {
      console.log(message);
    }
  }
}
