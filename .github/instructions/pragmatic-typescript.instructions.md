---
name: Pragmatic TypeScript Development
description: Professional development principles for maintainable, robust TypeScript code
applyTo: **/*.tsx, **/*.ts
---

# Pragmatic TypeScript Development

## Core Principles

### Ownership and Quality

- Accept responsibility for all code you produce
- Provide solutions and alternatives, not excuses
- Fix technical debt immediately when discovered
- Broken code normalizes low standards and accelerates decay
- Maintain high standards regardless of time pressure

### Eliminate Duplication

- Every concept must have exactly one authoritative representation
- Extract shared logic into reusable functions or modules
- Use type aliases and utility types to derive related types
- Avoid duplicating validation logic, business rules, or type definitions

### Build Independent Components

- Design modules with minimal dependencies between unrelated parts
- Changes in one module should not require changes in unrelated modules
- Use dependency injection to decouple implementations
- Define clear interfaces between subsystems

```typescript
// Good: decoupled through abstraction
interface Logger {
  log(message: string): void;
}

class Service {
  constructor(private logger: Logger) {}
}

// Bad: direct dependency on concrete implementation
class Service {
  private logger = new ConsoleLogger();
}
```

### Design for Reversibility

- Isolate third-party dependencies behind your own interfaces
- Use configuration and metadata for variable behavior
- Make architectural decisions reversible through abstraction
- Avoid vendor lock-in

```typescript
// Good: abstraction enables changing implementations
interface StorageAdapter {
  save(key: string, data: unknown): Promise<void>;
  load(key: string): Promise<unknown>;
}

class CloudStorage implements StorageAdapter {
  /* ... */
}
class LocalStorage implements StorageAdapter {
  /* ... */
}
```

### Develop Incrementally

- Build end-to-end slices of functionality
- Validate assumptions with working code early
- Get feedback on real features, not prototypes
- Iterate based on actual use

### Balance Quality with Pragmatism

- Understand acceptable quality levels for the context
- Ship working software rather than pursuing perfection
- Don't over-engineer beyond actual requirements
- Make quality a conscious decision, not an accident

## Code Implementation

### Clarity and Readability

- Use descriptive names that reveal intent and purpose
- Keep functions short with single, clear responsibilities
- Favor early returns over deep nesting
- Let TypeScript types document contracts and expectations

```typescript
// Good: clear intent, self-documenting
function findActiveUsers(users: User[]): User[] {
  return users.filter((user) => user.isActive && !user.isDeleted);
}

// Bad: unclear purpose, cryptic property names
function process(data: unknown[]): unknown[] {
  return data.filter((x) => x.a && !x.b);
}
```

### Assert and Validate

- Enable TypeScript strict mode and all compiler checks
- Add runtime assertions for critical invariants
- Validate all external input explicitly
- Test edge cases and boundary conditions

```typescript
// Runtime validation even with type checking
function processAge(age: number): void {
  if (age < 0 || age > 150 || !Number.isFinite(age)) {
    throw new Error(`Invalid age: ${age}`);
  }
  // Proceed with valid age
}
```

### Error Handling

- Fail fast when encountering invalid states
- Use specific error classes for different failure categories
- Include actionable context in error messages
- Ensure resource cleanup in all error paths

```typescript
class ValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(`Validation failed for ${field}: ${message}`);
    this.name = "ValidationError";
  }
}

async function processData(data: unknown): Promise<void> {
  const resource = await acquireResource();
  try {
    await resource.process(data);
  } finally {
    await resource.release();
  }
}
```

### Resource Management

- Pair every allocation with its deallocation
- Use try/finally or explicit disposable patterns
- Handle cleanup at the same abstraction level as acquisition
- Leverage TypeScript's disposable features when available

```typescript
// Using explicit disposables
class DatabaseConnection implements AsyncDisposable {
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

// Automatic cleanup with using
await using connection = await createConnection();
// Connection automatically closed

// Traditional approach when disposables unavailable
const connection = await createConnection();
try {
  await useConnection(connection);
} finally {
  await connection.close();
}
```

## Testing

### Test Comprehensively

- Write tests alongside or before implementation
- Test behavior and state transitions, not just code lines
- Focus on edge cases, boundaries, and error conditions
- Keep test suites fast and deterministic

