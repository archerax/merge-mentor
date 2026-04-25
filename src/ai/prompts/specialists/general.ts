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

const FILE_REVIEW_PASS_DETAILS: Record<
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
      "- Trust boundaries, auth/authz, and secret handling",
      "- Input validation, sanitization, and exploit paths",
      "- Data exposure and unsafe execution or deserialization risks",
    ],
    approach:
      "Security-team lens: re-check trust boundaries, validation, and exploitability without narrowing what may be reported",
    reportItems: [
      "**Security lens**: Issues made more visible by closely checking trust boundaries, validation, secrets, and realistic exploit paths",
    ],
  },
  logic: {
    analysisLines: [
      "- Edge cases and missing guards",
      "- Error propagation and failure behavior",
      "- State transitions, contracts, and integration correctness",
    ],
    approach:
      "Correctness-team lens: revisit contracts, edge cases, and failure behavior for subtle breakage",
    reportItems: [
      "**Correctness**: Broken edge cases, missing guards, invalid state transitions, or incorrect data flow",
    ],
  },
  performance: {
    analysisLines: [
      "- Algorithmic complexity and repeated work",
      "- Resource leak risks and unnecessary allocations",
      "- Scalability concerns in changed code paths",
    ],
    approach:
      "Performance-team lens: re-check complexity, repeated work, memory, I/O, and scalability risks",
    reportItems: [
      "**Performance lens**: N+1 queries, repeated work, resource leaks, unbounded loops, or latency-amplifying changes",
    ],
  },
  monorepo: {
    analysisLines: [
      "- Package boundary violations and private cross-package imports",
      "- Workspace dependency placement and package ownership",
      "- Shared tooling/config duplication across packages",
    ],
    approach:
      "Monorepo-team lens: revisit workspace boundaries, dependency placement, and shared tooling conventions",
    reportItems: [
      "**Monorepo hygiene**: Boundary violations, dependency leakage, or workspace-ownership issues that can break builds or contracts",
    ],
  },
  testing: {
    analysisLines: [
      "- Missing or weak tests for changed behavior",
      "- Test quality issues such as weak assertions or flaky patterns",
      "- Production-code testability problems that make meaningful tests hard to write",
    ],
    approach:
      "Testing-team lens: revisit coverage, test quality, and testability while still reporting any material baseline issue",
    reportItems: [
      "**Testing lens**: Missing coverage, brittle tests, or testability issues that increase regression risk",
    ],
  },
  database: {
    analysisLines: [
      "- Query correctness, transaction boundaries, and consistency risks",
      "- Migration or schema-change safety, nullability, and rollback concerns",
      "- Indexing, batching, locking, and data-access scalability issues",
    ],
    approach:
      "Database-team lens: revisit migrations, transactions, data consistency, and query access patterns",
    reportItems: [
      "**Database lens**: Migration safety, transaction correctness, data integrity, query efficiency, or locking concerns",
    ],
  },
};

const CROSS_FILE_PASS_DETAILS: Record<GeneralReviewPhase, string> = {
  scan: "Suspicious cross-file patterns, incomplete refactors, and inconsistent changes introduced by the PR",
  security:
    "Trust-boundary consistency, auth/authz coverage, validation gaps, data exposure, and exploit paths across files",
  logic:
    "Data flow, state management, error propagation, and contract compatibility across changed files",
  performance:
    "Algorithmic complexity, caching, resource usage, database access, and scalability risks with concrete system impact",
  monorepo:
    "Package boundaries, dependency graph hygiene, shared tooling conventions, and workspace structure",
  testing:
    "Coverage consistency, integration-test gaps, flaky patterns, and testability across the changed files",
  database:
    "Schema/query consistency, transaction coverage, migration impact, and data-integrity risks across files",
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

function buildAdditionalFilePassAnalysis(selectedPasses?: readonly GeneralReviewPhase[]): string {
  if (!selectedPasses || selectedPasses.length === 0) {
    return "";
  }

  return `
## Additional Focused Passes
${selectedPasses
  .map((phase, index) => {
    const details = FILE_REVIEW_PASS_DETAILS[phase].analysisLines.join("\n");
    return `### Additive Pass ${index + 1}: ${phase}\n${details}`;
  })
  .join("\n\n")}

After running the additional passes above, merge the strongest findings into one final result set.`;
}

function buildAdditionalReviewApproach(selectedPasses?: readonly GeneralReviewPhase[]): string {
  if (!selectedPasses || selectedPasses.length === 0) {
    return "";
  }

  return `
## Additional Pass Approach
${selectedPasses
  .map((phase, index) => `${index + 1}. **${phase}**: ${FILE_REVIEW_PASS_DETAILS[phase].approach}`)
  .join("\n")}
`;
}

function buildAdditionalReportFocus(selectedPasses?: readonly GeneralReviewPhase[]): string {
  if (!selectedPasses || selectedPasses.length === 0) {
    return "";
  }

  const items = new Set<string>();

  for (const phase of selectedPasses) {
    for (const item of FILE_REVIEW_PASS_DETAILS[phase].reportItems) {
      items.add(item);
    }
  }

  return `
## Additional Pass Focus
${Array.from(items)
  .map((item) => `- ${item}`)
  .join("\n")}
`;
}

function buildAdditionalCrossFileChecklist(selectedPasses?: readonly GeneralReviewPhase[]): string {
  if (!selectedPasses || selectedPasses.length === 0) {
    return "";
  }

  return `
