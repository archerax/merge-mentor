import type { DiffManifest } from "@merge-mentor/domain/diff.js";
import type { PRDetails } from "@merge-mentor/domain/platform.js";

import {
  buildSecurityPreamble,
  wrapUntrustedExistingComments,
  wrapUntrustedPRMetadata,
} from "../securityPreamble.js";
import { buildSeverityContextSection } from "../severityContext.js";
import { buildFilesListing, buildWorkspaceSection } from "../shared/workspaceSection.js";
import { buildReviewOutputFormat } from "./outputFormats.js";

/**
 * Builds the single-pass fast review prompt combining file-level analysis,
 * cross-file architectural analysis, existing-comments context, and the fast
 * review output format specification.
 *
 * @param prDetails - PR metadata used for the PR context section.
 * @param manifest - Diff manifest listing the files to review.
 * @param existingCommentsContext - Optional markdown of already-posted PR comments to avoid duplicating.
 * @param repoPath - Optional repository root used for workspace access sections.
 * @returns The complete fast review prompt.
 */
export function buildFastReviewPrompt(
  prDetails: PRDetails,
  manifest: DiffManifest,
  existingCommentsContext?: string,
  repoPath?: string
): string {
  const filesListing = buildFilesListing(manifest, repoPath);

  const commentsSection = existingCommentsContext
    ? `
# EXISTING PR COMMENTS
${wrapUntrustedExistingComments(existingCommentsContext)}

IMPORTANT: Be aware of issues already flagged. Focus on NEW issues not already covered.
`
    : "";

  const analysisStructureSection = `# ANALYSIS
Scan thoroughly for bugs, security vulnerabilities, performance issues, and quality concerns across all files and their interactions. Report all genuine findings with line references.`;

  return `${buildSecurityPreamble()}# YOUR ROLE
Expert code reviewer performing comprehensive analysis in a single pass. Baseline review is always active.
${buildWorkspaceSection(repoPath)}
# PR CONTEXT
${wrapUntrustedPRMetadata(prDetails.title, prDetails.description)}

# TASK
Perform a COMPLETE review of this PR covering:
- Individual file analysis (bugs, security, performance, quality)
- Cross-file architectural analysis (integration, consistency, design)

You MUST review EVERY file listed below - no exceptions. Each file's diff is
stored separately: read every diff IN FULL before analyzing it, then account for
every file in your output. Do NOT skim, sample, batch-skip, or defer any file
because it looks small, trivial, repetitive, test-only, or config-only. A
thorough review of all files is required before you respond.

Files to Review:
${filesListing}
${commentsSection}
${analysisStructureSection}

# VERIFICATION CHECKLIST

Before reporting any finding:
- Issue exists in ADDED lines (+), not removed lines (-)
- Line number is correct and points to actual problem code (if line-specific)
- Issue isn't already handled elsewhere in the diff or codebase
- Severity matches actual impact
- For cross-file issues: confirmed system-level impact, not just file-level

For each finding, \`reasoning\` must confirm the issue is real, state its concrete impact, and justify the severity (1–2 sentences).

# CRITICAL RULES
1. Only flag NEW issues in added lines (marked with +)
2. Include confidence (high/medium/low) and reasoning for EVERY finding
3. Use exact line numbers from diff for line-specific findings
4. Use flexible attribution based on issue scope:
   - **Line-specific**: Include both file and line number
   - **File-level**: Include file but omit line number
   - **General/PR-level**: Omit both file and line (architectural concerns)
5. You MUST read and review EVERY file listed above IN FULL, then return an entry for EVERY file in \`file_results\` - even files with no findings. Skipping or skimming any file is a failure of this task
${existingCommentsContext ? "6. AVOID duplicating issues in EXISTING COMMENTS above" : ""}

# SEVERITY THRESHOLDS
Use these exact criteria:
- **critical**: Security vulnerability, data loss, system crash, production outage
- **high**: Logic bug causing incorrect behavior, race condition, unsafe operation, architectural flaw
- **medium**: Performance issue, maintainability concern, missing validation, design concern
- **low**: Minor improvement, readability suggestion, documentation need
${buildSeverityContextSection()}
# CONFIDENCE LEVELS
- **high**: Clear issue with definite negative impact
- **medium**: Likely issue but needs context or verification
- **low**: Suggestion based on best practices, may not apply

# REVIEW APPROACH
Perform multiple mental passes through the PR:
1. **Logic**: Correctness, edge cases, error handling (file and system level)
2. **Security**: Injection flaws, authentication, data exposure (file and system level)
3. **Performance**: Algorithmic efficiency, memory leaks (file and system level)
4. **Quality**: Clean code principles, maintainability
5. **Architecture**: Integration issues, cross-cutting concerns, design consistency

Consider: null/undefined, empty arrays, boundary values, concurrent access, cross-file integration, "what could go wrong" scenarios

# ALWAYS REPORT
## File-Level:
- **Bugs**: Logic errors, race conditions, unhandled edge cases, off-by-one errors
- **Security**: Any potential vulnerability, no matter how small
- **Best practices**: var instead of let/const, magic numbers, poor naming
- **Code quality**: Functions doing too much, duplicate code, unnecessary complexity
- **Type safety**: Missing type annotations, unsafe assertions (any, as unknown)
- **Error handling**: Missing try-catch, unhandled promises, silent failures
- **Performance**: Algorithmic inefficiency, memory leaks, N+1 queries

## Architectural:
- **Integration issues**: Missing coordination between modified files
- **Design inconsistencies**: Different error handling patterns across files
- **Breaking changes**: API incompatibilities, contract violations
- **System-level concerns**: Incomplete feature implementation across files
- **Cross-cutting concerns**: Security, logging, error handling gaps at system level

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
6. Is this actually architectural? (for cross-file issues — not just file-level?)

Only report findings that survive this check.

## Attribution Rules
- **Line-specific**: Include both file and line number
- **File-level**: Include file and omit line number
- **General/PR-level**: Omit both file and line

${buildReviewOutputFormat()}
`;
}
