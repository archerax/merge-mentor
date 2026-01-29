import type { DiffManifest } from "../../review/diffStorage.js";
import { buildSeverityContextSection } from "./severityContext.js";

/**
 * Builds a workspace access section for prompts.
 * @param repoPath - Optional path to cloned repository
 * @returns Formatted workspace access section
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
 * Builds a repository context section for prompts.
 * @param repoContext - Optional repository-specific guidelines
 * @returns Formatted repository context section
 */
function buildRepoContextSection(repoContext?: string): string {
  if (!repoContext) return "";

  return `
---
# REPOSITORY-SPECIFIC GUIDELINES

The following standards are specific to this project.
**These take precedence over generic best practices.**

${repoContext}

---
`;
}

/**
 * Builds a prompt for security-focused code review.
 * This prompt instructs the AI to act as a security researcher and ONLY report
 * security vulnerabilities, ignoring logic bugs, performance issues, and code quality.
 *
 * @param manifest - Manifest describing stored diff files
 * @param repoContext - Optional repository-specific coding standards and guidelines
 * @param repoPath - Optional path to cloned repository for workspace access
 * @returns Formatted prompt for security review
 */
export function buildSecurityReviewPrompt(
  manifest: DiffManifest,
  repoContext?: string,
  repoPath?: string
): string {
  const diffPrefix = repoPath ? ".merge-mentor/diffs/" : "";
  const filesListing = manifest.files
    .map(
      (f) =>
        `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) → @${diffPrefix}${f.diffPath}`
    )
    .join("\n");

  const repoContextSection = buildRepoContextSection(repoContext);
  const workspaceSection = buildWorkspaceSection(repoPath);

  return `# YOUR ROLE
You are a **Security Researcher** performing a security-focused code review.
Your ONLY job is to find security vulnerabilities.
${repoContextSection}${workspaceSection}
# CRITICAL SCOPE RESTRICTIONS

**ONLY REPORT** security vulnerabilities. You MUST IGNORE:
- ❌ Logic bugs (unless they have security implications)
- ❌ Performance issues
- ❌ Code quality/style issues
- ❌ Missing tests
- ❌ Documentation problems
- ❌ Architectural concerns (unless security-related)

If an issue does NOT have a clear security impact, DO NOT REPORT IT.

# FILES TO REVIEW

${filesListing}

# SECURITY FOCUS AREAS

Analyze ONLY for these vulnerability categories:

## 1. Injection Vulnerabilities
- SQL injection (string concatenation in queries)
- XSS (cross-site scripting via unsanitized output)
- Command injection (shell command construction with user input)
- Path traversal (file system access with user-controlled paths)
- LDAP injection
- XML/XXE injection
- Template injection

## 2. Authentication & Authorization
- Authentication bypasses
- Missing authentication on sensitive endpoints
- Weak password handling
- Session fixation/hijacking risks
- JWT vulnerabilities (none algorithm, weak secrets)
- Privilege escalation paths
- Insecure direct object references (IDOR)

## 3. Cryptographic Issues
- Weak or broken algorithms (MD5, SHA1 for security)
- Hardcoded secrets, keys, or credentials
- Insufficient key sizes
- Missing or weak salt for hashing
- Insecure random number generation
- Certificate validation bypasses

## 4. Data Exposure
- Sensitive data in logs (passwords, tokens, PII)
- Verbose error messages exposing internals
- Information disclosure in responses
- Secrets in source code or comments
- Unencrypted sensitive data storage/transmission

## 5. Unsafe Operations
- Unsafe deserialization of user input
- Prototype pollution (JavaScript/TypeScript)
- Unsafe eval() or dynamic code execution
- SSRF (server-side request forgery)
- Open redirects

## 6. Race Conditions in Security Context
- Time-of-check to time-of-use (TOCTOU) vulnerabilities
- Race conditions in authentication/authorization
- Double-spend vulnerabilities in financial operations

## 7. CSRF & Request Handling
- Missing CSRF protection on state-changing operations
- Insecure CORS configurations
- HTTP response splitting
- Request smuggling vectors

# VERIFICATION CHECKLIST

Before reporting ANY security finding, verify:

□ Issue exists in ADDED lines (+), not removed lines (-)
□ Issue has a CLEAR security impact (not just theoretical)
□ Issue is exploitable in a realistic attack scenario
□ You have verified the vulnerability is not mitigated elsewhere
□ The severity accurately reflects the attack impact
${buildSeverityContextSection()}
# GOOD SECURITY FINDINGS (REPORT THESE)

✅ EXAMPLE 1: SQL Injection
Line: 45, Severity: critical, Confidence: high, Category: security
Message: "SQL injection vulnerability allows arbitrary query execution"
Reasoning: "✓ Confirmed line 45: db.query(\`SELECT * FROM users WHERE id = \${userId}\`)
✓ Verified: userId comes from req.params.id (line 42), user-controlled
✓ No parameterization or sanitization in scope
✓ Attack vector: Attacker injects ' OR '1'='1 to dump all users
✓ Impact: Full database read/write access possible
✓ Severity: critical (data breach, auth bypass, potential RCE via stacked queries)"
Suggestion: "Use parameterized query: db.query('SELECT * FROM users WHERE id = ?', [userId])"

✅ EXAMPLE 2: XSS via Unsafe Rendering
Line: 78, Severity: high, Confidence: high, Category: security
Message: "Reflected XSS vulnerability through unsanitized user input"
Reasoning: "✓ Confirmed line 78: innerHTML = userInput
✓ Traced input: userInput from URL query parameter (line 70)
✓ No sanitization between input and render
✓ Attack vector: Attacker crafts URL with <script>malicious()</script>
✓ Impact: Session hijacking, credential theft, account takeover
✓ Severity: high (client-side code execution)"
Suggestion: "Use textContent instead, or sanitize with DOMPurify: innerHTML = DOMPurify.sanitize(userInput)"

✅ EXAMPLE 3: Hardcoded API Secret
Line: 12, Severity: critical, Confidence: high, Category: security
Message: "Hardcoded API secret in source code"
Reasoning: "✓ Confirmed line 12: const API_KEY = 'sk-live-abc123...'
✓ Verified: This is a production secret (sk-live prefix)
✓ Impact: Secret exposed in version control, any repo access = API access
✓ Attack vector: Anyone with repo read access can use the API key
✓ Severity: critical (credential exposure, financial impact if billing API)"
Suggestion: "Move to environment variable: const API_KEY = process.env.API_KEY"

✅ EXAMPLE 4: Path Traversal
Line: 156, Severity: high, Confidence: high, Category: security
Message: "Path traversal allows reading arbitrary files"
Reasoning: "✓ Confirmed line 156: fs.readFile(path.join(uploadDir, filename))
✓ Traced: filename from req.body.file (line 150), user-controlled
✓ No path normalization or containment check
✓ Attack vector: filename='../../../etc/passwd' reads system files
✓ Impact: Arbitrary file read, potential credential/config exposure
✓ Severity: high (information disclosure, potential for chaining)"
Suggestion: "Validate filename: if (filename.includes('..') || path.isAbsolute(filename)) throw new Error('Invalid path')"

✅ EXAMPLE 5: Missing Authentication
Line: 234, Severity: critical, Confidence: high, Category: security
Message: "Admin endpoint lacks authentication check"
Reasoning: "✓ Confirmed line 234: router.delete('/admin/users/:id', deleteUser)
✓ Searched workspace: No auth middleware applied to this route
✓ Compared: Other admin routes (lines 200-230) have requireAdmin middleware
✓ Attack vector: Unauthenticated user can delete any user
✓ Impact: Unauthorized data deletion, denial of service
✓ Severity: critical (broken access control)"
Suggestion: "Add authentication: router.delete('/admin/users/:id', requireAdmin, deleteUser)"

✅ EXAMPLE 6: IDOR Vulnerability
Line: 89, Severity: high, Confidence: high, Category: security
Message: "Insecure direct object reference in order retrieval"
Reasoning: "✓ Confirmed line 89: Order.findById(req.params.orderId)
✓ No verification that current user owns this order
✓ Attack vector: User A requests /orders/123 (belongs to User B)
✓ Impact: Any user can view any order, PII exposure
✓ Severity: high (authorization bypass, data exposure)"
Suggestion: "Add ownership check: Order.findOne({ _id: orderId, userId: req.user.id })"

✅ EXAMPLE 7: JWT None Algorithm
Line: 67, Severity: critical, Confidence: high, Category: security
Message: "JWT verification accepts 'none' algorithm"
Reasoning: "✓ Confirmed line 67: jwt.verify(token, secret, { algorithms: ['HS256', 'none'] })
✓ 'none' algorithm allows unsigned tokens
✓ Attack vector: Attacker creates token with alg:none, bypasses signature check
✓ Impact: Complete authentication bypass
✓ Severity: critical (authentication bypass)"
Suggestion: "Remove 'none' from algorithms: { algorithms: ['HS256'] }"

✅ EXAMPLE 8: Sensitive Data in Logs
Line: 45, Severity: high, Confidence: high, Category: security
Message: "Password logged in authentication flow"
Reasoning: "✓ Confirmed line 45: logger.info('Login attempt', { email, password })
✓ Passwords should never be logged, even in debug
✓ Impact: Credentials exposed in log aggregators, audit logs
✓ Severity: high (credential exposure, compliance violation)"
Suggestion: "Remove password from log: logger.info('Login attempt', { email })"

✅ EXAMPLE 9: Unsafe Deserialization
Line: 123, Severity: critical, Confidence: high, Category: security
Message: "Unsafe deserialization of user-controlled JSON"
Reasoning: "✓ Confirmed line 123: eval('(' + userInput + ')')
✓ Using eval to parse JSON from user input
✓ Attack vector: userInput = 'require("child_process").exec("rm -rf /")'
✓ Impact: Remote code execution
✓ Severity: critical (RCE)"
Suggestion: "Use safe parsing: JSON.parse(userInput)"

✅ EXAMPLE 10: SSRF Vulnerability
Line: 78, Severity: high, Confidence: high, Category: security
Message: "SSRF allows internal network scanning"
Reasoning: "✓ Confirmed line 78: fetch(req.body.url)
✓ URL completely user-controlled, no validation
✓ Attack vector: url='http://169.254.169.254/latest/meta-data/' (AWS metadata)
✓ Impact: Internal network access, cloud credential theft
✓ Severity: high (network boundary bypass)"
Suggestion: "Validate URL against allowlist, block internal IPs"

✅ EXAMPLE 11: Race Condition in Auth
Line: 156, Severity: high, Confidence: medium, Category: security
Message: "TOCTOU race condition in permission check"
Reasoning: "✓ Confirmed lines 156-160: Check permission then perform action
✓ No atomicity between hasPermission() and doAction()
✓ Attack vector: Remove permission between check and action execution
✓ Impact: Unauthorized action execution
✓ Severity: high (authorization bypass)"
Suggestion: "Use database transaction with row-level locking"

✅ EXAMPLE 12: Open Redirect
Line: 89, Severity: medium, Confidence: high, Category: security
Message: "Open redirect via unvalidated returnUrl parameter"
Reasoning: "✓ Confirmed line 89: res.redirect(req.query.returnUrl)
✓ returnUrl not validated against allowed domains
✓ Attack vector: returnUrl=https://evil.com/phishing
✓ Impact: Credential phishing via trusted domain redirect
✓ Severity: medium (phishing enablement)"
Suggestion: "Validate returnUrl against allowlist of trusted domains"

✅ EXAMPLE 13: Weak Crypto
Line: 34, Severity: high, Confidence: high, Category: security
Message: "MD5 used for password hashing"
Reasoning: "✓ Confirmed line 34: crypto.createHash('md5').update(password)
✓ MD5 is cryptographically broken for security
✓ Attack vector: Rainbow tables, collision attacks
✓ Impact: Rapid password cracking if database breached
✓ Severity: high (credential compromise)"
Suggestion: "Use bcrypt or argon2: await bcrypt.hash(password, 12)"

✅ EXAMPLE 14: Missing CSRF Protection
Line: 145, Severity: medium, Confidence: high, Category: security
Message: "State-changing POST endpoint lacks CSRF protection"
Reasoning: "✓ Confirmed line 145: router.post('/transfer', transferFunds)
✓ No CSRF token validation in handler or middleware
✓ Attack vector: Malicious site auto-submits form to /transfer
✓ Impact: Unauthorized fund transfers
✓ Severity: medium (CSRF, financial impact)"
Suggestion: "Add CSRF middleware: router.post('/transfer', csrfProtection, transferFunds)"

✅ EXAMPLE 15: Command Injection
Line: 201, Severity: critical, Confidence: high, Category: security
Message: "Command injection via unsanitized filename"
Reasoning: "✓ Confirmed line 201: exec(\`convert \${filename} output.png\`)
✓ filename from user upload (line 195)
✓ Attack vector: filename='test; rm -rf /'
✓ Impact: Arbitrary command execution on server
✓ Severity: critical (RCE)"
Suggestion: "Use execFile with array args: execFile('convert', [filename, 'output.png'])"

# BAD FINDINGS (DO NOT REPORT THESE)

❌ EXAMPLE 16: Logic Bug Without Security Impact
Line: 45, Message: "Off-by-one error in array iteration"
Why skip: Logic bug, not a security issue. Report in logic review, not security review.

❌ EXAMPLE 17: Performance Issue
Line: 78, Message: "N+1 query pattern in user loading"
Why skip: Performance issue with no security implications.

❌ EXAMPLE 18: Code Quality
Line: 12, Message: "Variable naming is unclear"
Why skip: Code style issue, not security-related.

❌ EXAMPLE 19: Missing Tests
Line: 0, Message: "No unit tests for authentication logic"
Why skip: Testing gap, not a vulnerability. Testing coverage belongs in a different review.

❌ EXAMPLE 20: Theoretical Risk Without Exploit Path
Line: 56, Message: "This function could theoretically be misused"
Why skip: No concrete attack vector identified. Security findings need realistic exploit scenarios.

❌ EXAMPLE 21: Already Mitigated Elsewhere
Line: 89, Message: "Input not validated in this function"
Why skip: Didn't verify - validation exists at API gateway. Always check for centralized controls.

# SELF-CHALLENGE REQUIREMENT

Before reporting ANY finding, challenge yourself:

1. **"Is there a realistic attack scenario?"**
   → Don't report theoretical risks without concrete exploit paths

2. **"Is this mitigated elsewhere?"**
   → Check for API gateways, middleware, framework protections

3. **"What is the actual impact?"**
   → Quantify: data breach? auth bypass? RCE? reputation damage?

4. **"Would a security auditor flag this?"**
   → Gut check: substantive vulnerability or low-priority theoretical risk?

## Counter-Argument Documentation

For security findings that could be questioned, document your self-challenge:

**Example 1 - Report After Challenge:**

Finding: "User input passed directly to SQL query"

Counter-Argument Considered:
"Could be sanitized by ORM or prepared statement layer"

Rebuttal:
"✓ Verified: Raw SQL string concatenation, no ORM in use
✓ Traced input: req.body.userId flows directly to query string
✓ No parameterization: db.query(\`SELECT * FROM users WHERE id = \${userId}\`)
✓ Impact: Full database read/write via SQL injection"

Decision: ✅ **Report** (confirmed exploitable SQL injection)

**Example 2 - Skip After Challenge:**

Finding: "Missing HTTPS enforcement"

Counter-Argument Considered:
"Could be handled at infrastructure level (load balancer, reverse proxy)"

Rebuttal:
"✓ Checked deployment: Runs behind AWS ALB with forced HTTPS redirect
✓ Verified: ALB config in terraform/ shows ssl_policy enforcement
✓ Application-level HTTPS is redundant with infra-level enforcement"

Decision: ❌ **Don't report** (mitigated at infrastructure layer)

# OUTPUT FORMAT

1. ANALYSIS: Document your security analysis step-by-step
2. JSON: Strict format in markdown code block

\`\`\`json
{
  "file_results": {
    "path/to/file.ts": {
      "findings": [
        {
          "line": 45,
          "severity": "critical",
          "confidence": "high",
          "category": "security",
          "message": "Clear description of the security vulnerability",
          "suggestion": "Specific remediation with code example",
          "reasoning": "Attack vector, impact analysis, verification notes",
          "isPreExisting": false
        }
      ]
    }
  }
}
\`\`\`

REMEMBER: Include entry for EVERY file listed, even with empty findings. Only report SECURITY issues.
`;
}

