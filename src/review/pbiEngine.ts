import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import packageJson from "../../package.json" with { type: "json" };
import type { AIProviderClient, AIProviderType } from "../ai/types.js";
import { createChildLogger } from "../logger.js";
import type { PBIDetails, PlatformAdapter } from "../platforms/types.js";
import { consoleOutputWriter } from "../ports/outputWriter.js";

const PBIReviewResponseSchema = z.object({
  title: z.string().default(""),
  invest_evaluation: z.object({
    independent: z.string().default(""),
    negotiable: z.string().default(""),
    valuable: z.string().default(""),
    estimable: z.string().default(""),
    testable: z.string().default(""),
  }),
  overall_assessment: z.string().default(""),
  suggestions: z.array(z.string()).default([]),
});

export type PBIReviewResponse = z.infer<typeof PBIReviewResponseSchema>;

export interface PBIReviewEngineOptions {
  readonly dryRun?: boolean;
  readonly tempPath?: string;
  readonly aiProvider?: AIProviderType;
  readonly aiModel?: string;
}

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

    return `You are an expert Agile Coach and Product Owner reviewing a Product Backlog Item (PBI) / User Story / Issue against backlog quality guidelines.

# PBI DETAILS
- **Title:** ${pbi.title}
- **Description:** ${pbi.description || "(No description provided)"}
- **Acceptance Criteria:** ${pbi.acceptanceCriteria || "(No acceptance criteria provided)"}
- **Story Points/Estimation:** ${pbi.storyPoints !== undefined ? pbi.storyPoints : "Not estimated yet"}
- **MoSCoW Tag:** ${pbi.moscowTag || "None"}
- **Backlog Priority:** ${pbi.backlogPriority !== undefined ? pbi.backlogPriority : "Not ordered"}

# PBI COMMENTS/DISCUSSION
${commentsList}

# EVALUATION CRITERIA (PBI Quality Guidelines)
Review the PBI details against the following dimensions, treating them as guidelines rather than a strict tick list:
1. **Independent:** Can this story be completed and delivered independently of other stories?
2. **Negotiable:** Is there room for discussion? Avoid overly prescriptive "contracts".
3. **Valuable:** Does this story deliver clear, recognizable value to the user or customer?
4. **Estimable:** Is the scope clear enough to be estimated by the team? (Consider the current description complexity).
5. **Testable:** Are there clear Acceptance Criteria or paths to verify the story?

For each dimension, provide constructive, qualitative feedback explaining how well the PBI aligns with the guideline and any suggestions/nuance. Do not assign status ratings like Pass, Fail, or Needs Improvement.

# OUTPUT FORMAT
You must respond in strict JSON format within a \`\`\`json markdown block.

\`\`\`json
{
  "title": "${pbi.title.replace(/"/g, '\\"')}",
  "invest_evaluation": {
    "independent": "Concise qualitative feedback for Independent guideline",
    "negotiable": "Concise qualitative feedback for Negotiable guideline",
    "valuable": "Concise qualitative feedback for Valuable guideline",
    "estimable": "Concise qualitative feedback for Estimable guideline",
    "testable": "Concise qualitative feedback for Testable guideline"
  },
  "overall_assessment": "Holistic assessment of the story quality and development readiness.",
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
        invest_evaluation: {
          independent:
            typeof obj.invest_evaluation?.independent === "string"
              ? obj.invest_evaluation.independent
              : obj.invest_evaluation?.independent?.feedback || "",
          negotiable:
            typeof obj.invest_evaluation?.negotiable === "string"
              ? obj.invest_evaluation.negotiable
              : obj.invest_evaluation?.negotiable?.feedback || "",
          valuable:
            typeof obj.invest_evaluation?.valuable === "string"
              ? obj.invest_evaluation.valuable
              : obj.invest_evaluation?.valuable?.feedback || "",
          estimable:
            typeof obj.invest_evaluation?.estimable === "string"
              ? obj.invest_evaluation.estimable
              : obj.invest_evaluation?.estimable?.feedback || "",
          testable:
            typeof obj.invest_evaluation?.testable === "string"
              ? obj.invest_evaluation.testable
              : obj.invest_evaluation?.testable?.feedback || "",
        },
        overall_assessment: obj.overall_assessment || "",
        suggestions: obj.suggestions || [],
      };
    } catch {
      return {
        title: fallbackTitle,
        invest_evaluation: {
          independent: "Failed to parse AI evaluation.",
          negotiable: "Failed to parse AI evaluation.",
          valuable: "Failed to parse AI evaluation.",
          estimable: "Failed to parse AI evaluation.",
          testable: "Failed to parse AI evaluation.",
        },
        overall_assessment: "AI review failed to generate a parseable response.",
        suggestions: [],
      };
    }
  }

  private generateMarkdownReport(data: PBIReviewResponse, id: string): string {
    const evalObj = data.invest_evaluation;
    const model = this.options.aiModel?.trim() || "AI model";
    return `## 📋 PBI Review: #${id} - ${data.title}

### 📊 PBI Quality Guidelines

#### 🧩 Independent
${evalObj.independent}

#### 💬 Negotiable
${evalObj.negotiable}

#### 💎 Valuable
${evalObj.valuable}

#### 📐 Estimable
${evalObj.estimable}

#### 🧪 Testable
${evalObj.testable}

### 🎯 Overall Assessment
${data.overall_assessment}

${
  data.suggestions.length > 0
    ? `### 💡 Suggestions for Improvement\n${data.suggestions.map((s) => `- ${s}`).join("\n")}`
    : ""
}

---
Merge Mentor v${packageJson.version}, PBI review, ${model}
<!-- merge-mentor-pbi-review -->
`;
  }

  private displayTerminalReport(data: PBIReviewResponse): void {
    const output = consoleOutputWriter;
    const evalObj = data.invest_evaluation;

    output.log("=".repeat(60));
    output.log(`📊 PBI Review Results: ${data.title}`);
    output.log("=".repeat(60));

    const printDimension = (name: string, feedback: string) => {
      output.log(`• ${name}: ${feedback}`);
    };

    printDimension("Independent", evalObj.independent);
    printDimension("Negotiable", evalObj.negotiable);
    printDimension("Valuable", evalObj.valuable);
    printDimension("Estimable", evalObj.estimable);
    printDimension("Testable", evalObj.testable);
    output.log("");

    output.log(`🎯 Overall Assessment:\n${data.overall_assessment}\n`);

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
