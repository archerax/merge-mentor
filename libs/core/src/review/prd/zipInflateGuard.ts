/**
 * Zip-bomb guard on the actual data of a `.docx`, not just its declarations.
 *
 * `validateDocxBuffer` caps the uncompressed sizes the central directory
 * *declares*. Those numbers are attacker-controlled: an entry can declare a
 * few bytes while its deflate stream expands to gigabytes, and the zip
 * readers used by the parser (JSZip, inside mammoth too) only compare the
 * real size with the declared one after inflating everything into memory.
 * This guard inflates each deflated entry with a hard output cap equal to its
 * declared size, so a lying entry is rejected after at most that many bytes.
 *
 * Server-only (uses `node:zlib`); kept out of `docxValidator.ts`, which the
 * web client imports for the size limit.
 */
import { inflateRawSync } from "node:zlib";

import { ValidationError } from "@merge-mentor/shared/errors/index.js";

import { readCentralDirectory } from "./docxValidator.js";

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_LENGTH = 30;
const METHOD_DEFLATE = 8;
const FIELD = "docx";

/**
 * Checks that no deflated entry of the archive expands beyond its declared
 * uncompressed size. Call after `validateDocxBuffer` (which caps the declared
 * total) and before handing the buffer to a zip reader.
 *
 * @throws {ValidationError} when an entry expands beyond its declared size or
 *   its data is corrupt
 */
export function assertZipEntriesWithinDeclaredSizes(buffer: Uint8Array, maxEntries?: number): void {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (const entry of readCentralDirectory(buffer, maxEntries)) {
    if (entry.method !== METHOD_DEFLATE) continue;
    const header = entry.localHeaderOffset;
    if (
      header + LOCAL_HEADER_LENGTH > view.byteLength ||
      view.getUint32(header, true) !== LOCAL_HEADER_SIGNATURE
    ) {
      throw new ValidationError(FIELD, "file is not a valid zip archive (corrupt entry header)");
    }
    const start =
      header +
      LOCAL_HEADER_LENGTH +
      view.getUint16(header + 26, true) +
      view.getUint16(header + 28, true);
    const end = start + entry.compressedSize;
    if (end > view.byteLength) {
      throw new ValidationError(FIELD, "file is not a valid zip archive (truncated entry)");
    }
    let inflatedLength: number;
    try {
      inflatedLength = inflateRawSync(buffer.subarray(start, end), {
        maxOutputLength: Math.max(1, entry.uncompressedSize),
      }).length;
    } catch (error) {
      if ((error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE") {
        throw new ValidationError(
          FIELD,
          "file expands to more data than it declares (possible zip bomb)",
          { cause: error }
        );
      }
      throw new ValidationError(FIELD, "file is not a valid zip archive (corrupt entry data)", {
        cause: error,
      });
    }
    if (inflatedLength > entry.uncompressedSize) {
      throw new ValidationError(
        FIELD,
        "file expands to more data than it declares (possible zip bomb)"
      );
    }
  }
}
