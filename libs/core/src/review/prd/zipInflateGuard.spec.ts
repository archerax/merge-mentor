import { ValidationError } from "@merge-mentor/shared/errors/index.js";
import { describe, expect, it } from "vitest";

import { buildDocx, para } from "./docxFixture.test-helper.js";
import { parseDocx } from "./docxParser.js";
import { readCentralDirectory, validateDocxBuffer } from "./docxValidator.js";
import { assertZipEntriesWithinDeclaredSizes } from "./zipInflateGuard.js";

/** Rewrites the declared uncompressed size of `name` in the central directory. */
function lieAboutSize(buffer: Buffer, name: string, declared: number): Buffer {
  const copy = Buffer.from(buffer);
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = copy.indexOf(signature);
  while (offset !== -1) {
    const nameLength = copy.readUInt16LE(offset + 28);
    const entryName = copy.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (entryName === name) {
      copy.writeUInt32LE(declared, offset + 24);
      return copy;
    }
    offset = copy.indexOf(signature, offset + 46);
  }
  throw new Error(`entry ${name} not found`);
}

/** Appends `copies` extra central-directory records for `name` (same local data). */
function duplicateCentralRecord(buffer: Buffer, name: string, copies: number): Buffer {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  const directory = buffer.subarray(directoryOffset, eocd);
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = directory.indexOf(signature);
  while (offset !== -1) {
    const nameLength = directory.readUInt16LE(offset + 28);
    const total =
      46 + nameLength + directory.readUInt16LE(offset + 30) + directory.readUInt16LE(offset + 32);
    if (directory.subarray(offset + 46, offset + 46 + nameLength).toString("utf8") === name) {
      const record = directory.subarray(offset, offset + total);
      const extra = Buffer.concat(Array.from({ length: copies }, () => record));
      const tail = Buffer.from(buffer.subarray(eocd));
      const count = tail.readUInt16LE(10) + copies;
      tail.writeUInt16LE(count, 8);
      tail.writeUInt16LE(count, 10);
      tail.writeUInt32LE(directory.length + extra.length, 12);
      return Buffer.concat([buffer.subarray(0, eocd), extra, tail]);
    }
    offset = directory.indexOf(signature, offset + 46);
  }
  throw new Error(`entry ${name} not found`);
}

describe("assertZipEntriesWithinDeclaredSizes", () => {
  it("rejects many central records that point at the same local data", async () => {
    const honest = Buffer.from(await buildDocx({ body: para("x".repeat(100_000)) }));
    const repeated = duplicateCentralRecord(honest, "word/document.xml", 2_000);
    expect(readCentralDirectory(repeated).length).toBeGreaterThan(2_000);
    expect(() => assertZipEntriesWithinDeclaredSizes(repeated)).toThrow(ValidationError);
    expect(() => assertZipEntriesWithinDeclaredSizes(repeated)).toThrow(/share the same data/);
  });

  it("rejects entries whose data ranges overlap", async () => {
    const honest = Buffer.from(await buildDocx({ body: para("Hello") }));
    const entries = readCentralDirectory(honest).filter((e) => e.method === 8);
    const [first, second] = entries;
    if (!first || !second) throw new Error("need two deflated entries");
    // Point the second entry's central record at the first entry's local header.
    const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    let offset = honest.indexOf(signature);
    while (offset !== -1) {
      const nameLength = honest.readUInt16LE(offset + 28);
      if (honest.subarray(offset + 46, offset + 46 + nameLength).toString("utf8") === second.name) {
        honest.writeUInt32LE(first.localHeaderOffset, offset + 42);
        break;
      }
      offset = honest.indexOf(signature, offset + 46);
    }
    expect(() => assertZipEntriesWithinDeclaredSizes(honest)).toThrow(/share the same data/);
  });

  it("accepts an honest .docx", async () => {
    const buffer = await buildDocx({ body: para("Hello") });
    expect(() => assertZipEntriesWithinDeclaredSizes(buffer)).not.toThrow();
  });

  it("rejects an entry that inflates beyond its declared size", async () => {
    const honest = await buildDocx({ body: para("x".repeat(200_000)) });
    const lying = lieAboutSize(honest, "word/document.xml", 100);

    // The declaration-only check is fooled...
    expect(() => validateDocxBuffer(lying, { maxUncompressedBytes: 10_000 })).not.toThrow();
    // ...the inflate check is not.
    expect(() => assertZipEntriesWithinDeclaredSizes(lying)).toThrow(ValidationError);
    expect(() => assertZipEntriesWithinDeclaredSizes(lying)).toThrow(/possible zip bomb/);
  });

  it("rejects corrupt entry data", async () => {
    const honest = Buffer.from(await buildDocx({ body: para("Hello world") }));
    const entry = readCentralDirectory(honest).find((e) => e.name === "word/document.xml");
    if (!entry) throw new Error("missing entry");
    const start =
      entry.localHeaderOffset +
      30 +
      honest.readUInt16LE(entry.localHeaderOffset + 26) +
      honest.readUInt16LE(entry.localHeaderOffset + 28);
    honest.fill(0xff, start, start + Math.min(8, entry.compressedSize));
    expect(() => assertZipEntriesWithinDeclaredSizes(honest)).toThrow(/corrupt entry data/);
  });

  it("rejects a bad local header offset", async () => {
    const honest = Buffer.from(await buildDocx({ body: para("Hello") }));
    const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const central = honest.indexOf(signature);
    // Point the first deflated entry's local header past the end of the file.
    let offset = central;
    while (offset !== -1 && honest.readUInt16LE(offset + 10) !== 8) {
      offset = honest.indexOf(signature, offset + 46);
    }
    honest.writeUInt32LE(honest.length - 4, offset + 42);
    expect(() => assertZipEntriesWithinDeclaredSizes(honest)).toThrow(/corrupt entry header/);
  });

  it("is applied by parseDocx before any zip reader runs", async () => {
    const honest = await buildDocx({ body: para("x".repeat(200_000)) });
    const lying = lieAboutSize(honest, "word/document.xml", 100);
    await expect(parseDocx(lying)).rejects.toThrow(/possible zip bomb/);
  });
});
