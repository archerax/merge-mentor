import type { PRDetails } from "../../../platforms/types.js";
import type { DiffManifest } from "../../../review/diffStorage.js";
import type { GeneralReviewPhase } from "../../../review/reviewSelection.js";
import { buildSecurityPreamble, wrapUntrustedPRMetadata } from "../securityPreamble.js";
import { buildSeverityContextSection } from "../severityContext.js";
import { buildFastReviewOutputFormat } from "./outputFormats.js";

function buildWorkspaceSection(repoPath?: string): string {
  if (!repoPath) return "";

  return `
---
# WORKSPACE ACCESS ENABLED

You have full access to the repository (not just changed files).
Your working directory is set to the repository root.

**Use these features extensively:**

- \`@workspace /search <query>\` - Find patterns across all files
- \`@file:relative/path/to/file.ts\` - Read any file in the repository
- \`@workspace /find <filename>\` - Locate files by name

**MANDATORY:** Always cross-reference the repository before reporting:
- Verify existing patterns before flagging inconsistencies
- Check for centralized handling before reporting missing checks
- Understand the codebase architecture before reporting violations

---
`;
}

const FAST_PASS_DETAILS: Record<GeneralReviewPhase, readonly string[]> = {
  scan: [
    "- Re-scan the diff for suspicious change patterns and incomplete edits",
    "- Revisit nearby code paths for inconsistencies introduced by the PR",
  ],
  security: [
    "- Re-check trust boundaries, auth/authz, validation, and exploit paths",
    "- Revisit secrets, data exposure, and unsafe execution/deserialization risks",
  ],
  logic: [
    "- Revisit edge cases, contracts, and error propagation",
    "- Re-check state transitions and integration correctness",
  ],
  performance: [
    "- Re-check algorithmic complexity, repeated work, and resource usage",
    "- Revisit batching, caching, and scalability risks",
  ],
  monorepo: [
    "- Re-check workspace boundaries, package ownership, and dependency placement",
    "- Revisit shared tooling/config changes for cross-package breakage",
  ],
  testing: [
    "- Re-check missing coverage, weak assertions, flaky patterns, and testability",
    "- Revisit integration points or behavior changes that likely need tests",
  ],
  database: [
    "- Re-check query correctness, transaction boundaries, and migration safety",
    "- Revisit indexing, batching, locking, and data consistency concerns",
  ],
};

function buildSelectedPassesSection(selectedPasses?: readonly GeneralReviewPhase[]): string {
  if (!selectedPasses || selectedPasses.length === 0) {
    return "";
  }

  return `
# ADDITIVE REVIEW PASSES
Baseline review is always active. After the baseline review, run these extra passes in this exact order:
${selectedPasses.map((phase, index) => `${index + 1}. ${phase}`).join("\n")}

These passes add focus and context. They do **not** restrict what issues you may report.
`;
}

function buildAdditionalPassAnalysis(selectedPasses?: readonly GeneralReviewPhase[]): string {
  if (!selectedPasses || selectedPasses.length === 0) {
    return "";
  }

  return `
## Additional Focused Passes
${selectedPasses
  .map(
    (phase, index) =>
      `### Additive Pass ${index + 1}: ${phase}\n${FAST_PASS_DETAILS[phase].join("\n")}`
  )
  .join("\n\n")}
`;
}

function buildAdditionalContextSections(additionalContextSections?: readonly string[]): string {
  if (!additionalContextSections || additionalContextSections.length === 0) {
    return "";
  }

  return `\n${additionalContextSections.join("\n\n")}\n`;
}

export function buildFastReviewPrompt(
  prDetails: PRDetails,
  manifest: DiffManifest,
  existingCommentsContext?: string,
  repoPath?: string,
  selectedPasses?: readonly GeneralReviewPhase[],
  additionalContextSections?: readonly string[]
): string {
  const diffPrefix = repoPath ? ".mergementor/diffs/" : "";
  const filesListing = manifest.files
    .map(
      (f) =>
        `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) → @${diffPrefix}${f.diffPath}`
    )
    .join("\n");

  const commentsSection = existingCommentsContext
    ? `
# EXISTING PR COMMENTS
${existingCommentsContext}

