import type { Stats } from "node:fs";
import fs from "node:fs/promises";

/**
 * Filesystem abstraction for testability.
 *
 * Provides async file and directory operations compatible with Node.js fs/promises.
 * Using this abstraction enables tests to mock filesystem behavior without touching
 * real files on disk.
 *
 * All operations are async (Promise-based) for consistent behavior across
 * read, write, and directory operations.
 *
 * @example
 * ```typescript
 * // Production: real filesystem
 * import { nodeFs } from "../ports/index.js";
 * const content = await nodeFs.readFile("config.json", "utf-8");
 *
 * // Testing: mock filesystem
 * const mockFs = { readFile: vi.fn().mockResolvedValue('{"key":"value"}'), ... };
 * const content = await mockFs.readFile("config.json", "utf-8");
 * ```
 */
export interface FileSystem {
  /**
   * Reads a file's content.
   *
   * @param path - File path
   * @param encoding - Text encoding (utf-8, ascii, etc.)
   * @returns File content as string
   * @throws If file does not exist or cannot be read
   */
  readFile(path: string, encoding: BufferEncoding): Promise<string>;

  /**
   * Writes content to a file.
   *
   * @param path - File path
   * @param data - Content to write
   * @param encoding - Text encoding (utf-8, ascii, etc.)
   * @throws If directory does not exist or write fails
   */
  writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;

  /**
   * Creates a directory.
   *
   * @param path - Directory path
   * @param options - Creation options (recursive: true to create parent dirs)
   * @returns Created directory path, or undefined
   * @throws If creation fails
   */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;

  /**
   * Removes a file or directory.
   *
   * @param path - File or directory path
   * @param options - Removal options (recursive: true for directories, force: true to ignore missing)
   * @throws If removal fails
   */
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;

  /**
   * Checks if a file or directory is accessible.
   *
   * @param path - File or directory path
   * @throws If path is not accessible
   */
  access(path: string): Promise<void>;

  /**
   * Lists directory contents.
   *
   * @param path - Directory path
   * @param options - Must include { withFileTypes: true } to return Dirent objects
   * @returns Array of Dirent objects with file types
   * @throws If directory cannot be read
   */
  readdir(path: string, options?: { withFileTypes: true }): Promise<import("node:fs").Dirent[]>;

  /**
   * Gets file or directory metadata.
   *
   * @param path - File or directory path
   * @returns Stats object with size, mode, timestamps, etc.
   * @throws If stat fails
   */
  stat(path: string): Promise<Stats>;

  /**
   * Removes a file.
   *
   * @param path - File path
   * @throws If file cannot be removed
   */
  unlink(path: string): Promise<void>;
}

/**
 * Production implementation using Node.js fs/promises.
 *
 * Directly delegates to the async filesystem operations from Node.js,
 * providing Promise-based file and directory manipulation.
 */
export const nodeFs: FileSystem = {
  readFile: (path, encoding) => fs.readFile(path, encoding),
  writeFile: (path, data, encoding) => fs.writeFile(path, data, encoding),
  mkdir: (path, options) => fs.mkdir(path, options),
  rm: (path, options) => fs.rm(path, options),
  access: (path) => fs.access(path),
  readdir: (path, options) =>
    fs.readdir(path, options as { withFileTypes: true }) as Promise<import("node:fs").Dirent[]>,
  stat: (path) => fs.stat(path),
  unlink: (path) => fs.unlink(path),
};
