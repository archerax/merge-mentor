---
name: Clean TypeScript Code Principles
description: Software craftsmanship principles for writing maintainable, readable TypeScript
applyTo: **/*.tsx, **/*.ts
---

# Clean TypeScript Code Principles

## Naming

### Reveal Intent
Names must reveal intent without requiring comments.

```typescript
// Bad: requires comment to understand
const d = 86400000; // milliseconds in a day

// Good: self-documenting
const MILLISECONDS_PER_DAY = 86400000;
```

### Avoid Misleading Names
- No names with subtle differences (`userAccountList` vs `userAccounts`).
- Avoid lowercase `l` or uppercase `O` as identifiers.
- Don't use words that have established technical meanings differently.

### Make Searchable and Pronounceable
- Pronounceable in conversation: `currentDateString` not `yyyymmdstr`.
- Longer names for wider scopes; single letters only in small loops.
- Constants should be ALL_CAPS or descriptively named.

### Naming Conventions
- **Classes**: Nouns (`UserAccount`, `PaymentProcessor`).
- **Functions**: Verbs (`calculateTotal`, `sendEmail`, `fetchData`).
- **Booleans**: Predicates (`isActive`, `hasPermission`, `canExecute`).
- **Use domain terms**: Technical terms for technical concepts, domain terms for business concepts.

## Functions

### Small and Focused
Functions should be small (typically 5-20 lines) and do one thing at one abstraction level.

```typescript
// Bad: multiple responsibilities, mixed abstraction levels
function processUser(user: User) {
  if (!user.email?.includes('@')) return;
  user.lastModified = new Date();
  database.save(user);
}

// Good: single responsibility, consistent abstraction
function processUser(user: User) {
  if (!isValidUser(user)) return;
  updateTimestamp(user);
  saveUser(user);
}
```

### Minimize Arguments
- **Best**: Zero arguments (niladic).
- **Good**: One argument (monadic).
- **Acceptable**: Two arguments (dyadic).
- **Avoid**: Three or more arguments—use configuration objects.
- **Never**: Boolean flags (they mean the function does multiple things).

```typescript
// Bad: too many arguments, boolean flag
function createUser(name: string, email: string, age: number, active: boolean) { }

// Good: configuration object
interface UserConfig {
  name: string;
  email: string;
  age: number;
  active: boolean;
}
function createUser(config: UserConfig) { }
```

### Command-Query Separation
Functions either modify state (command) or return data (query), never both.

```typescript
// Bad: queries and modifies
function checkPassword(password: string): boolean {
  if (isValid(password)) {
    this.sessionManager.initialize(); // Hidden side effect
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

### Use Exceptions, Not Error Codes
Extract try/catch bodies into functions; error handling is one thing.

```typescript
// Bad: error codes obscure logic
function deleteUser(userId: string): ErrorCode {
  if (!exists(userId)) return ErrorCode.NOT_FOUND;
  if (!hasPermission(userId)) return ErrorCode.FORBIDDEN;
  remove(userId);
  return ErrorCode.SUCCESS;
}

// Good: exceptions for exceptional cases
async function deleteUser(userId: string): Promise<void> {
  validateUserExists(userId);
  validateUserPermission(userId);
  remove(userId);
}

function validateUserExists(userId: string): void {
  if (!exists(userId)) throw new UserNotFoundError(userId);
}
```

## Comments

### Express Intent in Code
Refactor unclear code instead of explaining it with comments.

```typescript
// Bad: comment explains what code should express
// Check if employee is eligible for benefits
if (employee.age > 65 && employee.tenure > 10) { }

// Good: code expresses intent
function isEligibleForBenefits(employee: Employee): boolean {
  return employee.age > 65 && employee.tenure > 10;
}
```

### Acceptable Comments
- **Legal/Copyright**: Required headers.
- **Intent Explanation**: Why a non-obvious decision was made.
- **Warning**: Consequences (performance implications, concurrency issues).
- **TODO**: Future work with tracking references.
- **Public API**: JSDoc with `@param`, `@returns`, `@example`.

### Unacceptable Comments
- **Commented-out code**: Delete it; version control remembers.
- **Noise**: Restating the obvious.
- **Journal**: Use version control for history.
- **Closing braces**: Keep functions small instead.
- **Redundant**: Code already says what comment says.

## Formatting

### Vertical Organization
- Related concepts close together.
- Variables declared close to usage.
- Caller functions above callees (read top-to-bottom).
- Group related functions.

### Horizontal Limits
- Lines under 120 characters.
- Use spacing to emphasize operator precedence.
- Never align declarations horizontally.
- Use project formatter (Prettier, ESLint).

## Data Structures vs Objects

### Hide Implementation
Expose abstract interfaces, not internal structure.

```typescript
// Bad: exposes implementation
interface Vehicle {
  fuelTankCapacityGallons: number;
  gallonsOfGasoline: number;
}

// Good: hides implementation
interface Vehicle {
  getPercentFuelRemaining(): number;
}
```

### Law of Demeter
A method should only call methods on: itself, its parameters, objects it creates, its fields.

```typescript
// Bad: train wreck
const street = user.getAddress().getStreet();

