/**
 * Test helper that builds minimal but valid `.docx` (OpenXML) files in memory.
 *
 * We have no real team documents in the repository, so the parser specs build
 * realistic fixtures programmatically: headings, paragraphs, tables, tracked
 * changes, comments and embedded images.
 */
import JSZip from "jszip";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";

/** A 1x1 transparent PNG. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A plain text run. */
export function run(text: string): string {
  return `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

/** A tracked insertion. */
export function ins(text: string, author = "Reviewer"): string {
  return `<w:ins w:id="${nextId()}" w:author="${escapeXml(author)}" w:date="2026-01-01T00:00:00Z">${run(text)}</w:ins>`;
}

/** A tracked deletion. */
export function del(text: string, author = "Reviewer"): string {
  return `<w:del w:id="${nextId()}" w:author="${escapeXml(author)}" w:date="2026-01-01T00:00:00Z"><w:r><w:delText xml:space="preserve">${escapeXml(text)}</w:delText></w:r></w:del>`;
}

/** Comment range start marker. */
export function commentStart(id: number): string {
  return `<w:commentRangeStart w:id="${id}"/>`;
}

/** Comment range end marker plus the reference run Word writes after it. */
export function commentEnd(id: number): string {
  return `<w:commentRangeEnd w:id="${id}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`;
}

/** A paragraph with raw inner run XML. */
export function paraXml(inner: string, styleId?: string): string {
  const pPr = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : "";
  return `<w:p>${pPr}${inner}</w:p>`;
}

/** A plain paragraph. */
export function para(text: string): string {
  return paraXml(run(text));
}

/** A heading paragraph using the built-in `HeadingN` style. */
export function heading(level: number, text: string): string {
  return paraXml(run(text), `Heading${level}`);
}

/** A list item; `numId` 1 is bulleted and 2 is numbered (see {@link buildDocx}). */
export function listItem(text: string, numId: 1 | 2, level = 0): string {
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${run(text)}</w:p>`;
}

/** A table whose cells each hold one paragraph of text. */
export function table(rows: string[][]): string {
  const body = rows
    .map((cells) => `<w:tr>${cells.map((cell) => `<w:tc>${para(cell)}</w:tc>`).join("")}</w:tr>`)
    .join("");
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>${body}</w:tbl>`;
}

/** A run holding an inline image that refers to relationship `relId`. */
export function imageRun(relId: string, altText: string): string {
  const id = nextId();
  return (
    `<w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/>` +
    `<wp:docPr id="${id}" name="Picture ${id}" descr="${escapeXml(altText)}"/>` +
    `<a:graphic><a:graphicData uri="${PIC_NS}"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="0" name="image.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/></pic:blipFill><pic:spPr/>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

let idCounter = 100;
function nextId(): number {
  idCounter += 1;
  return idCounter;
}

interface FixtureComment {
  readonly id: number;
  readonly author: string;
  readonly initials?: string;
  readonly text: string;
}

interface FixtureImage {
  /** Relationship id referenced by {@link imageRun}. */
  readonly relId: string;
  /** File name under `word/media/`. */
  readonly fileName: string;
  readonly data: Buffer;
}

export interface FixtureOptions {
  /** Body XML (paragraphs/tables) for `word/document.xml`. */
  readonly body: string;
  readonly comments?: readonly FixtureComment[];
  readonly images?: readonly FixtureImage[];
  /** Include `word/styles.xml` with heading style names (default true). */
  readonly includeStyles?: boolean;
  /** Raw XML of a part to add verbatim, keyed by zip path. */
  readonly extraParts?: Readonly<Record<string, string>>;
}

function numberingLevels(format: string): string {
  return [0, 1, 2]
    .map(
      (level) =>
        `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="%${level + 1}."/></w:lvl>`
    )
    .join("");
}

function numberingXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:numbering xmlns:w="${W_NS}">` +
    `<w:abstractNum w:abstractNumId="0">${numberingLevels("bullet")}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1">${numberingLevels("decimal")}</w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
    `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>` +
    `</w:numbering>`
  );
}

function stylesXml(): string {
  const headings = [1, 2, 3, 4, 5, 6]
    .map(
      (level) =>
        `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${level - 1}"/></w:pPr></w:style>`
    )
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="${W_NS}">` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>` +
    headings +
    `<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/></w:style>` +
    `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>` +
    `</w:styles>`
  );
}

function commentsXml(comments: readonly FixtureComment[]): string {
  const body = comments
    .map(
      (c) =>
        `<w:comment w:id="${c.id}" w:author="${escapeXml(c.author)}" w:initials="${escapeXml(c.initials ?? c.author.slice(0, 2))}" w:date="2026-01-01T00:00:00Z">${para(c.text)}</w:comment>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${W_NS}">${body}</w:comments>`;
}

/** Builds a `.docx` file as a Buffer. */
export async function buildDocx(options: FixtureOptions): Promise<Buffer> {
  const { body, comments = [], images = [], includeStyles = true, extraParts = {} } = options;
  const zip = new JSZip();

  const overrides = [
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`,
    includeStyles
      ? `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`
      : "",
    comments.length > 0
      ? `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>`
      : "",
  ].join("");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="png" ContentType="image/png"/>` +
      `<Default Extension="emf" ContentType="image/x-emf"/>` +
      overrides +
      `</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`
  );

  const rels = [
    includeStyles ? `<Relationship Id="rIdStyles" Type="${R_NS}/styles" Target="styles.xml"/>` : "",
    `<Relationship Id="rIdNumbering" Type="${R_NS}/numbering" Target="numbering.xml"/>`,
    comments.length > 0
      ? `<Relationship Id="rIdComments" Type="${R_NS}/comments" Target="comments.xml"/>`
      : "",
    ...images.map(
      (img) =>
        `<Relationship Id="${img.relId}" Type="${R_NS}/image" Target="media/${img.fileName}"/>`
    ),
  ].join("");
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`
  );

  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:pic="${PIC_NS}">` +
      `<w:body>${body}<w:sectPr/></w:body></w:document>`
  );
  if (includeStyles) zip.file("word/styles.xml", stylesXml());
  zip.file("word/numbering.xml", numberingXml());
  if (comments.length > 0) zip.file("word/comments.xml", commentsXml(comments));
  for (const img of images) zip.file(`word/media/${img.fileName}`, img.data);
  for (const [path, xml] of Object.entries(extraParts)) zip.file(path, xml);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
