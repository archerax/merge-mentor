# Refactoring TODO List

This document outlines the code quality, architectural, and performance improvements identified for the **merge-mentor** project.

---

## 1. Persistent Global Cache State Pollution

- **File:** [executableFinder.ts](file:///root/merge-mentor/src/ports/executableFinder.ts#L30)
- **Problem:**
  The resolved executable paths cache is declared as a module-level global variable:
  ```typescript
  /** Cache for resolved executable paths. */
  const pathCache = new Map<string, string>();
  ```
- **Consequences:**
  Since the map is never cleared between test runs, tests that call `createSystemExecutableFinder` share the same cache. This leads to state leakage and potential test cross-contamination.
- **Task:**
  - Move `pathCache` inside the closure of `createSystemExecutableFinder` (so each instanced finder has its own cache).
  - Alternatively, export a utility function to clear the cache during `afterEach` test hooks, or accept a cache map parameter.

---

## 2. Test Workarounds for uncleared Cache

- **File:** [ports.spec.ts](file:///root/merge-mentor/src/ports/ports.spec.ts#L19)
- **Problem:**
  Because `pathCache` is a global map that cannot be reset, the unit tests have to append a random UUID to every command name they query to avoid getting cached results from other tests:
  ```typescript
  const uniqueCmd = `found-cmd-${randomUUID()}`;
  ```
- **Task:**
  - Once the `pathCache` is refactored to be instance-scoped, remove the random UUID generation in tests and write standard deterministic tests (e.g. testing `git`, `node` directly).
