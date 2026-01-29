/**
 * Context-aware severity scoring for code reviews.
 *
 * This module provides functionality to adjust issue severity based on code location
 * (auth code vs test code vs utility code). Security-critical paths get stricter scoring,
 * while test paths get lenient scoring.
 *
 * @module severityContext
 */

/**
 * Code context types for severity scoring.
 *
 * Different code contexts require different severity thresholds:
 * - Security-critical code (auth, login) warrants higher severity for bugs
 * - Test code warrants lower severity as it doesn't affect production
 * - Utility code depends on usage context
 */
export type CodeContext =
  | "security-critical" // auth, security, login, password, session, token
  | "financial" // payment, billing, checkout, transaction, invoice
  | "data-critical" // database, migration, storage, persistence
  | "api" // routes, endpoints, handlers, controllers
  | "background" // jobs, workers, queue, scheduler, cron
  | "test" // test, spec, __tests__, __mocks__, fixtures
  | "logging" // logging, debug, telemetry, metrics, tracing
  | "utility" // utils, helpers, lib, common, shared
  | "admin" // admin, internal, backoffice, dashboard
  | "standard"; // everything else

/**
 * Path patterns for detecting code context.
 * Order matters - first match wins, so more specific patterns come first.
 */
const CONTEXT_PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly context: CodeContext;
}> = [
  // Test patterns FIRST (before other patterns to catch test files in any directory)
  // File extension patterns (most specific, highest priority for test identification)
  {
    pattern: /\.(test|spec|e2e)\.(ts|tsx|js|jsx|mjs|cjs)$/i,
    context: "test",
  },
  // Directory patterns for test code
  {
    pattern: /\/(test|tests|spec|specs|__tests__|__mocks__|__fixtures__|e2e|integration-tests)\//i,
    context: "test",
  },
  {
    pattern: /^\/?(test|tests|spec|specs|e2e|integration-tests)\//i,
    context: "test",
  },
  {
    pattern: /\/(fixtures|mocks|stubs|fakes|testutils|test-utils|test-helpers)\//i,
    context: "test",
  },

  // Security-critical patterns
  {
    pattern:
      /\/(auth|authentication|authorization|security|login|logout|password|session|token|oauth|saml|sso|credential|secret|encrypt|decrypt|hash|jwt|2fa|mfa|otp)\//i,
    context: "security-critical",
  },
  {
    pattern:
      /\/(auth|authentication|authorization|security|login|logout|password|session|token|oauth|saml|sso|credential|secret|encrypt|decrypt|hash|jwt|2fa|mfa|otp)\.[^/]+$/i,
    context: "security-critical",
  },

  // Financial patterns
  {
    pattern:
      /\/(payment|billing|checkout|transaction|invoice|subscription|pricing|stripe|paypal|wallet|refund|charge|credit|debit)\//i,
    context: "financial",
  },
  {
    pattern:
      /\/(payment|billing|checkout|transaction|invoice|subscription|pricing|stripe|paypal|wallet|refund|charge|credit|debit)\.[^/]+$/i,
    context: "financial",
  },

  // Data-critical patterns
  {
    pattern:
      /\/(database|db|migration|migrations|schema|storage|persistence|repository|repositories|data-access|dao|orm|entity|entities|model|models)\//i,
    context: "data-critical",
  },
  {
    pattern: /\/(database|db|migration|schema|storage|persistence|repository|dao)\.[^/]+$/i,
    context: "data-critical",
  },

  // API patterns
  {
    pattern:
      /\/(routes|route|router|routers|endpoints|endpoint|handlers|handler|controllers|controller|api|rest|graphql|rpc)\//i,
    context: "api",
  },
  {
    pattern:
      /\/(routes|route|router|endpoints|endpoint|handlers|handler|controllers|controller)\.[^/]+$/i,
    context: "api",
  },

  // Background job patterns
  {
    pattern:
      /\/(jobs|job|workers|worker|queue|queues|scheduler|schedulers|cron|background|async-tasks|tasks|consumers|consumer)\//i,
    context: "background",
  },
  {
    pattern: /\/(jobs|job|workers|worker|queue|scheduler|cron|background)\.[^/]+$/i,
    context: "background",
  },

  // Admin patterns
  {
    pattern: /\/(admin|administration|internal|backoffice|back-office|dashboard|management|ops)\//i,
    context: "admin",
  },
  {
    pattern: /\/(admin|administration|internal|backoffice|dashboard|management)\.[^/]+$/i,
    context: "admin",
  },

  // Logging patterns
  {
    pattern:
      /\/(logging|logger|loggers|debug|telemetry|metrics|tracing|observability|monitoring|analytics)\//i,
    context: "logging",
  },
  {
    pattern: /\/(logging|logger|debug|telemetry|metrics|tracing)\.[^/]+$/i,
    context: "logging",
  },

  // Utility patterns (lowest priority before standard)
  {
    pattern: /\/(utils|util|utilities|helpers|helper|lib|libs|common|shared|core|base|support)\//i,
    context: "utility",
  },
  {
    pattern: /\/(utils|util|utilities|helpers|helper|lib|common|shared)\.[^/]+$/i,
    context: "utility",
  },
];

