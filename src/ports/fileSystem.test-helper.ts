import type { Stats } from "node:fs";
import { vi } from "vitest";
import type { FileSystem } from "./fileSystem.js";

/** Creates a stub FileSystem for testing. All methods are vi.fn() stubs. */
export function createStubFileSystem(overrides?: Partial<FileSystem>): FileSystem {
  return {
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({
      isDirectory: () => true,
      isFile: () => true,
      size: 0,
      mtime: new Date("2025-01-01T00:00:00.000Z"),
    } as unknown as Stats),
    unlink: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
