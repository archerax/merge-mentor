import path from "node:path";

import { nodeFs } from "../ports/index.js";

/**
 * Audit log reader.
 *
 * The {@link AuditLogger} persists structured audit events to pino JSON log files
 * under `.mergementor/logs/`. This module reads those files back and exposes the
 * embedded `audit` payloads as typed, filterable entries so tools such as the web
 * UI can render review history without depending on pino itself.
 */

/** Severity levels attached to audit events. */
export type AuditLogSeverity = "info" | "warn" | "error";

/** Outcome of the audited action. */
type AuditLogResult = "success" | "failure" | "partial";

/** Resource that was acted upon by an audited action. */
interface AuditLogResource {
  /** Kind of resource being acted upon. */
  readonly type: string;
  /** Unique identifier for the resource (PR number, file path, etc.). */
  readonly id: string;
  /** Optional additional details about the resource. */
  readonly details?: Record<string, unknown>;
}

/** A single audit event parsed from a persisted log file. */
interface AuditLogEvent {
  /** Type of audit event (e.g. "pr.details.fetch", "review.start"). */
  readonly eventType: string;
  /** ISO timestamp of when the event occurred. */
  readonly timestamp: string;
  /** Severity derived from the result: info, warn, or error. */
  readonly severity: AuditLogSeverity;
  /** Actor identifier (user or service) that performed the action. */
  readonly actor: string;
  /** Resource that was acted upon. */
  readonly resource: AuditLogResource;
  /** Human-readable description of the action performed. */
  readonly action: string;
  /** Outcome of the action: success, failure, or partial. */
  readonly result: AuditLogResult;
  /** Optional key-value metadata providing additional context. */
  readonly metadata?: Record<string, unknown>;
  /** Optional error message when the action failed. */
  readonly error?: string;
}

/** An audit event together with its location in the log files. */
export interface AuditLogEntry extends AuditLogEvent {
  /** File name of the log the entry was read from. */
  readonly sourceFile: string;
  /** 1-based line number within the source log file. */
  readonly lineNumber: number;
}

/**
 * Minimal filesystem surface required to read audit logs.
 *
 * Structurally compatible with {@link FileSystem} (and therefore `nodeFs`), which
 * keeps the reader easy to stub in tests.
 */
export interface AuditLogFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readdir(
    path: string,
    options: { withFileTypes: true }
  ): Promise<ReadonlyArray<{ name: string; isFile(): boolean }>>;
}

/** Options for {@link readAuditEvents}. */
interface ReadAuditEventsOptions {
  /** Directory containing the `*.log` files. Defaults to `.mergementor/logs` in cwd. */
  readonly logsDir?: string;
  /** Filesystem implementation. Defaults to `nodeFs`. */
  readonly fs?: AuditLogFileSystem;
  /** Maximum number of entries to return after filtering and sorting. */
  readonly limit?: number;
  /** Only return entries with this severity. */
  readonly severity?: AuditLogSeverity;
  /** Only return entries with this event type. */
  readonly eventType?: string;
  /** Only read entries from this log file name. */
  readonly sourceFile?: string;
}

const LOG_FILE_SUFFIX = ".log";

/**
 * Resolves the default audit logs directory (`.mergementor/logs` in the cwd).
 */
export function getDefaultAuditLogsDir(): string {
  return path.join(process.cwd(), ".mergementor", "logs");
}

/**
 * Lists audit log files in a directory, newest first.
 *
 * @param logsDir - Directory that holds the `*.log` files
 * @param fs - Filesystem implementation (defaults to `nodeFs`)
 * @returns File names sorted in descending (newest first) order
 */
export async function listAuditLogFiles(
  logsDir: string = getDefaultAuditLogsDir(),
  fs: AuditLogFileSystem = nodeFs
): Promise<string[]> {
  const dirents = await fs.readdir(logsDir, { withFileTypes: true });
  return dirents
    .filter((entry) => entry.isFile() && entry.name.endsWith(LOG_FILE_SUFFIX))
    .map((entry) => entry.name)
    .toSorted((a, b) => b.localeCompare(a));
}

/**
 * Parses a single pino log line and extracts its audit event, if present.
 *
 * @param line - Raw log line
 * @param sourceFile - File name the line came from
 * @param lineNumber - 1-based line number
 * @returns The parsed entry, or `undefined` when the line is empty, malformed, or holds no audit event
 */
export function parseAuditLine(
  line: string,
  sourceFile: string,
  lineNumber: number
): AuditLogEntry | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || !isAuditLogEvent(parsed.audit)) return undefined;

  return { ...parsed.audit, sourceFile, lineNumber };
}

/**
 * Reads and parses audit events from the persisted log files.
 *
 * Missing directories and unreadable files are treated as empty so the reader can
 * be used safely before any review has been run. Events are returned newest first.
 *
 * @param options - Reader configuration
 * @returns Parsed audit entries
 */
export async function readAuditEvents(
  options: ReadAuditEventsOptions = {}
): Promise<AuditLogEntry[]> {
  const fs = options.fs ?? nodeFs;
  const logsDir = options.logsDir ?? getDefaultAuditLogsDir();

  let files: string[];
  try {
    files = await listAuditLogFiles(logsDir, fs);
  } catch {
    return [];
  }

  const selected = options.sourceFile ? files.filter((file) => file === options.sourceFile) : files;

  const entries: AuditLogEntry[] = [];
  for (const file of selected) {
    let content: string;
    try {
      content = await fs.readFile(path.join(logsDir, file), "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const entry = parseAuditLine(lines[index], file, index + 1);
      if (entry) entries.push(entry);
    }
  }

  const filtered = entries.filter(
    (entry) =>
      (options.severity === undefined || entry.severity === options.severity) &&
      (options.eventType === undefined || entry.eventType === options.eventType)
  );

  filtered.sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp));

  if (options.limit !== undefined && options.limit >= 0) {
    return filtered.slice(0, options.limit);
  }

  return filtered;
}

function toMillis(timestamp: string): number {
  const millis = Date.parse(timestamp);
  return Number.isNaN(millis) ? 0 : millis;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAuditLogEvent(value: unknown): value is AuditLogEvent {
  if (!isRecord(value)) return false;

  return (
    typeof value.eventType === "string" &&
    typeof value.timestamp === "string" &&
    isSeverity(value.severity) &&
    typeof value.actor === "string" &&
    typeof value.action === "string" &&
    isResult(value.result) &&
    isResource(value.resource) &&
    (value.metadata === undefined || isRecord(value.metadata)) &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function isSeverity(value: unknown): value is AuditLogSeverity {
  return value === "info" || value === "warn" || value === "error";
}

function isResult(value: unknown): value is AuditLogResult {
  return value === "success" || value === "failure" || value === "partial";
}

function isResource(value: unknown): value is AuditLogResource {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.id === "string" &&
    (value.details === undefined || isRecord(value.details))
  );
}
