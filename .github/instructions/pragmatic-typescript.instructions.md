---
name: TypeScript Code Principles
description: Code conventions for maintainable, robust TypeScript
applyTo: **/*.tsx, **/*.ts
---

# TypeScript Code Principles

## Naming

- **Classes**: Nouns (`UserAccount`, `PaymentProcessor`)
- **Functions**: Verbs (`calculateTotal`, `sendEmail`, `fetchData`)
- **Booleans**: Predicates (`isActive`, `hasPermission`, `canExecute`)
- Names reveal intent without comments; avoid abbreviations except in tight loops
- Constants: `ALL_CAPS` or descriptively named

## Functions

- Single responsibility; one abstraction level per function
- Favor early returns over deep nesting
- Use config objects for 3+ parameters; never boolean flags (split into separate functions instead)
- **Command-query separation**: functions either mutate state or return data, never both
- JSDoc on all public APIs with `@param`, `@returns`, and `@example`

## Classes & Architecture

- **Single responsibility**: one reason to change
- **Depend on interfaces, not concrete implementations**; use constructor injection
- **DRY**: every concept has one authoritative representation — extract shared logic, never duplicate business rules
- Isolate third-party dependencies behind your own interfaces
- Separate DTOs (data only) from domain objects (behavior + encapsulation)
- Law of Demeter: call methods only on direct dependencies — avoid `a.getB().getC()`

```typescript
// Good
class ReportGenerator {
  constructor(private formatter: Formatter) {}
}
// Bad
class ReportGenerator {
  private formatter = new PDFFormatter();
}
```

## Error Handling

- Throw named error classes with context; don't return error codes
- Prefer `undefined` over `null` for optional values; throw for exceptional cases
- Pair every resource acquisition with cleanup (`try/finally` or `using`)
- Validate all external input at boundaries; fail fast on invalid state

```typescript
class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`User not found: ${userId}`);
    this.name = "UserNotFoundError";
  }
}

await using connection = await createConnection(); // auto-cleanup
```

## TypeScript-Specific

- **No `any`**: use `unknown`, then narrow with type guards
- **Immutability**: prefer `readonly`, `const`, and spread updates over mutation
- **Discriminated unions** for state machines and variants
- Optional chaining (`?.`) and nullish coalescing (`??`) over manual null checks

```typescript
type Result<T, E> = { success: true; value: T } | { success: false; error: E };
```
