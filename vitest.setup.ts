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

// Mock child_process spawn globally for integration tests to avoid invoking the real Copilot CLI
// Source imports use both "node:child_process" and "child_process" in different files, so mock both
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("child_process", () => ({ spawn: vi.fn() }));

// Clean up after all tests complete
afterAll(async () => {
  // No need to cleanup mocked logger or child_process mocks
});
