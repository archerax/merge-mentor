import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import packageJson from "../../package.json" with { type: "json" };
import type { AIProviderClient, AIProviderType } from "../ai/types.js";
import { APP_NAME_LINK } from "../constants.js";
import { createChildLogger } from "../logger.js";
import type { PBIDetails, PlatformAdapter } from "../platforms/types.js";
import { consoleOutputWriter } from "../ports/outputWriter.js";

const PBIReviewResponseSchema = z.object({
  title: z.string().default(""),
  overall_assessment: z.string(),
  suggestions: z.array(z.string()).default([]),
});

/** The parsed, zod-validated result of a PBI AI review. */
export type PBIReviewResponse = z.infer<typeof PBIReviewResponseSchema>;

/**
 * Configuration options for the PBI review engine.
 */
export interface PBIReviewEngineOptions {
  /** Skip posting the review comment and only display the report (default: false). */
  readonly dryRun?: boolean;
  /** Directory under which the markdown report is saved. */
  readonly tempPath?: string;
  /** AI provider used for the review (default: 'copilot-sdk'). */
  readonly aiProvider?: AIProviderType;
  /** Model identifier used by the AI provider. */
  readonly aiModel?: string;
}

/**
 * Reviews Product Backlog Items / user stories for backlog quality.
 *
 * Fetches the PBI details from the platform, asks the AI provider for a
 * holistic backlog-quality assessment, writes a markdown report to disk, and
 * posts or updates a review comment on the PBI.
 */
export class PBIReviewEngine {
  private readonly logger = createChildLogger({ component: "PBIReviewEngine" });

  constructor(
    private readonly adapter: PlatformAdapter,
    private readonly aiClient: AIProviderClient,
    private readonly options: PBIReviewEngineOptions = {}
  ) {}

  /**
   * Reviews the specified PBI by fetching details, calling the AI provider, and writing the report.
   */
  async reviewPBI(id: string): Promise<PBIReviewResponse> {
    const dryRun = this.options.dryRun ?? false;
    const tempPath = this.options.tempPath ?? "./.mergementor";
    const provider = this.options.aiProvider ?? "copilot-sdk";

    const output = consoleOutputWriter;
    const modeLabel = dryRun ? " (dry-run)" : "";

    output.log(
      `\n🔍 Fetching details for PBI #${id} on ${this.adapter.getPlatformName()}${modeLabel}...\n`
    );

    const pbiDetails = await this.adapter.getPBIDetails(id);

    output.log(`📋 PBI Title: ${pbiDetails.title}`);
    output.log(`🤖 Requesting AI review using ${provider} against quality guidelines...\n`);

    const prompt = this.buildPBIReviewPrompt(pbiDetails);
    const aiResponse = await this.aiClient.executePrompt(prompt);

    const parsedResult = PBIReviewResponseSchema.safeParse(aiResponse.parsed);
    if (!parsedResult.success) {
      this.logger.warn({ error: parsedResult.error.format() }, "PBI review schema drift detected");
    }

    const reviewData = parsedResult.success
      ? parsedResult.data
      : this.fallbackParse(aiResponse.raw, pbiDetails.title);

    const reportMarkdown = this.generateMarkdownReport(reviewData, id);

    // Save report to disk
    try {
      const reportDir = join(tempPath, "reports");
      mkdirSync(reportDir, { recursive: true });
      const reportFile = join(reportDir, `pbi-${id}-review-report.md`);
      writeFileSync(reportFile, reportMarkdown, "utf-8");
      output.log(`📄 Detailed report saved to: ${reportFile}\n`);
    } catch (error) {
      this.logger.warn({ error: (error as Error).message }, "Failed to save local markdown report");
    }

    // Display formatted results to terminal
    this.displayTerminalReport(reviewData);

    if (dryRun) {
      output.log("📝 Dry-run mode: Comment posting skipped.");
    } else {
      // Find existing comment with the signature to overwrite
      const signature = "<!-- merge-mentor-pbi-review -->";
      const existingComment = pbiDetails.comments.find((c) => c.body.includes(signature));

      if (existingComment) {
        output.log(
          `🔄 Updating existing review comment (ID: ${existingComment.id}) on PBI #${id}...`
        );
        await this.adapter.postPBIComment(id, reportMarkdown, existingComment.id);
      } else {
        output.log(`✉️ Posting new review comment on PBI #${id}...`);
        await this.adapter.postPBIComment(id, reportMarkdown);
      }
      output.log("✅ Comment posted successfully!\n");
    }

    return reviewData;
  }

