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

/** One entry of a zip central directory, as declared by the archive. */
export interface ZipEntry {
  readonly name: string;
  /** Declared uncompressed size; untrusted until the data is inflated. */
  readonly uncompressedSize: number;
  readonly compressedSize: number;
  /** Compression method (0 stored, 8 deflate). */
  readonly method: number;
  /** Offset of the entry's local file header. */
  readonly localHeaderOffset: number;
}

/**
 * Reads the central directory of a zip archive without decompressing anything.
 *
 * The invariant that matters for security: this must list exactly the entries
 * JSZip (used by the parser and by mammoth) will read, otherwise the size
 * checks here and in the inflate guard inspect a different archive than the
 * one that is later inflated. It therefore mirrors JSZip's reader:
 * - the end-of-central-directory (EOCD) record is the LAST EOCD signature in
 *   the buffer (`lastIndexOfSignature`), not the first plausible one;
 * - when the EOCD is not exactly where the declared directory offset + size
 *   say, JSZip shifts every offset (central directory and local headers) by
 *   the gap, and so do we;
 * - JSZip reads central records until the signature stops matching, ignoring
 *   the declared entry count, so we refuse archives with extra records.
 * Anything JSZip could interpret differently is rejected: an EOCD whose comment
 * does not reach the end of the file, a second EOCD that could also be taken
 * as the real one (forged EOCD inside the comment), and zip64 markers.
 *
 * @throws {ValidationError} when the archive is corrupt, ambiguous, zip64, or
 *   has more than `maxEntries` entries
 */
export function readCentralDirectory(
  buffer: Uint8Array,
  maxEntries: number = DEFAULT_MAX_ENTRIES
): ZipEntry[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const eocd = findEndOfCentralDirectory(view);

  const entryCount = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const declaredOffset = view.getUint32(eocd + 16, true);
  if (
    view.getUint16(eocd + 4, true) === 0xffff ||
    view.getUint16(eocd + 6, true) === 0xffff ||
    view.getUint16(eocd + 8, true) === 0xffff ||
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    declaredOffset === 0xffffffff
  ) {
    throw new ValidationError(FIELD, "zip64 archives are not supported");
  }
  if (entryCount > maxEntries) {
    throw new ValidationError(FIELD, `archive has ${entryCount} entries (limit ${maxEntries})`);
  }

  // JSZip's "zero": the gap between where the directory should end and the EOCD.
  const gap = eocd - (declaredOffset + directorySize);
  if (gap < 0) {
    throw new ValidationError(FIELD, "file is not a valid zip archive (corrupt central directory)");
  }
  const directoryOffset = declaredOffset + gap;

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
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
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
    if (
      uncompressedSize === 0xffffffff ||
      compressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new ValidationError(FIELD, "zip64 archives are not supported");
    }
    const name = Buffer.from(buffer.subarray(nameStart, nameStart + nameLength)).toString("utf8");
    entries.push({
      name,
      uncompressedSize,
      compressedSize,
      method,
      localHeaderOffset: localHeaderOffset + gap,
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  if (offset + 4 <= view.byteLength && view.getUint32(offset, true) === CENTRAL_HEADER_SIGNATURE) {
    throw new ValidationError(
      FIELD,
      "file is not a valid zip archive (central directory has more entries than declared)"
    );
  }
  return entries;
}

/**
 * Finds the EOCD the way JSZip does (the last signature in the buffer) and
 * rejects archives where another reading would be possible.
 */
function findEndOfCentralDirectory(view: DataView): number {
  let eocd = -1;
  for (let offset = view.byteLength - 4; offset >= 0; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0 || eocd + EOCD_MIN_LENGTH > view.byteLength) {
    throw new ValidationError(FIELD, "file is not a valid zip archive (truncated or corrupt)");
  }
  if (eocd + EOCD_MIN_LENGTH + view.getUint16(eocd + 20, true) !== view.byteLength) {
    throw new ValidationError(
      FIELD,
      "file is not a valid zip archive (unexpected data after the central directory)"
    );
  }
  // Another record whose comment also reaches the end of the file could be
  // taken as the real EOCD by a different reader (e.g. a forged one hidden in
  // the comment of the real one).
  const earliest = Math.max(0, view.byteLength - EOCD_MIN_LENGTH - MAX_ZIP_COMMENT_LENGTH);
  for (let offset = eocd - 1; offset >= earliest; offset--) {
    if (
      view.getUint32(offset, true) === EOCD_SIGNATURE &&
      offset + EOCD_MIN_LENGTH <= view.byteLength &&
      offset + EOCD_MIN_LENGTH + view.getUint16(offset + 20, true) === view.byteLength
    ) {
      throw new ValidationError(FIELD, "file is not a valid zip archive (ambiguous end record)");
    }
  }
  return eocd;
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