IMPORTANT: Be aware of issues already flagged. Focus on NEW issues not already covered.
`
    : "";

  return `${buildSecurityPreamble()}# YOUR ROLE
Expert code reviewer performing comprehensive analysis in a single pass. Baseline review is always active. If additive passes are configured below, treat them like extra specialist reviewers giving the same diff another focused read.
${buildWorkspaceSection(repoPath)}
# PR CONTEXT
${wrapUntrustedPRMetadata(prDetails.title, prDetails.description)}

# TASK
Perform a COMPLETE review of this PR covering:
- Individual file analysis (bugs, security, performance, quality)
- Cross-file architectural analysis (integration, consistency, design)

Files to Review:
${filesListing}
${commentsSection}
${buildSelectedPassesSection(selectedPasses)}${buildAdditionalContextSections(additionalContextSections)}
# MANDATORY ANALYSIS STRUCTURE

Before providing JSON, document your analysis:

## Pass 1: File-Level Surface Scan
Line-by-line observations of suspicious patterns in individual files

## Pass 2: Security Deep Dive
- Authentication/authorization analysis (file and system level)
- Input validation completeness
- Data exposure risks

## Pass 3: Logic Analysis
- Edge case handling in individual files
- Error path completeness
- State management correctness

## Pass 4: Performance Review
- Algorithmic complexity
- Resource leak risks
- Scalability concerns

## Pass 5: Architectural Analysis
- Integration between modified files
- Cross-file consistency (error handling, patterns)
- System-level design concerns
- Dependency relationships
${buildAdditionalPassAnalysis(selectedPasses)}

## Findings Summary
Only after completing all passes above, list findings with appropriate attribution.

# VERIFICATION CHECKLIST

Before reporting any finding, complete this mandatory verification:

□ Issue exists in ADDED lines (+), not removed lines (-)
□ Line number is correct and points to actual problem code (if line-specific)
□ Issue isn't handled elsewhere in the diff or codebase (checked context)
□ Suggestion actually fixes the root cause (not just masking symptoms)
□ Issue isn't a false positive from missing context
□ Severity matches the actual impact (not over/under-rated)
□ For cross-file issues: verified all affected files are in the changed files list
□ For architectural issues: confirmed system-level impact, not just file-level

## Verification Documentation Requirements

For EACH finding, your reasoning field must include verification notes.

**Required verification elements:**
- ✓ Confirmation: What you verified
- ✓ Context check: What surrounding code or repo context you examined
- ✓ Pattern check: Whether you searched for existing solutions
- ✓ Impact assessment: Concrete consequences of the issue
- ✓ Severity justification: Why this specific severity level

# CRITICAL RULES
1. Only flag NEW issues in added lines (marked with +)
2. Include confidence (high/medium/low) and reasoning for EVERY finding
3. Use exact line numbers from diff for line-specific findings
4. Use flexible attribution based on issue scope:
   - **Line-specific**: Include both file and line number
   - **File-level**: Include file but omit line number
   - **General/PR-level**: Omit both file and line (architectural concerns)
5. Additive passes increase attention and context, but do NOT restrict findings to a narrow category
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

Before reporting ANY finding, you must challenge yourself with these questions:

1. **"Could this be intentional?"**
   → Example: Error swallowing in retry logic, intentional for resilience

2. **"Is this validated elsewhere?"**
   → Example: Input validation at API gateway layer, not application code

3. **"Is this test/mock/development code?"**
   → Different standards apply (shortcuts acceptable in tests)

4. **"Is there missing context?"**
   → Example: Framework magic (Next.js auto-imports, React conventions)

5. **"Would a senior engineer flag this?"**
   → Gut check: Is this substantive or nitpicking?

6. **"Is this actually architectural?"** (for cross-file issues)
   → Example: Issue might be file-level, not system-level

## Attribution Rules
- **Line-specific**: Include both file and line number
- **File-level**: Include file and omit line number
- **General/PR-level**: Omit both file and line

## Counter-Argument Documentation

For findings that could be questioned, document your self-challenge in the reasoning:

Counter-Argument Considered:
"Could this be intentional or handled elsewhere?"

Rebuttal:
"Explain what context you checked and why the concern still stands."

Decision:
Report only if the issue remains material after the challenge above.

${buildFastReviewOutputFormat()}
`;
}
