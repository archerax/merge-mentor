---
name: 'TypeScript Testing Standards'
description: 'Principles and practices for writing maintainable, trustworthy, and readable unit tests in TypeScript using Vitest'
applyTo: **/*.test.ts, **/*.spec.ts, **/*.test.tsx, **/*.spec.tsx
---

# TypeScript Testing Standards

## Core Testing Philosophy

A unit test validates a single unit of work, checking one specific outcome. Tests must be automated, fast, consistent, isolated, and trustworthy.

A **unit of work** spans from invoking a public method to a measurable end result:

- Returned value from a function
- Observable state change through public API
- Interaction with an external dependency

A unit ranges from a single function to multiple classes working together to produce meaningful outcomes.

## Test Quality Attributes

### Trustworthy

- Tests prove the code works correctly
- Failures indicate real bugs, not test issues
- No false positives or negatives

### Maintainable

- Easy to understand and modify
- Survives refactoring of production code
- Minimal coupling to implementation details

### Readable

- Expresses intent clearly
- Serves as documentation
- Reveals what and why, not just how

## Test Structure

### Naming Convention

Use descriptive names expressing behavior and expectation:

```typescript
// Good
test('returns zero when parsing empty string', () => {
  const result = parseNumbers('')
  expect(result).toBe(0)
})

// Avoid - cryptic
test('parseNumsEmptyStr', () => { ... })
```

### Arrange-Act-Assert Pattern

Structure tests into three clear sections:

```typescript
test("calculates sum when given multiple comma-separated numbers", () => {
  // Arrange - set up test data and dependencies
  const input = "1,2,3";
  const parser = new NumberParser();

  // Act - invoke the unit of work
  const result = parser.parseAndSum(input);

  // Assert - verify the outcome
  expect(result).toBe(6);
});
```

Separate sections with blank lines. Omit comments when structure is self-evident.

## Isolation and Test Doubles

### Test Doubles vs. Production Code

Use test doubles (stubs, mocks) to isolate the unit under test from dependencies:

**Stub** - provides predetermined responses to calls, testing state or return values:

```typescript
const stubLogger = {
  log: vi.fn(),
  error: vi.fn(),
};
```

**Mock** - verifies interactions occurred correctly:

```typescript
test("sends notification when error threshold exceeded", () => {
  const mockNotifier = { notify: vi.fn() };
  const service = new ErrorService(mockNotifier);

  service.processError({ severity: "critical" });

  expect(mockNotifier.notify).toHaveBeenCalledWith(
    expect.objectContaining({ severity: "critical" }),
  );
});
```

### Dependency Injection

Favor constructor injection for explicit dependency control:

```typescript
class UserService {
  constructor(
    private readonly repository: UserRepository,
    private readonly logger: Logger,
  ) {}
}

// Testing becomes straightforward
const service = new UserService(createStubRepository(), createStubLogger());
```

Use interfaces for abstraction; never inject production dependencies in tests.

### One Mock Per Test

Verify only one interaction per test:

```typescript
// Good
test("logs error when validation fails", () => {
  const mockLogger = { error: vi.fn() };
  const validator = new Validator(mockLogger);

  validator.validate(invalidData);

  expect(mockLogger.error).toHaveBeenCalled();
});

// Avoid - multiple interactions verified
test("processes order", () => {
  expect(mockLogger.log).toHaveBeenCalled();
  expect(mockNotifier.send).toHaveBeenCalled(); // Split into separate tests
});
```

## Avoiding Common Pitfalls

### No Logic in Tests

Tests should be simple and linear. Avoid conditionals, loops, or complex calculations:

```typescript
// Good - straightforward verification
test('filters active users', () => {
  const users = [
    { name: 'Alice', active: true },
    { name: 'Bob', active: false }
  ]

  const result = filterActive(users)

  expect(result).toHaveLength(1)
  expect(result[0].name).toBe('Alice')
})

// Avoid - logic in test
test('processes all types', () => {
  for (const type of ['A', 'B', 'C']) {  // Loop creates complexity
    if (type === 'A') { ... }  // Conditional logic
  }
})
```

### Test One Concern

Each test validates a single behavioral aspect:

```typescript
// Good - focused
test('returns empty array when input is empty', () => { ... })
test('returns sorted array when input is unsorted', () => { ... })
test('throws error when input contains invalid data', () => { ... })

// Avoid
test('handles all input cases', () => {
  // Testing empty, sorted, and error cases together
})
```

### Avoid Overspecification

Don't assert internal implementation details. Test observable behavior:

```typescript
// Good - tests public behavior
test("authenticates user with valid credentials", async () => {
  const auth = new Authenticator(mockUserStore);

  const result = await auth.login("user", "pass");

  expect(result.success).toBe(true);
});

// Avoid - asserting internal method calls
test("authenticates user", async () => {
  await auth.login("user", "pass");

  expect(mockHasher.hash).toHaveBeenCalled(); // Implementation detail
  expect(mockUserStore.find).toHaveBeenCalled(); // May change during refactor
});
```

## Test Organization

### File Structure

Colocate tests with source files or mirror source structure in test directory:

```
src/user-service.ts → src/user-service.test.ts
```

### Grouping Related Tests

Use `describe` blocks to organize related tests:

```typescript
describe('NumberParser', () => {
  describe('parseAndSum', () => {
    test('returns zero for empty string', () => { ... })
    test('returns number for single value', () => { ... })
    test('returns sum for comma-separated values', () => { ... })
  })

  describe('parseMultiply', () => {
    test('returns zero for empty string', () => { ... })
  })
})
```

### Setup and Teardown

Prefer factory functions over `beforeEach` for clarity:

