import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { AIProviderClient, AIProviderType } from "../ai/types.js";
import { createChildLogger } from "../logger.js";
import type { PBIDetails, PlatformAdapter } from "../platforms/types.js";
import { consoleOutputWriter } from "../ports/outputWriter.js";

const InvestStatusSchema = z.enum(["pass", "fail", "needs-improvement"]).catch("needs-improvement");

const InvestDimensionSchema = z.object({
  status: InvestStatusSchema,
  feedback: z.string().default(""),
});

const PBIReviewResponseSchema = z.object({
  title: z.string().default(""),
  invest_evaluation: z.object({
    independent: InvestDimensionSchema,
    negotiable: InvestDimensionSchema,
    valuable: InvestDimensionSchema,
    estimable: InvestDimensionSchema,
    testable: InvestDimensionSchema,
  }),
  overall_assessment: z.string().default(""),
  suggestions: z.array(z.string()).default([]),
});

export type PBIReviewResponse = z.infer<typeof PBIReviewResponseSchema>;

export interface PBIReviewEngineOptions {
  readonly dryRun?: boolean;
  readonly tempPath?: string;
  readonly aiProvider?: AIProviderType;
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
    output.log(`🤖 Requesting AI review using ${provider} against INVEST model...\n`);

    const prompt = this.buildINVESTPrompt(pbiDetails);
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
      const reportFile = join(reportDir, `pbi-${id}-invest-report.md`);
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

