/**
 * Validation of untrusted `.docx` input, shared by the CLI and the web server.
 *
 * Checks, without decompressing anything:
 * - the size cap (20 MB by default),
 * - the zip magic bytes (`PK\x03\x04`), with a specific message for legacy
 *   `.doc` / password-protected files (OLE compound files),
 * - the zip central directory: entry count, total uncompressed size (zip-bomb
 *   guard) and the presence of a Word document part.
 */
import { ValidationError } from "@merge-mentor/shared/errors/index.js";

/** Maximum accepted `.docx` size in bytes (20 MB). */
export const MAX_DOCX_BYTES = 20 * 1024 * 1024;

/** Default cap on the total uncompressed size of all zip entries. */
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

/** Default cap on the number of zip entries. */
const DEFAULT_MAX_ENTRIES = 10_000;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_MIN_LENGTH = 22;
const MAX_ZIP_COMMENT_LENGTH = 0xffff;

const FIELD = "docx";

export interface DocxValidationOptions {
  /** Size cap in bytes (default {@link MAX_DOCX_BYTES}). */
  readonly maxBytes?: number;
  /** Cap on total uncompressed size (default 200 MB). */
  readonly maxUncompressedBytes?: number;
  /** Cap on number of zip entries (default 10,000). */
  readonly maxEntries?: number;
}

/**
 * Throws a {@link ValidationError} if `sizeBytes` exceeds the cap. Use before
 * reading a file or accepting an upload body.
 */
export function assertDocxSize(sizeBytes: number, maxBytes: number = MAX_DOCX_BYTES): void {
  if (sizeBytes > maxBytes) {
    throw new ValidationError(
      FIELD,
      `file is ${formatMb(sizeBytes)}, which is over the ${formatMb(maxBytes)} limit`
    );
  }
}

/**
 * Validates that `buffer` looks like a well-formed, reasonably sized `.docx`.
 *
 * @throws {ValidationError} when the input is too large, is not a zip, is a
 *   legacy/encrypted Word file, is another OpenXML format, or fails the
 *   zip-bomb guard.
 */
export function validateDocxBuffer(buffer: Uint8Array, options: DocxValidationOptions = {}): void {
  const {
    maxBytes = MAX_DOCX_BYTES,
    maxUncompressedBytes = DEFAULT_MAX_UNCOMPRESSED_BYTES,
    maxEntries = DEFAULT_MAX_ENTRIES,
  } = options;

  if (buffer.length === 0) {
    throw new ValidationError(FIELD, "file is empty");
  }
  assertDocxSize(buffer.length, maxBytes);

  if (startsWith(buffer, OLE_MAGIC)) {
    throw new ValidationError(
      FIELD,
      "file is a legacy .doc or a password-protected document; save it as an unprotected .docx and try again"
    );
  }
  if (!startsWith(buffer, ZIP_MAGIC)) {
    throw new ValidationError(FIELD, "file is not a .docx (missing zip signature)");
  }

  const entries = readCentralDirectory(buffer, maxEntries);
  let totalUncompressed = 0;
  for (const entry of entries) {
    totalUncompressed += entry.uncompressedSize;
  }
  if (totalUncompressed > maxUncompressedBytes) {
    throw new ValidationError(
      FIELD,
      `file expands to ${formatMb(totalUncompressed)}, which is over the ${formatMb(maxUncompressedBytes)} limit`
    );
  }

  const names = new Set(entries.map((entry) => entry.name));
  if (!names.has("[Content_Types].xml")) {
    throw new ValidationError(FIELD, "file is a zip archive but not an Office document");
  }
  const hasWordPart = entries.some((entry) => entry.name.startsWith("word/"));
  if (!hasWordPart) {
    const other = entries.some((entry) => entry.name.startsWith("xl/"))
      ? " (it looks like an Excel workbook)"
      : entries.some((entry) => entry.name.startsWith("ppt/"))
        ? " (it looks like a PowerPoint presentation)"
        : "";
    throw new ValidationError(FIELD, `file is not a Word document${other}`);
  }
}

interface ZipEntry {
  readonly name: string;
  readonly uncompressedSize: number;
}

function readCentralDirectory(buffer: Uint8Array, maxEntries: number): ZipEntry[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) {
    throw new ValidationError(FIELD, "file is not a valid zip archive (truncated or corrupt)");
  }

  const entryCount = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) {
    throw new ValidationError(FIELD, "zip64 archives are not supported");
  }
  if (entryCount > maxEntries) {
    throw new ValidationError(FIELD, `archive has ${entryCount} entries (limit ${maxEntries})`);
  }

  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  for (let i = 0; i < entryCount; i++) {
    if (
      offset + 46 > view.byteLength ||
      view.getUint32(offset, true) !== CENTRAL_HEADER_SIGNATURE
    ) {
      throw new ValidationError(
        FIELD,
        "file is not a valid zip archive (corrupt central directory)"
      );
    }
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    if (nameStart + nameLength > view.byteLength) {
      throw new ValidationError(
        FIELD,
        "file is not a valid zip archive (corrupt central directory)"
      );
    }
    if (uncompressedSize === 0xffffffff) {
      throw new ValidationError(FIELD, "zip64 archives are not supported");
    }
    const name = Buffer.from(buffer.subarray(nameStart, nameStart + nameLength)).toString("utf8");
    entries.push({ name, uncompressedSize });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(view: DataView): number {
  const last = view.byteLength - EOCD_MIN_LENGTH;
  const first = Math.max(0, last - MAX_ZIP_COMMENT_LENGTH);
  for (let offset = last; offset >= first; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function startsWith(buffer: Uint8Array, magic: readonly number[]): boolean {
  return buffer.length >= magic.length && magic.every((byte, i) => buffer[i] === byte);
}

/**
 * Formats a byte count in megabytes for size messages: whole numbers as is
 * ("20 MB"), others with two decimals ("20.01 MB"), so a file just over a
 * limit does not read as the same size as the limit.
 */
export function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(2)} MB`;
}
