import type { FileReviewResult, PRDetails } from "../../../platforms/types.js";
import type { DiffManifest } from "../../../review/diffStorage.js";
import type { GeneralReviewPhase } from "../../../review/reviewSelection.js";
import {
  buildSecurityPreamble,
  wrapUntrustedExistingComments,
  wrapUntrustedPRMetadata,
} from "../securityPreamble.js";
import { buildSeverityContextSection } from "../severityContext.js";
import {
  buildBatchedFileResultsOutputFormat,
  buildCrossFileOutputFormat,
} from "./outputFormats.js";

/**
 * Builds a workspace access section for prompts.
 */
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

const FILE_REVIEW_PHASE_DETAILS: Record<
  GeneralReviewPhase,
  {
    readonly analysisLines: readonly string[];
    readonly approach: string;
    readonly reportItems: readonly string[];
  }
> = {
  scan: {
    analysisLines: [
      "- Suspicious diff patterns and incomplete edits",
      "- Inconsistent changes across nearby code paths",
      "- Maintainability risks with concrete impact on future changes",
    ],
    approach:
      "Suspicious diff patterns, incomplete edits, and risky inconsistencies introduced by the PR",
    reportItems: [
      "**Diff risks**: Incomplete refactors, inconsistent changes, or suspicious edits with concrete maintainability impact",
    ],
  },
  security: {
    analysisLines: [
      "- Authentication and authorization boundaries",
      "- Input validation and trust-boundary enforcement",
      "- Data exposure, secrets handling, and injection risks",
    ],
    approach:
      "Authentication, authorization, validation, and data-exposure issues with concrete risk",
    reportItems: [
      "**Security**: Credible vulnerabilities, trust-boundary mistakes, or data exposure with a realistic exploit or failure path",
    ],
  },
  logic: {
    analysisLines: [
      "- Edge cases and missing guards",
      "- Error propagation and failure behavior",
      "- State transitions, contracts, and integration correctness",
    ],
    approach: "Correctness, error propagation, state transitions, and contract compatibility",
    reportItems: [
      "**Correctness**: Broken edge cases, missing guards, invalid state transitions, or incorrect data flow",
      "**Contracts**: Type-safety, error propagation, or compatibility issues likely to break runtime behavior or callers",
    ],
  },
  performance: {
    analysisLines: [
      "- Algorithmic complexity and repeated work",
      "- Resource leak risks and unnecessary allocations",
      "- Scalability concerns in changed code paths",
    ],
    approach: "Algorithmic efficiency, repeated work, resource leaks, and scalability concerns",
    reportItems: [
      "**Performance**: Measurable inefficiency, unbounded work, or leak risk in changed code paths",
    ],
  },
  monorepo: {
    analysisLines: [
      "- Package boundary violations and private cross-package imports",
      "- Workspace dependency placement and package ownership",
      "- Shared tooling/config duplication across packages",
    ],
    approach:
      "Package boundaries, workspace dependency hygiene, shared tooling, and package ownership",
    reportItems: [
      "**Monorepo hygiene**: Boundary violations, dependency leakage, or workspace-ownership issues that can break builds or contracts",
    ],
  },
};

const CROSS_FILE_PHASE_DETAILS: Record<GeneralReviewPhase, string> = {
  scan: "Suspicious cross-file patterns, incomplete refactors, and inconsistent changes introduced by the PR",
  security:
    "Authentication boundaries, validation consistency, data exposure, and trust boundaries with concrete risk",
  logic:
    "Data flow, state management, error propagation, and integration correctness across changed files",
  performance:
    "Algorithmic complexity, caching, resource usage, database access, and scalability risks with concrete system impact",
  monorepo:
    "Package boundaries, dependency graph hygiene, shared tooling conventions, and workspace structure",
};

