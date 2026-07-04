import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import packageJson from "../../package.json" with { type: "json" };
import type { AIProviderClient, AIProviderType } from "../ai/types.js";
import { createChildLogger } from "../logger.js";
import type { PlatformAdapter, ProjectDetails } from "../platforms/types.js";
import { consoleOutputWriter } from "../ports/outputWriter.js";

const ProjectReviewResponseSchema = z.object({
  title: z.string().default(""),
  completeness_assessment: z.string().default(""),
  dependency_risks: z.string().default(""),
  acceptance_criteria_alignment: z.string().default(""),
  estimation_consistency: z.string().default(""),
  overall_assessment: z.string(),
  suggestions: z.array(z.string()).default([]),
});

export type ProjectReviewResponse = z.infer<typeof ProjectReviewResponseSchema>;

export interface ProjectReviewEngineOptions {
  readonly dryRun?: boolean;
  readonly tempPath?: string;
  readonly aiProvider?: AIProviderType;
  readonly aiModel?: string;
}

export class ProjectReviewEngine {
  private readonly logger = createChildLogger({ component: "ProjectReviewEngine" });

  constructor(
    private readonly adapter: PlatformAdapter,
    private readonly aiClient: AIProviderClient,
    private readonly options: ProjectReviewEngineOptions = {}
  ) {}

  /**
   * Reviews the specified project/feature plan by fetching details, calling the AI provider, and writing the report.
   */
  async reviewProject(id: string): Promise<ProjectReviewResponse> {
    const dryRun = this.options.dryRun ?? false;
    const tempPath = this.options.tempPath ?? "./.mergementor";
    const provider = this.options.aiProvider ?? "copilot-sdk";

    const output = consoleOutputWriter;
    const modeLabel = dryRun ? " (dry-run)" : "";

    output.log(
      `\n🔍 Fetching details for Project/Feature #${id} on ${this.adapter.getPlatformName()}${modeLabel}...\n`
    );

    const projectDetails = await this.adapter.getProjectDetails(id);

    output.log(`📋 Project Root: ${projectDetails.rootTitle} (${projectDetails.rootType})`);
    output.log(
      `📊 Retrieved ${projectDetails.workItems.length} work items & ${projectDetails.dependencies.length} dependencies.`
    );
    output.log(
      `🤖 Requesting AI review using ${provider} against planning quality guidelines...\n`
    );

    const prompt = this.buildProjectReviewPrompt(projectDetails);
    const aiResponse = await this.aiClient.executePrompt(prompt);

    const parsedResult = ProjectReviewResponseSchema.safeParse(aiResponse.parsed);
    if (!parsedResult.success) {
      this.logger.warn(
        { error: parsedResult.error.format() },
        "Project review schema drift detected"
      );
    }

    const reviewData = parsedResult.success
      ? parsedResult.data
      : this.fallbackParse(aiResponse.raw, projectDetails.rootTitle);

    const reportMarkdown = this.generateMarkdownReport(reviewData, id);

    // Save report to disk
    try {
      const reportDir = join(tempPath, "reports");
      mkdirSync(reportDir, { recursive: true });
      const reportFile = join(reportDir, `project-${id}-review-report.md`);
      writeFileSync(reportFile, reportMarkdown, "utf-8");
      output.log(`📄 Detailed report saved to: ${reportFile}\n`);
    } catch (error) {
      this.logger.warn(
        { error: (error as Error).message },
        "Failed to save local project review report"
      );
    }

    // Display formatted results to terminal
    this.displayTerminalReport(reviewData);

    if (dryRun) {
      output.log("📝 Dry-run mode: Comment posting skipped.");
    } else {
      // Find existing comment with the signature to overwrite on the root item
      const signature = "<!-- merge-mentor-project-review -->";
      const rootItem = projectDetails.workItems.find((wi) => wi.id === id);
      const rootComments = rootItem?.comments || [];
      const existingComment = rootComments.find((c) => c.body.includes(signature));

      if (existingComment) {
        output.log(
          `🔄 Updating existing review comment (ID: ${existingComment.id}) on Project Root #${id}...`
        );
        await this.adapter.postPBIComment(id, reportMarkdown, existingComment.id);
      } else {
        output.log(`✉️ Posting new review comment on Project Root #${id}...`);
        await this.adapter.postPBIComment(id, reportMarkdown);
      }
      output.log("✅ Comment posted successfully!\n");
    }

    return reviewData;
  }

