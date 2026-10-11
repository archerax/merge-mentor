/**
 * Durable record of which planned comments have already been posted.
 *
 * A dry-run review is stateless: the web UI round-trips the planned payload to
 * the post endpoint without re-running any AI work. Without a durable marker a
 * page reload would offer to post the same comments again, and repeated clicks
 * could double-post. This store keeps a per-target set of posted comment
 * fingerprints under `<tempPath>`, so a fresh review summary can mark comments
 * that were already posted and the endpoint can skip them idempotently.
 */

import fs from "node:fs";
import path from "node:path";

import type { Config, Platform } from "@merge-mentor/config/config.js";

/** File under `tempPath` that records posted comment fingerprints by target. */
const STORE_FILE = "posted-comments.json";

/** On-disk shape of the posted-comments store. */
interface PostedCommentsFile {
  /** Posted comment fingerprints keyed by {@link postedTargetKey}. */
  readonly targets: Record<string, readonly string[]>;
}

/** Repository scope shared by every comment posted against a target. */
export function reviewScope(platform: Platform, config: Config): string {
  return platform === "github"
    ? `${config.github.owner}/${config.github.repo}`
    : `${config.azure.org}/${config.azure.project}/${config.azure.repo}`;
}

/** Builds the store key identifying a review target's posted comments. */
export function postedTargetKey(
  kind: "pr" | "pbi" | "project",
  platform: Platform,
  scope: string,
  id: string | number
): string {
  return `${kind}:${platform}:${scope}:${id}`;
}

/** Absolute path of the posted-comments store for a temp path. */
function storePath(tempPath: string): string {
  return path.join(tempPath, STORE_FILE);
}

/** Reads the store, tolerating a missing or malformed file. */
function readStore(tempPath: string): Record<string, readonly string[]> {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(storePath(tempPath), "utf8")
    ) as Partial<PostedCommentsFile>;
    const targets = parsed.targets;
    return typeof targets === "object" && targets !== null ? targets : {};
  } catch {
    return {};
  }
}

/** Returns the fingerprints already recorded as posted for a target. */
export function loadPostedFingerprints(tempPath: string, targetKey: string): Set<string> {
  const stored = readStore(tempPath)[targetKey];
  const fingerprints = Array.isArray(stored) ? stored : [];
  return new Set(fingerprints.filter((value): value is string => typeof value === "string"));
}

/** Records fingerprints as posted for a target, writing the store atomically. */
export function recordPostedFingerprints(
  tempPath: string,
  targetKey: string,
  fingerprints: readonly string[]
): void {
  if (fingerprints.length === 0) return;

  const targets: Record<string, readonly string[]> = { ...readStore(tempPath) };
  const existing = new Set(targets[targetKey] ?? []);
  for (const fingerprint of fingerprints) existing.add(fingerprint);
  targets[targetKey] = [...existing];

  fs.mkdirSync(tempPath, { recursive: true });
  const file = storePath(tempPath);
  const tempFile = `${file}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify({ targets }, null, 2)}\n`, "utf8");
  fs.renameSync(tempFile, file);
}
