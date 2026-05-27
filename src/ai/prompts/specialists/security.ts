import type { PRDetails } from "../../../platforms/types.js";
import type { DiffManifest } from "../../../review/diffStorage.js";
import { buildSecurityPreamble, wrapUntrustedPRMetadata } from "../securityPreamble.js";
import { buildSeverityContextSection } from "../severityContext.js";
import {
  buildBatchedFileResultsOutputFormat,
  buildCrossFileOutputFormat,
} from "./outputFormats.js";
import type { BaseCrossFileContext } from "./types.js";

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
 * Context for security cross-file analysis.
 */
export interface SecurityCrossFileContext extends BaseCrossFileContext {
  readonly existingCommentsContext?: string;
}

/**
 * Builds a prompt for security-focused file review.
 * Instructs the AI to act as a security researcher and ONLY report security vulnerabilities.
 */
export function buildSecurityFileReviewPrompt(manifest: DiffManifest, repoPath?: string): string {
  const diffPrefix = repoPath ? ".mergementor/diffs/" : "";
  const filesListing = manifest.files
    .map(
      (f) =>
        `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) → @${diffPrefix}${f.diffPath}`
    )
    .join("\n");

  const workspaceSection = buildWorkspaceSection(repoPath);

  return `${buildSecurityPreamble()}# YOUR ROLE
You are a **Security Researcher** performing a security-focused code review.
Your ONLY job is to find security vulnerabilities.
${workspaceSection}
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

For security findings that could be questioned, apply the self-challenge above before reporting. Only include findings where the attack vector is realistic and not already mitigated.

${buildBatchedFileResultsOutputFormat({
  analysisInstruction: "Document your security analysis step-by-step",
  severityExample: "critical",
  categoryExample: "security",
  messageExample: "Clear description of the security vulnerability",
  suggestionExample: "Specific remediation with code example",
  reasoningExample: "Attack vector and concrete security impact",
  footer:
    "REMEMBER: Include entry for EVERY file listed, even with empty findings. Only report SECURITY issues.",
})}
`;
}

/**
 * Builds a prompt for security-focused cross-file analysis.
 * Focuses on system-level security concerns across multiple files.
 */
