---
name: TypeScript Code Principles
description: Core software craftsmanship and safety conventions for maintainable TypeScript
applyTo: **/*.tsx, **/*.ts
---

# TypeScript Code Principles

## 1. Naming & Intent

- **Classes & Types**: Nouns in `PascalCase` (`UserAccount`, `PaymentProcessor`).
- **Functions & Methods**: Verbs in `camelCase` (`calculateTotal`, `sendEmail`, `fetchData`).
- **Booleans**: Predicate questions in `camelCase` (`isActive`, `hasPermission`, `canExecute`).
- **Constants**: Descriptive `UPPER_SNAKE_CASE` (`MILLISECONDS_PER_DAY`).
- **Self-Documenting**: Reveal intent without comments; avoid abbreviations except in small, localized loops. Use domain-specific terms matching the business model.

```typescript
// Bad: requires comment to understand
const d = 86400000; // milliseconds in a day

// Good: self-documenting
const MILLISECONDS_PER_DAY = 86400000;
```

---

## 2. Functions

- **Small & Focused**: Do one thing at a single level of abstraction. Ideal length is 5–20 lines.
- **Early Returns**: Favor guard clauses and early returns over deeply nested conditionals.
- **Parameter Limits**: Use configuration objects for 3+ parameters.
- **No Boolean Flags**: Avoid boolean flags that control execution flow (e.g. `createUser(..., true)`); split them into separate, descriptive functions.
- **Command-Query Separation (CQS)**: Functions either modify state (command) or return data (query), never both.
- **Public Documentation**: Document all public-facing APIs with clear JSDoc (`@param`, `@returns`, `@example`).

```typescript
// Bad: queries and modifies
function checkPassword(password: string): boolean {
  if (isValid(password)) {
    this.sessionManager.initialize(); // Hidden side effect!
    return true;
  }
  return false;
}

// Good: separated concerns
function isPasswordValid(password: string): boolean {
  return isValid(password);
}
function authenticateUser(password: string): void {
  if (isPasswordValid(password)) {
    this.sessionManager.initialize();
  }
}
```

---

## 3. Architecture & Class Design

- **Single Responsibility Principle (SRP)**: A class or module should have exactly one reason to change.
- **Dependency Injection (DI)**: Depend on interfaces/abstractions, not concrete implementations. Inject dependencies via the constructor.
- **DRY (Don't Repeat Yourself)**: Every piece of knowledge must have a single, unambiguous representation. Extract common behavior, never copy business rules.
- **Encapsulation**: Hide internal implementation details. Expose high-level, abstract interfaces and tell, don't ask.
- **Law of Demeter**: A method should only call methods on direct dependencies (no train wrecks: `a.getB().getC().execute()`).
- **DTOs vs Domain Objects**: Keep Data Transfer Objects (pure data structure, no behavior) strictly separate from Domain Objects (encapsulates business behavior, hides state).
- **Third-Party Isolation**: Wrap third-party libraries behind your own adapters to prevent vendor lock-in and simplify testing.

```typescript
// Bad: depends on concrete implementation
class ReportGenerator {
  private pdfFormatter = new PDFFormatter();
  generate(data: Data) {
    return this.pdfFormatter.format(data);
  }
}

// Good: depends on abstraction, injected via constructor
interface Formatter {
  format(data: Data): string;
}
class ReportGenerator {
  constructor(private formatter: Formatter) {}
  generate(data: Data): string {
    return this.formatter.format(data);
  }
}
```

---

## 4. Error Handling

- **Exceptions over Error Codes**: Use custom, domain-specific exception classes with rich diagnostic context instead of returning status flags or magic numbers.
- **Null Avoidance**: Prefer explicit `undefined` or optional chaining (`?.`) for missing values. Throw exceptions only for exceptional, unexpected system errors.
- **Fail Fast**: Validate external inputs and check invariants immediately at system boundaries.
- **Safe Resource Management**: Pair resource acquisition with guaranteed cleanup using `try/finally` or modern `using` declarations.

```typescript
class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`User not found: ${userId}`);
    this.name = "UserNotFoundError";
  }
}

// Ensure cleanup
await using connection = await createDbConnection();
```

---

## 5. TypeScript-Specific Safety

- **No Unsafe Types**: Ban the use of `any`. Use `unknown` for unsafe input, then use strict type guards or assertions to narrow the type before usage.
- **Immutability**: Declare variables with `const` and fields as `readonly` by default. Use spread/immutable update patterns instead of mutation.
- **Discriminated Unions**: Model complex domain states, action types, or state machine variations using discriminated unions for compiler-enforced exhaustiveness checks.
- **Syntactic Sugar**: Prefer optional chaining (`?.`) and nullish coalescing (`??`) for cleaner, safer property access.

```typescript
type Result<T, E> = { success: true; value: T } | { success: false; error: E };

function processResult(result: Result<string, Error>): string {
  if (result.success) {
    return result.value;
  }
  throw result.error;
}
```
