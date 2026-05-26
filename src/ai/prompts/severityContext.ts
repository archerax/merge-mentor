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

### Example 1: Missing Input Validation
- **src/auth/resetPassword.ts** — No validation on reset token → **CRITICAL** (account takeover)
- **src/api/createUser.ts** — No email format validation → **HIGH** (invalid data, downstream errors)
- **src/utils/parseNumber.ts** — No input guard → **MEDIUM** (returns NaN, caller must handle)

### Example 2: Hardcoded Secret
- **src/auth/oauth.ts** — \`const API_KEY = 'sk-live-abc123'\` → **CRITICAL** (live credential exposed)
- **src/utils/config.ts** — \`const DEFAULT_KEY = 'demo-key-123'\` → **HIGH** (may be real; verify)
- **tests/mocks/api.ts** — \`const MOCK_KEY = 'test-key-fake'\` → **LOW** (clearly fake test data)

### Example 3: Missing Error Handling
- **src/payment/charge.ts** — \`await stripe.charge()\` without try-catch → **CRITICAL** (inconsistent transaction state)
- **src/api/users.ts** — \`await db.query()\` without try-catch → **HIGH** (API crashes on DB error)
- **src/jobs/cleanup.ts** — \`await deleteOldRecords()\` without try-catch → **MEDIUM** (silently skipped, retried next run)

### Example 4: Logging Sensitive Data
- **src/auth/login.ts** — \`logger.info('Attempt', { email, password })\` → **CRITICAL** (plaintext credentials in logs)
- **src/payment/process.ts** — \`logger.info('Processing', { cardNumber })\` → **CRITICAL** (PCI-DSS violation)
- **src/logging/debug.ts** — \`logger.debug('Request', { headers })\` → **HIGH** (headers may contain auth tokens)

### Example 5: Race Condition
- **src/auth/sessionManager.ts** — Check-then-act race in session validation → **CRITICAL** (auth bypass window)
- **src/jobs/emailSender.ts** — Race in job status update → **MEDIUM** (duplicate sends, mitigated by retry logic)
- **tests/integration/concurrent.test.ts** — Race in test setup → **LOW** (flaky tests, no production impact)

### Example 6: SQL Injection
- **src/admin/userLookup.ts** — String concatenation in query with user input → **CRITICAL** (admin-level DB access)
- **src/routes/search.ts** — Same pattern in public endpoint → **CRITICAL** (direct security vulnerability)
- **tests/db/queries.test.ts** — Same pattern in test → **LOW** (test DB, fix as bad pattern)

---
`;
}
