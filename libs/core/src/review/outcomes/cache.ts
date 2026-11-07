import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { OUTCOMES_FILE_VERSION, type OutcomesFile, type ScannedPr } from "./types.js";

/** Path of the results file inside the temp path. */
export function outcomesFilePath(tempPath: string): string {
  return path.join(tempPath, "outcomes", "outcomes.json");
}

/** A results file with no scanned PRs. */
export function emptyOutcomesFile(platform: string, project: string, now: Date): OutcomesFile {
  return {
    version: OUTCOMES_FILE_VERSION,
    platform,
    project,
    generatedAt: now.toISOString(),
    prs: {},
  };
}

function isScannedPr(value: unknown): value is ScannedPr {
  if (typeof value !== "object" || value === null) return false;
  const pr = value as Record<string, unknown>;
  return (
    typeof pr.updatedAt === "string" &&
    (pr.state === "open" || pr.state === "closed") &&
    typeof pr.scannedAt === "string" &&
    Array.isArray(pr.comments)
  );
}

/**
 * Reads the results file. Anything unusable (missing, corrupt, another schema
 * version, or another repository) yields no file, so the caller rescans rather
 * than trusting it.
 *
 * @param filePath - Path from {@link outcomesFilePath}
 * @param platform - Platform of the repository being scanned
 * @param project - Repository identifier being scanned
 */
export async function readOutcomesFile(
  filePath: string,
  platform: string,
  project: string
): Promise<OutcomesFile | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const file = parsed as Partial<OutcomesFile>;
  if (
    file.version !== OUTCOMES_FILE_VERSION ||
    file.platform !== platform ||
    file.project !== project ||
    typeof file.generatedAt !== "string" ||
    typeof file.prs !== "object" ||
    file.prs === null
  ) {
    return undefined;
  }
  const prs = Object.fromEntries(Object.entries(file.prs).filter(([, pr]) => isScannedPr(pr)));
  return { ...(file as OutcomesFile), prs };
}

/**
 * Writes the results file atomically, so a reader never sees a partial file.
 *
 * @param filePath - Path from {@link outcomesFilePath}
 * @param file - The results to save
 */
export async function writeOutcomesFile(filePath: string, file: OutcomesFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempFile, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
    await fs.rename(tempFile, filePath);
  } catch (error) {
    await fs.rm(tempFile, { force: true });
    throw error;
  }
}
