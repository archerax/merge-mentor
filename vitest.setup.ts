import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterAll, expect, vi } from "vitest";

expect.extend(jestDomMatchers);

// Mock pino to avoid CI issues with worker threads and file system operations
vi.mock("pino", () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => mockLogger),
    flush: vi.fn().mockResolvedValue(undefined),
    level: "info",
  };

  return {
    default: vi.fn(() => mockLogger),
  };
});

// Note: child_process and node:child_process mocks are defined in individual test files
// that need them, not globally, to avoid mock state leakage with isolate: false

// Clean up after all tests complete
afterAll(async () => {
  // No need to cleanup mocked logger
});

// Mantine components rely on browser APIs that jsdom does not implement. Specs
// opt in to jsdom with a `@vitest-environment jsdom` docblock; node-environment
// specs skip this block.
if (typeof window !== "undefined") {
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList;

  Element.prototype.scrollIntoView ??= vi.fn();

  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