function buildSelectedPhasesSection(selectedPhases?: readonly GeneralReviewPhase[]): string {
  if (!selectedPhases || selectedPhases.length === 0) {
    return "";
  }

  return `
# SELECTED REVIEW PHASES
Use ONLY these configured phases in this exact order. Do not expand into omitted phases.
${selectedPhases.map((phase, index) => `${index + 1}. ${phase}`).join("\n")}
`;
}

function buildCustomFileReviewAnalysisStructure(
  selectedPhases: readonly GeneralReviewPhase[]
): string {
  const phaseSections = selectedPhases
    .map((phase, index) => {
      const details = FILE_REVIEW_PHASE_DETAILS[phase].analysisLines.join("\n");
      return `## Pass ${index + 1}: ${phase}\n${details}`;
    })
    .join("\n\n");

  return `Think through these selected passes internally before finalizing findings:

${phaseSections}

Only return findings after all selected passes are complete.`;
}

function buildCustomReviewApproach(selectedPhases: readonly GeneralReviewPhase[]): string {
  return `Perform only the configured passes below:
${selectedPhases
  .map((phase, index) => `${index + 1}. **${phase}**: ${FILE_REVIEW_PHASE_DETAILS[phase].approach}`)
  .join("\n")}

Prefer high-confidence, actionable findings. Do not expand into omitted phases or report speculative style feedback.`;
}

function buildCustomAlwaysReport(selectedPhases: readonly GeneralReviewPhase[]): string {
  const items = new Set<string>();

  for (const phase of selectedPhases) {
    for (const item of FILE_REVIEW_PHASE_DETAILS[phase].reportItems) {
      items.add(item);
    }
  }

  return Array.from(items)
    .map((item) => `- ${item}`)
    .join("\n");
}

function buildCustomCrossFileChecklist(selectedPhases: readonly GeneralReviewPhase[]): string {
  return selectedPhases
    .map((phase) => `- **${phase}**: ${CROSS_FILE_PHASE_DETAILS[phase]}`)
    .join("\n");
}

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

/**
 * Context for general cross-file analysis.
 */
export interface GeneralCrossFileContext {
  readonly filesSummary: string;
  readonly fileReviewResults: readonly FileReviewResult[];
  readonly existingCommentsContext?: string;
}

/**
 * Builds a prompt for general file review.
 * This is the standard code review covering all aspects: bugs, security, performance, and quality.
 */