// Good: tell, don't ask
const street = user.getStreet();
```

### Separate Data and Behavior
- **Data Transfer Objects**: Plain objects for data, no behavior.
- **Domain Objects**: Encapsulate behavior, hide data.
- **Avoid hybrids**: Don't mix data exposure with business logic.

## Error Handling

### Don't Return Null
Returning null forces callers to check, creating clutter and potential bugs.

```typescript
// Bad: forces null checks everywhere
function findUser(id: string): User | null {
  return users.find(u => u.id === id) ?? null;
}

// Good: throw for exceptional cases
function getUser(id: string): User {
  const user = users.find(u => u.id === id);
  if (!user) throw new UserNotFoundError(id);
  return user;
}

// Or: use undefined for optional results
function findUser(id: string): User | undefined {
  return users.find(u => u.id === id);
}
```

### Don't Pass Null
Validate at boundaries; don't pass null into methods.

### Provide Context with Exceptions
Include operation attempted, failure type, and relevant identifiers.

```typescript
class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`User not found: ${userId}`);
    this.name = 'UserNotFoundError';
  }
}
```

## Classes

### Single Responsibility Principle
A class should have one reason to change. Small, focused classes are better than large multipurpose ones.

```typescript
// Bad: multiple responsibilities
class UserManager {
  validateEmail(email: string): boolean { }
  hashPassword(password: string): string { }
  saveToDatabase(user: User): void { }
  sendWelcomeEmail(user: User): void { }
}

// Good: single responsibilities
class EmailValidator {
  validate(email: string): boolean { }
}

class PasswordHasher {
  hash(password: string): string { }
}

class UserRepository {
  save(user: User): void { }
}

class WelcomeEmailService {
  send(user: User): void { }
}
```

### High Cohesion
Methods and fields should be interdependent. If subsets are independent, split the class.

### Depend on Abstractions
Use dependency injection; depend on interfaces, not concrete implementations.

```typescript
// Bad: depends on concrete implementation
class ReportGenerator {
  private pdfFormatter = new PDFFormatter();
  generate(data: Data) {
    return this.pdfFormatter.format(data);
  }
}

// Good: depends on abstraction
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

## Testing with Vitest

### Test Structure
Use arrange-act-assert pattern. One concept per test.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('UserService', () => {
  let userService: UserService;
  let mockRepo: MockRepository;

  beforeEach(() => {
    mockRepo = new MockRepository();
    userService = new UserService(mockRepo);
  });

  it('creates user with valid data', async () => {
    // Arrange
    const userData = { name: 'Alice', email: 'alice@example.com' };
    
    // Act
    const user = await userService.create(userData);
    
    // Assert
    expect(user.name).toBe('Alice');
    expect(user.email).toBe('alice@example.com');
  });

  it('throws error for invalid email', async () => {
    // Arrange
    const userData = { name: 'Bob', email: 'invalid-email' };
    
    // Act & Assert
    await expect(userService.create(userData))
      .rejects.toThrow('Invalid email format');
  });
});
```

### F.I.R.S.T. Principles
- **Fast**: Tests run quickly.
- **Independent**: No dependencies between tests.
- **Repeatable**: Same results in any environment.
- **Self-Validating**: Pass or fail, no manual inspection.
- **Timely**: Written with or before production code.

### Focus on Behavior
- Test boundary conditions and edge cases.
- Test failure modes, not just success paths.
- Meaningful tests over high coverage percentages.

## Core Principles

### Don't Repeat Yourself
Extract duplicated logic. Duplication is the root of maintenance problems.

### Prefer Simple Over Clever
Code should be obvious. Minimize complexity at every level.

### Express Intent Clearly
Code reads like prose. Favor clarity over brevity when they conflict.

### Boy Scout Rule
Leave code cleaner than you found it. Refactor continuously in small steps.

## TypeScript-Specific

### Type Safety
Avoid `any`; use `unknown` when type is unknown, then narrow with type guards.

```typescript
// Bad
function process(data: any) {
  return data.value;
}

// Good
function process(data: unknown): number {
  if (isValidData(data)) {
    return data.value;
  }
  throw new Error('Invalid data');
}

function isValidData(data: unknown): data is { value: number } {
  return typeof data === 'object' && 
         data !== null && 
         'value' in data && 
         typeof data.value === 'number';
}
```

### Prefer Immutability
Use `const`, `readonly`, and immutable update patterns.

```typescript
interface User {
  readonly id: string;
  name: string;
}

function updateUser(user: User, updates: Partial<User>): User {
  return { ...user, ...updates };
}
```

### Discriminated Unions
Use for state machines and variant handling.

```typescript
type Result<T, E> =
  | { success: true; value: T }
  | { success: false; error: E };

function handleResult<T, E>(result: Result<T, E>): T {
  if (result.success) {
    return result.value;
  }
  throw result.error;
}
```

### Null Safety
Prefer explicit `undefined` over `null`. Use optional chaining and nullish coalescing.

```typescript
interface Config {
  apiKey: string;
  timeout?: number;
}

function getTimeout(config: Config): number {
  return config.timeout ?? 30000;
}

// Optional chaining
const userEmail = user?.profile?.email;
```

