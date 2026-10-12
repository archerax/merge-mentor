/**
 * Review run identity.
 *
 * A review run id is distinct from the deterministic target id
 * (`generatePRIdentifier`): the target id identifies the PR/work item and is
 * reused across runs, while the run id identifies one execution. Run ids are
 * URL-safe, sortable (a base-36 timestamp prefix), and carry an unguessable
 * random suffix so a shared `/review?run=<id>` link cannot be enumerated.
 */

/** Longest target-id prefix embedded in a run id, to keep ids bounded. */
const MAX_TARGET_PREFIX_LENGTH = 80;

/** Characters that can appear in a run id and remain filesystem-safe. */
const UNSAFE_RUN_ID_CHARS = /[^A-Za-z0-9._-]+/g;

/**
 * Sanitizes a target key so it can be embedded in a run id and used as a
 * directory name, replacing unsafe runs of characters with a single hyphen.
 */
export function sanitizeRunTarget(targetKey: string): string {
  const sanitized = targetKey.replace(UNSAFE_RUN_ID_CHARS, "-").replace(/^[-.]+|[-.]+$/g, "");
  return sanitized.slice(0, MAX_TARGET_PREFIX_LENGTH) || "run";
}

/**
 * Generates a unique, URL-safe review run id.
 *
 * The id embeds the human-readable target key for debuggability, a base-36
 * timestamp so ids sort roughly by creation time, and a short random suffix so
 * repeated runs against the same target stay unique and unguessable.
 *
 * @param targetKey - Stable target identifier (e.g. the posted-comments key).
 * @returns A run id such as `pr-github-acme-widgets-42-lz9k2-1f3a2b4c`.
 */
export function generateReviewRunId(targetKey: string): string {
  const target = sanitizeRunTarget(targetKey);
  const timestamp = Date.now().toString(36);
  const random = globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${target}-${timestamp}-${random}`;
}

/** Matches a well-formed run id, which is also a safe relative path segment. */
const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Matches ids that are nothing but dots (`.`/`..`), which resolve to a parent dir. */
const DOT_ONLY_PATTERN = /^\.+$/;

/** Returns whether a string is a structurally valid, path-safe run id. */
export function isReviewRunId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 200 &&
    RUN_ID_PATTERN.test(value) &&
    !DOT_ONLY_PATTERN.test(value)
  );
}
