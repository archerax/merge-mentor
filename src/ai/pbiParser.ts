import { PBIAlignmentResponseSchema } from "./schemas.js";

export interface PBIAlignmentResult {
  readonly pbiId: string;
  readonly title: string;
  readonly metCriteria: readonly string[];
  readonly partialCriteria: readonly {
    readonly criterion: string;
    readonly explanation: string;
  }[];
  readonly missingCriteria: readonly string[];
  readonly scopeCreep: readonly string[];
  readonly overallAssessment: string;
}

/**
 * Extracts and parses PBI alignment response safely from raw AI output.
 * If JSON parsing or validation fails, handles it gracefully with fallback values.
 *
 * @param rawText - The raw string response from the AI model
 * @param pbiId - Fallback PBI ID
 * @param pbiTitle - Fallback PBI Title
 * @returns Normalised PBI alignment result
 */
export function parsePBIAlignmentResponse(
  rawText: string,
  pbiId: string,
  pbiTitle: string
): PBIAlignmentResult {
  // Extract JSON block (with or without markdown tags)
  let jsonText = rawText.trim();
  const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/i;
  const jsonMatch = jsonBlockRegex.exec(rawText);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  } else {
    const codeBlockRegex = /```\s*([\s\S]*?)\s*```/i;
    const codeMatch = codeBlockRegex.exec(rawText);
    if (codeMatch) {
      jsonText = codeMatch[1].trim();
    }
  }

  try {
    const parsedObj = JSON.parse(jsonText);
    const validated = PBIAlignmentResponseSchema.safeParse(parsedObj);
    if (validated.success) {
      return validated.data;
    }

    // Schema validation failed - normalize fields manually
    return {
      pbiId: parsedObj.pbiId ? String(parsedObj.pbiId) : pbiId,
      title: parsedObj.title ? String(parsedObj.title) : pbiTitle,
      metCriteria: Array.isArray(parsedObj.metCriteria) ? parsedObj.metCriteria.map(String) : [],
      partialCriteria: Array.isArray(parsedObj.partialCriteria)
        ? parsedObj.partialCriteria
            .filter(
              (item: unknown): item is Record<string, unknown> =>
                typeof item === "object" && item !== null
            )
            .map((item: Record<string, unknown>) => ({
              criterion: item.criterion ? String(item.criterion) : "",
              explanation: item.explanation ? String(item.explanation) : "",
            }))
        : [],
      missingCriteria: Array.isArray(parsedObj.missingCriteria)
        ? parsedObj.missingCriteria.map(String)
        : [],
      scopeCreep: Array.isArray(parsedObj.scopeCreep) ? parsedObj.scopeCreep.map(String) : [],
      overallAssessment: parsedObj.overallAssessment
        ? String(parsedObj.overallAssessment)
        : "Validation succeeded with format deviations.",
    };
  } catch (err) {
    // JSON parsing failed entirely - return fallback assessment with error diagnostics
    return {
      pbiId,
      title: pbiTitle,
      metCriteria: [],
      partialCriteria: [],
      missingCriteria: [],
      scopeCreep: [],
      overallAssessment: `Failed to parse AI response as JSON. Error: ${(err as Error).message}\n\nRaw output:\n${rawText}`,
    };
  }
}

/**
 * Formats PBI alignment results as a collapsible markdown summary.
 *
 * @param result - The PBI alignment result
 * @returns Collapsible markdown string
 */
export function formatPBIAlignmentReport(result: PBIAlignmentResult): string {
  const metStr =
    result.metCriteria.length > 0
      ? result.metCriteria.map((c) => `- ✅ ${c}`).join("\n")
      : "- None";

  const partialStr =
    result.partialCriteria.length > 0
      ? result.partialCriteria.map((c) => `- ⚠️ **${c.criterion}**: ${c.explanation}`).join("\n")
      : "- None";

  const missingStr =
    result.missingCriteria.length > 0
      ? result.missingCriteria.map((c) => `- ❌ ${c}`).join("\n")
      : "- None";

  const scopeCreepStr =
    result.scopeCreep.length > 0 ? result.scopeCreep.map((c) => `- ⚠️ ${c}`).join("\n") : "- None";

  return `<details>
<summary>🔗 Work Item #${result.pbiId} Alignment Report: ${result.title}</summary>

#### Overall Assessment
${result.overallAssessment || "No overall assessment provided."}

#### Acceptance Criteria Status
- **Met Criteria:**
${metStr}

- **Partially Met Criteria:**
${partialStr}

- **Missing Criteria:**
${missingStr}

#### Scope Creep
${scopeCreepStr}

</details>`;
}
