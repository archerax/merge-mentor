import type { FileReviewResult, PRDetails } from "../../../platforms/types.js";
import type { DiffManifest } from "../../../review/diffStorage.js";
import { buildSecurityPreamble, wrapUntrustedPRMetadata } from "../securityPreamble.js";
import { buildSeverityContextSection } from "../severityContext.js";

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
  repoPath?: string
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

  const workspaceSection = buildWorkspaceSection(repoPath);

  return `${buildSecurityPreamble()}# YOUR ROLE
Expert code reviewer analyzing changes. Be thorough and strict in catching issues.
${workspaceSection}
# TASK
Review ALL files listed below. Each file's diff is stored separately - read using @filename syntax.

Files to Review:
${filesListing}
${commentsSection}
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

# OUTPUT FORMAT

1. ANALYSIS: Document your analysis step-by-step
2. JSON: Strict format in markdown code block

\`\`\`json
{
  "file_results": {
    "path/to/file.ts": {
      "findings": [
        {
          "line": 45,
          "severity": "high",
          "confidence": "high",
          "category": "bug",
          "message": "Clear description of the problem",
          "suggestion": "Specific fix with code example",
          "reasoning": "Complete verification including data flow, impact, and severity justification",
          "isPreExisting": false
        }
      ]
    }
  }
}
\`\`\`

REMEMBER: Include entry for EVERY file listed, even with empty findings.
`;
}

/**
 * Builds a prompt for general cross-file analysis.
 * Focuses on architectural and system-level concerns across multiple files.
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

  const commentsSection = existingCommentsContext
    ? `\nEXISTING PR COMMENTS:\n${existingCommentsContext}\n\nIMPORTANT: Be aware of issues already flagged. Focus on NEW system-level concerns not already covered.\n`
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

# OUTPUT FORMAT

Provide a complete cross-file analysis in JSON format:

\`\`\`json
{
  "findings": [
    {
      "severity": "high",
      "confidence": "high",
      "category": "architecture",
      "message": "Clear description of cross-file issue",
      "affectedFiles": ["file1.ts", "file2.ts"],
      "reasoning": "Detailed verification of cross-file impact with evidence"
    }
  ],
  "overallAssessment": "Brief summary of PR quality and architecture",
  "recommendations": [
    "Actionable improvement suggestions"
  ]
}
\`\`\`

Focus on system-level concerns: integration issues, architectural inconsistencies, cross-cutting concerns.
`;
}
