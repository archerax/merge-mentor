import type { FileReviewResult, PRDetails, PRFile } from "../../platforms/types.js";
import type { DiffManifest } from "../../review/diffStorage.js";

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
    ? `\nEXISTING PR COMMENTS:\n${existingCommentsContext}\n\nIMPORTANT: Be aware of issues already flagged. Focus on NEW system-level concerns not already covered.\n`
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

  return `# YOUR ROLE
Expert code reviewer performing holistic architectural analysis of a pull request.
${repoContextSection}${workspaceSection}
# PR CONTEXT
Title: ${prDetails.title}
Description: ${prDetails.description || "No description provided"}

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

# EXAMPLES

✅ REPORT THIS:
Severity: high, Confidence: high
Message: "Auth middleware applied inconsistently - /api/users uses it but /api/admin routes bypass it"
Reasoning: "Security vulnerability where admin endpoints lack authentication that user endpoints have"

✅ REPORT THIS:
Severity: medium, Confidence: high  
Message: "Transaction management incomplete - database writes in OrderService lack rollback handling"
Reasoning: "Partial failures could leave database in inconsistent state across order and inventory tables"

❌ DON'T REPORT:
Message: "Consider adding unit tests"
Reason: Too vague, no specific gap identified

❌ DON'T REPORT:
Message: "Variable naming could be improved in UserService.ts"
Reason: Should be caught in individual file review, not architectural concern

# OUTPUT FORMAT

1. ANALYSIS: Think through architecture and integration risks step-by-step
2. JSON: Strict format in markdown code block

Example:
Analyzing the PR architecture, I notice the authentication flow spans three files...
The key risk is the inconsistent error handling pattern where...
\`\`\`json
{
  "overall_assessment": "Summary of PR quality and main concerns",
  "findings": [
    {
      "severity": "high",
      "confidence": "high",
      "category": "architecture",
      "message": "Clear description of the issue",
      "reasoning": "Why this is a problem and potential impact",
      "affected_files": ["file1.ts", "file2.ts"]
    }
  ],
  "recommendations": ["Specific actionable recommendation 1", "Specific actionable recommendation 2"]
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
  const filesListing = manifest.files
    .map((f) => `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) → @${f.diffPath}`)
    .join("\n");

  const commentsSection = existingCommentsContext
    ? `\n${existingCommentsContext}\n\nCRITICAL: Do NOT flag issues already mentioned above. Focus ONLY on NEW issues not yet covered.\n`
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

  return `# YOUR ROLE
Expert code reviewer analyzing changes. Be thorough and strict in catching issues.
${repoContextSection}${workspaceSection}
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

# EXAMPLES

✅ HIGH SEVERITY, HIGH CONFIDENCE - REPORT THIS:
Line: 45, Message: "Array access without bounds check"
Reasoning: "users[index] can throw if index >= users.length, causing runtime error"
Suggestion: "Add bounds check: if (index >= 0 && index < users.length)"

✅ MEDIUM SEVERITY, HIGH CONFIDENCE - REPORT THIS:
Line: 23, Message: "Use 'const' instead of 'let' for immutable variable"
Reasoning: "Variable 'result' is never reassigned, const prevents accidental mutation"
Suggestion: "Change 'let result = ...' to 'const result = ...'"

✅ HIGH SEVERITY, MEDIUM CONFIDENCE - REPORT THIS:
Line: 67, Message: "Potential race condition in async state update"
Reasoning: "Multiple async calls to setState without awaiting may cause state inconsistency"
Suggestion: "Use await or queue state updates"

❌ LOW CONFIDENCE, VAGUE - DON'T REPORT:
Message: "Consider refactoring this function"
Reason: Not specific, no clear issue identified

❌ FORMATTING ISSUE - DON'T REPORT:
Message: "Add blank line after function declaration"
Reason: Stylistic preference, not substantive

❌ UNFAMILIAR SYNTAX - DON'T REPORT:
Message: "This TypeScript syntax looks wrong"
Reason: Don't flag valid language features you don't recognize

# PRE-EXISTING ISSUES
- Focus on NEW issues in added lines (+)
- If issue exists in removed lines (-), set isPreExisting: true
- Only set isPreExisting: false for newly introduced issues

# OUTPUT FORMAT

1. ANALYSIS: Think step-by-step through logic, security, performance, quality
2. JSON: Strict format in markdown code block

Example:
Analyzing file1.ts: The authentication logic adds a new endpoint...
Key concern: Line 45 accesses array without bounds validation...
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
          "reasoning": "Runtime error if index out of bounds, user input not validated",
          "isPreExisting": false
        },
        {
          "line": 52,
          "severity": "medium",
          "confidence": "high",
          "category": "quality",
          "message": "Use 'const' instead of 'let' for immutable variable",
          "suggestion": "Change 'let result' to 'const result'",
          "reasoning": "Variable never reassigned, const prevents accidental mutation",
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
