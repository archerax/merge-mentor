import type { DiffManifest } from "@merge-mentor/domain/diff.js";
import type { PRDetails } from "@merge-mentor/domain/platform.js";

import {
  buildSecurityPreamble,
  wrapUntrustedExistingComments,
  wrapUntrustedPRMetadata,
} from "../securityPreamble.js";
import { buildSeverityContextSection } from "../severityContext.js";
import { buildFilesListing, buildWorkspaceSection } from "../shared/workspaceSection.js";
import { buildReviewOutputFormat, buildCrossFileOutputFormat } from "./outputFormats.js";
import type { BaseCrossFileContext } from "./types.js";

const FILE_REVIEW_ALLOWED_CATEGORIES = [
  "bug",
  "security",
  "performance",
  "quality",
  "documentation",
] as const;

const CROSS_FILE_ALLOWED_CATEGORIES = [
  "architecture",
  "design",
  "testing",
  "documentation",
  "bug",
  "security",
  "performance",
  "quality",
] as const;

/**
 * Builds an existing-comments section wrapping the provided untrusted comment
 * context with a heading and a focus instruction. Returns an empty string when
 * no existing comments are provided.
 *
 * @param heading - Markdown heading for the section.
 * @param existingCommentsContext - Optional markdown of already-posted PR comments.
 * @param focusInstruction - Instruction telling the model how to treat the existing comments.
 * @returns The existing-comments markdown section, or "" when no context is provided.
 */
function buildExistingCommentsSection(
  heading: string,
  existingCommentsContext: string | undefined,
  focusInstruction: string
): string {
  if (!existingCommentsContext) {
    return "";
  }

  return `
${heading}
${wrapUntrustedExistingComments(existingCommentsContext)}

IMPORTANT: ${focusInstruction}
`;
}

/** Context for the general (baseline) cross-file review. */
export interface GeneralCrossFileContext extends BaseCrossFileContext {
  /** Markdown of already-posted PR comments to avoid re-reporting. */
  readonly existingCommentsContext?: string;
}

/**
 * Builds the general (baseline) per-file review prompt with optional
 * existing-comments context and the batched file results output format.
 * Instructs the model to review every file in the manifest and return an entry
 * for each, even with empty findings.
 *
 * @param manifest - Diff manifest listing the files to review.
 * @param existingCommentsContext - Optional markdown of already-posted PR comments to avoid duplicating.
 * @param repoPath - Optional repository root used for workspace access sections.
 * @returns The complete general file review prompt.
 */