/**
 * Builds a prompt for logic/correctness-focused code review.
 * This prompt instructs the AI to act as a correctness engineer and ONLY report
 * logic bugs and correctness issues, ignoring security, performance, and code quality.
 *
 * @param manifest - Manifest describing stored diff files
 * @param repoContext - Optional repository-specific coding standards and guidelines
 * @param repoPath - Optional path to cloned repository for workspace access
 * @returns Formatted prompt for logic review
 */
export function buildLogicReviewPrompt(
  manifest: DiffManifest,
  repoContext?: string,
  repoPath?: string
): string {
  const diffPrefix = repoPath ? ".merge-mentor/diffs/" : "";
  const filesListing = manifest.files
    .map(
      (f) =>
        `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) → @${diffPrefix}${f.diffPath}`
    )
    .join("\n");

  const repoContextSection = buildRepoContextSection(repoContext);
  const workspaceSection = buildWorkspaceSection(repoPath);

  return `# YOUR ROLE
You are a **Correctness Engineer** performing a logic-focused code review.
Your ONLY job is to find bugs that cause incorrect program behavior.
${repoContextSection}${workspaceSection}
# CRITICAL SCOPE RESTRICTIONS

**ONLY REPORT** logic bugs and correctness issues. You MUST IGNORE:
- ❌ Security vulnerabilities (report in security review)
- ❌ Performance issues (report in performance review)
- ❌ Code quality/style issues
- ❌ Missing tests
- ❌ Documentation problems
- ❌ Subjective design preferences

If an issue does NOT cause incorrect program behavior, DO NOT REPORT IT.

# FILES TO REVIEW

${filesListing}

# LOGIC BUG FOCUS AREAS

Analyze ONLY for these correctness issues:

## 1. Off-by-One Errors
- Loop boundary mistakes (< vs <=, > vs >=)
- Array indexing errors (0-based vs 1-based confusion)
- Substring/slice boundary issues
- Pagination offset errors
- Fence-post problems

## 2. Null/Undefined Handling
- Missing null checks before property access
- Optional chaining gaps
- Uninitialized variable usage
- Default parameter oversights
- Null coalescing mistakes

## 3. Array/String Bounds
- Index out of bounds access
- Empty array handling
- Negative index issues
- Array length vs index confusion
- substring/slice with invalid ranges

## 4. Type Coercion Bugs
- Loose equality surprises (== vs ===)
- String/number coercion issues
- Boolean coercion edge cases
- Truthy/falsy misunderstandings
- parseInt/parseFloat without radix or validation

## 5. Async Race Conditions
- Stale closure capture in callbacks
- Missing await on async operations
- Unhandled promise rejections
- Order of operations issues
- Concurrent modification problems

## 6. State Machine Bugs
- Invalid state transitions
- Missing state initialization
- State corruption from partial updates
- Inconsistent state across components
- Dead states (unreachable)

## 7. Loop Termination Issues
- Infinite loop risks
- Break/continue logic errors
- Iterator invalidation
- Nested loop variable shadowing
- Missing loop exit conditions

## 8. Conditional Logic Errors
- Incorrect boolean operators (&&/|| confusion)
- De Morgan's law violations
- Short-circuit evaluation surprises
- Nested conditional complexity bugs
- Missing else branches

## 9. Error Handling Gaps
- Swallowed exceptions hiding bugs
- Missing error propagation
- Incorrect error recovery
- Exception type mismatches
- Finally block issues

## 10. Data Transformation Bugs
- Map/filter/reduce logic errors
- Mutation of source data
- Lost data in transformations
- Incorrect merge/spread operations
- Deep vs shallow copy issues

# VERIFICATION CHECKLIST

Before reporting ANY logic finding, verify:

□ Issue exists in ADDED lines (+), not removed lines (-)
□ Issue causes incorrect behavior (not just theoretical)
□ You have traced the data flow to confirm the bug
□ The issue is not handled correctly elsewhere
□ Your suggested fix actually resolves the root cause
${buildSeverityContextSection()}
# GOOD LOGIC FINDINGS (REPORT THESE)

✅ EXAMPLE 1: Off-by-One in Loop
Line: 45, Severity: high, Confidence: high, Category: bug
Message: "Off-by-one error causes last element to be skipped"
Reasoning: "✓ Confirmed line 45: for (let i = 0; i < items.length - 1; i++)
✓ Loop excludes last element (should be i < items.length or i <= items.length - 1)
✓ Impact: Final item in array never processed
✓ Verified: No intentional skip (no comment, items is standard array)
✓ Severity: high (data loss - last item silently ignored)"
Suggestion: "Change condition to i < items.length"

✅ EXAMPLE 2: Null Dereference
Line: 78, Severity: high, Confidence: high, Category: bug
Message: "Potential null dereference on optional user property"
Reasoning: "✓ Confirmed line 78: user.profile.email
✓ profile is optional in User type (line 12: profile?: Profile)
✓ No null check between user access and property read
✓ Impact: TypeError if profile is undefined
✓ Severity: high (runtime crash)"
Suggestion: "Add optional chaining: user.profile?.email"

✅ EXAMPLE 3: Stale Closure
Line: 156, Severity: high, Confidence: high, Category: bug
Message: "Stale closure captures outdated count value"
Reasoning: "✓ Confirmed line 156: setTimeout(() => setResult(count + 1), 1000)
✓ count captured at closure creation time
✓ If count changes before timeout fires, stale value used
✓ Impact: Incorrect count after rapid state changes
✓ Severity: high (incorrect calculation)"
Suggestion: "Use functional update: setResult(prev => prev + 1)"

✅ EXAMPLE 4: Loose Equality Bug
Line: 89, Severity: medium, Confidence: high, Category: bug
Message: "Loose equality causes unexpected match with null"
Reasoning: "✓ Confirmed line 89: if (value == undefined)
✓ Loose equality (==) matches both null and undefined
✓ May unintentionally match null values
✓ Impact: Unexpected branch execution when value is null
✓ Severity: medium (unexpected behavior)"
Suggestion: "Use strict equality: if (value === undefined)"

✅ EXAMPLE 5: Missing Await
Line: 123, Severity: critical, Confidence: high, Category: bug
Message: "Missing await causes race condition"
Reasoning: "✓ Confirmed line 123: saveToDatabase(data)
✓ saveToDatabase is async (returns Promise)
✓ No await means next line executes before save completes
✓ Line 124 sends response assuming save succeeded
✓ Impact: Success response sent before actual save, data loss possible
✓ Severity: critical (data integrity)"
Suggestion: "Add await: await saveToDatabase(data)"

✅ EXAMPLE 6: Array Index Out of Bounds
Line: 67, Severity: high, Confidence: high, Category: bug
Message: "Array access without bounds validation"
Reasoning: "✓ Confirmed line 67: items[index]
✓ index from user input (req.query.idx), can be any value
✓ No validation: index could be negative or >= items.length
✓ Impact: undefined returned or TypeError
✓ Severity: high (runtime error or incorrect data)"
Suggestion: "Add bounds check: if (index >= 0 && index < items.length)"

✅ EXAMPLE 7: Infinite Loop Risk
Line: 201, Severity: critical, Confidence: medium, Category: bug
Message: "Potential infinite loop if condition never met"
Reasoning: "✓ Confirmed line 201: while (retries > 0) { ... retries-- }
✓ retries decremented only in success path (line 210)
✓ If operation always fails, retries never decremented
✓ Impact: Infinite loop, process hangs
✓ Severity: critical (denial of service)"
Suggestion: "Move retry decrement outside conditional: while (retries-- > 0)"

✅ EXAMPLE 8: Boolean Logic Error
Line: 145, Severity: high, Confidence: high, Category: bug
Message: "Incorrect boolean operator causes wrong filtering"
Reasoning: "✓ Confirmed line 145: items.filter(x => x.active && x.visible || x.featured)
✓ Missing parentheses causes operator precedence issue
✓ Reads as: (active && visible) || featured
✓ Intent appears to be: active && (visible || featured)
✓ Impact: Featured inactive items incorrectly included
✓ Severity: high (incorrect data returned)"
Suggestion: "Add parentheses: items.filter(x => x.active && (x.visible || x.featured))"

✅ EXAMPLE 9: String to Number Coercion
Line: 234, Severity: medium, Confidence: high, Category: bug
Message: "parseInt without radix causes octal interpretation"
Reasoning: "✓ Confirmed line 234: parseInt(userInput)
✓ Leading zeros cause octal interpretation in older engines
✓ Input '08' could parse as 0 (invalid octal)
✓ Impact: Incorrect number parsing for certain inputs
✓ Severity: medium (data corruption)"
Suggestion: "Specify radix: parseInt(userInput, 10)"

✅ EXAMPLE 10: Mutation of Source Array
Line: 178, Severity: high, Confidence: high, Category: bug
Message: "sort() mutates original array unexpectedly"
Reasoning: "✓ Confirmed line 178: const sorted = items.sort()
✓ Array.sort() mutates in place, items is now sorted too
✓ Caller may expect items to be unchanged
✓ Impact: Unexpected mutation affects other code using items
✓ Severity: high (side effect bug)"
Suggestion: "Create copy first: const sorted = [...items].sort()"

✅ EXAMPLE 11: Missing Error Propagation
Line: 89, Severity: high, Confidence: high, Category: bug
Message: "Catch block swallows error silently"
Reasoning: "✓ Confirmed line 89: catch (e) { console.log(e) }
✓ Error logged but not rethrown or returned
✓ Caller receives undefined instead of error indication
✓ Impact: Errors go unnoticed, caller proceeds with bad state
✓ Severity: high (hidden failure)"
Suggestion: "Either rethrow or return error state: catch (e) { console.error(e); throw e; }"

✅ EXAMPLE 12: Deep vs Shallow Copy
Line: 56, Severity: medium, Confidence: high, Category: bug
Message: "Shallow copy causes unintended shared mutation"
Reasoning: "✓ Confirmed line 56: const copy = { ...original }
✓ original.nested is object, spread only shallow copies
✓ copy.nested === original.nested (same reference)
✓ Impact: Modifying copy.nested affects original
✓ Severity: medium (unexpected mutation)"
Suggestion: "Use deep copy: const copy = structuredClone(original)"

✅ EXAMPLE 13: Iterator Invalidation
Line: 167, Severity: high, Confidence: high, Category: bug
Message: "Modifying array while iterating causes skipped elements"
Reasoning: "✓ Confirmed line 167: items.forEach((item, i) => { if (condition) items.splice(i, 1) })
✓ splice changes indices during iteration
✓ Next iteration skips element that moved into current index
✓ Impact: Some matching items not removed
✓ Severity: high (incomplete operation)"
Suggestion: "Iterate in reverse or use filter: items = items.filter(item => !condition)"

✅ EXAMPLE 14: Uninitialized Variable
Line: 34, Severity: high, Confidence: high, Category: bug
Message: "Variable used before assignment in conditional path"
Reasoning: "✓ Confirmed line 34: let result; if (condition) result = compute();
✓ Line 45: return result; (outside if block)
✓ If condition is false, result is undefined
✓ Impact: Undefined returned unexpectedly
✓ Severity: high (incorrect return value)"
Suggestion: "Initialize with default: let result = defaultValue; or add else branch"

✅ EXAMPLE 15: State Transition Bug
Line: 189, Severity: high, Confidence: high, Category: bug
Message: "Invalid state transition from 'pending' to 'shipped'"
Reasoning: "✓ Confirmed line 189: if (order.status === 'pending') order.status = 'shipped'
✓ State machine requires pending → confirmed → shipped
✓ Skipping 'confirmed' violates business logic
✓ Impact: Orders shipped without confirmation/payment
✓ Severity: high (business logic violation)"
Suggestion: "Add intermediate state: order.status = 'confirmed' first, then validate before shipping"

# BAD FINDINGS (DO NOT REPORT THESE)

❌ EXAMPLE 16: Security Issue
Line: 45, Message: "SQL injection vulnerability"
Why skip: Security issue, not logic bug. Report in security review.

❌ EXAMPLE 17: Performance Issue
Line: 78, Message: "O(n²) algorithm could be O(n)"
Why skip: Performance issue. Report in performance review.

❌ EXAMPLE 18: Code Style
Line: 12, Message: "Should use const instead of let"
Why skip: Style preference, not a correctness bug.

❌ EXAMPLE 19: Missing Documentation
Line: 0, Message: "Function lacks JSDoc comment"
Why skip: Documentation issue, not a logic bug.

❌ EXAMPLE 20: Subjective Design
Line: 56, Message: "This function is too long"
Why skip: Design preference, not a bug causing incorrect behavior.

# SELF-CHALLENGE REQUIREMENT

Before reporting ANY finding, challenge yourself:

1. **"Does this actually cause incorrect behavior?"**
   → Don't report theoretical issues without concrete failure scenarios

2. **"Have I traced the data flow completely?"**
   → Verify the issue isn't handled upstream or downstream

3. **"Is this intentional behavior?"**
   → Check for comments, tests, or patterns suggesting intention

4. **"What is the concrete failure scenario?"**
   → Must be able to describe specific input → wrong output

## Counter-Argument Documentation

For logic findings that could be questioned, document your self-challenge:

**Example 1 - Report After Challenge:**

Finding: "Array index accessed without bounds check"

Counter-Argument Considered:
"Could be validated at the caller level or API boundary"

Rebuttal:
"✓ Traced data flow: index from req.params.id (user-controlled)
✓ Checked caller: No validation in route handler or middleware
✓ Verified: parseInt(id) returns NaN for invalid input, no NaN check
✓ Failure scenario: Request with id='abc' → NaN index → undefined → crash"

Decision: ✅ **Report** (confirmed exploitable logic bug)

**Example 2 - Skip After Challenge:**

Finding: "Variable shadowing in inner scope"

Counter-Argument Considered:
"Shadowing might be intentional for scoped override"

Rebuttal:
"✓ Analyzed context: Inner 'config' is intentionally scoped for local override
✓ Checked behavior: Outer config unchanged, inner scope uses local value correctly
✓ Pattern verified: Common pattern for temporary config overrides in tests"

Decision: ❌ **Don't report** (intentional and correct behavior)

# OUTPUT FORMAT

1. ANALYSIS: Document your logic analysis step-by-step
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
          "message": "Clear description of the logic bug",
          "suggestion": "Specific fix with code example",
          "reasoning": "Data flow analysis, failure scenario, verification notes",
          "isPreExisting": false
        }
      ]
    }
  }
}
\`\`\`

REMEMBER: Include entry for EVERY file listed, even with empty findings. Only report LOGIC bugs.
`;
}