```typescript
// Good - explicit
function createTestService() {
  return new DataService(createStubRepository());
}

test("saves data successfully", () => {
  const service = createTestService();
  // Self-contained and clear
});
```

Use `beforeEach` only when setup is identical for all tests in a suite. Avoid when:

- Objects used by only some tests
- Contains complex logic
- Creates shared mutable state

## Integration vs. Unit Tests

**Unit tests** - isolated, fast, no external dependencies (database, filesystem, network, system time)

**Integration tests** - exercise multiple components, may use real dependencies

Separate them by directory or naming convention. Run unit tests continuously; integration tests before commits.

## Testing Exceptions

Use Vitest's error testing utilities:

```typescript
test("throws error when file extension is invalid", () => {
  const parser = new FileParser();

  expect(() => parser.parse("file.xyz")).toThrow("Invalid extension");
});

test("rejects promise when network fails", async () => {
  const client = new ApiClient(failingConnection);

  await expect(client.fetch()).rejects.toThrow("Network error");
});
```

## Async Testing

Always await promises:

```typescript
// Good
test("fetches user data", async () => {
  const user = await service.getUser(123);
  expect(user.name).toBe("Alice");
});

// Avoid
test("fetches user data", () => {
  service.getUser(123); // Not awaited
  expect(user.name).toBe("Alice"); // Runs before completion
});
```

## Parameterized Tests

Use `test.each` for testing multiple inputs:

```typescript
test.each([
  ["", 0],
  ["5", 5],
  ["1,2", 3],
  ["1,2,3", 6],
])('parseAndSum("%s") returns %i', (input, expected) => {
  expect(parseAndSum(input)).toBe(expected);
});
```

## Variable Naming

Use meaningful names:

```typescript
// Good
const invalidEmail = "not-an-email";
const validator = new EmailValidator();
const result = validator.validate(invalidEmail);

// Avoid
const e = "not-an-email";
const v = new EmailValidator();
const r = v.validate(e);
```

## Assertion Best Practices

### Specific Matchers

Use the most specific matcher available:

```typescript
// Good
expect(result).toBeNull();
expect(items).toHaveLength(3);
expect(user).toEqual({ name: "Alice", age: 30 });

// Avoid - less specific
expect(result === null).toBe(true);
expect(items.length).toBe(3);
expect(JSON.stringify(user)).toBe(JSON.stringify({ name: "Alice", age: 30 }));
```

### Object Matching

Use partial matching when testing specific properties:

```typescript
// Good - tests relevant properties
expect(response).toMatchObject({
  status: 200,
  data: expect.objectContaining({
    userId: 123
  })
})

// Avoid - brittle to unrelated changes
expect(response).toEqual({
  status: 200,
  data: { userId: 123, timestamp: expect.any(Number), ... }
})
```

## Test Maintenance

### When to Modify Tests

- **Production bug found** - test was insufficient; add test case
- **Refactoring** - tests should pass unchanged if behavior unchanged
- **API changes** - update tests to match new contract
- **Test conflicts with another** - tests share mutable state; isolate them

### When to Remove Tests

- Code under test deleted
- Test duplicates another test exactly
- Test validates framework behavior, not application logic

## Legacy Code

When adding tests to untested code:

1. Write integration tests capturing current behavior
2. Introduce interfaces breaking dependencies
3. Add unit tests during refactoring
4. Use coverage to find gaps, not as metric goal

## Anti-Patterns to Avoid

- Shared mutable state between tests
- Test interdependence requiring execution order
- Hidden test calls in setup methods
- Testing private methods directly
- Complex logic in `beforeEach`
- Multiple assertions on different concerns
- Ignoring tests instead of fixing or removing
- Testing framework behavior

## Example: Complete Test File

```typescript
import { describe, test, expect, vi, beforeEach } from "vitest";
import { UserService } from "./user-service";
import type { UserRepository } from "./user-repository";
import type { EmailService } from "./email-service";

function createStubRepository(): UserRepository {
  return {
    find: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  };
}

function createStubEmailService(): EmailService {
  return {
    send: vi.fn().mockResolvedValue(undefined),
  };
}

describe("UserService", () => {
  describe("createUser", () => {
    test("saves user with normalized email", async () => {
      const repository = createStubRepository();
      const service = new UserService(repository, createStubEmailService());

      await service.createUser({ email: "Alice@Example.com", name: "Alice" });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "alice@example.com",
        }),
      );
    });

    test("sends welcome email after creation", async () => {
      const emailService = createStubEmailService();
      const service = new UserService(createStubRepository(), emailService);

      await service.createUser({ email: "alice@example.com", name: "Alice" });

      expect(emailService.send).toHaveBeenCalledWith({
        to: "alice@example.com",
        template: "welcome",
      });
    });

    test("throws error when email is invalid", async () => {
      const service = new UserService(
        createStubRepository(),
        createStubEmailService(),
      );

      await expect(
        service.createUser({ email: "invalid", name: "Alice" }),
      ).rejects.toThrow("Invalid email");
    });
  });

  describe("deleteUser", () => {
    test("removes user from repository", async () => {
      const repository = createStubRepository();
      const service = new UserService(repository, createStubEmailService());

      await service.deleteUser(123);

      expect(repository.delete).toHaveBeenCalledWith(123);
    });
  });
});
```

## Key Principles Summary

1. **Isolation** - Test units independently using test doubles
2. **Single Responsibility** - One test, one concern
3. **Readability** - Tests are documentation; write for humans
4. **Maintainability** - Test behavior, not implementation
5. **Speed** - Unit tests run in milliseconds
6. **Determinism** - Same code, same result, every time
7. **Independence** - Tests run in any order successfully
8. **Clarity** - Obvious what failed and why when tests break