export function buildGeneralFileReviewPrompt(
  manifest: DiffManifest,
  existingCommentsContext?: string,
  repoPath?: string,
  selectedPhases?: readonly GeneralReviewPhase[]
): string {
  const isCustomReview = !!selectedPhases?.length;
  const diffPrefix = repoPath ? ".mergementor/diffs/" : "";
  const filesListing = manifest.files
    .map(
      (f) =>
        `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) → @${diffPrefix}${f.diffPath}`
    )
    .join("\n");

  const commentsSection = buildExistingCommentsSection(
    "# EXISTING PR COMMENTS",
    existingCommentsContext,
    "Be aware of issues already flagged. Focus on NEW issues not already covered."
  );

  const workspaceSection = buildWorkspaceSection(repoPath);
  const selectedPhasesSection = buildSelectedPhasesSection(selectedPhases);
  const analysisStructure = selectedPhases
    ? buildCustomFileReviewAnalysisStructure(selectedPhases)
    : `Before providing JSON, document your analysis:

## Pass 1: Surface Scan
Line-by-line observations of suspicious patterns

## Pass 2: Security Deep Dive
- Authentication/authorization analysis
- Input validation completeness
- Data exposure risks

## Pass 3: Logic Analysis
- Edge case handling
- Error path completeness
- State management correctness

## Pass 4: Performance Review
- Algorithmic complexity
- Resource leak risks
- Scalability concerns

## Findings Summary
Only after completing all passes above, list findings.`;
  const reviewApproach = selectedPhases
    ? buildCustomReviewApproach(selectedPhases)
    : `Perform multiple mental passes through each file:
1. **Logic**: Correctness, edge cases, error handling
2. **Security**: Injection flaws, authentication, data exposure
3. **Performance**: Algorithmic efficiency, memory leaks
4. **Quality**: Clean code principles, maintainability

Consider: null/undefined, empty arrays, boundary values, concurrent access, "what could go wrong" scenarios`;
  const reportingBar = selectedPhases
    ? buildCustomAlwaysReport(selectedPhases)
    : `- **Bugs**: Logic errors, race conditions, unhandled edge cases, off-by-one errors
- **Security**: Any potential vulnerability, no matter how small
- **Best practices**: var instead of let/const, magic numbers, poor naming
- **Code quality**: Functions doing too much, duplicate code, unnecessary complexity
- **Type safety**: Missing type annotations, unsafe assertions (any, as unknown)
- **Error handling**: Missing try-catch, unhandled promises, silent failures
- **Performance**: Algorithmic inefficiency, memory leaks, N+1 queries
- **Breaking changes**: API incompatibilities, contract violations`;
  const roleDescription = isCustomReview
    ? "Expert code reviewer analyzing changes. Focus on material, actionable issues within the selected review phases."
    : "Expert code reviewer analyzing changes. Be thorough and strict in catching issues.";
  const verificationSection = isCustomReview
    ? `# VERIFICATION

Before reporting any finding, verify:

- Issue exists in ADDED lines (+), not removed lines (-)
- Nearby context or the diff does not already handle it
- The finding clearly belongs to one of the selected phases
- Severity matches the concrete impact
- If you claim a missing shared guard or inconsistent pattern, confirm it against the repository when workspace access is enabled

For EACH finding, keep reasoning concise:

- 1-2 sentences only
- Cite the changed code or checked context
- State the concrete impact
- Do NOT include step-by-step analysis or counter-arguments`
    : `# VERIFICATION CHECKLIST

Before reporting any finding, complete this mandatory verification:

□ Issue exists in ADDED lines (+), not removed lines (-)
□ Line number is correct and points to actual problem code
□ Issue isn't handled elsewhere in the diff (checked context lines)
□ Suggestion actually fixes the root cause (not just masking symptoms)
□ Issue isn't a false positive from missing context
□ Severity matches the actual impact (not over/under-rated)

## Verification Documentation Requirements

For EACH finding, your reasoning field must include verification notes.

**Required verification elements:**
- ✓ Confirmation: What you verified ("Confirmed line X has Y")
- ✓ Context check: What surrounding code you examined
- ✓ Pattern check: Whether you searched for existing solutions
- ✓ Impact assessment: Concrete consequences of the issue
- ✓ Severity justification: Why this specific severity level

**Example of proper verification in reasoning:**

    ✓ Confirmed line 45: users[index] access without bounds check
    ✓ Scanned lines 40-50: no validation present for index parameter
    ✓ Checked context: index comes from req.query.id (user-controlled input)
    ✓ Impact: Runtime TypeError crashes server if index >= users.length
    ✓ Severity justification: high (production crash risk from user input)`;
  const criticalRules = isCustomReview
    ? `1. Only flag NEW issues in added lines (marked with +)
2. Include confidence (high/medium/low) and concise reasoning for EVERY finding
3. Use exact line numbers from diff - they're pre-calculated
4. Return results for ALL files, even if no findings
5. Restrict findings to the configured SELECTED REVIEW PHASES above
6. Prefer high-confidence, actionable findings over exhaustive coverage
7. Use only these categories: ${FILE_REVIEW_ALLOWED_CATEGORIES.join(", ")}${existingCommentsContext ? "\n8. AVOID duplicating issues in EXISTING COMMENTS above" : ""}`
    : `1. Only flag NEW issues in added lines (marked with +)
2. Include confidence (high/medium/low) and reasoning for EVERY finding
3. Use exact line numbers from diff - they're pre-calculated
4. Return results for ALL files, even if no findings
${existingCommentsContext ? "5. AVOID duplicating issues in EXISTING COMMENTS above" : ""}`;
  const reportingHeader = isCustomReview ? "# REPORTING BAR" : "# ALWAYS REPORT";
  const neverReport = isCustomReview
    ? `- **Formatting**: Whitespace, indentation, or auto-formatting output
- **Pure style nits**: Naming, magic numbers, or preferences without concrete impact
- **Speculation**: Concerns without enough code evidence or checked context
- **Out-of-scope issues**: Findings outside the selected phases
- **Existing issues**: Problems in removed lines (-) unless marking as pre-existing`
    : `- **Formatting**: Whitespace, indentation (if project has auto-formatter)
- **Syntax errors**: Assume all code compiles successfully  
- **Unfamiliar features**: Don't flag language constructs you don't recognize
- **Obvious documentation**: Getters/setters, self-explanatory functions
- **Subjective opinions**: Personal preferences without concrete rationale
- **Existing issues**: Problems in removed lines (-) unless marking as pre-existing`;
  const signalSection = isCustomReview
    ? `# SIGNAL BAR

Prefer no finding over speculative feedback.

Skip anything that is:
- ambiguous without stronger evidence
- purely stylistic
- already covered in local context or existing comments
- not material enough that a senior reviewer would raise it`
    : `# SELF-CHALLENGE REQUIREMENT

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

## Counter-Argument Documentation

For findings that could be questioned, document your self-challenge in the reasoning:

**Example 1 - Report After Challenge:**

Finding: "Missing try-catch around database call"

Counter-Argument Considered:
"This could be handled by a transaction wrapper or middleware"

Rebuttal:
"✓ Checked codebase: No transaction wrapper exists (@workspace /search transaction wrapper)
✓ Verified pattern: Other DB calls in src/data/ all use explicit try-catch (checked 8 files)
✓ This is inconsistent with established pattern"

Decision: ✅ **Report** (pattern violation confirmed)

**Example 2 - Skip After Challenge:**

Finding: "Magic number 3600 should be constant"

Counter-Argument Considered:
"This is clearly seconds-per-hour, universally understood"

Rebuttal:
"✓ Verified: 3600 is universally known constant (seconds per hour)
✓ Context: Used once, meaning obvious from variable name
✓ Pattern check: No SECONDS_PER_HOUR constant elsewhere in codebase"

Decision: ❌ **Don't report** (universally understood constant)`;

  return `${buildSecurityPreamble()}# YOUR ROLE
${roleDescription}
${workspaceSection}
# TASK
Review ALL files listed below. Each file's diff is stored separately - read using @filename syntax.

Files to Review:
${filesListing}
${commentsSection}
${selectedPhasesSection}
# MANDATORY ANALYSIS STRUCTURE

${analysisStructure}

${verificationSection}

# CRITICAL RULES
${criticalRules}

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
${reviewApproach}

${reportingHeader}
${reportingBar}

# NEVER REPORT
${neverReport}

# LINE NUMBERS (PRE-CALCULATED)
Diff format: [+/-/SPACE][NUMBER] | CODE
- Use NUMBER directly from added lines (+)
- Example: "+ 159 | const x = 1" → report line 159
- No counting needed - numbers are ready to use!

${signalSection}

${buildBatchedFileResultsOutputFormat({
  analysisInstruction: isCustomReview
    ? "Think through the selected passes internally; do not include your analysis in the response"
    : "Document your analysis step-by-step",
  severityExample: "high",
  categoryExample: "bug",
  messageExample: "Clear description of the problem",
  suggestionExample: "Specific fix with code example",
  reasoningExample: isCustomReview
    ? "Concise rationale citing the changed code or checked context and the concrete impact"
    : "Complete verification including data flow, impact, and severity justification",
  footer: isCustomReview
    ? `Return ONLY the JSON code block. Use only these categories: ${FILE_REVIEW_ALLOWED_CATEGORIES.join(", ")}. Include entry for EVERY file listed, even with empty findings.`
    : "REMEMBER: Include entry for EVERY file listed, even with empty findings.",
})}
`;
}

