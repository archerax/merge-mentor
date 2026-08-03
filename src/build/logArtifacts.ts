import path from "node:path";
import type { FileSystem } from "../ports/index.js";
import { nodeFs } from "../ports/index.js";
import type { BuildLogChunk, BuildReference, EvidenceBlock, LogArtifact } from "./types.js";

const DEFAULT_TAIL_LINES = 200;
const DEFAULT_TAIL_BYTES = 8_192;

export interface LogArtifactOptions {
  readonly tempPath: string;
  readonly tailLines?: number;
  readonly tailBytes?: number;
  readonly fileSystem?: FileSystem;
}

export interface StoredLogArtifacts {
  readonly directory: string;
  readonly artifacts: readonly LogArtifact[];
}

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

export function redactLog(text: string): string {
  return redact(text).text;
}

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

function takeTail(text: string, maxLines: number, maxBytes: number): string {
  const lines = text.split(/\r?\n/);
  const tail = lines.slice(-Math.max(1, maxLines)).join("\n");
  if (Buffer.byteLength(tail) <= maxBytes) return tail;
  return Buffer.from(tail).subarray(-maxBytes).toString("utf8");
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80) || "unknown";
}
