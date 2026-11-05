/**
 * Naming of PRD / FRD runs, shared by the review and the work breakdown.
 */
import { randomBytes } from "node:crypto";
import path from "node:path";

/** The document to process: a file on disk, or bytes already in memory (an upload). */
export type PrdDocumentSource =
  | { readonly path: string }
  | { readonly buffer: Buffer; readonly fileName: string };

/** Display name of the document (the file's base name). */
export function sourceFileName(source: PrdDocumentSource): string {
  const name = path.basename("path" in source ? source.path : source.fileName);
  return name.length > 0 ? name : "document.docx";
}

/** `20261023-142530-checkout-prd-a1b2c3`: sortable, readable and unique. */
export function createRunId(date: Date, fileName: string): string {
  const stamp = date
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace(/[-:]/g, "")
    .replace("T", "-");
  const slug =
    fileName
      .replace(/\.docx$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "document";
  return `${stamp}-${slug}-${randomBytes(3).toString("hex")}`;
}