  private buildINVESTPrompt(pbi: PBIDetails): string {
    const commentsList =
      pbi.comments.length > 0
        ? pbi.comments.map((c, i) => `Comment #${i + 1}: ${c.body}`).join("\n\n")
        : "No comments yet.";

    return `You are an expert Agile Coach and Product Owner reviewing a Product Backlog Item (PBI) / User Story / Issue against the INVEST model.

# PBI DETAILS
- **Title:** ${pbi.title}
- **Description:** ${pbi.description || "(No description provided)"}
- **Acceptance Criteria:** ${pbi.acceptanceCriteria || "(No acceptance criteria provided)"}
- **Story Points/Estimation:** ${pbi.storyPoints !== undefined ? pbi.storyPoints : "Not estimated yet"}

# PBI COMMENTS/DISCUSSION
${commentsList}

# EVALUATION CRITERIA (INVEST)
Review the PBI details against the following dimensions:
1. **Independent:** Can this story be completed and delivered independently of other stories?
2. **Negotiable:** Is there room for discussion? Avoid overly prescriptive "contracts".
3. **Valuable:** Does this story deliver clear, recognizable value to the user or customer?
4. **Estimable:** Is the scope clear enough to be estimated by the team? (Consider the current description complexity).
5. **Testable:** Are there clear Acceptance Criteria or paths to verify the story?

# SEVERITY / STATUS LEVELS
For each dimension, output one of:
- \`pass\`: The PBI meets this criterion well.
- \`needs-improvement\`: There are minor gaps or improvements recommended.
- \`fail\`: The criterion is not met, presenting a significant blocker for refinement/development.

# OUTPUT FORMAT
You must respond in strict JSON format within a \`\`\`json markdown block.

\`\`\`json
{
  "title": "${pbi.title.replace(/"/g, '\\"')}",
  "invest_evaluation": {
    "independent": {
      "status": "pass | fail | needs-improvement",
      "feedback": "Concise feedback for Independent dimension"
    },
    "negotiable": {
      "status": "pass | fail | needs-improvement",
      "feedback": "Concise feedback for Negotiable dimension"
    },
    "valuable": {
      "status": "pass | fail | needs-improvement",
      "feedback": "Concise feedback for Valuable dimension"
    },
    "estimable": {
      "status": "pass | fail | needs-improvement",
      "feedback": "Concise feedback for Estimable dimension"
    },
    "testable": {
      "status": "pass | fail | needs-improvement",
      "feedback": "Concise feedback for Testable dimension"
    }
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
          independent: {
            status: obj.invest_evaluation?.independent?.status || "needs-improvement",
            feedback: obj.invest_evaluation?.independent?.feedback || "",
          },
          negotiable: {
            status: obj.invest_evaluation?.negotiable?.status || "needs-improvement",
            feedback: obj.invest_evaluation?.negotiable?.feedback || "",
          },
          valuable: {
            status: obj.invest_evaluation?.valuable?.status || "needs-improvement",
            feedback: obj.invest_evaluation?.valuable?.feedback || "",
          },
          estimable: {
            status: obj.invest_evaluation?.estimable?.status || "needs-improvement",
            feedback: obj.invest_evaluation?.estimable?.feedback || "",
          },
          testable: {
            status: obj.invest_evaluation?.testable?.status || "needs-improvement",
            feedback: obj.invest_evaluation?.testable?.feedback || "",
          },
        },
        overall_assessment: obj.overall_assessment || "",
        suggestions: obj.suggestions || [],
      };
    } catch {
      return {
        title: fallbackTitle,
        invest_evaluation: {
          independent: { status: "needs-improvement", feedback: "Failed to parse AI evaluation." },
          negotiable: { status: "needs-improvement", feedback: "Failed to parse AI evaluation." },
          valuable: { status: "needs-improvement", feedback: "Failed to parse AI evaluation." },
          estimable: { status: "needs-improvement", feedback: "Failed to parse AI evaluation." },
          testable: { status: "needs-improvement", feedback: "Failed to parse AI evaluation." },
        },
        overall_assessment: "AI review failed to generate a parseable response.",
        suggestions: [],
      };
    }
  }

  private getStatusEmoji(status: string): string {
    switch (status) {
      case "pass":
        return "🟢 **PASS**";
      case "needs-improvement":
        return "🟡 **NEEDS IMPROVEMENT**";
      case "fail":
        return "🔴 **FAIL**";
      default:
        return "⚪ **UNKNOWN**";
    }
  }

  private generateMarkdownReport(data: PBIReviewResponse, id: string): string {
    const evalObj = data.invest_evaluation;
    return `## 📋 PBI INVEST Review: #${id} - ${data.title}

### 📊 INVEST Model Evaluation

| Dimension | Status | Feedback |
| :--- | :--- | :--- |
| **Independent** | ${this.getStatusEmoji(evalObj.independent.status)} | ${evalObj.independent.feedback} |
| **Negotiable** | ${this.getStatusEmoji(evalObj.negotiable.status)} | ${evalObj.negotiable.feedback} |
| **Valuable** | ${this.getStatusEmoji(evalObj.valuable.status)} | ${evalObj.valuable.feedback} |
| **Estimable** | ${this.getStatusEmoji(evalObj.estimable.status)} | ${evalObj.estimable.feedback} |
| **Testable** | ${this.getStatusEmoji(evalObj.testable.status)} | ${evalObj.testable.feedback} |

### 🎯 Overall Assessment
${data.overall_assessment}

${
  data.suggestions.length > 0
    ? `### 💡 Suggestions for Improvement\n${data.suggestions.map((s) => `- ${s}`).join("\n")}`
    : ""
}

---
*Reviewed by Merge Mentor* <!-- merge-mentor-pbi-review -->
`;
  }

  private displayTerminalReport(data: PBIReviewResponse): void {
    const output = consoleOutputWriter;
    const evalObj = data.invest_evaluation;

    output.log("=".repeat(60));
    output.log(`📊 INVEST Review Results: ${data.title}`);
    output.log("=".repeat(60));

    const printDimension = (name: string, status: string, feedback: string) => {
      output.log(`• ${name}: ${this.getStatusEmoji(status)}`);
      if (feedback) {
        output.log(`  Feedback: ${feedback}`);
      }
    };

    printDimension("Independent", evalObj.independent.status, evalObj.independent.feedback);
    printDimension("Negotiable", evalObj.negotiable.status, evalObj.negotiable.feedback);
    printDimension("Valuable", evalObj.valuable.status, evalObj.valuable.feedback);
    printDimension("Estimable", evalObj.estimable.status, evalObj.estimable.feedback);
    printDimension("Testable", evalObj.testable.status, evalObj.testable.feedback);
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
