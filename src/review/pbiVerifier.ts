import {
  type AIProviderClient,
  formatPBIAlignmentReport,
  type PBIAlignmentResult,
  parsePBIAlignmentResponse,
  type TokenUsage,
} from "../ai/index.js";
import { buildPBIAlignmentPrompt } from "../ai/prompts/alignment.js";
import { createChildLogger } from "../logger.js";
import type { CrossFileReviewResult, PlatformAdapter, PRFile } from "../platforms/types.js";
import type { OutputWriter } from "../ports/index.js";

export class PbiVerifier {
  private readonly platform: PlatformAdapter;
  private readonly provider: AIProviderClient;
  private readonly output: OutputWriter;
  private readonly options: { readonly verbose?: boolean };
  private readonly logger = createChildLogger({ component: "PbiVerifier" });

  constructor(
    platform: PlatformAdapter,
    provider: AIProviderClient,
    output: OutputWriter,
    options?: { readonly verbose?: boolean }
  ) {
    this.platform = platform;
    this.provider = provider;
    this.output = output;
    this.options = options ?? {};
  }

  /**
   * Verifies PR changes against linked backlog items / issues.
   * Appends verification reports to the cross-file review result assessment.
   */
  async verifyPRAlignment(
    prNumber: number,
    files: PRFile[],
    crossFileResult: CrossFileReviewResult,
    onTokenUsage: (usage: TokenUsage | undefined) => void
  ): Promise<CrossFileReviewResult> {
    this.log("\n🔍 Verifying PR alignment with linked work items...");
    let pbiIds: readonly string[] = [];
    try {
      pbiIds = await this.platform.getLinkedPBIIds(prNumber);
    } catch (error) {
      this.logger.error(
        { prNumber, error: (error as Error).message },
        "Failed to get linked PBI/issue IDs"
      );
    }

    if (pbiIds.length === 0) {
      this.log("⚠️ Warning: No linked work items or issues found for this PR.");
      return {
        ...crossFileResult,
        overallAssessment: `⚠️ **Warning:** No linked work items or issues found for this PR.\n\n${crossFileResult.overallAssessment}`,
      };
    }

    const prDiff = files
      .filter((f) => f.patch)
      .map((f) => `--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}`)
      .join("\n");

    const alignmentReports: string[] = [];

    for (const id of pbiIds) {
      try {
        this.log(`📋 Fetching details for linked work item #${id}...`);
        const pbiDetails = await this.platform.getPBIDetails(id);

        this.log(`🤖 Verifying alignment against work item #${id}: ${pbiDetails.title}...`);
        const prompt = buildPBIAlignmentPrompt(
          pbiDetails.id,
          pbiDetails.title,
          pbiDetails.description,
          pbiDetails.acceptanceCriteria || "",
          prDiff
        );

        const aiResponse = await this.provider.executePrompt(prompt);
        onTokenUsage(aiResponse.tokenUsage);

        const alignmentResult: PBIAlignmentResult = parsePBIAlignmentResponse(
          aiResponse.raw,
          pbiDetails.id,
          pbiDetails.title
        );

        const reportMarkdown = formatPBIAlignmentReport(alignmentResult);
        alignmentReports.push(reportMarkdown);
      } catch (error) {
        this.logger.error(
          { id, error: (error as Error).message },
          "Failed to verify PBI alignment"
        );
        this.log(`⚠️ Warning: Failed to fetch or verify work item #${id}.`);
        alignmentReports.push(
          `<details>\n<summary>🔗 Work Item #${id} Alignment Report</summary>\n\n⚠️ **Error:** Failed to fetch or analyze alignment details for this work item.\n\n</details>`
        );
      }
    }

    if (alignmentReports.length > 0) {
      return {
        ...crossFileResult,
        overallAssessment: `${crossFileResult.overallAssessment}\n\n### 🔗 Work Item Alignment Verification\n\n${alignmentReports.join("\n\n")}`,
      };
    }

    return crossFileResult;
  }

  private log(message: string): void {
    if (this.options.verbose !== false) {
      this.output.log(message);
      this.logger.debug(message);
    }
  }
}
