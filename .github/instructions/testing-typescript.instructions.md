---
name: 'TypeScript Testing Standards'
description: 'Testing conventions for Vitest unit tests in TypeScript'
applyTo: **/*.test.ts, **/*.spec.ts, **/*.test.tsx, **/*.spec.tsx
---

# TypeScript Testing Standards

## Structure

- **Arrange-Act-Assert**: separate phases with blank lines; omit comments when structure is obvious
- **One concern per test**: test a single behavioral outcome per test case
- **Descriptive names**: `'returns zero when parsing empty string'` not `'parseNumsEmptyStr'`
- **Colocate**: `src/user-service.ts` → `src/user-service.test.ts`
- **`describe` blocks**: group tests by class, then by method

## Test Doubles

- **Factory functions over `beforeEach`**: create stubs inline; use `beforeEach` only when setup is identical for every test in the suite
- **One mock per test**: verify one interaction; stub everything else
- **Never inject production dependencies** in tests

```typescript
function createStubRepository(): UserRepository {
  return { find: vi.fn(), save: vi.fn(), delete: vi.fn() };
}
```

## Assertions

- Use specific matchers: `toBeNull()`, `toHaveLength()`, `toEqual()` — not `toBe(true)` for everything
- Use `toMatchObject()` for partial matching to avoid brittle full-object equality
- Use `test.each` for parameterized inputs

## Rules

- **No logic in tests**: no loops, conditionals, or computed expected values
- **Test behavior, not implementation**: assert outcomes, not internal method calls
- **Always `await` promises** in async tests — never fire-and-forget
- **Exceptions**: `expect(() => fn()).toThrow(msg)` / `await expect(fn()).rejects.toThrow(msg)`
- **Unit tests**: no real I/O — no database, filesystem, network, or system time
