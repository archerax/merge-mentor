import type { FileReviewResult, PRDetails, PRFile } from "../../platforms/types.js";
import type { DiffManifest } from "../../review/diffStorage.js";

/**
 * Builds a prompt for cross-file analysis.
 *
 * @param prDetails - Pull request metadata
 * @param filesSummary - Summary of changed files
 * @param fileReviewResults - Results from individual file reviews
 * @param existingCommentsContext - Optional context of existing comments to avoid duplication
 * @returns Formatted prompt for Copilot CLI
 */
export function buildCrossFilePrompt(
  prDetails: PRDetails,
  filesSummary: string,
  fileReviewResults: readonly FileReviewResult[],
  existingCommentsContext?: string
): string {
  const findingsSummary = fileReviewResults
    .filter((r) => r.findings.length > 0)
    .map((r) => `${r.filename}: ${r.findings.length} finding(s)`)
    .join("\n");

  const commentsSection = existingCommentsContext
    ? `\nEXISTING PR COMMENTS:\n${existingCommentsContext}\n\nIMPORTANT: Be aware of issues already flagged in existing comments. Focus on system-level concerns not already covered.\n`
    : "";

  return `You are an expert code reviewer performing a holistic analysis of a pull request. Be thorough and strict.

PR TITLE: ${prDetails.title}
PR DESCRIPTION: ${prDetails.description || "No description provided"}

CHANGED FILES SUMMARY:
${filesSummary}

INDIVIDUAL FILE REVIEW FINDINGS:
${findingsSummary || "No individual issues found"}
${commentsSection}
SYSTEMATIC ANALYSIS CHECKLIST:
- Error handling: Are errors propagated consistently? Missing try-catch?
- State management: Any race conditions or inconsistent state updates?
- Data flow: Complete path from input to output? Missing validations?
- Dependencies: Circular dependencies? Tight coupling issues?
- Testing: Are critical paths testable? Integration points covered?
- Security: Authentication/authorization consistent? Input validation complete?

FOCUS ON HIGH-LEVEL SUBSTANTIVE ISSUES:
- Architectural problems: poor separation of concerns, circular dependencies, violated design principles
- System-level concerns: missing error handling patterns, incomplete transaction management
- Cross-cutting issues: inconsistent approach across files, missing integration points
- Testing gaps: critical paths without coverage, integration test needs

DO NOT flag:
- Issues already caught in individual file reviews (avoid duplication)
- General suggestions without specific actionable improvements
- Syntax or compilation issues (assume all code compiles and is valid syntax)
- Language features you're unfamiliar with

GUIDELINES:
- Provide recommendations that improve architectural integrity, maintainability, or prevent issues
- Evaluate choices critically; do not assume the current approach is optimal
- Focus on potential failures, confusion, and architectural alignment
- ONLY analyze the actual files listed in CHANGED FILES SUMMARY - ignore any files mentioned in PR title/description that aren't in the changed files list

GOAL: Perform ONE thorough architectural review that catches all system-level concerns.

Respond with your analysis and findings.

FORMAT:
1. ANALYSIS: Think through the architecture and integration risks step-by-step.
2. JSON: Output the findings in a STRICT JSON format wrapped in a markdown code block.

Example Response:
The architectural changes in this PR introduce...
One concern is the circular dependency between...
\`\`\`json
{
  "overall_assessment": "Summary of the PR quality",
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "architecture|design|testing|documentation",
      "message": "Description of the issue",
      "affected_files": ["file1.ts", "file2.ts"]
    }
  ],
  "recommendations": ["Recommendation 1", "Recommendation 2"]
}
\`\`\`
`;
}

/**
 * Builds a summary of changed files for prompt context.
 *
 * @param files - Array of PR files
 * @returns Formatted file summary string
 */
export function buildFilesSummary(files: readonly PRFile[]): string {
  return files
    .map((f) => `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`)
    .join("\n");
}

/**
 * Builds a prompt for batched file review where all files are reviewed in a single AI call.
 * The diffs are stored on disk and referenced via the manifest.
 *
 * @param manifest - Manifest describing stored diff files
 * @param existingCommentsContext - Optional context of existing comments to avoid duplication
 * @returns Formatted prompt for batched review
 */