/**
 * Infers the code context from a file path to determine appropriate severity scoring.
 * Security-critical paths get stricter scoring, test paths get lenient scoring.
 *
 * The function normalizes path separators to forward slashes and applies pattern
 * matching in priority order (security-critical first, standard last).
 *
 * @param filepath - File path to analyze (can use forward or back slashes)
 * @returns The inferred code context
 *
 * @example
 * ```typescript
 * inferCodeContext('src/auth/validateToken.ts')     // 'security-critical'
 * inferCodeContext('src/payment/checkout.ts')       // 'financial'
 * inferCodeContext('tests/helpers/mockData.ts')    // 'test'
 * inferCodeContext('src/utils/formatDate.ts')      // 'utility'
 * inferCodeContext('src/components/Button.tsx')    // 'standard'
 * ```
 */
export function inferCodeContext(filepath: string): CodeContext {
  // Normalize path separators to forward slashes
  const normalizedPath = filepath.replace(/\\/g, "/");

  // Ensure path starts with a slash for consistent pattern matching
  const pathWithLeadingSlash = normalizedPath.startsWith("/")
    ? normalizedPath
    : `/${normalizedPath}`;

  for (const { pattern, context } of CONTEXT_PATTERNS) {
    if (pattern.test(pathWithLeadingSlash)) {
      return context;
    }
  }

  return "standard";
}

/**
 * Builds the context-aware severity scoring section for prompts.
 * This section guides AI to adjust severity based on code location.
 *
 * The section includes:
 * - Rules for severity adjustment by code location
 * - Detection heuristics for identifying code context
 * - 20+ examples showing the same bug in different contexts with different severities
 *
 * @returns Prompt section with severity scoring guidelines and examples
 *
 * @example
 * ```typescript
 * const severitySection = buildSeverityContextSection();
 * const prompt = `${otherSections}${severitySection}`;
 * ```
 */
