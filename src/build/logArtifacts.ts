import path from "node:path";
import type { FileSystem } from "../ports/index.js";
import { nodeFs } from "../ports/index.js";
import type { BuildLogChunk, BuildReference, EvidenceBlock, LogArtifact } from "./types.js";

const DEFAULT_TAIL_LINES = 200;
const DEFAULT_TAIL_BYTES = 8_192;

/**
 * Options controlling how log artifacts are persisted.
 */
export interface LogArtifactOptions {
  /** Base directory under which the artifact subdirectory is created. */
  readonly tempPath: string;
  /** Maximum number of trailing lines kept in each artifact's tail. */
  readonly tailLines?: number;
  /** Maximum number of tail bytes kept in each artifact's tail. */
  readonly tailBytes?: number;
  /** File system abstraction used for storage; defaults to `node:fs`. */
  readonly fileSystem?: FileSystem;
}

/**
 * Result of persisting a build's log chunks to disk.
 */
export interface StoredLogArtifacts {
  /** Absolute path of the directory holding the artifacts and manifest. */
  readonly directory: string;
  /** The stored artifacts, one per persisted log chunk. */
  readonly artifacts: readonly LogArtifact[];
}

/**
 * Persists the failed build's log chunks to disk as sanitized artifact files.
 *
 * Each chunk is written to a numbered `.log` file under
 * `tempPath/build-logs/<platform>-<buildId>-<timestamp>`, along with a
 * `manifest.json` describing the artifacts. A redacted tail of each file is
 * kept on the returned artifact for inline prompt context.
 *
 * @param reference - The build the log chunks belong to.
 * @param chunks - The failed log chunks to persist.
 * @param evidence - Evidence blocks whose IDs are recorded in the manifest.
 * @param options - Storage location, tail sizing, and file system override.
 * @returns The storage directory and the persisted artifacts.
 */
export async function storeLogArtifacts(
  reference: BuildReference,
  chunks: readonly BuildLogChunk[],
  evidence: readonly EvidenceBlock[],
  options: LogArtifactOptions
): Promise<StoredLogArtifacts> {
  const fileSystem = options.fileSystem ?? nodeFs;
  const directory = path.join(
    options.tempPath,
    "build-logs",
    `${reference.platform}-${safeName(reference.id)}-${Date.now()}`
  );
  await fileSystem.mkdir(directory, { recursive: true });

  const artifacts: LogArtifact[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const filename = `${String(index + 1).padStart(3, "0")}-${safeName(
      chunk.jobName ?? chunk.stepName ?? `log-${index + 1}`
    )}.log`;
    const filePath = path.join(directory, filename);
    const content = redact(chunk.content).text;
    await fileSystem.writeFile(filePath, content, "utf8");
    artifacts.push({
      filename,
      path: filePath,
      jobName: chunk.jobName,
      stageName: chunk.stageName,
      stepName: chunk.stepName,
      sequence: chunk.sequence,
      tail: takeTail(
        content,
        options.tailLines ?? DEFAULT_TAIL_LINES,
        options.tailBytes ?? DEFAULT_TAIL_BYTES
      ),
    });
  }

  const manifest = {
    platform: reference.platform,
    buildId: reference.id,
    artifacts: artifacts.map(({ path: filePath, ...artifact }) => ({
      ...artifact,
      path: filePath,
    })),
    evidenceIds: evidence.map((block) => block.id),
  };
  await fileSystem.writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
  return { directory, artifacts };
}

/**
 * Redacts secrets (tokens, passwords, API keys, authorization headers) from
 * a log string.
 *
 * @param text - The raw log text to sanitize.
 * @returns The log text with secret values replaced by `[REDACTED]`.
 */
export function redactLog(text: string): string {
  return redact(text).text;
}

/**
 * Redacts secrets from a log string and reports whether anything changed.
 *
 * @param text - The raw log text to sanitize.
 * @returns The sanitized text and whether any secrets were replaced.
 */
function redact(text: string): { text: string; changed: boolean } {
  let changed = false;
  const redacted = text.replace(
    /((?:token|password|secret|api[_-]?key|authorization)\s*[=:]\s*)([^\s,;]+)/gi,
    (_match, prefix: string) => {
      changed = true;
      return `${prefix}[REDACTED]`;
    }
  );
  return { text: redacted, changed };
}

/**
 * Extracts the tail of a log string within line and byte limits.
 *
 * @param text - The full log content.
 * @param maxLines - Maximum number of trailing lines to keep.
 * @param maxBytes - Maximum byte size for the returned tail.
 * @returns The trailing portion of the log within both limits.
 */
function takeTail(text: string, maxLines: number, maxBytes: number): string {
  const lines = text.split(/\r?\n/);
  const tail = lines.slice(-Math.max(1, maxLines)).join("\n");
  if (Buffer.byteLength(tail) <= maxBytes) return tail;
  return Buffer.from(tail).subarray(-maxBytes).toString("utf8");
}

/**
 * Sanitizes a string into a safe filename segment.
 *
 * Replaces characters that are unsafe for filenames and truncates to 80
 * characters.
 *
 * @param value - The raw value to make filename-safe.
 * @returns A filename-safe string, or `"unknown"` if nothing remains.
 */
function safeName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80) || "unknown";
}