export function buildBatchedFileReviewPrompt(
  manifest: DiffManifest,
  existingCommentsContext?: string
): string {
  const filesListing = manifest.files
    .map((f) => `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) → @${f.diffPath}`)
    .join("\n");

  const commentsSection = existingCommentsContext
    ? `\n${existingCommentsContext}\n\nIMPORTANT: Review the existing comments above. Do NOT flag the same issues again, even if worded differently. Focus on finding NEW issues not already covered by existing comments.\n`
    : "";

  return `You are an expert code reviewer analyzing changes. Be thorough and strict. Focus on substantive issues that would impact correctness, security, or maintainability.

CLEAN CODE PRINCIPLES:
- Prioritize clarity and simplicity over cleverness
- Flag code that is unnecessarily complex or hard to understand
- Encourage meaningful names that reveal intent
- Identify functions that do too much (should have single responsibility)
- Suggest breaking down large, complex functions
- Flag duplicate code that should be extracted
- Recommend proper error handling and validation

BATCHED REVIEW MODE: Review ALL files listed below. Each file has its diff stored in a separate file that you can read.

FILES TO REVIEW:
${filesListing}
${commentsSection}
INSTRUCTIONS:
1. Read each diff file listed above (use the @filename syntax to read them)
2. Review each file thoroughly
3. Return a single JSON response with results for ALL files

COMPREHENSIVE REVIEW APPROACH:
- Perform multiple mental passes: logic → security → performance → quality
- Consider edge cases: null/undefined, empty arrays, boundary values, concurrent access
- Think about "what could go wrong" scenarios exhaustively
- Don't stop at first issue - scan the entire change thoroughly
- Consider both what's present and what might be missing
${existingCommentsContext ? "- AVOID duplicating issues already mentioned in EXISTING COMMENTS above" : ""}

FOCUS ON SUBSTANTIVE ISSUES:
- Actual bugs: logic errors, race conditions, edge cases not handled
- Security vulnerabilities: injection flaws, authentication issues, data exposure
- Performance problems: algorithmic inefficiency, memory leaks, unnecessary operations
- Breaking changes: API incompatibilities, contract violations
- Critical architectural concerns: tight coupling, violated principles

DO NOT flag:
- Purely stylistic preferences (e.g., whitespace, variable naming) unless they severely violate established patterns
- Documentation for completely self-evident code (e.g., getters/setters)
- Syntax or compilation issues (assume all code compiles and is valid syntax)
- Language features you're unfamiliar with

GUIDELINES:
- Report findings even if they seem minor, if they impact code quality or maintainability
- Do not assume the developer made the best choice; verify the logic and implementation details
- Focus on correctness, security, performance, and best practices
- Be thorough and strict; it is better to flag a potential issue than to miss a real bug

PRE-EXISTING ISSUE DETECTION:
- **CRITICAL**: Only flag issues that are NEW in this PR - introduced by added/modified lines (marked with +)
- If an issue exists in removed lines (starting with -), set isPreExisting to true
- Only set isPreExisting to false for issues newly introduced in added lines (+)
- **Focus EXCLUSIVELY on new issues introduced in this PR**
- Do NOT flag existing code issues that were already present before this PR

CRITICAL LINE NUMBER INSTRUCTIONS - READ CAREFULLY:
The "line" field MUST be the absolute line number in the NEW version of the file (after changes are applied).

The diffs have PRE-CALCULATED LINE NUMBERS for easy reference.

DIFF FORMAT:
Each line shows: [PREFIX][LINE_NUMBER] | [CONTENT]
- PREFIX is: " " (context), "+" (added), or "-" (removed)
- LINE_NUMBER is the line number in the NEW file (or "-" for removed lines)

EXAMPLE:
@@ -80,5 +155,7 @@ .footer {
    155 | text-align: center;      ← Context line at line 155
    156 | }                        ← Context line at line 156
    157 |                          ← Empty context line at line 157
-     - | .logo {                   ← Removed line (no line number)
-     - |   animation: logo-spin;   ← Removed line (no line number)
+   158 | .logo-fixed {             ← ADDED at line 158 - USE THIS NUMBER!
+   159 |   animation: broken-spin; ← ADDED at line 159
    160 | }                        ← Context line at line 160

HOW TO USE:
- Read the line number directly from the diff - no counting needed!
- For "animation: broken-spin" above, report line 159
- Only lines with "+" prefix are newly added code
- Lines with "-" prefix were removed and cannot be commented on

Respond with your analysis and findings.

FORMAT:
1. ANALYSIS: Think through the changes step-by-step. Analyze logic, security, and performance implications.
2. JSON: Output the findings in a STRICT JSON format wrapped in a markdown code block.

Example Response:
Analysis of the changes...
\`\`\`json
{
  "file_results": {
    "path/to/file1.ts": {
      "findings": [
        {
          "line": <line_number>,
          "severity": "critical|high|medium|low",
          "category": "bug|security|performance|quality|documentation",
          "message": "Description of the issue",
          "suggestion": "Recommended fix or improvement",
              "isPreExisting": false
        }
      ]
    },
    "path/to/file2.ts": {
      "findings": []
    }
  }
}
\`\`\`

IMPORTANT: Include an entry for EVERY file listed above, even if it has no findings (use empty arrays).
If a file has no issues, use: "filename": { "findings": []}`;
}
