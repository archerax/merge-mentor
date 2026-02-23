import type { Stats } from "node:fs";
import fs from "node:fs/promises";

/** Abstraction over filesystem operations for testability. */
export interface FileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  access(path: string): Promise<void>;
  readdir(path: string, options?: { withFileTypes: true }): Promise<import("node:fs").Dirent[]>;
  stat(path: string): Promise<Stats>;
  unlink(path: string): Promise<void>;
}

/** Production implementation using Node.js fs/promises. */
export const nodeFs: FileSystem = {
  readFile: (path, encoding) => fs.readFile(path, encoding),
  writeFile: (path, data, encoding) => fs.writeFile(path, data, encoding),
  mkdir: (path, options) => fs.mkdir(path, options),
  rm: (path, options) => fs.rm(path, options),
  access: (path) => fs.access(path),
  readdir: (path, options) => fs.readdir(path, options as any) as any,
  stat: (path) => fs.stat(path),
  unlink: (path) => fs.unlink(path),
};
