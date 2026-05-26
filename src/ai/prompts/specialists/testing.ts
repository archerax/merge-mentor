import type { PRDetails } from "../../../platforms/types.js";
import type { DiffManifest } from "../../../review/diffStorage.js";
import { buildSecurityPreamble, wrapUntrustedPRMetadata } from "../securityPreamble.js";
import { buildSeverityContextSection } from "../severityContext.js";
import {
  buildBatchedFileResultsOutputFormat,
  buildCrossFileOutputFormat,
} from "./outputFormats.js";
import type { TestingCrossFileContext, TestingReviewContext } from "./types.js";

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
- Check for existing test patterns and conventions
- Verify test coverage for similar files
- Understand the testing architecture before reporting gaps

---
`;
}

/**
 * Gets language-specific testing guidance.
 */
function getLanguageTestingGuidance(language: "csharp" | "typescript" | "unknown"): string {
  if (language === "csharp") {
    return `
# C# TESTING STANDARDS

## Required Test Patterns
- **Unit Tests**: xUnit, NUnit, or MSTest with proper [Fact]/[Test] attributes
- **Mocking**: Moq, NSubstitute, or FakeItEasy for dependencies
- **Assertions**: FluentAssertions or Assert class methods
- **Naming**: MethodName_Scenario_ExpectedBehavior pattern

## Test Organization
- Test classes should mirror production class names (UserService → UserServiceTests)
- One test class per production class
- Arrange-Act-Assert pattern in all tests
- Test methods should be public void/async Task

## Coverage Expectations
- Public methods: 100% coverage of happy and error paths
- Edge cases: null checks, boundary values, empty collections
- Async methods: Test both successful and faulted tasks
- Exception handling: Verify expected exceptions with Assert.Throws<T>

## C#-Specific Concerns
- Test async/await patterns properly
- Verify IDisposable cleanup in tests
- Test LINQ query logic separately from data access
- Mock ILogger, IConfiguration, IOptions<T> dependencies
- Test dependency injection registrations
`;
  }

  if (language === "typescript") {
    return `
# TYPESCRIPT TESTING STANDARDS

## Required Test Patterns
- **Test Framework**: Vitest, Jest, or Mocha with proper describe/it blocks
- **Mocking**: vi.fn(), vi.mock() for dependencies
- **Assertions**: expect() with specific matchers
- **Naming**: Descriptive test names with "should" or behavior-focused

## Test Organization
- Test files colocated (*.test.ts, *.spec.ts) or in __tests__/ directory
- Group related tests with describe() blocks
- One concept per test (single assertion focus)
- Use beforeEach/afterEach for setup/cleanup

## Coverage Expectations
- Functions: All code paths (happy path + error cases)
- Edge cases: undefined, null, empty arrays/objects, boundary values
- Async operations: Promises, async/await error handling
- Type guards: Runtime type checking validation
- React components: Render, user interactions, conditional rendering

## TypeScript-Specific Concerns
- Test type narrowing and type guards
- Verify generic type behavior with different type arguments
- Test discriminated unions handle all cases
- Mock TypeScript interfaces properly
- Test with strict mode edge cases (null, undefined)
`;
  }

  return `
# GENERAL TESTING STANDARDS

## Core Principles
- Tests should be independent and deterministic
- Each test should verify one specific behavior
- Use descriptive test names that explain what is tested
- Follow Arrange-Act-Assert pattern

## Coverage Focus
- All public API methods and functions
- Error handling and edge cases
- Boundary conditions and input validation
- Integration points with dependencies
`;
}

/**
 * Builds a prompt for testing-focused review of a single file.
 * Analyzes test coverage, test quality, and testability of production code.
 *
 * @param manifest - Manifest describing stored diff files
 * @param context - Context about the file, test files, and language
 * @param repoContext - Optional repository-specific coding standards and guidelines
 * @param repoPath - Optional path to cloned repository for workspace access
 * @returns Formatted prompt for testing review
 */
export function buildTestingFileReviewPrompt(
  manifest: DiffManifest,
  context: TestingReviewContext,
  repoPath?: string
): string {
  const diffPrefix = repoPath ? ".mergementor/diffs/" : "";
  const filesListing = manifest.files
    .map(
      (f) =>
        `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) → @${diffPrefix}${f.diffPath}`
    )
    .join("\n");

  const workspaceSection = buildWorkspaceSection(repoPath);
  const languageGuidance = getLanguageTestingGuidance(context.language);

  const testFileContext =
    context.testFiles.length > 0
      ? `
