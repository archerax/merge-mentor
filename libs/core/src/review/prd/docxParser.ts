/**
 * Parses a `.docx` requirements document into the structured {@link DocxDocument}
 * model used by the PRD / FRD review.
 *
 * Mammoth does the heavy lifting (styles, numbering, tables, tracked changes,
 * comment bodies, images): its internal document tree is captured through the
 * `transformDocument` hook. Mammoth already yields the accepted view of tracked
 * changes (`w:ins` kept, `w:del` dropped). Two things are read from the OpenXML
 * directly because mammoth does not expose them: the commented range text of
 * each comment, and the zip part path of each image.
 */
import { createHash } from "node:crypto";

import { DocumentParseError, ValidationError } from "@merge-mentor/shared/errors/index.js";
import { type FileSystem, nodeFs } from "@merge-mentor/shared/ports/index.js";
import JSZip from "jszip";
import mammoth from "mammoth";

import { assertDocxSize, type DocxValidationOptions, validateDocxBuffer } from "./docxValidator.js";
import { extractCommentAnchors, findMainDocumentPath } from "./openXml.js";
import type {
  DocxBlock,
  DocxComment,
  DocxDocument,
  DocxImage,
  DocxParagraph,
  DocxSection,
  DocxTable,
  DocxTableCell,
  DocxTableRow,
} from "./types.js";
import { assertZipEntriesWithinDeclaredSizes } from "./zipInflateGuard.js";

/** Filesystem capabilities needed to load a `.docx` (satisfied by `nodeFs`). */
export type DocxFileSystem = Pick<FileSystem, "stat" | "readFileBuffer">;

export interface ParseDocxOptions {
  readonly validation?: DocxValidationOptions;
}

/**
 * Reads, validates and parses a `.docx` file. The size cap is checked with
 * `stat` before the file is read.
 *
 * @throws {ValidationError} if the file is too large or not a valid `.docx`
 * @throws {DocumentParseError} if the file cannot be read or parsed
 */
export async function parseDocxFile(
  path: string,
  fileSystem: DocxFileSystem = nodeFs,
  options: ParseDocxOptions = {}
): Promise<DocxDocument> {
  return parseDocx(await readDocxFile(path, fileSystem, options), options);
}

/**
 * Reads a `.docx` file's bytes, checking the size cap with `stat` first. The
 * content is not validated; {@link parseDocx} does that.
 *
 * @throws {ValidationError} if the file is too large
 * @throws {DocumentParseError} if the file cannot be read
 */
export async function readDocxFile(
  path: string,
  fileSystem: DocxFileSystem = nodeFs,
  options: ParseDocxOptions = {}
): Promise<Buffer> {
  try {
    const stats = await fileSystem.stat(path);
    assertDocxSize(stats.size, options.validation?.maxBytes);
    return await fileSystem.readFileBuffer(path);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new DocumentParseError("docx", `could not read ${path}`, { cause: error });
  }
}

/**
 * Validates and parses an in-memory `.docx`.
 *
 * @throws {ValidationError} if the buffer fails {@link validateDocxBuffer}
 * @throws {DocumentParseError} if the document cannot be parsed
 */
export async function parseDocx(
  buffer: Buffer,
  options: ParseDocxOptions = {}
): Promise<DocxDocument> {
  validateDocxBuffer(buffer, options.validation);
  // The declared sizes checked above are untrusted; make sure no entry
  // inflates past them before any zip reader decompresses it into memory.
  assertZipEntriesWithinDeclaredSizes(buffer, options.validation?.maxEntries);

  let root: unknown;
  let messages: readonly MammothMessage[];
  let zip: JSZip;
  try {
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        externalFileAccess: false,
        // The HTML output is discarded; avoid base64-encoding every image.
        convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })),
        transformDocument: (element: unknown) => {
          root = element;
          return element;
        },
      }
    );
    messages = result.messages;
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    throw new DocumentParseError("docx", "the file is not a readable Word document", {
      cause: error,
    });
  }
  if (!isElement(root) || root.type !== "document") {
    throw new DocumentParseError("docx", "no document body found");
  }

  const builder = new DocumentBuilder();
  builder.build(root);

  const anchors = await readCommentAnchors(zip);
  const comments = buildComments(root, builder, anchors);
  const images = await buildImages(builder, zip);

  return {
    ...(builder.title !== undefined ? { title: builder.title } : {}),
    sections: builder.finishSections(),
    comments,
    images: images.images,
    hasHeadings: builder.hasHeadings,
    warnings: [...collectWarnings(messages), ...images.warnings],
  };
}

