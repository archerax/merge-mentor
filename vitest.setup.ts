import { afterAll, vi } from "vitest";

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