export function buildGeneralFileReviewPrompt(
  manifest: DiffManifest,
  existingCommentsContext?: string,
  repoPath?: string
): string {
  const filesListing = buildFilesListing(manifest, repoPath);

  const commentsSection = buildExistingCommentsSection(
    "# EXISTING PR COMMENTS",
    existingCommentsContext,
    "Be aware of issues already flagged. Focus on NEW issues not already covered."
  );

  const analysisStructureSection = `# ANALYSIS
Scan thoroughly for bugs, security vulnerabilities, performance issues, and quality concerns. Report all genuine findings with line references.`;

  return `${buildSecurityPreamble()}# YOUR ROLE
Expert code reviewer analyzing changes. Baseline review is always active.
${buildWorkspaceSection(repoPath)}
# TASK
You MUST review EVERY file listed below - no exceptions. Each file's diff is
stored separately - read each diff IN FULL using @filename syntax before
analyzing it. Do NOT skim, sample, or skip any file because it looks small,
trivial, repetitive, test-only, or config-only.

Files to Review:
${filesListing}
${commentsSection}
${analysisStructureSection}

# VERIFICATION CHECKLIST

Before reporting any finding:
- Issue exists in ADDED lines (+), not removed lines (-)
- Line number is correct and points to actual problem code
- Issue isn't already handled elsewhere in the diff
- Severity matches actual impact

For each finding, \`reasoning\` must confirm the issue is real, state its concrete impact, and justify the severity (1–2 sentences).

# CRITICAL RULES
1. Only flag NEW issues in added lines (marked with +)
2. Include confidence (high/medium/low) and reasoning for EVERY finding
3. Use exact line numbers from diff - they're pre-calculated
4. You MUST return results for EVERY file, even if it has no findings; do not skim or skip any file
${existingCommentsContext ? "5. AVOID duplicating issues in EXISTING COMMENTS above" : ""}

# SEVERITY THRESHOLDS
Use these exact criteria:
- **critical**: Security vulnerability, data loss, system crash, production outage
- **high**: Logic bug causing incorrect behavior, race condition, unsafe operation
- **medium**: Performance issue, maintainability concern, missing validation, code smell
- **low**: Minor improvement, readability suggestion, documentation need
${buildSeverityContextSection()}
# CONFIDENCE LEVELS
- **high**: Clear issue with definite negative impact
- **medium**: Likely issue but needs context or verification
- **low**: Suggestion based on best practices, may not apply

# REVIEW APPROACH
Perform multiple mental passes through each file:
1. **Logic**: Correctness, edge cases, error handling
2. **Security**: Injection flaws, authentication, data exposure
3. **Performance**: Algorithmic efficiency, memory leaks
4. **Quality**: Clean code principles, maintainability

Consider: null/undefined, empty arrays, boundary values, concurrent access, "what could go wrong" scenarios

# ALWAYS REPORT
- **Bugs**: Logic errors, race conditions, unhandled edge cases, off-by-one errors
- **Security**: Any potential vulnerability, no matter how small
- **Best practices**: var instead of let/const, magic numbers, poor naming
- **Code quality**: Functions doing too much, duplicate code, unnecessary complexity
- **Type safety**: Missing type annotations, unsafe assertions (any, as unknown)
- **Error handling**: Missing try-catch, unhandled promises, silent failures
- **Performance**: Algorithmic inefficiency, memory leaks, N+1 queries
- **Breaking changes**: API incompatibilities, contract violations

# NEVER REPORT
- **Formatting**: Whitespace, indentation (if project has auto-formatter)
- **Syntax errors**: Assume all code compiles successfully
- **Unfamiliar features**: Don't flag language constructs you don't recognize
- **Obvious documentation**: Getters/setters, self-explanatory functions
- **Subjective opinions**: Personal preferences without concrete rationale
- **Existing issues**: Problems in removed lines (-) unless marking as pre-existing

# LINE NUMBERS (PRE-CALCULATED)
Diff format: [+/-/SPACE][NUMBER] | CODE
- Use NUMBER directly from added lines (+)
- Example: "+ 159 | const x = 1" → report line 159
- No counting needed - numbers are ready to use!

# SELF-CHALLENGE REQUIREMENT

Before reporting ANY finding, ask yourself:
1. Could this be intentional? (e.g., deliberate error swallowing in retry logic)
2. Is this validated elsewhere? (e.g., at API gateway)
3. Is this test/mock code? (different standards apply)
4. Is there framework context I'm missing?
5. Would a senior engineer flag this? (Is it substantive, not nitpicking?)

Only report findings that survive this check.

${buildReviewOutputFormat({
  analysisInstruction: "Document your analysis step-by-step",
  severityExample: "high",
  categoryExample: "bug",
  messageExample: "Clear description of the problem",
  suggestionExample: "Specific fix with code example",
  reasoningExample: "Why this is a real issue and its concrete impact",
  fileCategories: FILE_REVIEW_ALLOWED_CATEGORIES,
  crossFile: "skip",
})}
`;
}

/**
 * Builds the general (baseline) cross-file review prompt performing holistic
 * architectural analysis across the changed files. Includes per-file finding
 * summaries, workspace access instructions, and the cross-file output format.
 *
 * @param prDetails - PR metadata used for the PR context section.
 * @param context - Cross-file context with file summaries and per-file review results.
 * @param repoPath - Optional repository root used for workspace access sections.
 * @returns The complete general cross-file review prompt.
 */