/**
 * Builds a prompt for general cross-file analysis.
 * Focuses on architectural and system-level concerns across multiple files.
 */
export function buildGeneralCrossFilePrompt(
  prDetails: PRDetails,
  context: GeneralCrossFileContext,
  repoPath?: string,
  selectedPhases?: readonly GeneralReviewPhase[]
): string {
  const isCustomReview = !!selectedPhases?.length;
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
  const selectedPhasesSection = buildSelectedPhasesSection(selectedPhases);
  const analysisChecklist = selectedPhases
    ? buildCustomCrossFileChecklist(selectedPhases)
    : `- Error handling: Consistent propagation? Missing try-catch patterns?
- State management: Race conditions? Inconsistent state updates across files?
- Data flow: Complete path from input to output? Missing cross-file validations?
- Dependencies: Circular dependencies? Tight coupling between modules?
- Testing: Integration points covered? Critical paths testable?
- Security: Authentication/authorization consistent? Input validation complete?`;
  const roleDescription = isCustomReview
    ? "Expert code reviewer performing holistic analysis of changed files. Focus on material cross-file concerns within the selected review phases."
    : "Expert code reviewer performing holistic architectural analysis of a pull request.";
  const criticalRules = isCustomReview
    ? `1. ONLY analyze files in the Changed Files list above - ignore any files mentioned in PR description that aren't actually changed
2. Do NOT duplicate issues already caught in individual file reviews
3. Include confidence (high/medium/low) and concise reasoning for EVERY finding
4. Focus on system-level and architectural concerns, not individual file issues
5. Restrict findings to the configured SELECTED REVIEW PHASES above
6. Prefer high-confidence, actionable findings over exhaustive coverage
7. Use only these categories: ${CROSS_FILE_ALLOWED_CATEGORIES.join(", ")}`
    : `1. ONLY analyze files in the Changed Files list above - ignore any files mentioned in PR description that aren't actually changed
2. Do NOT duplicate issues already caught in individual file reviews
3. Include confidence (high/medium/low) and reasoning for EVERY finding
4. Focus on system-level and architectural concerns, not individual file issues
${selectedPhases ? "5. Restrict findings to the configured SELECTED REVIEW PHASES above" : ""}`;
  const verificationSection = isCustomReview
    ? `# VERIFICATION

Before reporting any cross-file finding, verify:

- The issue spans multiple changed files
- It is new to this PR, not pre-existing architectural debt
- It is not already covered in individual file reviews
- The finding belongs to one of the selected phases
- Severity matches the concrete system impact

For EACH finding, keep reasoning concise:

- 1-2 sentences only
- Cite the affected files or checked system context
- State the concrete system impact
- Do NOT include step-by-step analysis or counter-arguments`
    : `# VERIFICATION CHECKLIST

Before reporting any cross-file finding, complete this mandatory verification:

□ Issue spans multiple files (not a single-file concern)
□ Issue is NEW to this PR (not pre-existing architectural debt)
□ Issue isn't already covered in individual file reviews
□ All affected files are actually in the Changed Files list
□ Impact is architectural/system-level (not isolated)
□ Severity matches cross-file impact (consider system-wide consequences)

## Verification Documentation Requirements

For EACH finding, your reasoning field must include verification notes.

**Required verification elements:**
- ✓ Cross-file confirmation: Which files you verified and how they're connected
- ✓ System impact: How the issue affects overall architecture
- ✓ Pattern check: Whether similar patterns exist elsewhere
- ✓ Integration verification: How components interact incorrectly
- ✓ Severity justification: Why this matters at the system level

**Example of proper verification in reasoning:**

    ✓ Confirmed: AuthMiddleware.ts adds check, but AdminRoutes.ts bypasses it
    ✓ Verified integration: AdminRoutes imports but doesn't use the middleware
    ✓ Pattern check: All other route files (UserRoutes, OrderRoutes) use middleware correctly
    ✓ System impact: Admin endpoints lack authentication, allowing unauthorized access
    ✓ Severity justification: high (security boundary violated across modules)`;
  const analysisHeader = isCustomReview
    ? "# INTERNAL REVIEW PASSES"
    : "# SYSTEMATIC ANALYSIS CHECKLIST";
  const signalSection = isCustomReview
    ? `# SIGNAL BAR

Prefer no finding over speculative architectural feedback.

Skip anything that is:
- already explained by the changed-file findings
- not clearly cross-file in nature
- outside the selected phases
- too weak for an experienced reviewer to raise`
    : `# SELF-CHALLENGE REQUIREMENT

Before reporting ANY finding, you must challenge yourself with these questions:

1. **"Could this be intentional design?"**
   → Example: Loose coupling might look like "missing integration" but could be deliberate

2. **"Is this validated/handled elsewhere in the system?"**
   → Example: Input validation might exist in API gateway, not application layer

3. **"Is there architectural context I'm missing?"**
   → Example: Framework conventions (dependency injection, middleware patterns)

4. **"Is this actually a system-level concern?"**
   → Example: Issue might be file-level, not architectural

5. **"Would an experienced architect agree this is a problem?"**
   → Gut check: Is this substantive architectural concern or minor coupling?

## Counter-Argument Documentation

For findings that could be questioned, document your self-challenge:

**Example 1 - Report After Challenge:**

Finding: "Missing error handling coordination across service boundaries"

Counter-Argument Considered:
"Could be handled by API gateway or middleware layer"

Rebuttal:
"✓ Checked: No API gateway in this project (monolithic architecture)
✓ Verified: Middleware in src/middleware/ handles only authentication, not errors
✓ Pattern analysis: Other service integrations (PaymentService, NotificationService) have explicit error handling
✓ This service integration is inconsistent with established pattern"

Decision: ✅ **Report** (architectural inconsistency confirmed)

**Example 2 - Skip After Challenge:**

Finding: "Tight coupling between UserController and UserService"

Counter-Argument Considered:
"This might be standard Controller-Service pattern"

Rebuttal:
"✓ Reviewed: This IS the standard Controller-Service pattern used throughout
✓ Pattern check: All controllers follow this pattern (checked 12 files)
✓ No architectural violation - this is the intended design"

Decision: ❌ **Don't report** (standard pattern confirmed)`;

  return `${buildSecurityPreamble()}# YOUR ROLE
${roleDescription}
${workspaceSection}
# PR CONTEXT
${wrapUntrustedPRMetadata(prDetails.title, prDetails.description)}

Changed Files:
${filesSummary}

Individual File Findings:
${findingsSummary || "No individual issues found"}
${commentsSection}
${selectedPhasesSection}
# CRITICAL RULES
${criticalRules}

${verificationSection}

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

${analysisHeader}
${analysisChecklist}

${signalSection}

${buildCrossFileOutputFormat({
  intro: isCustomReview
    ? "Think through the selected passes internally, then return ONLY a complete cross-file analysis in JSON format:"
    : "Provide a complete cross-file analysis in JSON format:",
  severityExample: "high",
  categoryExample: "architecture",
  messageExample: "Clear description of cross-file issue",
  reasoningExample: isCustomReview
    ? "Concise rationale citing the affected files, checked context, and the concrete system impact"
    : "Detailed verification of cross-file impact with evidence",
  overallAssessmentExample: "Brief summary of PR quality and architecture",
  recommendationExample: "Actionable improvement suggestions",
  footer: isCustomReview
    ? `Return ONLY the JSON code block. Use only these categories: ${CROSS_FILE_ALLOWED_CATEGORIES.join(", ")}. Focus on system-level concerns introduced by the selected phases.`
    : "Focus on system-level concerns: integration issues, architectural inconsistencies, cross-cutting concerns.",
})}
`;
}
