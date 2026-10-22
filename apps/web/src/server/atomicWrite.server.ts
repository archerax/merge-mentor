import { randomUUID } from "node:crypto";
import fs from "node:fs";

/**
 * Writes a file atomically (unique temp file + rename) so readers never see
 * partial content and concurrent writers never share a temp file.
 */
export function writeFileAtomic(filePath: string, content: string): void {
  const tempFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempFile, content, "utf8");
    fs.renameSync(tempFile, filePath);
  } catch (error) {
    fs.rmSync(tempFile, { force: true });
    throw error;
  }
}