// ---------------------------------------------------------------------------
// Mammoth document tree (narrowed from `transformDocument`'s untyped element)
// ---------------------------------------------------------------------------

interface MammothElement {
  readonly type: string;
  readonly children?: readonly unknown[];
  readonly [key: string]: unknown;
}

interface MammothMessage {
  readonly type: string;
  readonly message: string;
}

interface MammothImage {
  readonly altText?: string;
  readonly contentType?: string;
  readonly readAsBuffer?: () => Promise<Buffer>;
}

function isElement(value: unknown): value is MammothElement {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function childrenOf(element: MammothElement): MammothElement[] {
  return (element.children ?? []).filter(isElement);
}

function stringProp(element: MammothElement, key: string): string | undefined {
  const value = element[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberProp(element: MammothElement, key: string, fallback: number): number {
  const value = element[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const HEADING_STYLE_NAME = /^heading\s*([1-9])$/i;
const HEADING_STYLE_ID = /^heading([1-9])$/i;
const TITLE_STYLE = /^title$/i;

function headingLevel(paragraph: MammothElement): number | undefined {
  const name = stringProp(paragraph, "styleName");
  const id = stringProp(paragraph, "styleId");
  const match = (name && HEADING_STYLE_NAME.exec(name)) || (id && HEADING_STYLE_ID.exec(id));
  return match ? Number(match[1]) : undefined;
}

function isTitle(paragraph: MammothElement): boolean {
  const name = stringProp(paragraph, "styleName");
  const id = stringProp(paragraph, "styleId");
  return (
    (name !== undefined && TITLE_STYLE.test(name)) || (id !== undefined && TITLE_STYLE.test(id))
  );
}

/** Text and inline references collected from one paragraph. */
interface InlineContent {
  text: string;
  commentIds: string[];
  images: MammothImage[];
}

function collectInline(element: MammothElement, into: InlineContent): void {
  switch (element.type) {
    case "text":
      into.text += stringProp(element, "value") ?? "";
      return;
    case "tab":
      into.text += "\t";
      return;
    case "break":
      if (element["breakType"] === "line") into.text += "\n";
      return;
    case "checkbox":
      into.text += element["checked"] === true ? "[x] " : "[ ] ";
      return;
    case "commentReference": {
      const id = stringProp(element, "commentId");
      if (id !== undefined && !into.commentIds.includes(id)) into.commentIds.push(id);
      return;
    }
    case "image":
      into.images.push(element as MammothImage);
      return;
    default:
      for (const child of childrenOf(element)) collectInline(child, into);
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

interface MutableSection {
  id: string;
  title: string;
  level: number;
  headingPath: string[];
  parentId: string | null;
  childIds: string[];
  headingParagraphId: string | null;
  blocks: DocxBlock[];
  childCounter: number;
}

interface PendingImage {
  readonly image: MammothImage;
  readonly paragraphId: string;
  readonly sectionId: string;
}

class DocumentBuilder {
  title: string | undefined;
  hasHeadings = false;
  readonly paragraphs: DocxParagraph[] = [];
  readonly paragraphSection = new Map<string, string>();
  readonly pendingImages: PendingImage[] = [];

  private readonly sections: MutableSection[] = [];
  private readonly stack: MutableSection[] = [];
  private preamble: MutableSection | undefined;
  private topLevelCounter = 0;
  private paragraphCounter = 0;
  private tableCounter = 0;
  private imageCounter = 0;

  build(document: MammothElement): void {
    for (const element of childrenOf(document)) {
      if (element.type === "paragraph") {
        const level = headingLevel(element);
        if (level !== undefined && this.openHeading(element, level)) continue;
        const paragraph = this.paragraph(element, this.currentSection());
        if (paragraph) this.currentSection().blocks.push({ kind: "paragraph", paragraph });
      } else if (element.type === "table") {
        const section = this.currentSection();
        section.blocks.push({ kind: "table", table: this.table(element, section) });
      }
    }
  }

  finishSections(): DocxSection[] {
    if (this.sections.length === 0) this.currentSection();
    return this.sections.map(({ childCounter: _childCounter, ...section }) => section);
  }

  private openHeading(element: MammothElement, level: number): boolean {
    const content: InlineContent = { text: "", commentIds: [], images: [] };
    collectInline(element, content);
    const title = normalizeText(content.text);
    if (title.length === 0) return false;

    while (this.stack.length > 0 && (this.stack.at(-1)?.level ?? 0) >= level) this.stack.pop();
    const parent = this.stack.at(-1);
    const id = parent ? `${parent.id}.${++parent.childCounter}` : `s${++this.topLevelCounter}`;
    const section: MutableSection = {
      id,
      title,
      level,
      headingPath: [...(parent?.headingPath ?? []), title],
      parentId: parent?.id ?? null,
      childIds: [],
      headingParagraphId: null,
      blocks: [],
      childCounter: 0,
    };
    parent?.childIds.push(id);
    this.sections.push(section);
    this.stack.push(section);
    this.hasHeadings = true;

    const paragraph = this.registerParagraph(element, content, section, title);
    section.headingParagraphId = paragraph.id;
    return true;
  }

  private currentSection(): MutableSection {
    const top = this.stack.at(-1);
    if (top) return top;
    if (!this.preamble) {
      this.preamble = {
        id: "s0",
        title: "",
        level: 0,
        headingPath: [],
        parentId: null,
        childIds: [],
        headingParagraphId: null,
        blocks: [],
        childCounter: 0,
      };
      this.sections.push(this.preamble);
    }
    return this.preamble;
  }

  private paragraph(element: MammothElement, section: MutableSection): DocxParagraph | undefined {
    const content: InlineContent = { text: "", commentIds: [], images: [] };
    collectInline(element, content);
    const text = normalizeText(content.text);
    if (text.length === 0 && content.images.length === 0 && content.commentIds.length === 0) {
      return undefined;
    }
    if (this.title === undefined && text.length > 0 && isTitle(element)) this.title = text;
    return this.registerParagraph(element, content, section, text);
  }

  private registerParagraph(
    element: MammothElement,
    content: InlineContent,
    section: MutableSection,
    text: string
  ): DocxParagraph {
    const id = `p${++this.paragraphCounter}`;
    const imageIds = content.images.map((image) => {
      const imageId = `img${++this.imageCounter}`;
      this.pendingImages.push({ image, paragraphId: id, sectionId: section.id });
      return imageId;
    });
    const styleName = stringProp(element, "styleName");
    const list = listInfo(element["numbering"]);
    const paragraph: DocxParagraph = {
      id,
      text,
      ...(styleName !== undefined ? { styleName } : {}),
      ...(list ? { list } : {}),
      commentIds: content.commentIds,
      imageIds,
    };
    this.paragraphs.push(paragraph);
    this.paragraphSection.set(id, section.id);
    return paragraph;
  }

  private table(element: MammothElement, section: MutableSection): DocxTable {
    const id = `t${++this.tableCounter}`;
    const rows: DocxTableRow[] = childrenOf(element)
      .filter((row) => row.type === "tableRow")
      .map((row) => ({
        isHeader: row["isHeader"] === true,
        cells: childrenOf(row)
          .filter((cell) => cell.type === "tableCell")
          .map((cell) => this.cell(cell, section)),
      }));
    return { id, rows };
  }

  private cell(element: MammothElement, section: MutableSection): DocxTableCell {
    const blocks: DocxBlock[] = [];
    for (const child of childrenOf(element)) {
      if (child.type === "paragraph") {
        const paragraph = this.paragraph(child, section);
        if (paragraph) blocks.push({ kind: "paragraph", paragraph });
      } else if (child.type === "table") {
        blocks.push({ kind: "table", table: this.table(child, section) });
      }
    }
    return {
      blocks,
      colSpan: numberProp(element, "colSpan", 1),
      rowSpan: numberProp(element, "rowSpan", 1),
    };
  }
}

function listInfo(numbering: unknown): DocxParagraph["list"] {
  if (typeof numbering !== "object" || numbering === null) return undefined;
  const { level, isOrdered } = numbering as { level?: unknown; isOrdered?: unknown };
  const parsedLevel = Number(level ?? 0);
  return {
    level: Number.isFinite(parsedLevel) ? parsedLevel : 0,
    ordered: isOrdered === true,
  };
}

function normalizeText(text: string): string {
  return text
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

async function readCommentAnchors(zip: JSZip): Promise<Map<string, string>> {
  const rels = await zip.file("_rels/.rels")?.async("string");
  const mainPath = findMainDocumentPath(rels);
  const xml = await zip.file(mainPath)?.async("string");
  return xml ? extractCommentAnchors(xml) : new Map();
}

function buildComments(
  root: MammothElement,
  builder: DocumentBuilder,
  anchors: Map<string, string>
): DocxComment[] {
  const referencedIn = new Map<string, string>();
  for (const paragraph of builder.paragraphs) {
    for (const commentId of paragraph.commentIds) {
      if (!referencedIn.has(commentId)) referencedIn.set(commentId, paragraph.id);
    }
  }

  const raw = Array.isArray(root["comments"]) ? root["comments"].filter(isElement) : [];
  return raw.flatMap((comment): DocxComment[] => {
    const id = stringProp(comment, "commentId");
    if (id === undefined) return [];
    const text = childrenOf({ type: "body", children: asArray(comment["body"]) })
      .map((block) => {
        const content: InlineContent = { text: "", commentIds: [], images: [] };
        collectInline(block, content);
        return normalizeText(content.text);
      })
      .filter((line) => line.length > 0)
      .join("\n");
    const anchorText = anchors.get(id);
    const paragraphId = referencedIn.get(id) ?? locateByText(builder.paragraphs, anchorText);
    const initials = stringProp(comment, "authorInitials");
    return [
      {
        id,
        author: stringProp(comment, "authorName") ?? "Unknown",
        ...(initials !== undefined ? { initials } : {}),
        text,
        ...(anchorText !== undefined ? { anchorText } : {}),
        paragraphId: paragraphId ?? null,
        sectionId: paragraphId ? (builder.paragraphSection.get(paragraphId) ?? null) : null,
      },
    ];
  });
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function locateByText(
  paragraphs: readonly DocxParagraph[],
  anchorText: string | undefined
): string | undefined {
  const needle = anchorText?.split("\n")[0]?.trim();
  if (!needle) return undefined;
  return paragraphs.find((paragraph) => paragraph.text.includes(needle))?.id;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/**
 * Names of the zip parts that the main document references as images, taken
 * from the image relationships in `word/_rels/document.xml.rels`. Only these
 * are inflated and hashed, so unrelated binaries (embedded OLE objects,
 * fonts, ...) are never read.
 */
async function imagePartNames(zip: JSZip): Promise<string[]> {
  const rels = zip.file("word/_rels/document.xml.rels");
  if (!rels) return [];
  const xml = await rels.async("string");
  const names = new Set<string>();
  for (const [tag] of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const attr = (name: string): string | undefined =>
      new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag)?.slice(1).find(Boolean);
    const type = attr("Type");
    const target = attr("Target");
    if (!type || !target || !/\/image$/i.test(type)) continue;
    if (/^external$/i.test(attr("TargetMode") ?? "")) continue;
    const resolved = resolveRelationshipTarget(target);
    if (resolved && !/\.(xml|rels)$/i.test(resolved)) names.add(resolved);
  }
  return [...names];
}

/** Resolves a relationship target against `word/` (or the package root when absolute). */
function resolveRelationshipTarget(target: string): string | undefined {
  const segments: string[] = [];
  const parts = target.startsWith("/")
    ? target.slice(1).split("/")
    : ["word", ...target.split("/")];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.pop() === undefined) return undefined;
    } else segments.push(part);
  }
  return segments.join("/");
}

async function buildImages(
  builder: DocumentBuilder,
  zip: JSZip
): Promise<{ images: DocxImage[]; warnings: string[] }> {
  if (builder.pendingImages.length === 0) return { images: [], warnings: [] };

  const partsByHash = new Map<string, string>();
  for (const partName of await imagePartNames(zip)) {
    const file = zip.file(partName);
    if (!file) continue;
    const bytes = await file.async("nodebuffer");
    const hash = sha256(bytes);
    if (!partsByHash.has(hash)) partsByHash.set(hash, partName);
  }

  const warnings: string[] = [];
  const images: DocxImage[] = [];
  for (const [index, pending] of builder.pendingImages.entries()) {
    const id = `img${index + 1}`;
    const { image } = pending;
    let bytes: Buffer | undefined;
    try {
      bytes = image.readAsBuffer ? await image.readAsBuffer() : undefined;
    } catch {
      bytes = undefined;
    }
    if (!bytes) warnings.push(`Image ${id} could not be read (it may be linked, not embedded).`);
    const hash = bytes ? sha256(bytes) : undefined;
    const partPath = hash ? partsByHash.get(hash) : undefined;
    const altText = image.altText?.trim();
    images.push({
      id,
      paragraphId: pending.paragraphId,
      sectionId: pending.sectionId,
      contentType: image.contentType ?? "application/octet-stream",
      ...(altText ? { altText } : {}),
      ...(partPath !== undefined ? { partPath } : {}),
      ...(bytes ? { sizeBytes: bytes.length } : {}),
      ...(hash !== undefined ? { sha256: hash } : {}),
    });
  }
  return { images, warnings };
}

/**
 * Reads the bytes of the given images from a `.docx` by their zip part path,
 * for image review. An image is returned only when its part exists and its
 * bytes still match the SHA-256 recorded at parse time; images without a part
 * path (linked or unreadable) are left out. Validate the buffer first (as
 * {@link parseDocx} does).
 *
 * @returns Image bytes keyed by image id
 * @throws {DocumentParseError} if the file is not a readable zip
 */
export async function readDocxImageData(
  buffer: Buffer,
  images: readonly DocxImage[]
): Promise<Map<string, Buffer>> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    throw new DocumentParseError("docx", "the file is not a readable Word document", {
      cause: error,
    });
  }
  const data = new Map<string, Buffer>();
  for (const image of images) {
    if (!image.partPath || !image.sha256) continue;
    const file = zip.file(image.partPath);
    if (!file) continue;
    const bytes = await file.async("nodebuffer");
    if (sha256(bytes) === image.sha256) data.set(image.id, bytes);
  }
  return data;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

/**
 * Style-mapping and browser-display warnings concern mammoth's HTML output,
 * which is not used (image formats are handled by image review).
 */
const IGNORED_WARNING =
  /^Unrecognised (paragraph|run|table) style|^Image of type .* is unlikely to display in web browsers/;

function collectWarnings(messages: readonly MammothMessage[]): string[] {
  return [
    ...new Set(
      messages.map((message) => message.message).filter((message) => !IGNORED_WARNING.test(message))
    ),
  ];
}
