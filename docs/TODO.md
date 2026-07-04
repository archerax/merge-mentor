# Refactoring TODO List

This document outlines the code quality, architectural, and performance improvements identified for the **merge-mentor** project.

---

## 1. Persistent Global Cache State Pollution (Completed)

- **File:** [executableFinder.ts](file:///root/merge-mentor/src/ports/executableFinder.ts#L30)
- **Problem:**
  The resolved executable paths cache was declared as a module-level global variable:
  ```typescript
  /** Cache for resolved executable paths. */
  const pathCache = new Map<string, string>();
  ```
- **Consequences:**
  Since the map was never cleared between test runs, tests that call `createSystemExecutableFinder` shared the same cache. This led to state leakage and potential test cross-contamination.
- **Task:**
  - [x] Move `pathCache` inside the closure of `createSystemExecutableFinder` (so each instanced finder has its own cache).

---

## 2. Test Workarounds for uncleared Cache (Completed)

- **File:** [ports.spec.ts](file:///root/merge-mentor/src/ports/ports.spec.ts#L19)
- **Problem:**
  Because `pathCache` was a global map that could not be reset, the unit tests had to append a random UUID to every command name they queried to avoid getting cached results from other tests:
  ```typescript
  const uniqueCmd = `found-cmd-${randomUUID()}`;
  ```
- **Task:**
  - [x] Once the `pathCache` is refactored to be instance-scoped, remove the random UUID generation in tests and write standard deterministic tests (e.g. testing `git`, `node` directly).