export function buildSecurityCrossFilePrompt(
  prDetails: PRDetails,
  context: SecurityCrossFileContext,
  repoPath?: string
): string {
  const { filesSummary, fileReviewResults, existingCommentsContext } = context;

  const findingsSummary = fileReviewResults
    .filter((r) => r.findings.length > 0)
    .map((r) => `${r.filename}: ${r.findings.length} finding(s)`)
    .join("\n");

  const commentsSection = existingCommentsContext
    ? `\nEXISTING PR COMMENTS:\n${existingCommentsContext}\n\nIMPORTANT: Be aware of issues already flagged. Focus on NEW security concerns not already covered.\n`
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

**Critical for Security Analysis:**

1. **Before flagging "missing authentication":**
   \`@workspace /search authentication middleware\` to check for centralized auth

2. **Before reporting "no input validation":**
   \`@workspace /search validation\` to find shared validators

3. **Before claiming "inconsistent security":**
   \`@workspace /find security\` to understand existing security patterns

4. **For authorization concerns:**
   Explore existing access control mechanisms across the codebase

**MANDATORY:** Always cross-reference the repository before reporting:
- Authentication/authorization might be handled centrally
- Input validation might exist at API gateway
- Security patterns might be framework-provided
- Defense-in-depth layers might exist at different levels

---
`
    : "";

  return `${buildSecurityPreamble()}# YOUR ROLE
Security researcher performing system-level security analysis of a pull request.
Your focus is on cross-file security concerns and architectural security issues.
${workspaceSection}
# PR CONTEXT
${wrapUntrustedPRMetadata(prDetails.title, prDetails.description)}

Changed Files:
${filesSummary}

Individual File Security Findings:
${findingsSummary || "No individual security issues found"}
${commentsSection}
# CRITICAL SCOPE RESTRICTIONS

**ONLY REPORT** system-level security issues. You MUST IGNORE:
- ❌ Single-file vulnerabilities (already covered in file reviews)
- ❌ Logic bugs without security impact
- ❌ Performance issues
- ❌ Code quality concerns
- ❌ Architectural issues without security implications

Focus on security concerns that span multiple files or affect system-wide security posture.

# CRITICAL RULES
1. ONLY analyze files in the Changed Files list above
2. Do NOT duplicate issues already caught in individual file reviews
3. Include confidence (high/medium/low) and reasoning for EVERY finding
4. Focus on system-level security concerns across multiple files

# VERIFICATION CHECKLIST

Before reporting any cross-file security finding, verify:

□ Issue spans multiple files (not a single-file concern)
□ Issue is NEW to this PR (not pre-existing security debt)
□ Issue isn't already covered in individual file reviews
□ All affected files are actually in the Changed Files list
□ Issue has system-wide security impact
□ There's a realistic attack scenario across these files
□ Severity matches the cross-file security impact

## Verification Documentation Requirements

For EACH finding, your reasoning field must include:

- ✓ Cross-file confirmation: Which files and how they interact insecurely
- ✓ Attack scenario: Specific cross-file exploit path
- ✓ Pattern check: Whether similar security patterns exist elsewhere
- ✓ Integration verification: How components create security gaps together
- ✓ Impact assessment: System-wide security consequences
- ✓ Severity justification: Why this matters at the architecture level

**Example of proper verification in reasoning:**

    ✓ Confirmed: AuthMiddleware.ts adds rate limiting, but ApiRoutes.ts bypasses it
    ✓ Verified integration: ApiRoutes directly defines routes without middleware chain
    ✓ Pattern check: All other route files (UserRoutes, OrderRoutes) include rate limiting
    ✓ Attack scenario: Attacker can brute-force API endpoints without rate limits
    ✓ System impact: DoS vulnerability and credential brute-force risk
    ✓ Severity justification: high (system-wide security control bypassed)

# CROSS-FILE SECURITY FOCUS AREAS

Analyze for these system-level security concerns:

## 1. Authentication/Authorization Architecture
- Inconsistent auth enforcement across modules
- Missing authentication on new endpoints
- Authorization bypasses through alternate code paths
- Privilege escalation across component boundaries
- Session management inconsistencies

## 2. Trust Boundaries
- Data crossing trust boundaries without validation
- Missing input validation at system entry points
- Unsafe data flow from untrusted to trusted components
- Backend trusting frontend validation

## 3. Security Control Consistency
- Security controls applied inconsistently
- Some endpoints protected, others exposed
- Partial migration to secure patterns
- Mixed security levels across related functionality

## 4. Cross-Component Data Exposure
- Sensitive data exposed through component integration
- Information leakage across module boundaries
- Incomplete data sanitization in multi-tier flows
- Logging exposing data from multiple sources

## 5. Cryptographic Architecture
- Inconsistent crypto standards across modules
- Key management issues across components
- Mixed encryption standards in integrated systems
- Secrets management inconsistencies

## 6. Distributed Security Issues
- Race conditions in distributed auth checks
- TOCTOU across service boundaries
- Inconsistent state across distributed components
- Transaction integrity in distributed operations

# SEVERITY THRESHOLDS
Use these exact criteria for cross-file security issues:
- **critical**: System-wide authentication bypass, widespread data exposure, architectural RCE
- **high**: Major security control gap, significant authorization flaw, cross-module vulnerability
- **medium**: Partial security control inconsistency, defense-in-depth gap
- **low**: Minor architectural security improvement opportunity

# CONFIDENCE LEVELS
- **high**: Clear cross-file security issue with obvious exploit path
- **medium**: Likely security concern that needs verification
- **low**: Potential security concern based on general practices

# SELF-CHALLENGE REQUIREMENT

Before reporting ANY finding, challenge yourself:

1. **"Is this truly a cross-file security issue?"**
   → Don't report single-file issues in cross-file analysis

2. **"Is this security control intentionally at different layers?"**
   → Example: Auth at API gateway, not application code

3. **"Is there a realistic cross-file attack scenario?"**
   → Must be able to describe multi-file exploit path

4. **"Is this architectural context I'm missing?"**
   → Example: Security framework conventions

5. **"Would a security architect flag this?"**
   → Gut check: Substantive architectural vulnerability?

## Counter-Argument Documentation

For findings that could be questioned, apply the self-challenge above before reporting. Only include findings with a realistic cross-file attack scenario.

${buildCrossFileOutputFormat({
  intro: "Provide a complete cross-file security analysis in JSON format:",
  severityExample: "high",
  categoryExample: "security",
  messageExample: "Clear description of cross-file security issue",
  reasoningExample: "Why this cross-file security concern is real and its attack impact",
  overallAssessmentExample:
    "Brief summary of PR's security posture and architectural security concerns",
  recommendationExample: "Actionable security improvement suggestions",
  footer:
    "Focus on system-level security: auth/authz consistency, trust boundaries, security control gaps, cross-component vulnerabilities.",
})}
`;
}
