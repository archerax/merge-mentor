/** Entry for a single file in the diff manifest. */
export interface DiffFileEntry {
  /** Original filename from the PR (e.g., "src/utils/helper.ts") */
  readonly filename: string;
  /** File status (added, modified, deleted, renamed) */
  readonly status: string;
  /** Relative path to the diff file within the diffs directory (sanitized filename) */
  readonly diffPath: string;
  /** Number of lines added in this file */
  readonly additions: number;
  /** Number of lines deleted from this file */
  readonly deletions: number;
}

/** Manifest describing all diffs stored for a PR. */
export interface DiffManifest {
  /** Unique PR identifier (e.g., "GitHub-owner-repo-PR42") */
  readonly prIdentifier: string;
  /** List of files with their diff paths and metadata */
  readonly files: readonly DiffFileEntry[];
  /** ISO 8601 timestamp when diffs were stored */
  readonly createdAt: string;
}
