import type { FileReviewResult, PRDetails } from "../../platforms/types.js";
import type { DiffManifest } from "../../review/diffStorage.js";
import {
  buildSecurityPreamble,
  wrapUntrustedExistingComments,
  wrapUntrustedPRMetadata,
} from "./securityPreamble.js";
import { buildSeverityContextSection } from "./severityContext.js";

/**
 * Builds a prompt for cross-file analysis.
 *
 * @param prDetails - Pull request metadata
 * @param filesSummary - Summary of changed files
 * @param fileReviewResults - Results from individual file reviews
 * @param existingCommentsContext - Optional context of existing comments to avoid duplication
 * @param repoContext - Optional repository-specific coding standards and guidelines
 * @param repoPath - Optional path to cloned repository for workspace access
 * @returns Formatted prompt for Copilot CLI
 */
export function buildCrossFilePrompt(
  prDetails: PRDetails,
  filesSummary: string,
  fileReviewResults: readonly FileReviewResult[],
  existingCommentsContext?: string,
  repoContext?: string,
  repoPath?: string
): string {
  const findingsSummary = fileReviewResults
    .filter((r) => r.findings.length > 0)
    .map((r) => `${r.filename}: ${r.findings.length} finding(s)`)
    .join("\n");

  const commentsSection = existingCommentsContext
    ? `\nEXISTING PR COMMENTS:\n${wrapUntrustedExistingComments(existingCommentsContext)}\n\nIMPORTANT: Be aware of issues already flagged. Focus on NEW system-level concerns not already covered.\n`
    : "";

  const repoContextSection = repoContext
    ? `
---
# REPOSITORY-SPECIFIC GUIDELINES

The following standards are specific to this project.
**These take precedence over generic best practices.**

${repoContext}

---
`
    : "";

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
Expert code reviewer performing holistic architectural analysis of a pull request.
${repoContextSection}${workspaceSection}
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

Before reporting any cross-file finding:
- Issue spans multiple files (not a single-file concern)
- Issue is NEW to this PR (not pre-existing architectural debt)
- Issue isn't already covered in individual file reviews
- All affected files are actually in the Changed Files list
- Impact is architectural/system-level (not isolated)

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

# WHAT TO REPORT
- Architectural problems: poor separation of concerns, circular dependencies, violated design principles
- System-level concerns: missing error handling patterns, incomplete transaction management
- Cross-cutting issues: inconsistent approach across files, missing integration points
- Testing gaps: critical paths without coverage, integration test needs
- Breaking changes: API incompatibilities across modules

# WHAT NOT TO REPORT
- Issues already in individual file reviews
- Syntax or compilation errors (assume code compiles)
- Language features you don't recognize
- Vague suggestions without specific actionable improvements

# OUTPUT FORMAT

1. JSON: Return findings in strict JSON format within markdown code block

\`\`\`json
{
  "overall_assessment": "Summary of PR quality and main concerns",
  "findings": [
    {
      "severity": "high",
      "confidence": "high",
      "category": "architecture",
      "message": "Clear description of the issue",
      "reasoning": "Why this is a real cross-file concern and its system-level impact",
      "affected_files": ["file1.ts", "file2.ts"]
    }
  ],
  "recommendations": ["Specific actionable recommendation 1", "Specific actionable recommendation 2"]
}
\`\`\`
`;
}

/**
 * Builds a prompt for batched file review where all files are reviewed in a single AI call.
 * The diffs are stored on disk and referenced via the manifest.
 *
 * @param manifest - Manifest describing stored diff files
 * @param existingCommentsContext - Optional context of existing comments to avoid duplication
 * @param repoContext - Optional repository-specific coding standards and guidelines
 * @param repoPath - Optional path to cloned repository for workspace access
 * @returns Formatted prompt for batched review
 */
export function buildBatchedFileReviewPrompt(
  manifest: DiffManifest,
  existingCommentsContext?: string,
  repoContext?: string,
  repoPath?: string
): string {
  // When repoPath is provided, diffs are stored in .mergementor/diffs/ inside the repo
  // Use @file: prefix for file paths when working in a repository workspace
  const filesListing = manifest.files
    .map((f) => {
      // When repoPath is provided, use @file: syntax with relative path from repo root
      // Otherwise, just use @filename for files in current directory
      const fileRef = repoPath ? `@file:.mergementor/diffs/${f.diffPath}` : `@${f.diffPath}`;
      return `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) → ${fileRef}`;
    })
    .join("\n");

  const commentsSection = existingCommentsContext
    ? `\nEXISTING PR COMMENTS:\n${wrapUntrustedExistingComments(existingCommentsContext)}\n\nCRITICAL: Do NOT flag issues already mentioned above. Focus ONLY on NEW issues not yet covered.\n`
    : "";

  const repoContextSection = repoContext
    ? `
---
# REPOSITORY-SPECIFIC GUIDELINES

The following standards are specific to this project.
**These take precedence over generic best practices.**

${repoContext}

---
`
    : "";

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
Expert code reviewer analyzing changes. Be thorough and strict in catching issues.
${repoContextSection}${workspaceSection}
# TASK
Review ALL files listed below. Each file's diff is stored separately - read using @filename syntax.

Files to Review:
${filesListing}
${commentsSection}
# ANALYSIS
Scan thoroughly for bugs, security vulnerabilities, performance issues, and quality concerns. Report all genuine findings with line references.

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
4. Return results for ALL files, even if no findings
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

# PRE-EXISTING ISSUES
- Focus on NEW issues in added lines (+)
- If issue exists in removed lines (-), set isPreExisting: true
- Only set isPreExisting: false for newly introduced issues

# OUTPUT FORMAT

1. JSON: Return findings in strict JSON format within markdown code block

\`\`\`json
{
  "file_results": {
    "path/to/file1.ts": {
      "findings": [
        {
          "line": 45,
          "severity": "high",
          "confidence": "high",
          "category": "bug",
          "message": "Array access without bounds check on user input",
          "suggestion": "Add validation: if (index >= 0 && index < array.length)",
          "reasoning": "User-controlled index with no bounds check causes runtime crash",
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

REMEMBER: Include entry for EVERY file listed above, even with empty findings array.
`;
}