## ASSOCIATED TEST FILES

The following test file(s) exist for this production file:
${context.testFiles.map((f) => `- ${f}`).join("\n")}

**Your task:** Verify that tests adequately cover the changes in the production file.
`
      : `
## NO TEST FILE FOUND

⚠️ **WARNING:** No corresponding test file was found for this production file.

Common test patterns to look for:
- TypeScript: ${context.filename.replace(/\.tsx?$/, ".test.ts")}, ${context.filename.replace(/\.tsx?$/, ".spec.ts")}
- C#: ${context.filename.replace(/\.cs$/, "Test.cs")}, ${context.filename.replace(/\.cs$/, "Tests.cs")}

**Your task:** Evaluate whether this production file needs tests based on its content.
`;

  return `${buildSecurityPreamble()}# YOUR ROLE
You are a **Test Quality Expert** performing a testing-focused code review.
Your ONLY job is to evaluate test coverage, test quality, and code testability.
${workspaceSection}${languageGuidance}
# CRITICAL SCOPE RESTRICTIONS

**ONLY REPORT** testing-related issues. You MUST IGNORE:
- ❌ Logic bugs (unless they affect testability)
- ❌ Performance issues
- ❌ Security vulnerabilities  
- ❌ Code style/quality (unless it impacts testability)
- ❌ Architectural concerns (unless testing-related)

If an issue does NOT relate to testing, test coverage, or testability, DO NOT REPORT IT.

# FILE TO REVIEW

${filesListing}
${testFileContext}
# TESTING ANALYSIS AREAS

## 1. Test Coverage Analysis
${
  context.testFiles.length > 0
    ? `
**Since test file(s) exist, verify:**
- ✓ New/modified functions have corresponding tests
- ✓ Edge cases are tested (null, empty, invalid input)
- ✓ Error paths have test coverage
- ✓ All public methods are tested
- ✓ Conditional branches (if/else, switch) are covered
- ✓ Async operations have success and failure tests
`
    : `
**Since no test file exists, evaluate:**
- ✓ Does this file contain testable logic?
- ✓ Should this file have unit tests?
- ✓ What are the risks of no test coverage?
- ✓ Are there public methods/functions that need testing?
`
}

## 2. Test Naming Convention Validation
${
  context.testFiles.length > 0
    ? `
**Verify test naming follows language conventions:**
${
  context.language === "csharp"
    ? `- C# Pattern: MethodName_Scenario_ExpectedBehavior (e.g., GetUser_InvalidId_ThrowsException)
- Test class names match: UserService → UserServiceTests
- Naming is clear and self-documenting`
    : context.language === "typescript"
      ? `- TypeScript Pattern: describe/it blocks with behavior descriptions
- Test names start with "should" or describe behavior (e.g., "throws error when input is invalid")
- Clear hierarchy: describe(component) → describe(method) → it(behavior)`
      : `- Test names clearly describe what is being tested and expected outcome
- Consistent naming pattern throughout test suite
- Self-documenting without needing to read test body`
}
- Test names match actual test behavior (no misleading names)
- Names reveal intent without requiring comments
`
    : `
**Not applicable** - no test file to evaluate.
`
}

## 3. Assertion Verification
${
  context.testFiles.length > 0
    ? `
**Verify assertions match test behavior and names:**
- Assertions actually test the behavior described in test name
- Multiple assertions focus on same logical concept (not testing unrelated things)
- Assertions verify behavior outcomes, not implementation details
- Sufficient assertions to prove behavior (not just "doesn't crash")
- No missing assertions (test calls method but doesn't verify result)
- Appropriate matchers used (toBe vs toEqual, specific vs generic)
`
    : `
**Not applicable** - no test file to evaluate.
`
}

