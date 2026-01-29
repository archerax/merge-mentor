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
✓ Verified: All controllers follow this coupling pattern (OrderController, ProductController)
✓ Architecture check: This is intended design, not a violation"

Decision: ❌ **Don't report** (intentional architectural pattern)

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

## EXCELLENT - WITH CROSS-FILE VERIFICATION (REPORT THESE)

✅ EXAMPLE 1: Security Architecture Issue
Severity: high, Confidence: high
Message: "Authentication middleware bypassed in admin routes while enforced elsewhere"
Reasoning: "✓ Confirmed: AuthMiddleware.ts defines requireAuth() (line 15)
✓ Cross-file check: UserRoutes.ts uses requireAuth on all endpoints (lines 23, 45, 67)
✓ Integration verification: AdminRoutes.ts imports requireAuth but doesn't apply it (line 8 import, lines 20-35 missing)
✓ Pattern analysis: 3 of 4 route files use middleware correctly, AdminRoutes is the outlier
✓ Counter-argument: Could admin routes have separate auth mechanism?
✓ Rebuttal: Checked AdminRoutes.ts - no custom auth, just missing the middleware
✓ System impact: Admin endpoints (/api/admin/users, /api/admin/settings) lack authentication
✓ Severity justification: high (security boundary violation, unauthorized admin access possible)"
Affected files: ["src/routes/AdminRoutes.ts", "src/middleware/AuthMiddleware.ts"]

✅ EXAMPLE 2: Transaction Consistency Issue
Severity: high, Confidence: high
Message: "Incomplete transaction management across OrderService and InventoryService"
Reasoning: "✓ Confirmed: OrderService.ts creates order without transaction wrapper (line 78)
✓ Cross-file check: InventoryService.ts updates inventory in separate call (line 45)
✓ Integration verification: No shared transaction context between services
✓ Counter-argument: Could be using eventual consistency or message queue pattern?
✓ Rebuttal: No message queue imports, no async job handlers - direct synchronous calls
✓ Pattern analysis: PaymentService.ts uses proper transaction pattern (lines 34-52 show rollback handling)
✓ System impact: Order creation failure leaves inventory decremented, or vice versa
✓ Severity justification: high (data consistency violation, financial impact possible)"
Affected files: ["src/services/OrderService.ts", "src/services/InventoryService.ts"]

