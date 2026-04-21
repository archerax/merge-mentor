import { vi } from "vitest";
import type { GitClient } from "../gitClient.js";

/** Creates a stub GitClient for testing. All methods resolve successfully by default. */
export function createStubGitClient(overrides?: Partial<GitClient>): GitClient {
  return {
    clone: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    clean: vi.fn().mockResolvedValue(undefined),
    setRemoteUrl: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