  private buildPBIReviewPrompt(pbi: PBIDetails): string {
    const commentsList =
      pbi.comments.length > 0
        ? pbi.comments.map((c, i) => `Comment #${i + 1}: ${c.body}`).join("\n\n")
        : "No comments yet.";

    return `You are an expert Agile Coach and Product Owner reviewing a Product Backlog Item (PBI) / User Story / Issue.

# PBI DETAILS
- **Title:** ${pbi.title}
- **Description:** ${pbi.description || "(No description provided)"}
- **Acceptance Criteria:** ${pbi.acceptanceCriteria || "(No acceptance criteria provided)"}
- **Story Points/Estimation:** ${pbi.storyPoints !== undefined ? pbi.storyPoints : "Not estimated yet"}
- **MoSCoW Tag:** ${pbi.moscowTag || "None"}
- **Backlog Priority:** ${pbi.backlogPriority !== undefined ? pbi.backlogPriority : "Not ordered"}

# PBI COMMENTS/DISCUSSION
${commentsList}

# REVIEW GUIDANCE
Assess the item holistically for backlog quality and development readiness, drawing on established agile principles (such as INVEST) as an internal lens. Weigh whether the item is independent, leaves room for negotiation, delivers clear value, is estimable, is appropriately sized, and is testable — but do not structure your response around these as a checklist, do not name or label them, and do not assign status ratings like Pass, Fail, or Needs Improvement.

Write a single cohesive, constructive narrative assessment in plain prose, then list actionable suggestions. Focus on clarity, user value, scope, and how the item can be improved.

# OUTPUT FORMAT
You must respond in strict JSON format within a \`\`\`json markdown block.

\`\`\`json
{
  "title": "${pbi.title.replace(/"/g, '\\"')}",
  "overall_assessment": "A holistic narrative assessment of the item's quality and development readiness.",
  "suggestions": [
    "Actionable suggestion 1",
    "Actionable suggestion 2"
  ]
}
\`\`\`
`;
  }

  private fallbackParse(raw: string, fallbackTitle: string): PBIReviewResponse {
    // Attempt basic regex extraction if zod schema validation failed completely
    try {
      const match = raw.match(/```json\n([\s\S]*?)\n```/);
      const jsonStr = match ? match[1] : raw.substring(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
      const obj = JSON.parse(jsonStr);
      return {
        title: obj.title || fallbackTitle,
        overall_assessment: this.extractAssessment(obj),
        suggestions: Array.isArray(obj.suggestions) ? obj.suggestions : [],
      };
    } catch {
      return {
        title: fallbackTitle,
        overall_assessment: "AI review failed to generate a parseable response.",
        suggestions: [],
      };
    }
  }

  /**
   * Extracts the narrative assessment from a parsed AI response, tolerating
   * older responses that split feedback across named criteria.
   */
  private extractAssessment(obj: Record<string, unknown>): string {
    if (typeof obj.overall_assessment === "string") {
      return obj.overall_assessment;
    }

    const legacy = obj.invest_evaluation;
    if (legacy && typeof legacy === "object") {
      return Object.values(legacy as Record<string, unknown>)
        .map((value) =>
          typeof value === "string"
            ? value
            : ((value as { feedback?: string } | null)?.feedback ?? "")
        )
        .filter((value) => value.length > 0)
        .join(" ");
    }

    return "";
  }

  private generateMarkdownReport(data: PBIReviewResponse, id: string): string {
    const model = this.options.aiModel?.trim() || "AI model";
    return `## 📋 PBI Review: #${id} - ${data.title}

### 🎯 Assessment
${data.overall_assessment}

${
  data.suggestions.length > 0
    ? `### 💡 Suggestions for Improvement\n${data.suggestions.map((s) => `- ${s}`).join("\n")}`
    : ""
}

---
${APP_NAME_LINK} v${packageJson.version}, PBI review, ${model}
<!-- merge-mentor-pbi-review -->
`;
  }

  private displayTerminalReport(data: PBIReviewResponse): void {
    const output = consoleOutputWriter;

    output.log("=".repeat(60));
    output.log(`📊 PBI Review Results: ${data.title}`);
    output.log("=".repeat(60));

    output.log(`🎯 Assessment:\n${data.overall_assessment}\n`);

    if (data.suggestions.length > 0) {
      output.log("💡 Suggestions for Improvement:");
      for (const s of data.suggestions) {
        output.log(`  - ${s}`);
      }
      output.log("");
    }
    output.log(`${"=".repeat(60)}\n`);
  }
}
