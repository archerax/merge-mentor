import { ValidationError } from "@merge-mentor/shared/errors/index.js";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { buildDocx, para } from "./docxFixture.test-helper.js";
import { assertDocxSize, MAX_DOCX_BYTES, validateDocxBuffer } from "./docxValidator.js";

async function zipOf(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function eocdOffset(buffer: Buffer): number {
  return buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
}

describe("validateDocxBuffer", () => {
  it("accepts a valid .docx", async () => {
    const buffer = await buildDocx({ body: para("Hello") });
    expect(() => validateDocxBuffer(buffer)).not.toThrow();
  });

  it("rejects an empty file", () => {
    expect(() => validateDocxBuffer(Buffer.alloc(0))).toThrow(/file is empty/);
  });

  it("rejects files over the size cap", async () => {
    const buffer = await buildDocx({ body: para("Hello") });
    expect(() => validateDocxBuffer(buffer, { maxBytes: 100 })).toThrow(ValidationError);
    expect(() => validateDocxBuffer(buffer, { maxBytes: 100 })).toThrow(
      /exceeds the 0\.0 MB limit/
    );
  });

  it("rejects a legacy .doc / encrypted OLE file with a specific message", () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    expect(() => validateDocxBuffer(ole)).toThrow(/legacy \.doc or a password-protected/);
  });

  it("rejects non-zip content even with a .docx-like payload", () => {
    expect(() => validateDocxBuffer(Buffer.from("<w:document/>"))).toThrow(/missing zip signature/);
  });

  it("rejects a truncated zip", async () => {
    const buffer = await buildDocx({ body: para("Hello") });
    expect(() => validateDocxBuffer(buffer.subarray(0, 40))).toThrow(/truncated or corrupt/);
  });

  it("rejects a corrupt central directory", async () => {
    const buffer = Buffer.from(await buildDocx({ body: para("Hello") }));
    buffer.writeUInt32LE(4, eocdOffset(buffer) + 16);
    expect(() => validateDocxBuffer(buffer)).toThrow(/corrupt central directory/);
  });

  it("rejects zip64 archives", async () => {
    const buffer = Buffer.from(await buildDocx({ body: para("Hello") }));
    buffer.writeUInt16LE(0xffff, eocdOffset(buffer) + 10);
    expect(() => validateDocxBuffer(buffer)).toThrow(/zip64/);
  });

  it("rejects archives with too many entries", async () => {
    const buffer = await buildDocx({ body: para("Hello") });
    expect(() => validateDocxBuffer(buffer, { maxEntries: 2 })).toThrow(/entries \(limit 2\)/);
  });

  it("rejects archives that expand beyond the uncompressed cap (zip bomb guard)", async () => {
    const buffer = await buildDocx({ body: para("x".repeat(50_000)) });
    expect(buffer.length).toBeLessThan(10_000);
    expect(() => validateDocxBuffer(buffer, { maxUncompressedBytes: 20_000 })).toThrow(
      /expands to/
    );
  });

  it("rejects a zip that is not an Office document", async () => {
    const buffer = await zipOf({ "readme.txt": "hi" });
    expect(() => validateDocxBuffer(buffer)).toThrow(/not an Office document/);
  });

  it("names Excel and PowerPoint files", async () => {
    const xlsx = await zipOf({ "[Content_Types].xml": "<Types/>", "xl/workbook.xml": "<x/>" });
    const pptx = await zipOf({ "[Content_Types].xml": "<Types/>", "ppt/presentation.xml": "<p/>" });
    const other = await zipOf({ "[Content_Types].xml": "<Types/>", "other/a.xml": "<a/>" });
    expect(() => validateDocxBuffer(xlsx)).toThrow(/Excel workbook/);
    expect(() => validateDocxBuffer(pptx)).toThrow(/PowerPoint presentation/);
    expect(() => validateDocxBuffer(other)).toThrow(/not a Word document$/);
  });

  it("accepts a Uint8Array view at a non-zero offset", async () => {
    const docx = await buildDocx({ body: para("Hello") });
    const padded = new Uint8Array(docx.length + 8);
    padded.set(docx, 8);
    expect(() => validateDocxBuffer(padded.subarray(8))).not.toThrow();
  });
});

describe("assertDocxSize", () => {
  it("allows sizes up to the 20 MB cap", () => {
    expect(MAX_DOCX_BYTES).toBe(20 * 1024 * 1024);
    expect(() => assertDocxSize(MAX_DOCX_BYTES)).not.toThrow();
  });

  it("throws a ValidationError above the cap", () => {
    expect(() => assertDocxSize(MAX_DOCX_BYTES + 1)).toThrow(
      "Validation failed for docx: file is 20.0 MB, which exceeds the 20.0 MB limit"
    );
  });
});
