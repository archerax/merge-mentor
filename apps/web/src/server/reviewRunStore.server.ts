/**
 * Durable storage for review runs.
 *
 * A review run survives a browser refresh and a server restart because its
 * lifecycle is persisted under `<tempPath>/runs/<runId>`:
 *
 * ```
 * runs/<runId>/
 *   manifest.json   # target, input, status, createdAt
 *   events.jsonl    # append-only stream frames, one per line, each with a seq
 *   summary.json    # final result frame (written once the run completes)
 * ```
 *
 * `events.jsonl` is append-only (cheap); `manifest.json` and `summary.json` are
 * rewritten atomically (temp file + rename) so a crash never leaves a partial
 * file. This module performs no policy (retention, execution) — that lives in
 * `reviewRuns.server.ts`.
 */

import fs from "node:fs";
import path from "node:path";

import { isReviewRunId } from "@merge-mentor/shared/utils/reviewRunId.js";

/** Which review kind produced a run. */
export type ReviewRunKind = "pr" | "pbi" | "project";

/** Lifecycle status persisted for a run. */
export type ReviewRunStatus = "running" | "done" | "error";

/** Persisted metadata describing a review run. */
export interface ReviewRunManifest {
  /** Unique run id (also the directory name). */
  readonly runId: string;
  /** Which review kind this run executes. */
  readonly kind: ReviewRunKind;
  /** Stable target key, used to dedupe concurrent runs of the same target. */
  readonly targetKey: string;
  /** Original stream input, replayed for resume and post-comments. */
  readonly input: unknown;
  /** Human-readable label (e.g. `PR #42 · acme/widgets`). */
  readonly label: string;
  /** Creation timestamp (epoch milliseconds). */
  readonly createdAt: number;
  /** Current lifecycle status. */
  readonly status: ReviewRunStatus;
}

/** An event frame paired with its monotonic sequence number. */
export interface StoredRunEvent {
  /** Monotonic sequence number, starting at 1. */
  readonly seq: number;
  /** The stream frame payload. */
  readonly event: unknown;
}

/** Directory holding all run directories for a temp path. */
export function runsDir(tempPath: string): string {
  return path.join(tempPath, "runs");
}

/** Directory for a specific run, or `null` for an invalid run id. */
export function runDir(tempPath: string, runId: string): string | null {
  if (!isReviewRunId(runId)) return null;
  return path.join(runsDir(tempPath), runId);
}

/** Writes a file atomically (temp file + rename) so readers never see partial content. */
function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.tmp`;
  fs.writeFileSync(tempFile, content, "utf8");
  fs.renameSync(tempFile, filePath);
}

/** Persists a run manifest atomically. */
export function writeManifest(tempPath: string, manifest: ReviewRunManifest): void {
  const dir = runDir(tempPath, manifest.runId);
  if (!dir) return;
  writeAtomic(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Reads a run manifest, or `null` when missing/malformed. */
export function readManifest(tempPath: string, runId: string): ReviewRunManifest | null {
  const dir = runDir(tempPath, runId);
  if (!dir) return null;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8")
    ) as Partial<ReviewRunManifest>;
    if (typeof parsed.runId !== "string" || typeof parsed.status !== "string") return null;
    return parsed as ReviewRunManifest;
  } catch {
    return null;
  }
}

/** Serializes one event frame as a single JSONL line. */
function serializeEvent(entry: StoredRunEvent): string {
  return `${JSON.stringify(entry)}\n`;
}

/**
 * Opens a run's event log for appending, returning its file descriptor.
 *
 * A live run keeps this descriptor open and writes frames through
 * {@link writeEvent}, avoiding an open/write/close per frame on the streaming
 * hot path. Returns `null` for an invalid run id or if opening fails.
 */
export function openEventLog(tempPath: string, runId: string): number | null {
  const dir = runDir(tempPath, runId);
  if (!dir) return null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    return fs.openSync(path.join(dir, "events.jsonl"), "a");
  } catch {
    return null;
  }
}

/** Appends one event frame through an already-open event-log descriptor. */
export function writeEvent(fd: number, entry: StoredRunEvent): void {
  fs.writeSync(fd, serializeEvent(entry));
}

/** Closes an event-log descriptor, tolerating an already-closed one. */
export function closeEventLog(fd: number): void {
  try {
    fs.closeSync(fd);
  } catch {
    // Already closed.
  }
}

/** Appends one event frame to a run's append-only event log. */
export function appendEvent(tempPath: string, runId: string, entry: StoredRunEvent): void {
  const fd = openEventLog(tempPath, runId);
  if (fd === null) return;
  try {
    writeEvent(fd, entry);
  } finally {
    closeEventLog(fd);
  }
}

/** Reads persisted events with a sequence number greater than `fromSeq`. */
export function readEvents(tempPath: string, runId: string, fromSeq = 0): StoredRunEvent[] {
  const dir = runDir(tempPath, runId);
  if (!dir) return [];
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(dir, "events.jsonl"), "utf8");
  } catch {
    return [];
  }

  const events: StoredRunEvent[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const entry = JSON.parse(line) as StoredRunEvent;
      if (typeof entry.seq === "number" && entry.seq > fromSeq) events.push(entry);
    } catch {
      // Tolerate a partially written trailing line.
    }
  }
  return events;
}

/** Persists the final result frame for a run atomically. */
export function writeSummary(tempPath: string, runId: string, summary: unknown): void {
  const dir = runDir(tempPath, runId);
  if (!dir) return;
  writeAtomic(path.join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
}

/** Reads a run's final result frame, or `null` when absent. */
export function readSummary(tempPath: string, runId: string): unknown | null {
  const dir = runDir(tempPath, runId);
  if (!dir) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** Lists run manifests, newest first. */
export function listRuns(tempPath: string): ReviewRunManifest[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(runsDir(tempPath), { withFileTypes: true });
  } catch {
    return [];
  }

  const manifests: ReviewRunManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = readManifest(tempPath, entry.name);
    if (manifest) manifests.push(manifest);
  }
  manifests.sort((a, b) => b.createdAt - a.createdAt);
  return manifests;
}

/**
 * Deletes runs older than `maxAgeMs` or beyond the newest `maxCount`. Run ids in
 * `protect` (typically still executing) are never removed. Returns the run ids
 * that were removed.
 */
export function pruneRuns(
  tempPath: string,
  options: {
    readonly maxAgeMs?: number;
    readonly maxCount?: number;
    readonly protect?: ReadonlySet<string>;
  }
): string[] {
  const manifests = listRuns(tempPath);
  const now = Date.now();
  const { maxAgeMs, maxCount, protect } = options;
  const removed: string[] = [];

  manifests.forEach((manifest, index) => {
    if (protect?.has(manifest.runId)) return;

    const tooOld = maxAgeMs !== undefined && now - manifest.createdAt > maxAgeMs;
    const tooMany = maxCount !== undefined && index >= maxCount;
    if (!tooOld && !tooMany) return;

    const dir = runDir(tempPath, manifest.runId);
    if (!dir) return;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(manifest.runId);
    } catch {
      // Best-effort cleanup; leave the directory if removal fails.
    }
  });

  return removed;
}