  private buildProjectReviewPrompt(project: ProjectDetails): string {
    const workItemsText = project.workItems
      .map(
        (wi) => `
- **ID:** ${wi.id}
- **Type:** ${wi.type}
- **Title:** ${wi.title}
- **State:** ${wi.state} (Normalized: ${wi.normalizedState})
- **Story Points/Effort:** ${wi.storyPoints !== undefined ? wi.storyPoints : "Not estimated"}
- **Description:** ${wi.description || "(No description)"}
- **Acceptance Criteria:** ${wi.acceptanceCriteria || "(No acceptance criteria)"}
- **Comments:** ${wi.comments.length > 0 ? wi.comments.map((c, i) => `[Comment #${i + 1}] ${c.body}`).join(" | ") : "None"}
`
      )
      .join("\n---\n");

    const dependenciesText =
      project.dependencies.length > 0
        ? project.dependencies
            .map(
              (dep) =>
                `- Work Item #${dep.sourceId} has a **${dep.type}** relation to Work Item #${dep.targetId}`
            )
            .join("\n")
        : "No explicit dependencies linked.";

    return `You are an expert Agile Coach and Product Owner reviewing a project/feature plan structure (Epics, Features, and child PBIs/User Stories) against Agile planning and quality guidelines.

# PROJECT/FEATURE ROOT Details
- **Root ID:** ${project.rootId}
- **Root Title:** ${project.rootTitle}
- **Root Type:** ${project.rootType}
- **Root Description:** ${project.rootDescription || "(No description)"}

# HIERARCHY WORK ITEMS
Below is the list of all work items retrieved in this project hierarchy:
${workItemsText}

# WORK ITEM DEPENDENCIES
Below is the list of explicit dependency relationships (predecessor/successor) links between items:
${dependenciesText}

# EVALUATION CRITERIA
Review the project plan details against the following planning dimensions:
1. **Plan Completeness & Gaps:** Do the child stories fully cover the scope of the root Epic/Feature? Identify missing requirements, gaps, or holes in the story breakdown.
2. **Dependency & Sequencing Risks:** Validate the work states against their dependency relationships. Flag if any successor is "In Progress" or "Done" while its predecessor is still "To Do" or "New". Detect circular dependencies.
3. **Acceptance Criteria Alignment:** Verify that child stories have clear, testable acceptance criteria matching the high-level project goals.
4. **Estimation & Scope Consistency:** Check if estimates are missing, if any story is excessively large (epic-sized) and needs breaking down, or if there is scope creep.

# OUTPUT FORMAT
You must respond in strict JSON format within a \`\`\`json markdown block.

\`\`\`json
{
  "title": "${project.rootTitle.replace(/"/g, '\\"')}",
  "completeness_assessment": "Detailed qualitative feedback for Plan Completeness & Gaps",
  "dependency_risks": "Detailed qualitative feedback for Dependency & Sequencing Risks",
  "acceptance_criteria_alignment": "Detailed qualitative feedback for Acceptance Criteria Alignment",
  "estimation_consistency": "Detailed qualitative feedback for Estimation & Scope Consistency",
  "overall_assessment": "Holistic assessment of the project plan health, readiness, and risks.",
  "suggestions": [
    "Actionable suggestion 1",
    "Actionable suggestion 2"
  ]
}
\`\`\`
`;
  }

  private fallbackParse(raw: string, fallbackTitle: string): ProjectReviewResponse {
    try {
      const match = raw.match(/```json\n([\s\S]*?)\n```/);
      const jsonStr = match ? match[1] : raw.substring(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
      const obj = JSON.parse(jsonStr);
      return {
        title: obj.title || fallbackTitle,
        completeness_assessment: obj.completeness_assessment || "",
        dependency_risks: obj.dependency_risks || "",
        acceptance_criteria_alignment: obj.acceptance_criteria_alignment || "",
        estimation_consistency: obj.estimation_consistency || "",
        overall_assessment: obj.overall_assessment || "",
        suggestions: obj.suggestions || [],
      };
    } catch {
      return {
        title: fallbackTitle,
        completeness_assessment: "Failed to parse AI evaluation.",
        dependency_risks: "Failed to parse AI evaluation.",
        acceptance_criteria_alignment: "Failed to parse AI evaluation.",
        estimation_consistency: "Failed to parse AI evaluation.",
        overall_assessment: "AI review failed to generate a parseable response.",
        suggestions: [],
      };
    }
  }

  private generateMarkdownReport(data: ProjectReviewResponse, id: string): string {
    const model = this.options.aiModel?.trim() || "AI model";
    return `## 📋 Project Plan Review: #${id} - ${data.title}

### 🔍 Planning Quality Guidelines

| Dimension | Feedback |
| :--- | :--- |
| **Plan Completeness & Gaps** | ${data.completeness_assessment} |
| **Dependency & Sequencing Risks** | ${data.dependency_risks} |
| **Acceptance Criteria Alignment** | ${data.acceptance_criteria_alignment} |
| **Estimation & Scope Consistency** | ${data.estimation_consistency} |

### 🎯 Overall Assessment
${data.overall_assessment}

${
  data.suggestions.length > 0
    ? `### 💡 Suggestions for Improvement\n${data.suggestions.map((s) => `- ${s}`).join("\n")}`
    : ""
}

---
Merge Mentor v${packageJson.version}, Project review, ${model}
<!-- merge-mentor-project-review -->
`;
  }

  private displayTerminalReport(data: ProjectReviewResponse): void {
    const output = consoleOutputWriter;

    output.log("=".repeat(60));
    output.log(`📊 Project Review Results: ${data.title}`);
    output.log("=".repeat(60));

    output.log(`• Plan Completeness: ${data.completeness_assessment}`);
    output.log(`• Dependency Risks: ${data.dependency_risks}`);
    output.log(`• Acceptance Criteria Alignment: ${data.acceptance_criteria_alignment}`);
    output.log(`• Estimation & Scope: ${data.estimation_consistency}`);
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
