import { getJsonSchema } from "./jsonSchemas.js";
import type { PromptType } from "./promptType.js";

/**
 * Required-field requirements for a single review finding. Fields that are
 * genuinely optional (e.g. `suggestion`, `replacement`) are intentionally
 * omitted so the permissive schema can keep defaulting them without triggering
 * a repair turn.
 */
interface FindingRequirements {
  /** `message` must be a non-empty string. */
  readonly message?: boolean;
  /** `issue` must be a non-empty string (used by project/plan findings). */
  readonly issue?: boolean;
}

/**
 * Findings requirements per prompt type. Prompt types that are not listed
 * (e.g. `build-analysis`, `plan`, `unknown`) never trigger a repair turn.
 */
const FINDING_REQUIREMENTS: Partial<Record<PromptType, FindingRequirements>> = {
  "file-review": { message: true },
  "cross-file-review": { message: true },
  "fast-review": { message: true },
  "multi-agent-synthesizer": { message: true },
  "multi-agent-subagent": { message: true },
  project: { issue: true },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function checkFinding(
  finding: unknown,
  path: string,
  requirements: FindingRequirements,
  reasons: string[]
): void {
  if (!isRecord(finding)) {
    reasons.push(`${path} must be a JSON object`);
    return;
  }
  if (requirements.message && !hasText(finding.message)) {
    reasons.push(`${path}.message is required and must be a non-empty string`);
  }
  if (requirements.issue && !hasText(finding.issue)) {
    reasons.push(`${path}.issue is required and must be a non-empty string`);
  }
}

function checkFindings(
  findings: unknown,
  basePath: string,
  requirements: FindingRequirements,
  reasons: string[]
): void {
  if (!Array.isArray(findings)) {
    return;
  }
  findings.forEach((finding, index) => {
    checkFinding(finding, `${basePath}[${index}]`, requirements, reasons);
  });
}

/**
 * Determines whether a parsed AI response violates the critical fields of its
 * schema. Only the fields that materially affect the output (each finding's
 * `message`, and `issue` for plan findings) are checked; optional fields such as
 * `line` (absent for whole-file comments) are deliberately ignored so the
 * permissive JSON schema can keep defaulting them.
 *
 * @param parsed - The parsed JSON returned by the AI provider.
 * @param promptType - The detected prompt type, used to pick the right schema.
 * @returns A list of human-readable reasons; empty when no repair is needed.
 */
export function collectSchemaRepairReasons(parsed: unknown, promptType: PromptType): string[] {
  const reasons: string[] = [];
  if (!isRecord(parsed)) {
    return reasons;
  }

  if (promptType === "batched-file-review") {
    const fileResults = parsed.file_results;
    if (isRecord(fileResults)) {
      for (const [filename, fileData] of Object.entries(fileResults)) {
        if (!isRecord(fileData)) continue;
        checkFindings(
          fileData.findings,
          `file_results[${JSON.stringify(filename)}].findings`,
          { message: true },
          reasons
        );
      }
    }
    return reasons;
  }

  const requirements = FINDING_REQUIREMENTS[promptType];
  if (requirements) {
    checkFindings(parsed.findings, "findings", requirements, reasons);
  }
  return reasons;
}

/**
 * Builds a follow-up message that asks the model to re-emit its previous answer
 * with the required fields populated, reusing the existing agent session (and
 * therefore its context) rather than starting a fresh review.
 *
 * @param promptType - The detected prompt type, used to embed the JSON schema.
 * @param reasons - The missing/invalid fields reported by {@link collectSchemaRepairReasons}.
 * @returns The repair prompt to send into the same session.
 */
export function buildSchemaRepairPrompt(
  promptType: PromptType,
  reasons: readonly string[]
): string {
  const schema = getJsonSchema(promptType);
  const schemaBlock = schema
    ? JSON.stringify(schema, null, 2)
    : "Follow the JSON schema described in the original instructions exactly.";
  const issueList = reasons.map((reason) => `- ${reason}`).join("\n");

  return [
    "Your previous response did not satisfy the required JSON schema. The following required fields were missing, empty, or invalid:",
    issueList,
    "",
    "Re-emit the COMPLETE response as a single JSON object that satisfies the schema below. Keep every finding you already reported and use exactly these field names. Output only the JSON object, with no markdown fences, commentary, or text outside it.",
    "",
    schemaBlock,
  ].join("\n");
}