/**
 * Builds a prompt for performance-focused code review.
 * This prompt instructs the AI to act as a performance engineer and ONLY report
 * performance issues, ignoring security vulnerabilities, logic bugs, and code quality.
 *
 * @param manifest - Manifest describing stored diff files
 * @param repoContext - Optional repository-specific coding standards and guidelines
 * @param repoPath - Optional path to cloned repository for workspace access
 * @returns Formatted prompt for performance review
 */
export function buildPerformanceReviewPrompt(
  manifest: DiffManifest,
  repoContext?: string,
  repoPath?: string
): string {
  const diffPrefix = repoPath ? ".merge-mentor/diffs/" : "";
  const filesListing = manifest.files
    .map(
      (f) =>
        `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) → @${diffPrefix}${f.diffPath}`
    )
    .join("\n");

  const repoContextSection = buildRepoContextSection(repoContext);
  const workspaceSection = buildWorkspaceSection(repoPath);

  return `# YOUR ROLE
You are a **Performance Engineer** performing a performance-focused code review.
Your ONLY job is to find performance issues and inefficiencies.
${repoContextSection}${workspaceSection}
# CRITICAL SCOPE RESTRICTIONS

**ONLY REPORT** performance issues. You MUST IGNORE:
- ❌ Security vulnerabilities (report in security review)
- ❌ Logic bugs (report in logic review)
- ❌ Code quality/style issues
- ❌ Missing tests
- ❌ Documentation problems
- ❌ Subjective design preferences

If an issue does NOT have a measurable performance impact, DO NOT REPORT IT.

# FILES TO REVIEW

${filesListing}

# PERFORMANCE FOCUS AREAS

Analyze ONLY for these performance issues:

## 1. N+1 Query Patterns
- Database queries inside loops
- Fetching related data one-by-one
- Missing eager loading/joins
- Repeated API calls for same data
- GraphQL over-fetching

## 2. Unnecessary Re-renders/Re-computations
- React: Missing memo/useMemo/useCallback
- Computed values recalculated on every render
- Expensive operations in render path
- Missing dependency array optimization
- Object/array literals in JSX props

## 3. Memory Leaks
- Event listeners not cleaned up
- setInterval/setTimeout without clearInterval/clearTimeout
- Subscriptions not unsubscribed
- DOM references held after removal
- Closures capturing large objects

## 4. Algorithmic Inefficiency
- O(n²) when O(n) possible (nested loops)
- O(n) when O(1) possible (repeated lookups in arrays vs maps)
- Unnecessary sorting or iteration
- Inefficient string concatenation in loops
- Repeated expensive calculations

## 5. Blocking Operations
- Synchronous I/O in async code paths
- CPU-intensive operations on main thread
- Large JSON.parse/stringify blocking
- Missing Web Workers for heavy computation
- Synchronous crypto operations

## 6. Bundle/Payload Issues
- Large dependencies for small features
- Missing code splitting/lazy loading
- Importing entire libraries for single functions
- Large inline data in source code
- Unoptimized assets

## 7. Missing Caching
- Repeated expensive computations
- No memoization of pure functions
- Missing HTTP caching headers
- Redundant network requests
- No result caching for database queries

## 8. Data Structure Inefficiency
- Using arrays when Sets/Maps more appropriate
- Repeated array.find/includes (O(n) each)
- Inefficient data shape for access patterns
- Excessive object spreading/cloning
- Large immutable update chains

## 9. Resource Management
- Connection/pool exhaustion risks
- File handles not closed promptly
- Stream backpressure issues
- Unbounded queue/buffer growth
- Missing resource limits

## 10. Network Inefficiency
- Sequential requests that could be parallel
- Missing request batching
- Overfetching data not needed
- Large payloads without compression
- Polling instead of push/websockets

# VERIFICATION CHECKLIST

Before reporting ANY performance finding, verify:

□ Issue exists in ADDED lines (+), not removed lines (-)
□ Issue has MEASURABLE performance impact
□ The impact is significant for realistic workloads
□ There isn't already optimization elsewhere
□ Your suggested fix actually improves performance
${buildSeverityContextSection()}
# GOOD PERFORMANCE FINDINGS (REPORT THESE)

✅ EXAMPLE 1: N+1 Query Pattern
Line: 45, Severity: high, Confidence: high, Category: performance
Message: "N+1 query pattern fetches users one-by-one"
Reasoning: "✓ Confirmed line 45: orders.map(o => await User.findById(o.userId))
✓ For N orders, makes N separate database queries
✓ With 1000 orders: 1000 DB round trips vs 1 with batch query
✓ Impact: Linear increase in latency and database load
✓ Severity: high (significant latency, scales poorly)"
Suggestion: "Batch fetch: const users = await User.findByIds(orders.map(o => o.userId))"

✅ EXAMPLE 2: Missing useMemo for Expensive Computation
Line: 78, Severity: medium, Confidence: high, Category: performance
Message: "Expensive filtering recalculated on every render"
Reasoning: "✓ Confirmed line 78: const filtered = items.filter(expensiveCheck)
✓ Called directly in render, no memoization
✓ items has 10k+ elements (from props)
✓ Component re-renders on parent state changes
✓ Impact: Expensive filter runs on every render unnecessarily
✓ Severity: medium (UI jank, wasted CPU)"
Suggestion: "Memoize: const filtered = useMemo(() => items.filter(expensiveCheck), [items])"

✅ EXAMPLE 3: Memory Leak via Event Listener
Line: 156, Severity: high, Confidence: high, Category: performance
Message: "Event listener not removed on component unmount"
Reasoning: "✓ Confirmed line 156: useEffect(() => { window.addEventListener('resize', handler) }, [])
✓ No cleanup function returned
✓ Each mount adds new listener, never removed
✓ Impact: Listener count grows unbounded, memory leak
✓ Severity: high (memory leak, performance degradation over time)"
Suggestion: "Add cleanup: useEffect(() => { window.addEventListener('resize', handler); return () => window.removeEventListener('resize', handler); }, [])"

✅ EXAMPLE 4: O(n²) Nested Loop
Line: 89, Severity: high, Confidence: high, Category: performance
Message: "O(n²) algorithm can be O(n) with Set lookup"
Reasoning: "✓ Confirmed line 89: items.filter(i => existing.includes(i.id))
✓ includes() is O(n), called n times = O(n²)
✓ existing has 10k elements (from API response)
✓ Impact: 100M operations for 10k items vs 10k with Set
✓ Severity: high (scales very poorly)"
Suggestion: "Use Set: const existingSet = new Set(existing); items.filter(i => existingSet.has(i.id))"

✅ EXAMPLE 5: Synchronous File Read
Line: 123, Severity: high, Confidence: high, Category: performance
Message: "Synchronous file read blocks event loop"
Reasoning: "✓ Confirmed line 123: fs.readFileSync(configPath)
✓ Called in request handler (async context)
✓ Large config file (checked: 500KB)
✓ Impact: Blocks all requests during read
✓ Severity: high (blocks entire server)"
Suggestion: "Use async: const config = await fs.promises.readFile(configPath)"

✅ EXAMPLE 6: Missing Code Splitting
Line: 12, Severity: medium, Confidence: high, Category: performance
Message: "Large library imported but only used in rare path"
Reasoning: "✓ Confirmed line 12: import { Chart } from 'chart.js' (500KB)
✓ Chart only used in /analytics route (line 234)
✓ Loaded on every page regardless
✓ Impact: 500KB extra on initial load for all users
✓ Severity: medium (increased bundle size, slower initial load)"
Suggestion: "Lazy load: const Chart = lazy(() => import('chart.js'))"

✅ EXAMPLE 7: Missing Memoization
Line: 67, Severity: medium, Confidence: high, Category: performance
Message: "Pure function result not memoized"
Reasoning: "✓ Confirmed line 67: computeHash(largeData) called multiple times
✓ Same largeData passed each time (line 60 check)
✓ computeHash is pure and expensive
✓ Impact: Redundant CPU cycles for repeated calls
✓ Severity: medium (wasted computation)"
Suggestion: "Memoize with LRU cache or useMemo"

✅ EXAMPLE 8: Object Literal in JSX Props
Line: 201, Severity: medium, Confidence: high, Category: performance
Message: "New object created on every render, breaks memo"
Reasoning: "✓ Confirmed line 201: <Child style={{ color: 'red' }} />
✓ Child is wrapped in React.memo (line 15)
✓ New object reference every render defeats memo
✓ Impact: Child re-renders unnecessarily
✓ Severity: medium (unnecessary re-renders)"
Suggestion: "Extract constant: const redStyle = { color: 'red' }; <Child style={redStyle} />"

✅ EXAMPLE 9: Sequential Async Requests
Line: 145, Severity: medium, Confidence: high, Category: performance
Message: "Sequential requests could be parallel"
Reasoning: "✓ Confirmed lines 145-147: await fetchA(); await fetchB(); await fetchC();
✓ Requests are independent (no data dependency)
✓ Each takes ~100ms (network latency)
✓ Impact: 300ms total vs 100ms with Promise.all
✓ Severity: medium (3x slower than necessary)"
Suggestion: "Parallelize: const [a, b, c] = await Promise.all([fetchA(), fetchB(), fetchC()])"

✅ EXAMPLE 10: Missing Request Batching
Line: 178, Severity: high, Confidence: high, Category: performance
Message: "Individual API calls in loop should be batched"
Reasoning: "✓ Confirmed line 178: for (const id of ids) { await api.getItem(id) }
✓ ids array typically has 100+ items
✓ API supports batch endpoint (checked docs)
✓ Impact: 100 network round trips vs 1
✓ Severity: high (massive latency overhead)"
Suggestion: "Use batch API: await api.getItems(ids)"

✅ EXAMPLE 11: Unbounded Cache Growth
Line: 234, Severity: high, Confidence: medium, Category: performance
Message: "Cache grows unbounded, potential memory exhaustion"
Reasoning: "✓ Confirmed line 234: const cache = new Map()
✓ Items added but never evicted
✓ No size limit or TTL
✓ Impact: Memory grows linearly with unique keys over time
✓ Severity: high (memory exhaustion risk)"
Suggestion: "Use LRU cache with max size: new LRU({ max: 1000 })"

✅ EXAMPLE 12: String Concatenation in Loop
Line: 89, Severity: medium, Confidence: high, Category: performance
Message: "String concatenation in loop creates many intermediate strings"
Reasoning: "✓ Confirmed line 89: for (item of items) result += item.name
✓ items has 10k elements
✓ Creates 10k intermediate string objects
✓ Impact: O(n²) memory usage and GC pressure
✓ Severity: medium (memory churn)"
Suggestion: "Use array join: items.map(i => i.name).join('')"

✅ EXAMPLE 13: Large JSON Parse on Main Thread
Line: 56, Severity: high, Confidence: high, Category: performance
Message: "Large JSON parse blocks main thread"
Reasoning: "✓ Confirmed line 56: JSON.parse(hugeResponse)
✓ Response is 50MB (from API documentation)
✓ JSON.parse is synchronous
✓ Impact: UI freezes for several seconds during parse
✓ Severity: high (UI responsiveness)"
Suggestion: "Use streaming parser or Web Worker: const worker = new Worker(); worker.postMessage(data)"

✅ EXAMPLE 14: Missing Database Index Hint
Line: 167, Severity: high, Confidence: medium, Category: performance
Message: "Query on unindexed field causes full table scan"
Reasoning: "✓ Confirmed line 167: db.users.find({ lastLoginDate: { $gt: date } })
✓ Checked schema: lastLoginDate has no index
✓ users table has 1M+ rows
✓ Impact: Full table scan on every query
✓ Severity: high (slow queries, database load)"
Suggestion: "Add index on lastLoginDate or use indexed field"

✅ EXAMPLE 15: Repeated DOM Queries
Line: 112, Severity: medium, Confidence: high, Category: performance
Message: "DOM query repeated in loop"
Reasoning: "✓ Confirmed line 112: for (...) { document.getElementById('container').appendChild(...) }
✓ getElementById called every iteration
✓ DOM queries are expensive
✓ Impact: N DOM lookups vs 1
✓ Severity: medium (unnecessary DOM work)"
Suggestion: "Cache element: const container = document.getElementById('container'); for (...) container.appendChild(...)"

# BAD FINDINGS (DO NOT REPORT THESE)

❌ EXAMPLE 16: Security Issue
Line: 45, Message: "SQL injection vulnerability"
Why skip: Security issue, not performance. Report in security review.

❌ EXAMPLE 17: Logic Bug
Line: 78, Message: "Off-by-one error in loop"
Why skip: Correctness issue, not performance. Report in logic review.

❌ EXAMPLE 18: Code Style
Line: 12, Message: "Variable naming is unclear"
Why skip: Style issue, not performance.

❌ EXAMPLE 19: Micro-Optimization
Line: 56, Message: "Could use ++i instead of i++"
Why skip: Negligible performance difference, not worth reporting.

❌ EXAMPLE 20: Premature Optimization
Line: 89, Message: "Could cache this value that's accessed once"
Why skip: Single access doesn't benefit from caching.

❌ EXAMPLE 21: Already Optimized
Line: 145, Message: "Consider memoization"
Why skip: Didn't verify - function already memoized at call site.

# SELF-CHALLENGE REQUIREMENT

Before reporting ANY finding, challenge yourself:

1. **"Is the performance impact measurable?"**
   → Don't report micro-optimizations or theoretical concerns

2. **"Is this a hot path?"**
   → Cold code paths may not need optimization

3. **"Is this already optimized elsewhere?"**
   → Check for caching layers, CDNs, database indexes

4. **"What is the scale?"**
   → Small data sets may not need optimization

## Counter-Argument Documentation

For performance findings that could be questioned, document your self-challenge:

**Example 1 - Report After Challenge:**

Finding: "N+1 query pattern in user listing"

Counter-Argument Considered:
"Data might be cached or dataset is small enough"

Rebuttal:
"✓ Verified: No caching layer present (checked Redis/cache imports)
✓ Scale analysis: users table has 50k+ records (from migration comments)
✓ Hot path confirmed: Called on every page load (dashboard component)
✓ Impact: 50k DB queries vs 1 with batch loading"

Decision: ✅ **Report** (confirmed significant performance impact)

**Example 2 - Skip After Challenge:**

Finding: "Array.includes() in loop could use Set"

Counter-Argument Considered:
"Array size might be small enough that Set overhead isn't worth it"

Rebuttal:
"✓ Checked data: Array has max 5 items (from validation schema)
✓ Scale analysis: O(5) lookup is negligible
✓ Set overhead: Creating Set costs more than 5 array lookups
✓ Hot path check: Called once per form submit (not performance critical)"

Decision: ❌ **Don't report** (micro-optimization with no measurable impact)

# OUTPUT FORMAT

1. ANALYSIS: Document your performance analysis step-by-step
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
          "category": "performance",
          "message": "Clear description of the performance issue",
          "suggestion": "Specific optimization with code example",
          "reasoning": "Complexity analysis, scale impact, verification notes",
          "isPreExisting": false
        }
      ]
    }
  }
}
\`\`\`

REMEMBER: Include entry for EVERY file listed, even with empty findings. Only report PERFORMANCE issues.
`;
}
