/**
 * Ports and adapters for dependency injection and testability.
 *
 * The ports module defines abstraction interfaces for external dependencies,
 * enabling easy mocking and substitution during testing. Each port provides:
 * - A clean interface abstraction (the "port")
 * - A production implementation using Node.js built-ins (the "adapter")
 * - Optional test helpers for creating mocks/stubs
 *
 * This follows the Hexagonal Architecture (Ports & Adapters) pattern,
 * decoupling core application logic from infrastructure concerns like
 * filesystem I/O, process execution, and system time.
 *
 * @example
 * ```typescript
 * // Production: uses real system resources
 * import { systemClock, nodeFs, nodeProcessRunner } from "../ports/index.js";
 *
 * // Testing: provide stub/mock implementations
 * const mockClock = { now: () => new Date("2024-01-01"), ... };
 * const mockFs = { readFile: vi.fn(), writeFile: vi.fn(), ... };
 * ```
 */

/**
 * Abstraction over system time for testability.
 *
 * Provides three ways to read the current time, enabling tests to
 * freeze, advance, or manipulate time without affecting other tests.
 *
 * @example
 * ```typescript
 * const now = clock.now();        // Date object
 * const isoString = clock.timestamp();  // "2024-01-15T10:30:00.000Z"
 * const ms = clock.epochMs();     // 1705317000000
 * ```
 */
export interface Clock {
  /** Returns current Date. */
  now(): Date;
  /** Returns current time as ISO 8601 string. */
  timestamp(): string;
  /** Returns current time as epoch milliseconds. */
  epochMs(): number;
}

/**
 * Production implementation using system clock.
 *
 * Directly delegates to JavaScript's Date and Date.now() without any wrapping.
 */
export const systemClock: Clock = {
  now: () => new Date(),
  timestamp: () => new Date().toISOString(),
  epochMs: () => Date.now(),
};