export function buildSeverityContextSection(): string {
  return `
---
# CONTEXT-AWARE SEVERITY SCORING

Severity depends on CODE LOCATION and IMPACT. The same bug has different severity in different contexts.

## Severity Rules by Code Location

### Authentication/Authorization Code
Code in: \`/auth/\`, \`/security/\`, \`/login/\`, \`/password/\`, \`/session/\`, \`/token/\`
- **Input validation bug** → CRITICAL (security bypass risk)
- **Missing error handling** → HIGH (auth bypass via exception)
- **Logic error** → HIGH (unauthorized access possible)
- **Type coercion issue** → HIGH (authentication bypass)
- **Missing null check** → HIGH (security boundary violation)
- **Race condition** → CRITICAL (authentication bypass window)

### Payment/Financial Code
Code in: \`/payment/\`, \`/billing/\`, \`/checkout/\`, \`/transaction/\`
- **Calculation error** → CRITICAL (money loss, overcharge)
- **Race condition** → CRITICAL (double-charge/double-spend)
- **Rounding error** → HIGH (accumulates to significant loss)
- **Missing validation** → HIGH (fraudulent transactions)
- **Type coercion issue** → CRITICAL (incorrect monetary calculations)
- **Off-by-one error** → HIGH (incorrect billing periods)

### Data Processing/Storage Code
Code in: \`/database/\`, \`/migration/\`, \`/storage/\`, \`/repository/\`
- **Data loss bug** → CRITICAL (permanent data loss)
- **Transaction integrity issue** → CRITICAL (data corruption)
- **Missing error handling** → HIGH (silent data loss)
- **Race condition** → HIGH (data corruption)
- **Performance issue** → MEDIUM (batch job timeout, degraded service)
- **Null handling issue** → HIGH (data integrity violation)

### API Endpoints
Code in: \`/routes/\`, \`/endpoints/\`, \`/handlers/\`, \`/controllers/\`
- **No rate limiting** → HIGH (DoS vulnerability)
- **Missing input validation** → HIGH (injection risk)
- **Poor error messages** → MEDIUM (info disclosure)
- **Missing authentication check** → CRITICAL (unauthorized access)
- **Missing authorization check** → CRITICAL (privilege escalation)
- **Response data leak** → HIGH (sensitive data exposure)

### Background Jobs/Workers
Code in: \`/jobs/\`, \`/workers/\`, \`/queue/\`, \`/scheduler/\`
- **Infinite loop** → CRITICAL (resource exhaustion, system down)
- **Missing retry logic** → MEDIUM (reliability issue)
- **No idempotency** → HIGH (duplicate processing)
- **Memory leak** → HIGH (worker crashes over time)
- **Unhandled exception** → MEDIUM (job silently fails)
- **Performance issue** → LOW (runs async, less user-facing)

### Error Handling Code
Code in error handlers, catch blocks, fallback logic
- **Bug in error handler** → MEDIUM (already in failure path)
- **Missing validation** → LOW (error input less critical)
- **Swallowed exception** → MEDIUM (debugging difficulty)
- **Incorrect error type** → LOW (affects logging/monitoring)

### Test Code
Code in: \`/test/\`, \`/spec/\`, \`/__tests__/\`, \`/__mocks__/\`, \`.test.\`, \`.spec.\`
- **Most issues** → LOW (doesn't affect production)
- **Flaky test logic** → LOW (test reliability)
- **Missing test case** → MEDIUM (coverage gap)
- **Incorrect assertion** → LOW (test accuracy)
- **Hardcoded test data** → LOW (test maintainability)

### Logging/Debug Code
Code in: \`/logging/\`, \`/debug/\`, \`/telemetry/\`, \`/metrics/\`
- **Most issues** → LOW (non-critical path)
- **Sensitive data logged** → HIGH (security/compliance violation)
- **PII in logs** → HIGH (privacy violation, GDPR/CCPA)
- **Performance issue** → MEDIUM (logging overhead)
- **Missing error context** → LOW (debugging difficulty)

### Admin/Internal Tools
Code in: \`/admin/\`, \`/internal/\`, \`/backoffice/\`
- **All issues elevated by one level** (high privilege = higher impact)
- **Missing auth check** → CRITICAL (admin access to anyone)
- **Injection vulnerability** → CRITICAL (admin-level data access)
- **Logic error** → HIGH (admin actions are impactful)

### Utility/Helper Code
Code in: \`/utils/\`, \`/helpers/\`, \`/lib/\`, \`/common/\`
- **Severity depends on usage context**
- **If used in auth/payment** → Evaluate at caller's context level
- **If general purpose** → MEDIUM default
- **Type safety issue** → MEDIUM (affects all callers)
- **Performance issue** → Context-dependent

## Detection Heuristics

When reviewing a file, use its path to determine context:

| Path Pattern | Context | Severity Adjustment |
|--------------|---------|---------------------|
| \`/auth/\`, \`/security/\`, \`/login/\` | Security-Critical | ⬆️ Strict scoring |
| \`/payment/\`, \`/billing/\`, \`/checkout/\` | Financial | ⬆️ Strict correctness |
| \`/database/\`, \`/migration/\`, \`/storage/\` | Data-Critical | ⬆️ Data integrity focus |
| \`/routes/\`, \`/api/\`, \`/handlers/\` | API | ⬆️ Security + validation |
| \`/jobs/\`, \`/workers/\`, \`/queue/\` | Background | ➡️ Reliability focus |
| \`/test/\`, \`/spec/\`, \`/__tests__/\` | Test | ⬇️ Lenient scoring |
| \`/logging/\`, \`/debug/\`, \`/telemetry/\` | Logging | ⬇️ Lenient (except PII) |
| \`/utils/\`, \`/helpers/\`, \`/lib/\` | Utility | ➡️ Context-dependent |
| \`/admin/\`, \`/internal/\` | Admin | ⬆️ High privilege |

## Context-Aware Severity Examples

### Example 1: Array Access Without Bounds Check

**Location: src/auth/validateToken.ts, Line 45**
Bug: \`const role = roles[index]\` - no bounds check
Severity: **CRITICAL**
Reasoning: "In authentication code, out-of-bounds access could bypass role verification
if attacker controls array index. Index=-1 or index=999 might return undefined, which
could be coerced to falsy and bypass auth checks. Security-critical context elevates severity."

**Location: src/utils/formatDate.ts, Line 45**
Bug: \`const month = months[index]\` - no bounds check
Severity: **MEDIUM**
Reasoning: "In utility function, would cause crash or undefined behavior but no security impact.
Should be fixed for reliability but not critical. Utility context = standard severity."

**Location: tests/helpers/mockData.ts, Line 45**
Bug: \`const fixture = fixtures[index]\` - no bounds check
Severity: **LOW**
Reasoning: "Test code only, no production impact. Fix for test reliability but not urgent.
Test context = lenient severity."

### Example 2: Missing Null Check

**Location: src/payment/processTransaction.ts, Line 78**
Bug: \`user.paymentMethod.cardNumber\` without null check
Severity: **CRITICAL**
Reasoning: "In payment code, null access crashes the transaction mid-process. Could leave
payment in inconsistent state (charged but not recorded). Financial context demands critical severity."

**Location: src/components/UserProfile.tsx, Line 78**
Bug: \`user.profile.avatar\` without null check
Severity: **MEDIUM**
Reasoning: "In UI component, would crash the page but no data loss or security impact.
Standard UI code = medium severity for null pointer issues."

**Location: src/logging/formatLog.ts, Line 78**
Bug: \`context.metadata.requestId\` without null check
Severity: **LOW**
Reasoning: "In logging code, would skip logging this request but no user-facing impact.
Logging context = lenient severity unless it involves sensitive data."

### Example 3: Race Condition

**Location: src/auth/sessionManager.ts, Line 112**
Bug: Check-then-act race in session validation
Severity: **CRITICAL**
Reasoning: "Race window in session validation could allow expired/revoked sessions to
pass authentication. Attacker could exploit timing to bypass security checks.
Security-critical context = critical severity for any race condition."

**Location: src/jobs/emailSender.ts, Line 112**
Bug: Race condition in job status update
Severity: **MEDIUM**
Reasoning: "Could cause duplicate email sends or missed updates, but jobs have retry logic
and idempotency keys. Background job context with mitigations = medium severity."

**Location: tests/integration/concurrent.test.ts, Line 112**
Bug: Race condition in test setup
Severity: **LOW**
Reasoning: "May cause flaky tests but no production impact. Test context = low severity."

### Example 4: SQL Injection Pattern

**Location: src/admin/userLookup.ts, Line 56**
Bug: String concatenation in SQL query with user input
Severity: **CRITICAL**
Reasoning: "Admin tools have elevated privileges. SQL injection here grants attacker full
admin-level database access. Admin context elevates already-critical security issue."

**Location: src/routes/search.ts, Line 56**
Bug: String concatenation in SQL query with user input
Severity: **CRITICAL**
Reasoning: "Public API endpoint with SQL injection. Critical regardless of context because
it's a direct security vulnerability. API context confirms critical severity."

**Location: tests/db/queries.test.ts, Line 56**
Bug: String concatenation in test query
Severity: **LOW**
Reasoning: "Test database with test data, not connected to production. Test context = low,
but recommend fixing as bad pattern that could be copied."

### Example 5: Hardcoded Secret

**Location: src/auth/oauth.ts, Line 23**
Bug: \`const API_KEY = 'sk-live-abc123'\` hardcoded
Severity: **CRITICAL**
Reasoning: "Live API key in authentication code, directly exposes credentials.
Security-critical context + credential exposure = critical."

**Location: src/utils/config.ts, Line 23**
Bug: \`const DEFAULT_KEY = 'demo-key-123'\` hardcoded
Severity: **HIGH**
Reasoning: "Could be a real key or intentional default. Utility context but credential
exposure warrants high severity. Verify if this is actually sensitive."

**Location: tests/mocks/api.ts, Line 23**
Bug: \`const MOCK_KEY = 'test-key-fake'\` hardcoded
Severity: **LOW**
Reasoning: "Test mock data, clearly fake key for testing. Test context = low."

### Example 6: Missing Error Handling

**Location: src/payment/charge.ts, Line 89**
Bug: \`await stripe.charge()\` without try-catch
Severity: **CRITICAL**
Reasoning: "Payment operation without error handling could leave transaction in unknown state.
User charged but order not recorded, or vice versa. Financial context = critical."

**Location: src/api/users.ts, Line 89**
Bug: \`await db.query()\` without try-catch
Severity: **HIGH**
Reasoning: "API endpoint crashes on database error, returns 500 to user. API context with
potential data issues = high severity."

**Location: src/jobs/cleanup.ts, Line 89**
Bug: \`await deleteOldRecords()\` without try-catch
Severity: **MEDIUM**
Reasoning: "Background cleanup job fails silently, will retry on next run. Background context
with retry logic = medium severity."

### Example 7: Type Coercion Issue

**Location: src/auth/validateUser.ts, Line 34**
Bug: \`if (userId == requestId)\` using loose equality
Severity: **HIGH**
Reasoning: "Authentication validation using loose equality. '123' == 123 could allow
type juggling attacks. Security-critical context = high severity."

**Location: src/billing/compare.ts, Line 34**
Bug: \`if (amount == expected)\` using loose equality
Severity: **HIGH**
Reasoning: "Financial comparison with loose equality. String '100' equals number 100,
could mask calculation errors. Financial context = high severity."

**Location: src/utils/compare.ts, Line 34**
Bug: \`if (a == b)\` using loose equality
Severity: **MEDIUM**
Reasoning: "General utility comparison. Unexpected behavior possible but impact depends
on usage. Utility context = medium, recommend strict equality."

### Example 8: Logging Sensitive Data

**Location: src/auth/login.ts, Line 67**
Bug: \`logger.info('Attempt', { email, password })\`
Severity: **CRITICAL**
Reasoning: "Password logged in plaintext during auth. Credentials exposed in log aggregators,
stored indefinitely. Security-critical context + credential exposure = critical."

**Location: src/payment/process.ts, Line 67**
Bug: \`logger.info('Processing', { cardNumber, cvv })\`
Severity: **CRITICAL**
Reasoning: "Credit card data logged. PCI-DSS violation, massive compliance and security risk.
Financial context + PII = critical."

**Location: src/logging/debug.ts, Line 67**
Bug: \`logger.debug('Request', { headers })\`
Severity: **HIGH**
Reasoning: "Headers may contain auth tokens. Even in logging code, exposing auth tokens is
high severity. Logging context but security-sensitive data = high."

### Example 9: Missing Input Validation

**Location: src/auth/resetPassword.ts, Line 45**
Bug: No validation on password reset token
Severity: **CRITICAL**
Reasoning: "Password reset without token validation allows account takeover.
Security-critical context = critical for any input validation gap."

**Location: src/api/createUser.ts, Line 45**
Bug: No validation on email format
Severity: **HIGH**
Reasoning: "API endpoint accepts invalid data, causes downstream errors.
API context = high for missing validation."

**Location: src/utils/parseNumber.ts, Line 45**
Bug: No validation on input string
Severity: **MEDIUM**
Reasoning: "Utility function may receive bad input, returns NaN. Utility context = medium,
callers should handle edge cases."

### Example 10: Infinite Loop Risk

**Location: src/auth/retryLogin.ts, Line 156**
Bug: While loop without guaranteed exit condition
Severity: **CRITICAL**
Reasoning: "Infinite loop in authentication path blocks all auth requests, complete DoS.
Security-critical context = critical for any availability issue."

**Location: src/jobs/processQueue.ts, Line 156**
Bug: While loop without guaranteed exit condition
Severity: **CRITICAL**
Reasoning: "Infinite loop exhausts worker resources, jobs stop processing.
Background context but resource exhaustion = critical."

**Location: tests/stress/loop.test.ts, Line 156**
Bug: While loop without guaranteed exit condition
Severity: **LOW**
Reasoning: "Test code, will timeout in test runner. Test context = low."

### Example 11: Unhandled Promise Rejection

**Location: src/database/migrate.ts, Line 89**
Bug: \`db.migrate()\` without await or catch
Severity: **CRITICAL**
Reasoning: "Migration runs without error handling, could silently fail leaving DB in
inconsistent state. Data-critical context = critical."

**Location: src/api/notify.ts, Line 89**
Bug: \`sendNotification()\` without await or catch
Severity: **MEDIUM**
Reasoning: "Notification may fail silently, user not notified. API context but
non-critical side effect = medium."

**Location: src/logging/flush.ts, Line 89**
Bug: \`logBuffer.flush()\` without await or catch
Severity: **LOW**
Reasoning: "Log flush may fail, some logs lost. Logging context = low severity."

### Example 12: Off-by-One Error

**Location: src/billing/prorateDays.ts, Line 78**
Bug: \`for (i = 0; i < days - 1; i++)\` excludes last day
Severity: **CRITICAL**
Reasoning: "Billing calculation excludes last day, user undercharged or overcharged.
Financial context = critical for any calculation error."

**Location: src/api/paginate.ts, Line 78**
Bug: \`items.slice(0, count - 1)\` returns one less item
Severity: **MEDIUM**
Reasoning: "Pagination returns wrong number of items. API context = medium,
annoying but not data loss."

**Location: tests/fixtures/generate.ts, Line 78**
Bug: \`for (i = 0; i < n - 1; i++)\` generates one less fixture
Severity: **LOW**
Reasoning: "Test generates fewer fixtures. Test context = low."

### Example 13: Memory Leak

**Location: src/auth/sessionCache.ts, Line 112**
Bug: Sessions added to cache but never evicted
Severity: **HIGH**
Reasoning: "Memory grows unbounded, auth service eventually crashes. Security-critical
context = high for availability issues."

**Location: src/api/connectionPool.ts, Line 112**
Bug: Connections opened but not closed
Severity: **HIGH**
Reasoning: "Connection pool exhaustion, API stops serving requests. API context = high."

**Location: src/jobs/cache.ts, Line 112**
Bug: Job results cached without TTL
Severity: **MEDIUM**
Reasoning: "Worker memory grows over time, eventually restarts. Background context
with automatic recovery = medium."

### Example 14: Division by Zero Risk

**Location: src/payment/calculateDiscount.ts, Line 56**
Bug: \`discount = total / items.length\` without zero check
Severity: **CRITICAL**
Reasoning: "Division by zero crashes payment calculation. Financial context = critical."

**Location: src/utils/average.ts, Line 56**
Bug: \`avg = sum / count\` without zero check
Severity: **MEDIUM**
Reasoning: "Returns Infinity/NaN for empty input. Utility context = medium."

**Location: tests/math/divide.test.ts, Line 56**
Bug: Test divides without zero check
Severity: **LOW**
Reasoning: "Test code, may fail test run. Test context = low."

### Example 15: Missing Authorization Check

**Location: src/admin/deleteUser.ts, Line 34**
Bug: No admin role verification before delete
Severity: **CRITICAL**
Reasoning: "Any authenticated user could delete users via admin endpoint.
Admin context = critical for any authz gap."

**Location: src/api/updateProfile.ts, Line 34**
Bug: No ownership verification before update
Severity: **HIGH**
Reasoning: "User could update any profile, not just their own. IDOR vulnerability.
API context = high for authorization issues."

**Location: src/internal/debugTool.ts, Line 34**
Bug: Debug tool accessible without auth
Severity: **HIGH**
Reasoning: "Internal tools should still require authentication. Admin context = high."

### Example 16: Improper Error Message

**Location: src/auth/login.ts, Line 89**
Bug: Error message reveals whether email exists
Severity: **HIGH**
Reasoning: "Username enumeration allows attackers to discover valid accounts.
Security-critical context = high for info disclosure."

**Location: src/api/search.ts, Line 89**
Bug: Error includes internal file paths
Severity: **MEDIUM**
Reasoning: "Information disclosure but limited security impact. API context = medium."

**Location: src/utils/parse.ts, Line 89**
Bug: Verbose error message for invalid input
Severity: **LOW**
Reasoning: "Internal utility, verbose errors help debugging. Utility context = low."

### Example 17: Timing Attack Vulnerability

**Location: src/auth/compareTokens.ts, Line 45**
Bug: Using \`===\` instead of constant-time comparison
Severity: **HIGH**
Reasoning: "String comparison timing reveals token length and prefix. Security-critical
context = high for timing attacks."

**Location: src/utils/compare.ts, Line 45**
Bug: Using \`===\` for string comparison
Severity: **LOW**
Reasoning: "Non-security utility comparison. Utility context = low."

### Example 18: Insecure Random

**Location: src/auth/generateToken.ts, Line 23**
Bug: Using \`Math.random()\` for security token
Severity: **CRITICAL**
Reasoning: "Math.random() is predictable, tokens can be guessed. Security-critical
context = critical for cryptographic weakness."

**Location: src/utils/shuffleArray.ts, Line 23**
Bug: Using \`Math.random()\` for shuffle
Severity: **LOW**
Reasoning: "Non-security shuffle. Utility context = low."

### Example 19: Prototype Pollution

**Location: src/api/parseQuery.ts, Line 67**
Bug: Object merge from user input without sanitization
Severity: **HIGH**
Reasoning: "Prototype pollution from query params affects all objects. API context
with security implications = high."

**Location: src/utils/deepMerge.ts, Line 67**
Bug: Deep merge without prototype check
Severity: **MEDIUM**
Reasoning: "Utility function, impact depends on usage. Utility context = medium,
recommend sanitization."

### Example 20: File Path Traversal

**Location: src/admin/downloadFile.ts, Line 78**
Bug: \`fs.readFile(userPath)\` without path sanitization
Severity: **CRITICAL**
Reasoning: "Admin endpoint with path traversal allows reading any file on server.
Admin context + file access = critical."

**Location: src/api/serveAsset.ts, Line 78**
Bug: \`fs.readFile(assetPath)\` without path sanitization
Severity: **HIGH**
Reasoning: "Public API with path traversal. API context = high."

**Location: tests/fixtures/loadFile.ts, Line 78**
Bug: Test loads file without sanitization
Severity: **LOW**
Reasoning: "Test environment, limited impact. Test context = low."

---
`;
}