```typescript
import { describe, it, expect } from "vitest";

describe("UserService", () => {
  it("handles empty list", () => {
    const service = new UserService();
    expect(service.findActive([])).toEqual([]);
  });

  it("filters by active status", () => {
    const users = [
      { id: "1", isActive: true, isDeleted: false },
      { id: "2", isActive: false, isDeleted: false },
      { id: "3", isActive: true, isDeleted: true },
    ];
    const active = service.findActive(users);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("1");
  });
});
```

### Build Testable Code

- Separate business logic from infrastructure dependencies
- Inject dependencies to enable substitution in tests
- Avoid global state and singleton patterns
- Prefer pure functions for core logic

### Automate Ruthlessly

- Automate all builds, tests, and deployments
- Use consistent, repeatable processes for all tasks
- Generate repetitive code and boilerplate
- Maintain reproducible development environments

## Development Practices

### Prefer Plain Text

- Use human-readable formats (JSON, YAML, Markdown) over binary
- Plain text enables diffing, searching, and version control
- Store configuration as text
- Generate rich formats from plain text sources

### Use Version Control Effectively

- Commit frequently with descriptive messages
- Explain why changes were made, not just what changed
- Use branches for experiments and features
- Review diffs carefully before committing

### Document Clearly

- Add TSDoc comments to all public APIs
- Keep documentation adjacent to code
- Update docs whenever behavior changes
- Include examples for complex functions

````typescript
/**
 * Calculates total price with tax and optional discount.
 *
 * @param basePrice - Price before adjustments
 * @param taxRate - Tax rate as decimal (0.08 = 8%)
 * @param discount - Discount as decimal (0.1 = 10% off)
 * @returns Final price after discount and tax
 *
 * @example
 * ```typescript
 * calculateTotal(100, 0.08, 0.1); // 97.2
 * ```
 */
function calculateTotal(
  basePrice: number,
  taxRate: number,
  discount = 0,
): number {
  const afterDiscount = basePrice * (1 - discount);
  return afterDiscount * (1 + taxRate);
}
````

### Debug Systematically

- Reproduce issues reliably before fixing
- Question all assumptions, including about frameworks and libraries
- Use binary search to isolate root causes
- Fix underlying problems, not symptoms
- Add tests to prevent regression

## Architecture

### Modularity

- Organize by feature/domain, not technical layer
- Define clear boundaries between modules
- Minimize public surface area
- Keep coupling low, cohesion high

### Abstraction

- Hide volatile implementation details behind stable interfaces
- Let abstractions emerge from real needs, not speculation
- Avoid abstractions for single use cases
- Balance flexibility with clarity

```typescript
// Stable abstraction for changing implementations
interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}

class KafkaPublisher implements EventPublisher {
  async publish(event: DomainEvent): Promise<void> {
    // Implementation can change without affecting clients
  }
}
```

### Separation of Concerns

- Isolate presentation, domain logic, and data access
- Use messaging to decouple components
- Keep domain models independent of infrastructure
- Separate what changes from what stays stable

### Concurrency

- Design for parallel execution where beneficial
- Prefer stateless components
- Use immutable data to eliminate race conditions
- Handle async operations with proper error boundaries

## Problem Solving

### Challenge Assumptions

- Question requirements that seem impossible
- Distinguish actual problems from symptoms
- Seek simpler approaches
- Verify if the task is truly necessary

### Gather Requirements

- Work directly with end users
- Build shared vocabulary and glossaries
- Use concrete examples over abstract descriptions
- Clarify ambiguities immediately

### Start Deliberately

- Begin coding only with sufficient understanding
- Trust instincts about problematic designs
- Raise concerns about risks early
- Avoid speculative implementation

### Iterate Continuously

- Build incrementally with working features
- Gather feedback on real functionality
- Refine understanding through implementation
- Adjust approach based on learning

## Continuous Improvement

### Refactor Regularly

- Improve structure as understanding grows
- Make small, focused improvements
- Run tests after every change
- Don't postpone necessary refactoring

### Learn from Failures

- Analyze root causes of defects
- Prevent recurrence with tests and process changes
- Document lessons learned
- Share knowledge across the team

### Performance

- Measure before optimizing
- Fix algorithmic issues before micro-optimizations
- Verify improvements with benchmarks
- Balance speed with maintainability