✅ EXAMPLE 3: State Management Issue
Severity: medium, Confidence: high
Message: "Inconsistent error state handling between UI components and data layer"
Reasoning: "✓ Confirmed: ApiClient.ts throws errors directly (line 67)
✓ Cross-file check: UserComponent.tsx catches but doesn't clear previous error state (line 89)
✓ Integration verification: Error persists across successful retries
✓ Counter-argument: Maybe component unmounts/remounts handle cleanup?
✓ Rebuttal: Component uses local state (useState), not cleared on prop changes
✓ Pattern analysis: ProductComponent.tsx handles this correctly (lines 45-50 show state reset)
✓ System impact: UI shows stale errors after successful operations
✓ Severity justification: medium (UX issue, confuses users but doesn't break functionality)"
Affected files: ["src/api/ApiClient.ts", "src/components/UserComponent.tsx"]

✅ EXAMPLE 4: Workspace Exploration Prevented False Positive
Initial concern: "Missing database connection pooling across services"
Verification process: "✓ Noticed: OrderService.ts creates new DB connection (line 23)
✓ Workspace search: @workspace /search 'connection pool'
✓ Found: src/config/database.ts exports connectionPool singleton
✓ Checked imports: Both OrderService and PaymentService import from database.ts
✓ Verified pattern: Connection is reused via singleton pattern
✓ Conclusion: Pooling IS implemented at config level, NOT an issue"
Result: "No finding reported - verification showed proper architecture"

✅ EXAMPLE 5: Low Confidence Cross-File Issue
Severity: medium, Confidence: low
Message: "Possible circular dependency between AuthService and UserService"
Reasoning: "✓ Confirmed: AuthService.ts imports UserService (line 5)
✓ Cross-file check: UserService.ts imports from auth/types.ts (line 8)
✓ Traced imports: types.ts doesn't import AuthService, so not circular
✓ Counter-argument: Types-only import doesn't create circular dependency
✓ Partial agreement: Technically correct, but runtime coupling still exists
✓ Uncertainty: Module bundler may still have issues, need build testing to confirm
✓ Pattern analysis: Similar pattern in PaymentService works fine
✓ System impact: May cause initialization order issues at runtime
✓ Confidence justification: low (technically not circular, but coupling is high)"
Affected files: ["src/services/AuthService.ts", "src/services/UserService.ts"]

✅ EXAMPLE 6: Integration Gap with Pre-Existing Context
Severity: high, Confidence: high
Message: "New feature breaks existing error handling contract"
Reasoning: "✓ Confirmed: NotificationService.ts now throws NotificationError (line 45)
✓ Cross-file check: Existing callers in UserController (line 234) and OrderController (line 156) catch generic Error
✓ Workspace search: @workspace /search 'catch.*Error' found 15 call sites
✓ Integration verification: New error type won't be caught by existing handlers
✓ System impact: Errors will bubble to global handler, causing 500 errors
✓ Severity justification: high (breaks existing error handling contract, production impact)"
Affected files: ["src/services/NotificationService.ts", "src/controllers/UserController.ts", "src/controllers/OrderController.ts"]

## WEAK - NO VERIFICATION (DON'T REPORT THESE)

❌ EXAMPLE 7: Vague Without Cross-File Analysis
Message: "Consider adding unit tests"
Reasoning: "Testing would improve quality"
Reason to reject: Not cross-file, too vague, no specific integration gap identified

❌ EXAMPLE 8: Single-File Concern
Message: "Variable naming could be improved in UserService.ts"
Reasoning: "Names should be more descriptive"
Reason to reject: Should be caught in individual file review, not architectural concern

❌ EXAMPLE 9: No Integration Verification
Message: "Services might not work together"
Reasoning: "Could cause problems"
Reason to reject: No verification performed, no specific integration issue identified

❌ EXAMPLE 10: Didn't Use Workspace to Verify Pattern
Message: "Missing shared configuration for timeouts"
Reasoning: "Each service has different timeout values"
Reason to reject: Didn't search workspace - @workspace /search 'timeout' would show src/config/timeouts.ts exists with shared values

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
  // When repoPath is provided, diffs are stored in .merge-mentor/diffs/ inside the repo
  // Use relative paths so Copilot CLI can access them from its workspace
  const diffPrefix = repoPath ? ".merge-mentor/diffs/" : "";
  const filesListing = manifest.files
    .map(
      (f) =>
        `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) → @${diffPrefix}${f.diffPath}`
    )
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
"✓ Agreed: 3600 = seconds per hour is common knowledge
✓ Not truly 'magic': The value is self-documenting
✓ Creating SECONDS_PER_HOUR constant adds no clarity"

Decision: ❌ **Don't report** (not substantive)

**Example 3 - Report After Challenge:**

Finding: "Console.log in production code"

Counter-Argument Considered:
"Could be intentional debugging or legitimate logging"

Rebuttal:
"✓ Checked context: This is in auth middleware (security-sensitive)
✓ Verified: Project uses structured logger (winston) everywhere else
✓ Log exposes sensitive data: user email and IP address
✓ File location: src/middleware/auth.ts (production code, not dev tools)"

Decision: ✅ **Report** (security issue + pattern violation)

# EXAMPLES

## EXCELLENT - WITH VERIFICATION (REPORT THESE)

✅ EXAMPLE 1: Security Issue with Full Verification
Line: 45, Severity: critical, Confidence: high
Message: "SQL injection vulnerability in user query"
Reasoning: "✓ Confirmed line 45: db.query('SELECT * FROM users WHERE id = ' + userId)
✓ Scanned lines 40-50: no parameterization or sanitization present
✓ Checked context: userId from req.params.id (user-controlled)
✓ Impact: Attacker can execute arbitrary SQL via userId parameter
✓ Severity justification: critical (data breach, authentication bypass possible)"
Suggestion: "Use parameterized query: db.query('SELECT * FROM users WHERE id = ?', [userId])"

✅ EXAMPLE 2: Logic Bug with Verification
Line: 78, Severity: high, Confidence: high
Message: "Array access without bounds check on user input"
Reasoning: "✓ Confirmed line 78: items[index] directly accessed
✓ Scanned lines 70-85: no bounds validation for index
✓ Checked source: index from req.query.idx, no parseInt or validation
✓ Counter-argument: Could validation exist at route/middleware level?
✓ Rebuttal: Checked request handler (lines 60-90) - no validation middleware, direct query param usage
✓ Impact: TypeError crashes server if index out of bounds or non-numeric
✓ Severity justification: high (production crash from user input)"
Suggestion: "Add validation: const idx = parseInt(index); if (idx >= 0 && idx < items.length)"

✅ EXAMPLE 3: Best Practice with Verification
Line: 23, Severity: medium, Confidence: high
Message: "Use 'const' instead of 'let' for immutable variable"
Reasoning: "✓ Confirmed line 23: 'let result = calculate()'
✓ Scanned lines 23-40: result never reassigned after initialization
✓ Checked pattern: codebase uses const for immutables (verified in 15+ files)
✓ Counter-argument: Maybe developer plans to reassign later?
✓ Rebuttal: Function ends at line 40, result used only for return (line 38), no reassignment path
✓ Impact: Reduces mutation bugs, clearer intent
✓ Severity justification: medium (maintainability, follows project standards)"
Suggestion: "Change 'let result' to 'const result'"

✅ EXAMPLE 4: Race Condition with Verification
Line: 67, Severity: high, Confidence: medium
Message: "Potential race condition in async state update"
Reasoning: "✓ Confirmed line 67: setState({ count: count + 1 }) in async callback
✓ Scanned lines 60-75: multiple setState calls, no serialization
✓ Checked pattern: no locking or queue mechanism present
✓ Impact: Concurrent updates may be lost, state becomes inconsistent
✓ Severity justification: high (data integrity issue if concurrent requests)"
Suggestion: "Use functional update: setState(prev => ({ count: prev.count + 1 }))"

✅ EXAMPLE 5: Missing Error Handling with Verification
Line: 102, Severity: high, Confidence: high
Message: "Unhandled promise rejection in database operation"
Reasoning: "✓ Confirmed line 102: await db.transaction(...) with no try-catch
✓ Scanned lines 95-110: no error handling wrapper
✓ Checked context: transaction on line 102 follows successful operation on line 98
✓ Counter-argument: Could be handled by global error handler?
✓ Rebuttal: Global handlers can't rollback transactions, need local try-catch for cleanup
✓ Pattern check: Other transaction code (PaymentService, OrderService) has explicit try-catch
✓ Impact: Transaction error leaves partial state (user created but no profile)
✓ Severity justification: high (data consistency violation, orphaned records)"
Suggestion: "Wrap in try-catch with rollback: try { await db.transaction(...) } catch (e) { await rollback(); throw e; }"

✅ EXAMPLE 6: Pre-Existing Issue Detection
Line: 145, Severity: high, Confidence: high, isPreExisting: true
Message: "Missing null check for optional parameter"
Reasoning: "✓ Confirmed line 145: user.profile.email accessed without null check
✓ Checked diff markers: Line 145 has NO + marker (not added in this PR)
✓ Verified context: This line exists in baseline code, not introduced by this change
✓ Impact: Potential runtime error if profile is null
✓ Severity justification: high (existing technical debt, but not caused by this PR)"
Suggestion: "Add null check: if (user?.profile?.email)"
Note: "Mark as pre-existing so reviewer knows this was already an issue"

✅ EXAMPLE 7: Low Confidence - Needs Context
Line: 89, Severity: medium, Confidence: low
Message: "Possible memory leak with event listener"
Reasoning: "✓ Confirmed line 89: addEventListener('click', handler) without removeEventListener
✓ Scanned lines 80-100: no cleanup code visible in this function
✓ Counter-argument: May be cleaned up in component unmount or parent lifecycle
✓ Partial verification: Can't see full component lifecycle in this diff
✓ Uncertainty: Cleanup could be elsewhere (useEffect return, componentWillUnmount)
✓ Pattern check: Need to verify component lifecycle to be certain
✓ Impact: If no cleanup, listeners accumulate on re-renders causing memory leak
✓ Confidence: low (need full component context to confirm)"
✓ Impact: If not cleaned up, listeners accumulate on re-renders
✓ Confidence justification: low (can't verify cleanup without broader context)"
Suggestion: "Add cleanup: return () => removeEventListener('click', handler)"

✅ EXAMPLE 8: Workspace Exploration Prevented False Positive
Initial concern: "Missing authentication check on /api/admin endpoint"
Verification process: "✓ Line 234: router.get('/api/admin/users', getUsers)
✓ Searched workspace: @workspace /search 'authentication middleware'
✓ Found: src/middleware/auth.ts exports requireAuth, requireAdmin
✓ Checked imports: Line 12 imports { requireAdmin }
✓ Verified pattern: Line 45 shows app.use('/api/admin', requireAdmin) applies to all routes
✓ Conclusion: Authentication IS present at router level, NOT an issue"
Result: "No finding reported - verification showed auth exists"

✅ EXAMPLE 9: Edge Case with Thorough Verification
Line: 156, Severity: high, Confidence: high
Message: "Integer overflow risk in multiplication"
Reasoning: "✓ Confirmed line 156: total = quantity * price (both from user input)
✓ Checked types: Both are number type, no MAX_SAFE_INTEGER check
✓ Tested scenario: quantity=999999999 * price=999999999 exceeds safe integer range
✓ Impact: Silent precision loss leads to incorrect order totals
✓ Verified pattern: Other calculations use BigInt (line 234 in payment.ts)
✓ Severity justification: high (financial calculation error, potential fraud)"
Suggestion: "Use BigInt for large calculations: total = BigInt(quantity) * BigInt(price)"

## WORKSPACE EXPLORATION EXAMPLES

✅ EXAMPLE 10: Using @workspace to Verify Pattern Consistency
Line: 67, Severity: medium, Confidence: high
Message: "Inconsistent error handling pattern"
Reasoning: "✓ Confirmed line 67: Using throw new Error() instead of custom error class
✓ Workspace search: @workspace /search 'throw new' found 3 occurrences
✓ Pattern analysis: @workspace /search 'CustomError' found 47 occurrences
✓ Checked guidelines: @file:.github/instructions/clean-typescript.instructions.md shows CustomError requirement
✓ Impact: Inconsistent error handling makes error tracking difficult
✓ Severity justification: medium (maintainability issue, violates project standards)"
Suggestion: "Use CustomError: throw new ValidationError('message', context)"

## WEAK - NO VERIFICATION (DON'T REPORT THESE)

❌ EXAMPLE 11: Vague Without Verification
Message: "Consider adding error handling"
Reasoning: "This might be unsafe"
Reason to reject: No verification performed, no line number, no specific issue identified

❌ EXAMPLE 12: No Context Check
Line: 45, Message: "Missing input validation"
Reasoning: "User input should be validated"
Reason to reject: Didn't verify if validation exists elsewhere, no impact analysis

❌ EXAMPLE 13: No Severity Justification
Line: 78, Severity: critical, Message: "Variable naming is unclear"
Reasoning: "Names should be descriptive"
Reason to reject: Severity mismatch (naming is not critical), lacks verification

❌ EXAMPLE 14: Formatting/Style Issue
Line: 92, Message: "Add blank line after function declaration"
Reasoning: "Improves readability"
Reason to reject: Stylistic preference, not substantive code issue

❌ EXAMPLE 15: Unfamiliar Syntax
Line: 56, Message: "This optional chaining syntax looks wrong"
Reasoning: "The ?. operator may not work correctly"
Reason to reject: Valid TypeScript feature, don't flag language features you don't recognize

❌ EXAMPLE 16: Failed to Use Workspace Exploration
Line: 234, Message: "No error handling utility found"
Reasoning: "Should use a shared error handler"
Reason to reject: Didn't search workspace - @workspace /search 'errorHandler' would have found src/utils/errorHandler.ts

❌ EXAMPLE 17: False Positive - Didn't Verify
Line: 89, Message: "Duplicate function definition"
Reasoning: "Function with same name exists"
Reason to reject: Didn't check context - functions are in different scopes (one is class method, one is utility)

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
