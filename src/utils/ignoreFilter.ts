import micromatch from "micromatch";
import type { PRFile } from "../platforms/types.js";

/**
 * File ignore filtering utilities for PR reviews.
 *
 * Determines which files in a PR should be skipped during code review based on
 * glob pattern matching. Uses micromatch for pattern matching against file paths.
 *
 * Default patterns are empty (all files reviewed by default), but users can
 * specify patterns via the CLI --ignore flag to exclude specific files.
 *
 * @example
 * ```typescript
 * const files = [
 *   "src/index.ts",
 *   "dist/index.js",
 *   "node_modules/package.json",
 *   "README.md"
 * ];
 *
 * const result = filterPRFiles(files, [
 *   "dist/**",
 *   "node_modules/**",
 *   "*.lock"
 * ]);
 * // result.kept = [src/index.ts, README.md]
 * // result.ignored = [dist/index.js, node_modules/package.json]
 * ```
 */
/**
 * Merges default ignore patterns with user-provided patterns.
 * User patterns extend the defaults (currently empty by default).
 *
 * @param userPatterns - User-provided glob patterns to ignore
 * @returns Merged array of default + user patterns for matching
 */
export function getIgnorePatterns(userPatterns: string[] = []): string[] {
  const DEFAULT_IGNORE_PATTERNS = [
    "**/*.lock",
    "**/package-lock.json",
    "**/pnpm-lock.yaml",
    "**/npm-shrinkwrap.json",
    "**/bun.lockb",
    "**/*.lockb",
    "**/*.min.js",
    "**/*.min.css",
    "**/*.map",
    // Image formats
    "**/*.png",
    "**/*.jpg",
    "**/*.jpeg",
    "**/*.gif",
    "**/*.ico",
    "**/*.svg",
    "**/*.webp",
    // Font formats
    "**/*.woff",
    "**/*.woff2",
    "**/*.ttf",
    "**/*.eot",
    // Archives
    "**/*.zip",
    "**/*.tar.gz",
    "**/*.tgz",
    "**/*.tar",
    "**/*.gz",
    "**/*.rar",
    "**/*.7z",
    // Media/Documents
    "**/*.pdf",
    "**/*.mp3",
    "**/*.wav",
    "**/*.mp4",
    "**/*.mov",
    "**/*.avi",
    "**/*.webm",
    // Compiled binaries / Database files
    "**/*.exe",
    "**/*.dll",
    "**/*.so",
    "**/*.dylib",
    "**/*.class",
    "**/*.pyc",
    "**/*.db",
    "**/*.sqlite",
    "**/*.sqlite3",
  ];
  return [...DEFAULT_IGNORE_PATTERNS, ...userPatterns];
}

/**
 * Checks if a file path matches any of the provided glob patterns.
 *
 * @param filePath - File path to check
 * @param patterns - Array of glob patterns to match against
 * @returns true if the file matches any pattern, false otherwise
 */
export function shouldIgnoreFile(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  return micromatch.match([filePath], patterns).length > 0;
}

/**
 * Filters PR files based on ignore patterns.
 * Files matching any ignore pattern are excluded from the result.
 *
 * @param files - Array of PR files to filter
 * @param ignorePatterns - Glob patterns for files to ignore
 * @returns Filtered array of files, along with ignored file paths
 */
export function filterPRFiles(
  files: PRFile[],
  ignorePatterns: string[] = []
): { kept: PRFile[]; ignored: string[] } {
  const kept: PRFile[] = [];
  const ignored: string[] = [];

  for (const file of files) {
    if (shouldIgnoreFile(file.filename, ignorePatterns)) {
      ignored.push(file.filename);
    } else {
      kept.push(file);
    }
  }

  return { kept, ignored };
}