## 4. Mock Framework Usage
${
  context.testFiles.length > 0
    ? `
**Validate mocking/stubbing follows language best practices:**
${
  context.language === "csharp"
    ? `- C# Mocking: Moq, NSubstitute, or FakeItEasy used correctly
- Mock setup: .Setup(), .Returns(), Substitute.For<T>() patterns
- Verification: .Verify(), .Received() to assert interactions
- Mock lifecycle: Mocks created fresh per test, no shared state`
    : context.language === "typescript"
      ? `- TypeScript Mocking: vi.fn(), vi.mock(), vi.spyOn() used correctly
- Mock creation: vi.fn() for functions, vi.mock() for modules
- Assertions: expect(mockFn).toHaveBeenCalledWith() patterns
- Mock cleanup: vi.clearAllMocks() or beforeEach reset`
      : `- Appropriate mocking framework used
- Mocks created correctly for dependencies
- Mock interactions verified when relevant
- Mocks isolated per test (no shared state)`
}
- Not over-mocking (testing mocks instead of behavior)
- Dependencies mocked, but core logic tested real
- Mock setup matches actual usage patterns
`
    : `
**Not applicable** - no test file to evaluate.
`
}

## 5. Code Testability Analysis

**Evaluate production code for testability issues:**
- Hard-coded dependencies (can't inject mocks)
- Static method calls (difficult to stub)
- Global state access (breaks test isolation)
- Tight coupling to concrete implementations
- Missing interfaces/abstractions
- Side effects mixed with logic
- Large functions doing too much (hard to test)
- No clear separation of concerns

## 6. Test Quality Assessment
${
  context.testFiles.length > 0
    ? `
**Evaluate overall test structure and organization:**
- Test independence (no shared mutable state)
- Tests follow AAA (Arrange-Act-Assert) pattern
- No test logic complexity (loops, conditionals in tests)
`
    : `
**Not applicable** - no test file to evaluate.
`
}

## 7. Missing Test Scenarios

**Identify untested scenarios that should be covered:**
- Happy path (normal successful execution)
- Error cases (exceptions, validation failures)
- Edge cases (boundary values, empty data)
- Null/undefined handling
- Concurrent access (if applicable)
- State transitions (if stateful)
- Integration points with dependencies

# VERIFICATION CHECKLIST

Before reporting any finding, verify:

□ Issue is testing-related (coverage, quality, or testability)
□ Issue is NEW to this PR (not pre-existing technical debt)
□ Issue has clear impact on test reliability or coverage
□ Finding includes specific actionable improvement
□ Severity matches testing impact (consider risk of untested code)

## Verification Documentation Requirements

For EACH finding, your reasoning field must include:

**Required verification elements:**
- ✓ Test gap identification: What specific behavior is untested
- ✓ Risk assessment: What could break without this test
- ✓ Coverage check: Verified test file exists/doesn't exist
- ✓ Pattern verification: How other similar code is tested
- ✓ Severity justification: Why this matters for code quality

**Example of proper verification in reasoning:**

    ✓ Confirmed: createUser() method added in UserService.cs (line 45)
    ✓ Checked: UserServiceTests.cs exists but no test for createUser()
    ✓ Pattern analysis: Other methods (updateUser, deleteUser) have tests
    ✓ Risk assessment: User creation without validation tests risks data integrity
    ✓ Edge cases missing: null input, duplicate users, invalid email format
    ✓ Severity: medium (new functionality, moderate risk if breaks)

${buildSeverityContextSection()}

# CONFIDENCE LEVELS
- **high**: Clear missing test coverage for critical functionality
- **medium**: Test quality issue or minor coverage gap
- **low**: Suggestion for improvement, not critical

# SELF-CHALLENGE REQUIREMENT

Before reporting ANY finding, challenge yourself:

1. **"Is this file testable enough to write tests?"**
   → Don't report missing tests if code structure makes testing impractical

2. **"Are tests handled elsewhere in the codebase?"**
   → Check for integration tests, E2E tests, or testing at different layers

3. **"Is this genuinely risky without tests?"**
   → Simple getters/setters or trivial logic may not need tests

4. **"Would a senior engineer agree this needs testing?"**
   → Gut check: Is this substantive risk or pedantic over-testing?

## Counter-Argument Documentation

For findings that could be questioned, apply the self-challenge above before reporting. Only include findings for genuinely risky coverage gaps.

# WHAT TO REPORT

${
  context.testFiles.length > 0
    ? `
**Test Coverage Gaps:**
- New/modified functions missing tests
- Missing error case tests
- Untested edge cases and boundary conditions
- Missing integration test coverage for cross-component changes

**Test Quality Issues:**
- Tests that don't actually verify behavior (weak assertions)
- Flaky tests (timing issues, shared state)
- Over-mocked tests (testing mocks, not real behavior)
- Unclear test names or missing arrange-act-assert structure
- Test code duplication without helper functions
`
    : `
**Missing Test File:**
- Evaluate if this file needs test coverage
- Identify specific methods/functions that should be tested
- Assess risk of no test coverage
- Consider if this is a testable component

**Testability Issues:**
- Hard-coded dependencies preventing testing
- Global state making tests unreliable
- Code structure making tests difficult
`
}

**Testability Problems:**
- Hard-to-test code (tight coupling, no dependency injection)
- Static calls that can't be mocked
- Complex functions that need refactoring for testability

# WHAT NOT TO REPORT
- Issues already covered in other review types (security, performance)
- Testing tools or framework choices (unless causing quality issues)
- Test file location/organization (unless blocking coverage)
- Request for 100% coverage (focus on important test gaps)

# EXAMPLES

## EXCELLENT - WITH VERIFICATION (REPORT THESE)

✅ EXAMPLE 1: Missing Test Coverage for New Method
Line: 45, Severity: medium, Confidence: high, Category: testing
Message: "New createOrder() method lacks test coverage"
Reasoning: "✓ Confirmed: createOrder() added in OrderService.ts (line 45)
✓ Test file check: OrderService.test.ts exists in same directory
✓ Coverage gap: No test cases for createOrder() in test file
✓ Method complexity: 25 lines, multiple conditionals, error handling
✓ Pattern analysis: Other service methods (updateOrder, deleteOrder) have 3-5 test cases each
✓ Risk assessment: Order creation is critical path, affects inventory and payments
✓ Edge cases missing: null items, invalid quantities, duplicate orders
✓ Severity: medium (new critical functionality without tests)"
Suggestion: "Add test cases in OrderService.test.ts covering: valid order creation, empty items array, negative quantities, order total calculation, error handling"

✅ EXAMPLE 2: Weak Test Assertions
Line: 89, Severity: low, Confidence: high, Category: testing
Message: "Test only verifies method doesn't throw, not behavior"
Reasoning: "✓ Confirmed: test 'processes payment' (line 89) only calls processPayment()
✓ No assertions: Test passes if no exception thrown
✓ Missing verifications: Payment recorded, balance updated, receipt generated
✓ Pattern analysis: Other tests in suite have 2-3 assertions each
✓ Risk: Test provides false confidence, won't catch logic bugs
✓ Severity: low (test exists but weak coverage)"
Suggestion: "Add assertions: expect(result.status).toBe('success'); expect(account.balance).toBe(expectedBalance); expect(mockEmailService.sendReceipt).toHaveBeenCalled()"

✅ EXAMPLE 3: Testability Issue - Hard-Coded Dependency
Line: 23, Severity: medium, Confidence: high, Category: testing
Message: "Hard-coded database client prevents unit testing"
Reasoning: "✓ Confirmed: line 23 instantiates new DatabaseClient() directly
✓ Constructor: No parameters, no injection point for test doubles
✓ Impact: Tests must use real database or can't run
✓ Pattern analysis: Other services accept database in constructor (UserService, OrderService)
✓ Testability: Cannot inject mock, forces integration testing
✓ Severity: medium (blocks unit testing, slows development)"
Suggestion: "Refactor to inject database: constructor(private db: DatabaseClient) - enables mock injection in tests"

✅ EXAMPLE 4: Missing Error Case Tests
Line: 156, Severity: medium, Confidence: high, Category: testing
Message: "parseUserInput() error handling not tested"
Reasoning: "✓ Confirmed: parseUserInput() has try-catch (lines 156-162)
✓ Test file: InputParser.test.ts exists with 4 test cases
✓ Coverage gap: All tests use valid input, none trigger error path
✓ Code paths: 2 error scenarios (invalid JSON, missing required field)
✓ Pattern analysis: Similar parsers have error case tests
✓ Risk: Error handling could be broken without detection
✓ Severity: medium (error path untested, validation risk)"
Suggestion: "Add tests: 'throws on invalid JSON', 'throws on missing required field'"

✅ EXAMPLE 5: Missing Test File for Critical Component
Severity: high, Confidence: high, Category: testing
Message: "No test coverage for new PaymentProcessor class"
Reasoning: "✓ Confirmed: PaymentProcessor.ts is new file (status: added)
✓ Test file check: No PaymentProcessor.test.ts found
✓ Component analysis: 3 public methods, handles financial transactions
✓ Complexity: 120 lines, external API calls, error handling, retries
✓ Pattern analysis: All other services in src/services/ have test files
✓ Risk: Payment logic untested, high financial and reputation risk
✓ Severity: high (critical functionality, zero test coverage)"
Suggestion: "Create PaymentProcessor.test.ts with tests for: processPayment (success, failure, retry), refundPayment (full, partial), validatePaymentMethod (valid, invalid cards)"

✅ EXAMPLE 6: Flaky Test Due to Timing
Line: 234, Severity: medium, Confidence: high, Category: testing
Message: "Test uses setTimeout without proper async handling"
Reasoning: "✓ Confirmed: test 'debounces API calls' uses setTimeout (line 234)
✓ Issue: Test completes before setTimeout callback executes
✓ Pattern: Not using async/await or done() callback
✓ Risk: Race condition makes test non-deterministic
✓ Evidence: Test sometimes passes, sometimes fails (flaky)
✓ Severity: medium (unreliable test, false failures)"
Suggestion: "Use fake timers: vi.useFakeTimers(); callDebounced(); vi.advanceTimersByTime(500); await Promise.resolve(); expect(mockFn).toHaveBeenCalled();"

## WEAK - NO VERIFICATION (DON'T REPORT THESE)

❌ EXAMPLE 7: Trivial Code Without Tests
Message: "getName() method lacks test coverage"
Why skip: Simple getter returning property value. No logic to break. Testing provides no value.

❌ EXAMPLE 8: Testing Framework Preference
Message: "Should use Jest instead of Vitest"
Why skip: Tool choice, not testing quality. Both are valid frameworks.

❌ EXAMPLE 9: Test File Location
Message: "Tests should be in __tests__/ directory not colocated"
Why skip: Organizational preference, doesn't affect coverage or quality.

❌ EXAMPLE 10: Demanding 100% Coverage
Message: "Code coverage is only 85%, should be 100%"
Why skip: Arbitrary metric. Focus on important gaps, not percentage goals.

❌ EXAMPLE 11: Already Covered by Integration Tests
Message: "Missing unit tests for API endpoint handler"
Why skip: Didn't verify - comprehensive integration tests exist in tests/integration/. Not all code needs unit tests.

${buildBatchedFileResultsOutputFormat({
  analysisInstruction: "Document your testing analysis step-by-step",
  severityExample: "medium",
  categoryExample: "testing",
  messageExample: "Concise issue description",
  suggestionExample: "Specific actionable fix",
  reasoningExample: "Why this coverage gap or test quality issue matters for regression risk",
  footer: `**Rules:**
- Include entry for EVERY file listed, even with empty findings
- Every finding MUST have complete reasoning with verification steps
- Line numbers must reference the PRODUCTION file being reviewed (not test file)
- Use line 0 for file-level issues (missing test file, overall coverage gaps)
- Only report TESTING issues`,
})}
`;
}

/**
 * Builds a prompt for cross-file testing analysis.
 * Evaluates test coverage patterns across the entire PR.
 *
 * @param prDetails - Pull request metadata
 * @param context - Context for cross-file testing analysis
 * @param repoContext - Optional repository-specific coding standards and guidelines
 * @param repoPath - Optional path to cloned repository for workspace access
 * @returns Formatted prompt for cross-file testing review
 */
export function buildTestingCrossFilePrompt(
  prDetails: PRDetails,
  context: TestingCrossFileContext,
  repoPath?: string
): string {
  const findingsSummary = context.fileReviewResults
    .filter((r) => r.findings.length > 0)
    .map((r) => `${r.filename}: ${r.findings.length} finding(s)`)
    .join("\n");

  const coverageAnalysis = analyzeCoveragePatterns(context);

  const workspaceSection = buildWorkspaceSection(repoPath);

  return `${buildSecurityPreamble()}# YOUR ROLE
Expert test architect performing holistic test coverage analysis across a pull request.
Your focus is on testing patterns, coverage gaps, and test architecture.
${workspaceSection}
# PR CONTEXT
${wrapUntrustedPRMetadata(prDetails.title, prDetails.description)}

Changed Files:
${context.filesSummary}

Individual File Testing Findings:
${findingsSummary || "No individual testing issues found"}

# TEST COVERAGE ANALYSIS
${coverageAnalysis}

# CRITICAL RULES
1. ONLY analyze testing concerns across multiple files
2. Do NOT duplicate issues already caught in individual file reviews
3. Focus on SYSTEM-LEVEL testing patterns, not individual file coverage
4. Include confidence (high/medium/low) and reasoning for EVERY finding

# VERIFICATION CHECKLIST

Before reporting any cross-file testing finding:

□ Issue spans multiple files (not a single-file concern)
□ Issue is NEW to this PR (not pre-existing test debt)
□ Issue isn't already covered in individual file reviews
□ All affected files are in the Changed Files list
□ Impact is on overall test strategy or architecture
□ Severity matches testing risk (consider system-wide consequences)

## Verification Documentation Requirements

For EACH finding, your reasoning field must include verification notes.

**Required verification elements:**
- ✓ Cross-file confirmation: Which files you verified and how they're related
- ✓ Test impact: How the issue affects overall test coverage or quality
- ✓ Pattern check: Whether consistent or inconsistent testing approaches exist
- ✓ Coverage verification: What critical paths lack test coverage
- ✓ Severity justification: Why this matters at the system level

**Example of proper verification in reasoning:**

    ✓ Confirmed: UserService.ts, OrderService.ts, PaymentService.ts all modified
    ✓ Test file check: UserService.test.ts exists, but OrderService.test.ts and PaymentService.test.ts missing
    ✓ Pattern inconsistency: 1 of 3 service files has tests
    ✓ Integration risk: These services call each other, no integration tests
    ✓ System impact: Core business flow (user → order → payment) has zero end-to-end test coverage
    ✓ Severity justification: high (critical flow, no integration testing)

${buildSeverityContextSection()}

# CONFIDENCE LEVELS
- **high**: Clear system-level testing gap or pattern issue
- **medium**: Potential testing concern that needs verification
- **low**: Suggestion based on general practices, may not apply here

# SYSTEMATIC ANALYSIS CHECKLIST

Evaluate these cross-file testing concerns:

## 1. Integration Testing Gaps
- Are components that interact with each other both tested?
- Do integration points have integration tests?
- Are API contracts between services verified?
- Are database interactions tested?

## 2. Test Coverage Patterns
- Consistent testing approach across similar files?
- Are production files and test files changed together?
- New features with corresponding test additions?
- Deleted code with corresponding test deletions?

## 3. Test Architecture Issues
- Shared test utilities properly maintained?
- Consistent mocking/stubbing strategies?
- Test data factories or fixtures properly used?
- Test configuration consistent across files?

## 4. E2E and Scenario Coverage
- Critical user flows tested end-to-end?
- Multi-step processes have scenario tests?
- Error recovery paths tested across components?
- State management tested across component boundaries?

# SELF-CHALLENGE REQUIREMENT

Before reporting ANY finding, challenge yourself:

1. **"Is this a system-level testing concern?"**
   → Example: Single file missing tests is file-level, not cross-file

2. **"Are tests at a different layer handling this?"**
   → Example: Unit tests missing but E2E tests cover the integration

3. **"Is there architectural context I'm missing?"**
   → Example: Microservices tested independently, not in this repo

4. **"Would a test architect agree this is a problem?"**
   → Gut check: Is this substantive testing gap or minor inconsistency?

## Counter-Argument Documentation

For findings that could be questioned, apply the self-challenge above before reporting. Only include findings with a real system-level testing gap.

# WHAT TO REPORT

**System-Level Testing Gaps:**
- Multiple related components modified without integration tests
- Critical user flows across files lacking E2E coverage
- New feature spanning files without acceptance tests
- Inconsistent test coverage patterns (some files tested, others not)

**Test Architecture Issues:**
- Inconsistent mocking strategies across similar components
- Shared utilities modified without test updates
- Test data setup duplication across multiple test files
- Breaking changes to test helpers affecting multiple tests

**Integration Risks:**
- Components that call each other both lack integration tests
- Database/external service interactions not tested
- Error handling across service boundaries untested
- State management across files without tests

# WHAT NOT TO REPORT
- Issues already in individual file reviews
- Single-file test coverage gaps
- Test framework or tooling choices
- Code coverage percentage targets
- Test file organization/structure

# EXAMPLES

## EXCELLENT - WITH CROSS-FILE VERIFICATION (REPORT THESE)

✅ EXAMPLE 1: Integration Testing Gap
Severity: high, Confidence: high, Category: testing
Message: "No integration tests for new service layer interaction"
Reasoning: "✓ Confirmed: OrderService.ts now calls PaymentService.ts (line 89)
✓ Test file check: Both services have unit tests with mocked dependencies
✓ Integration verification: No tests verify actual interaction between services
✓ Pattern analysis: Other service integrations (UserService + EmailService) have integration tests
✓ Risk assessment: Payment processing critical path, no verification of actual integration
✓ Severity justification: high (financial transactions, integration failure risk)"
Affected files: ["src/services/OrderService.ts", "src/services/PaymentService.ts"]

✅ EXAMPLE 2: Inconsistent Test Coverage Pattern
Severity: medium, Confidence: high, Category: testing
Message: "New feature has partial test coverage across files"
Reasoning: "✓ Confirmed: Three files implement discount feature: DiscountService.ts, OrderCalculator.ts, CartComponent.tsx
✓ Test coverage: DiscountService.test.ts exists, other two have no tests
✓ Pattern inconsistency: 1 of 3 files tested
✓ Feature completeness: All three must work together for discount feature
✓ Risk assessment: Untested UI and calculation logic for customer-facing feature
✓ Severity justification: medium (feature incomplete, moderate user-facing risk)"
Affected files: ["src/services/DiscountService.ts", "src/utils/OrderCalculator.ts", "src/components/CartComponent.tsx"]

✅ EXAMPLE 3: Breaking Change to Test Helper
Severity: high, Confidence: high, Category: testing
Message: "Test helper signature changed but dependent tests not updated"
Reasoning: "✓ Confirmed: testHelpers.ts createMockUser() added required parameter (line 45)
✓ Dependency analysis: 15 test files import createMockUser
✓ Impact check: 8 test files in this PR, 7 others not updated
✓ Verification: Tests will fail when other files are tested
✓ Risk assessment: Breaking change to shared test utility affects multiple test suites
✓ Severity justification: high (breaks existing tests, blocks CI)"
Affected files: ["tests/helpers/testHelpers.ts", "tests/UserService.test.ts", "tests/OrderService.test.ts", "..."]

✅ EXAMPLE 4: E2E Coverage Gap for Critical Flow
Severity: high, Confidence: high, Category: testing
Message: "New checkout flow lacks end-to-end test coverage"
Reasoning: "✓ Confirmed: Checkout flow spans 5 files: CartComponent, CheckoutForm, PaymentService, OrderService, EmailService
✓ Unit test check: Each file has isolated unit tests
✓ Integration check: No tests verify complete checkout flow
✓ Pattern analysis: Other major flows (login, signup) have E2E tests in tests/e2e/
✓ Risk assessment: Multi-step user journey, 5 integration points, financial transactions
✓ Severity justification: high (revenue-critical flow, no end-to-end validation)"
Affected files: ["src/components/CartComponent.tsx", "src/components/CheckoutForm.tsx", "src/services/PaymentService.ts", "src/services/OrderService.ts", "src/services/EmailService.ts"]

## WEAK - NO VERIFICATION (DON'T REPORT THESE)

❌ EXAMPLE 5: Single File Missing Tests
Message: "UserService.ts lacks test coverage"
Why skip: Single file concern, belongs in file-level review, not cross-file analysis.

❌ EXAMPLE 6: Test Naming Inconsistency
Message: "Some tests use .spec.ts, others use .test.ts"
Why skip: Cosmetic issue, doesn't affect testing effectiveness or coverage.

❌ EXAMPLE 7: Coverage Percentage
Message: "Overall code coverage dropped from 85% to 82%"
Why skip: Metric-focused, not actionable. Focus on specific gaps, not percentages.

${buildCrossFileOutputFormat({
  intro: `1. ANALYSIS: Document your cross-file testing analysis step-by-step
2. JSON: Return findings in strict JSON format within markdown code block`,
  severityExample: "medium",
  categoryExample: "testing",
  messageExample: "Concise issue description",
  reasoningExample: "Why this system-level testing concern is real and its regression risk",
  overallAssessmentExample: "Brief summary of testing approach",
  recommendationExample: "Actionable system-level testing improvements",
  footer: `**Rules:**
- Empty findings array if no cross-file testing issues found
- Every finding MUST have complete reasoning with verification steps
- affected_files must list ALL files involved in the testing concern
- Focus on system-level testing, not individual file coverage`,
})}
`;
}

/**
 * Analyzes test coverage patterns across changed files.
 */
function analyzeCoveragePatterns(context: TestingCrossFileContext): string {
  const productionFiles: string[] = [];
  const testFiles: string[] = [];
  const productionWithTests: string[] = [];
  const productionWithoutTests: string[] = [];

  for (const file of context.allChangedFiles) {
    if (file.match(/\.(test|spec)\.(ts|tsx|cs)$/i)) {
      testFiles.push(file);
    } else if (
      file.match(/\.(ts|tsx|cs)$/i) &&
      !file.includes("types.ts") &&
      !file.includes(".d.ts")
    ) {
      productionFiles.push(file);

      const testFile = context.productionToTestMap.get(file);
      if (testFile && context.allChangedFiles.includes(testFile)) {
        productionWithTests.push(file);
      } else if (testFile === undefined) {
        productionWithoutTests.push(file);
      }
    }
  }

  return `
## Coverage Statistics
- Production files changed: ${productionFiles.length}
- Test files changed: ${testFiles.length}
- Production files WITH corresponding test changes: ${productionWithTests.length}
- Production files WITHOUT corresponding test files: ${productionWithoutTests.length}

${
  productionWithoutTests.length > 0
    ? `
### Files Without Test Coverage
${productionWithoutTests.map((f) => `- ${f}`).join("\n")}
`
    : ""
}

${
  productionWithTests.length > 0
    ? `
### Files With Test Coverage
${productionWithTests.map((f) => `- ${f} → ${context.productionToTestMap.get(f)}`).join("\n")}
`
    : ""
}
`;
}
