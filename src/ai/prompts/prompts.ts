import type { FileReviewResult, PRDetails, PRFile } from "../../platforms/types.js";

/**
 * Builds a prompt for reviewing a single file.
 *
 * @param filename - Name of the file being reviewed
 * @param patch - Git diff/patch content for the file
 * @param allFilesContext - Optional summary of all files changed in the PR for context
 * @param existingCommentsContext - Optional context of existing comments to avoid duplication
 * @returns Formatted prompt for Copilot CLI
 */
export function buildFileReviewPrompt(
  filename: string,
  patch: string,
  allFilesContext?: string,
  existingCommentsContext?: string
): string {
  const contextSection = allFilesContext ? `\nFILES CHANGED IN THIS PR:\n${allFilesContext}\n` : "";
  const commentsSection = existingCommentsContext
    ? `\n${existingCommentsContext}\n\nIMPORTANT: Review the existing comments above. Do NOT flag the same issues again, even if worded differently. Focus on finding NEW issues not already covered by existing comments.\n`
    : "";

  return `You are an expert code reviewer analyzing changes made by senior developers. Focus on substantive issues that would impact correctness, security, or maintainability.
${contextSection}${commentsSection}
FILE: ${filename}
DIFF:
${patch}

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
- Obvious best practices that any senior developer knows (e.g., "breaking changes may occur")
- Stylistic preferences unless they violate established patterns in the codebase
- Trivial suggestions that don't materially improve the code
- Well-known trade-offs without explaining why the choice is problematic in this context
- Documentation for self-evident code

GUIDELINES:
- Only report findings if you can explain a specific negative consequence
- Assume the developer is experienced and made intentional choices
- If suggesting a change, explain the concrete benefit, not just what's "better"
- Skip findings about configuration or dependency updates unless there's a specific compatibility issue
- Focus on "what could go wrong" not "what could be different"

GOAL: Find ALL substantive issues in a single comprehensive review, not just a sample.

CONFIDENCE SCORING:
- "high": You are certain this is an issue AND it was introduced in this PR (in added/modified lines)
- "medium": You believe this is likely an issue, but there's some uncertainty
- "low": You suspect this might be an issue, but you're not confident
- Only report findings with "high" or "medium" confidence

PRE-EXISTING ISSUE DETECTION:
- If an issue exists in removed lines (starting with -), it is pre-existing - set isPreExisting to true
- If the same pattern exists in both removed and added lines, it is pre-existing - set isPreExisting to true  
- Only set isPreExisting to false for issues that are newly introduced in added lines (+)
- Focus primarily on new issues introduced in this PR

IMPORTANT: The "line" field must reference a line number that appears in the diff above.
- For added lines (starting with +), use the NEW line number (right side of the diff)
- For context lines (no prefix), use the NEW line number
- For removed lines (starting with -), do NOT create findings - focus on what was added/changed
- Line numbers should match the @@ hunk headers in the diff (e.g., @@ -10,5 +15,7 @@ means new lines start at 15)
${
  existingCommentsContext
    ? `
RESOLVED COMMENT DETECTION:
- Review the EXISTING COMMENTS listed above
- For each existing comment, check if the issue has been FIXED in the current diff
- An issue is resolved if the problematic code was removed, corrected, or the concern no longer applies
- Include resolved comments in the "resolved_comments" array with the original line number and brief reason
`
    : ""
}
Respond ONLY with valid JSON in this exact format:
{
  "findings": [
    {
      "line": <line_number>,
      "severity": "critical|high|medium|low",
      "category": "bug|security|performance|quality|documentation",
      "message": "Description of the issue",
      "suggestion": "Recommended fix or improvement",
      "confidence": "high|medium|low",
      "isPreExisting": false
    }
  ]${
    existingCommentsContext
      ? `,
  "resolved_comments": [
    {
      "line": <original_line_number>,
      "reason": "Brief explanation of why this issue is now resolved"
    }
  ]`
      : ""
  }
}

If there are no issues, return: {"findings": []${existingCommentsContext ? ', "resolved_comments": []' : ""}}`;
}

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

  return `You are an expert code reviewer performing a holistic analysis of a pull request by experienced developers.

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
- Best practices that are obvious to experienced developers
- Documentation for standard patterns

GUIDELINES:
- Only provide recommendations that would prevent production issues or significantly improve maintainability
- Assume the team has good reasons for their choices unless there's clear evidence of a problem
- Focus on what could fail or cause confusion, not what could be "nicer"
- ONLY analyze the actual files listed in CHANGED FILES SUMMARY - ignore any files mentioned in PR title/description that aren't in the changed files list

GOAL: Perform ONE thorough architectural review that catches all system-level concerns.

Respond ONLY with valid JSON in this exact format:
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
}`;
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