export function buildGeneralCrossFilePrompt(
  prDetails: PRDetails,
  context: GeneralCrossFileContext,
  repoPath?: string
): string {
  const { filesSummary, fileReviewResults, existingCommentsContext } = context;

  const findingsSummary = fileReviewResults
    .filter((r) => r.findings.length > 0)
    .map((r) => `${r.filename}: ${r.findings.length} finding(s)`)
    .join("\n");

  const commentsSection = buildExistingCommentsSection(
    "EXISTING PR COMMENTS:",
    existingCommentsContext,
    "Be aware of issues already flagged. Focus on NEW system-level concerns not already covered."
  );

  const workspaceSection = repoPath
    ? `
---
# WORKSPACE ACCESS ENABLED

You have full access to the repository (not just changed files).
Your working directory is set to the repository root.

**Use these features extensively:**

- \`@workspace /search <query>\` - Find patterns across all files
- \`@file:relative/path/to/file.ts\` - Read any file in the repository
- \`@workspace /find <filename>\` - Locate files by name

**Critical Scenarios:**

1. **Before flagging "missing validation":**
   \`@workspace /search validation\` to see if it exists elsewhere

2. **Before suggesting "add error handling":**
   \`@file:src/utils/errorHandler.ts\` to check existing patterns

3. **Before reporting "inconsistent with codebase":**
   \`@workspace /find similar\` to verify the pattern used

4. **For architectural concerns:**
   Explore existing modules to understand the system design

**MANDATORY:** Always cross-reference the repository before reporting:
- "Missing" features (they might exist)
- "Inconsistent" patterns (verify against actual code)
- "No error handling" (check shared utilities)
- Architectural violations (understand the architecture first)

---
`
    : "";

  return `${buildSecurityPreamble()}# YOUR ROLE
Expert code reviewer performing holistic architectural analysis of a pull request. Baseline cross-file review is always active.
${workspaceSection}
# PR CONTEXT
${wrapUntrustedPRMetadata(prDetails.title, prDetails.description)}

Changed Files:
${filesSummary}

Individual File Findings:
${findingsSummary || "No individual issues found"}
${commentsSection}
# CRITICAL RULES
1. ONLY analyze files in the Changed Files list above - ignore any files mentioned in PR description that aren't actually changed
2. Do NOT duplicate issues already caught in individual file reviews
3. Include confidence (high/medium/low) and reasoning for EVERY finding
4. Focus on system-level and architectural concerns, not individual file issues

# VERIFICATION CHECKLIST

Before reporting any cross-file finding, complete this mandatory verification:

□ Issue spans multiple files (not a single-file concern)
□ Issue is NEW to this PR (not pre-existing architectural debt)
□ Issue isn't already covered in individual file reviews
□ All affected files are actually in the Changed Files list
□ Impact is architectural/system-level (not isolated)
□ Severity matches cross-file impact (consider system-wide consequences)

For each finding, \`reasoning\` must confirm which files are involved, state the system-level impact, and justify the severity (1–2 sentences).

# SEVERITY THRESHOLDS
Use these exact criteria:
- **critical**: System crash, data loss, security breach, production outage risk
- **high**: Architectural flaw, major integration issue, widespread impact
- **medium**: Design concern, maintainability issue, testing gap
- **low**: Minor improvement opportunity, documentation need

# CONFIDENCE LEVELS
- **high**: Clear architectural issue with obvious negative impact
- **medium**: Potential concern that needs verification or context
- **low**: Suggestion based on general practices, may not apply here

# SYSTEMATIC ANALYSIS CHECKLIST
- Error handling: Consistent propagation? Missing try-catch patterns?
- State management: Race conditions? Inconsistent state updates across files?
- Data flow: Complete path from input to output? Missing cross-file validations?
- Dependencies: Circular dependencies? Tight coupling between modules?
- Testing: Integration points covered? Critical paths testable?
- Security: Authentication/authorization consistent? Input validation complete?

# SELF-CHALLENGE REQUIREMENT

Before reporting ANY finding, ask yourself:
1. Could this be intentional design? (e.g., deliberate loose coupling)
2. Is this validated/handled elsewhere in the system?
3. Is there architectural context I'm missing? (e.g., framework conventions)
4. Is this actually a system-level concern, not just file-level?
5. Would an experienced architect flag this as a real problem?

Only report findings that survive this check.

${buildCrossFileOutputFormat({
  intro: "Provide a complete cross-file analysis in JSON format:",
  severityExample: "high",
  categoryExample: "architecture",
  messageExample: "Clear description of cross-file issue",
  reasoningExample: "Why this cross-file concern is real and its system-level impact",
  overallAssessmentExample: "Brief summary of PR quality and architecture",
  recommendationExample: "Actionable improvement suggestions",
  footer: `Return ONLY the JSON code block. Use only these categories: ${CROSS_FILE_ALLOWED_CATEGORIES.join(", ")}. Focus on system-level concerns across the changed files.`,
})}
`;
}
