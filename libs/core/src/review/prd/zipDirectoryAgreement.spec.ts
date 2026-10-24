/**
 * Our validator and inflate guard must inspect exactly the zip entries that
 * JSZip (used by the parser and by mammoth) will later read. These specs build
 * archives that try to make the two disagree and check against the real JSZip.
 */
import { ValidationError } from "@merge-mentor/shared/errors/index.js";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { buildDocx, para } from "./docxFixture.test-helper.js";
import { readCentralDirectory, validateDocxBuffer } from "./docxValidator.js";
import { assertZipEntriesWithinDeclaredSizes } from "./zipInflateGuard.js";

const EOCD_SIG = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const CEN_SIG = 0x02014b50;

async function zipOf(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files))
    zip.file(name, content, { createFolders: false });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Entry names the real JSZip reads, or "rejected". */
async function jszipView(buffer: Buffer): Promise<string[] | "rejected"> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    return Object.keys(zip.files)
      .filter((name) => !name.endsWith("/"))
      .toSorted();
  } catch {
    return "rejected";
  }
}

/** Entry names our central-directory reader sees, or "rejected". */
function ourView(buffer: Buffer): string[] | "rejected" {
  try {
    return readCentralDirectory(buffer)
      .map((entry) => entry.name)
      .filter((name) => !name.endsWith("/"))
      .toSorted();
  } catch (error) {
    if (error instanceof ValidationError) return "rejected";
    throw error;
  }
}

interface Record46 {
  readonly name: string;
  readonly localOffset: number;
  readonly compressedSize?: number;
  readonly uncompressedSize?: number;
}

