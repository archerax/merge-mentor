/**
 * Path policy shared by AI provider permission handlers.
 *
 * Tool requests are driven by model output, which in turn is steered by
 * untrusted PR content. File access is therefore confined to the working tree
 * (symlinks resolved) and writes additionally refuse paths that can execute
 * code the next time the user runs git, an editor, CI or a package manager.
 */

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** Top-level directories that `fix` must never write to. */
const DENIED_WRITE_DIRECTORIES: ReadonlySet<string> = new Set([
  ".git",
  ".husky",
  ".github",
  ".vscode",
]);

/** File names (at any depth) that `fix` must never write to. */
const DENIED_WRITE_FILES: ReadonlySet<string> = new Set([
  "package.json",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".envrc",
]);

/**
 * Resolves a path through symlinks, even when the final segments do not exist
 * yet (a file about to be created): the nearest existing ancestor is resolved
 * and the missing tail re-attached.
 */
function realpathAllowingMissing(path: string): string {
  let existing = path;
  const tail: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return path;
    tail.unshift(basename(existing));
    existing = parent;
  }
  return resolve(realpathSync(existing), ...tail);
}

/**
 * Returns the real path relative to the working tree, or `undefined` when the
 * path resolves (after `..` and symlinks) outside of it.
 *
 * @param workingDirectory - Root of the allowed working tree
 * @param candidate - Absolute or working-tree-relative path from a tool request
 */
export function relativeInsideWorkingTree(
  workingDirectory: string,
  candidate: string
): string | undefined {
  if (candidate.includes("\0")) return undefined;
  const root = realpathAllowingMissing(resolve(workingDirectory));
  const target = realpathAllowingMissing(
    isAbsolute(candidate) ? resolve(candidate) : resolve(workingDirectory, candidate)
  );
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return rel;
}

/**
 * Whether a working-tree-relative path is off limits for writes.
 *
 * @param relativePath - Path relative to the working tree, as returned by {@link relativeInsideWorkingTree}
 */
export function isDeniedWritePath(relativePath: string): boolean {
  const segments = relativePath.split(sep).filter((segment) => segment.length > 0);
  if (segments.length === 0) return true;
  if (DENIED_WRITE_DIRECTORIES.has(segments[0].toLowerCase())) return true;
  return DENIED_WRITE_FILES.has(segments[segments.length - 1].toLowerCase());
}