## Additional Pass Checklist
${selectedPasses.map((phase) => `- **${phase}**: ${CROSS_FILE_PASS_DETAILS[phase]}`).join("\n")}
`;
}

function buildAdditionalContextSections(additionalContextSections?: readonly string[]): string {
  if (!additionalContextSections || additionalContextSections.length === 0) {
    return "";
  }

  return `\n${additionalContextSections.join("\n\n")}\n`;
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

export interface GeneralCrossFileContext {
  readonly filesSummary: string;
  readonly fileReviewResults: readonly FileReviewResult[];
  readonly existingCommentsContext?: string;
}

export function buildGeneralFileReviewPrompt(
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

  const commentsSection = buildExistingCommentsSection(
    "# EXISTING PR COMMENTS",
    existingCommentsContext,
    "Be aware of issues already flagged. Focus on NEW issues not already covered."
  );

  return `${buildSecurityPreamble()}# YOUR ROLE
Expert code reviewer analyzing changes. Baseline review is always active. If additive passes are configured below, treat them like extra specialist reviewers giving the same diff another close read.
${buildWorkspaceSection(repoPath)}
# TASK
Review ALL files listed below. Each file's diff is stored separately - read using @filename syntax.

Files to Review:
${filesListing}
${commentsSection}
${buildSelectedPassesSection(selectedPasses)}${buildAdditionalContextSections(additionalContextSections)}
# MANDATORY ANALYSIS STRUCTURE

Before providing JSON, document your analysis:

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
${buildAdditionalFilePassAnalysis(selectedPasses)}

## Findings Summary
Only after completing all passes above, list findings.

# VERIFICATION CHECKLIST

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
    ✓ Severity justification: high (production crash risk from user input)

# CRITICAL RULES
1. Only flag NEW issues in added lines (marked with +)
2. Include confidence (high/medium/low) and reasoning for EVERY finding
3. Use exact line numbers from diff - they're pre-calculated
4. Return results for ALL files, even if no findings
5. Additive passes increase attention and context, but do NOT restrict findings to a narrow category
${existingCommentsContext ? "6. AVOID duplicating issues in EXISTING COMMENTS above" : ""}

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
${buildAdditionalReviewApproach(selectedPasses)}

# ALWAYS REPORT
- **Bugs**: Logic errors, race conditions, unhandled edge cases, off-by-one errors
- **Security**: Any potential vulnerability, no matter how small
- **Best practices**: var instead of let/const, magic numbers, poor naming
- **Code quality**: Functions doing too much, duplicate code, unnecessary complexity
- **Type safety**: Missing type annotations, unsafe assertions (any, as unknown)
- **Error handling**: Missing try-catch, unhandled promises, silent failures
- **Performance**: Algorithmic inefficiency, memory leaks, N+1 queries
- **Breaking changes**: API incompatibilities, contract violations
${buildAdditionalReportFocus(selectedPasses)}

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

Decision: ❌ **Don't report** (universally understood constant)

${buildBatchedFileResultsOutputFormat({
  analysisInstruction: "Document your analysis step-by-step",
  severityExample: "high",
  categoryExample: "bug",
  messageExample: "Clear description of the problem",
  suggestionExample: "Specific fix with code example",
  reasoningExample: "Complete verification including data flow, impact, and severity justification",
  footer: `Return ONLY the JSON code block. Use only these categories: ${FILE_REVIEW_ALLOWED_CATEGORIES.join(", ")}. Include entry for EVERY file listed, even with empty findings.`,
})}
`;
}

export function buildGeneralCrossFilePrompt(
  prDetails: PRDetails,
  context: GeneralCrossFileContext,
  repoPath?: string,
  selectedPasses?: readonly GeneralReviewPhase[],
  additionalContextSections?: readonly string[]
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
Expert code reviewer performing holistic architectural analysis of a pull request. Baseline cross-file review is always active. If additive passes are configured, treat them like extra specialist reviewers giving the changed files another focused read.
${workspaceSection}
# PR CONTEXT
${wrapUntrustedPRMetadata(prDetails.title, prDetails.description)}

Changed Files:
${filesSummary}

Individual File Findings:
${findingsSummary || "No individual issues found"}
${commentsSection}
${buildSelectedPassesSection(selectedPasses)}${buildAdditionalContextSections(additionalContextSections)}
# CRITICAL RULES
1. ONLY analyze files in the Changed Files list above - ignore any files mentioned in PR description that aren't actually changed
2. Do NOT duplicate issues already caught in individual file reviews
3. Include confidence (high/medium/low) and reasoning for EVERY finding
4. Focus on system-level and architectural concerns, not individual file issues
5. Additive passes increase attention and context, but do NOT restrict findings to a narrow category

# VERIFICATION CHECKLIST

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
    ✓ Severity justification: high (security boundary violated across modules)

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
${buildAdditionalCrossFileChecklist(selectedPasses)}

# SELF-CHALLENGE REQUIREMENT

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

Decision: ❌ **Don't report** (standard pattern confirmed)

${buildCrossFileOutputFormat({
  intro: "Provide a complete cross-file analysis in JSON format:",
  severityExample: "high",
  categoryExample: "architecture",
  messageExample: "Clear description of cross-file issue",
  reasoningExample: "Detailed verification of cross-file impact with evidence",
  overallAssessmentExample: "Brief summary of PR quality and architecture",
  recommendationExample: "Actionable improvement suggestions",
  footer: `Return ONLY the JSON code block. Use only these categories: ${CROSS_FILE_ALLOWED_CATEGORIES.join(", ")}. Focus on system-level concerns across the changed files.`,
})}
`;
}