/** A hand-built central directory file header (stored, no extra/comment). */
function centralRecord(r: Record46): Buffer {
  const name = Buffer.from(r.name);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CEN_SIG, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt32LE(r.compressedSize ?? 0, 20);
  header.writeUInt32LE(r.uncompressedSize ?? 0, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(r.localOffset, 42);
  return Buffer.concat([header, name]);
}

function eocdRecord(count: number, cdSize: number, cdOffset: number, commentLength = 0): Buffer {
  const eocd = Buffer.alloc(22);
  EOCD_SIG.copy(eocd, 0);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(commentLength, 20);
  return eocd;
}

function eocdOffset(buffer: Buffer): number {
  return buffer.lastIndexOf(EOCD_SIG);
}

/** True when the archive is rejected, or both readers see the same entries. */
async function agrees(buffer: Buffer): Promise<boolean> {
  const ours = ourView(buffer);
  if (ours === "rejected") return true;
  return JSON.stringify(ours) === JSON.stringify(await jszipView(buffer));
}

async function realDocx(): Promise<Buffer> {
  return buildDocx({ body: para("Hello") });
}

describe("zip directory agreement with JSZip", () => {
  it("accepts ordinary Word files and sees the same entries as JSZip", async () => {
    const buffer = await realDocx();
    expect(() => validateDocxBuffer(buffer)).not.toThrow();
    expect(ourView(buffer)).toEqual(await jszipView(buffer));
  });

  it("JSZip takes the LAST end-of-central-directory signature in the buffer", async () => {
    // A forged EOCD (with its own tiny central directory, listing a subset of
    // the real entries) inside the real EOCD's comment: JSZip reads the forged
    // one, and so did our scan. It must now be refused as ambiguous.
    const real = await realDocx();
    const realEocd = eocdOffset(real);
    const commentStart = realEocd + 22;
    const decoy = centralRecord({ name: "[Content_Types].xml", localOffset: 0 });
    const forged = eocdRecord(1, decoy.length, commentStart);
    const comment = Buffer.concat([decoy, forged]);
    const buffer = Buffer.concat([real, comment]);
    buffer.writeUInt16LE(comment.length, realEocd + 20);

    expect(await jszipView(buffer)).toEqual(["[Content_Types].xml"]);
    expect(await jszipView(real)).not.toEqual(["[Content_Types].xml"]);
    expect(ourView(buffer)).toBe("rejected");
  });

  it("rejects a forged EOCD whose own comment reaches the end of the file", async () => {
    const real = await realDocx();
    const realEocd = eocdOffset(real);
    const commentStart = realEocd + 22;
    const decoy = centralRecord({ name: "word/decoy.xml", localOffset: 0 });
    const forged = eocdRecord(1, decoy.length, commentStart, 3);
    const comment = Buffer.concat([decoy, forged, Buffer.from("abc")]);
    const buffer = Buffer.concat([real, comment]);
    buffer.writeUInt16LE(comment.length, realEocd + 20);
    expect(ourView(buffer)).toBe("rejected");
  });

  it("rejects an EOCD signature in the last 21 bytes, which JSZip would pick", async () => {
    const real = await realDocx();
    const realEocd = eocdOffset(real);
    const comment = Buffer.concat([Buffer.from("junk"), EOCD_SIG, Buffer.from("zz")]);
    const buffer = Buffer.concat([real, comment]);
    buffer.writeUInt16LE(comment.length, realEocd + 20);

    expect(await jszipView(buffer)).toBe("rejected");
    expect(ourView(buffer)).toBe("rejected");
  });

  it("rejects a comment length that does not reach the end of the file", async () => {
    const real = await realDocx();
    const buffer = Buffer.concat([real, Buffer.from("trailing")]);
    expect(await agrees(buffer)).toBe(true);
    expect(ourView(buffer)).toBe("rejected");
  });

  it("sees entries beyond the declared count, as JSZip reads the directory until it ends", async () => {
    const buffer = Buffer.from(
      await zipOf({
        "[Content_Types].xml": "<Types/>",
        "word/document.xml": "<w/>",
        "word/hidden.bin": "x".repeat(1000),
      })
    );
    const eocd = eocdOffset(buffer);
    buffer.writeUInt16LE(2, eocd + 8);
    buffer.writeUInt16LE(2, eocd + 10);

    expect(await jszipView(buffer)).toHaveLength(3);
    expect(await agrees(buffer)).toBe(true);
    expect(ourView(buffer)).toBe("rejected");
  });

  it("applies the same base offset as JSZip when the declared directory offset is wrong", async () => {
    // [locals][decoy record][real directory][EOCD]: the EOCD declares the
    // decoy's offset and the real directory's size. JSZip notices the gap and
    // shifts every offset by it, so it reads the REAL directory (and local
    // headers at declared offset + shift); reading at the declared offset would
    // show a different set of entries.
    const original = Buffer.from(
      await zipOf({
        "pad.txt": Array.from({ length: 400 }, (_, i) =>
          String.fromCharCode(33 + ((i * 37) % 90))
        ).join(""),
        "[Content_Types].xml": "<Types/>",
        "word/document.xml": "<w/>",
        "word/big.xml": "y".repeat(5000),
      })
    );
    const eocd = eocdOffset(original);
    const cdOffset = original.readUInt32LE(eocd + 16);
    const dir = Buffer.from(original.subarray(cdOffset, eocd));
    const decoy = centralRecord({ name: "word/decoy.xml", localOffset: 0 });
    const shift = decoy.length;
    // Skip the padding entry's record and declare local offsets `shift` lower.
    const recordLength = (at: number): number =>
      46 + dir.readUInt16LE(at + 28) + dir.readUInt16LE(at + 30) + dir.readUInt16LE(at + 32);
    const listed = Buffer.from(dir.subarray(recordLength(0)));
    let at = 0;
    while (at < listed.length) {
      const length =
        46 +
        listed.readUInt16LE(at + 28) +
        listed.readUInt16LE(at + 30) +
        listed.readUInt16LE(at + 32);
      listed.writeUInt32LE(listed.readUInt32LE(at + 42) - shift, at + 42);
      at += length;
    }
    const locals = original.subarray(0, cdOffset);
    const buffer = Buffer.concat([
      locals,
      decoy,
      listed,
      eocdRecord(3, listed.length, locals.length),
    ]);

    const jszip = await jszipView(buffer);
    expect(jszip).toEqual(["[Content_Types].xml", "word/big.xml", "word/document.xml"]);
    expect(ourView(buffer)).toEqual(jszip);
    expect(() => assertZipEntriesWithinDeclaredSizes(buffer)).not.toThrow();
  });
});
