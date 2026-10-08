import path from "node:path";

import { nodeFs } from "../ports/index.js";

/**
 * Review report reader.
 *
 * The CLI persists markdown reports (PR reviews, PBI/project assessments,
 * implementation plans, staged reviews) under `.mergementor/reports/`. This
 * module lists and reads those files back as typed summaries so tools such as
 * the web UI can render review history without re-implementing file handling.
 */

/** Category of a persisted report, derived from its file name. */
export type ReportKind = "review" | "pbi" | "project" | "plan" | "stage" | "report";

/** Metadata describing a persisted markdown report. */
export interface ReportSummary {
  /** File name of the report, unique within the reports directory. */
  readonly name: string;
  /** Human-readable title taken from the first markdown heading. */
  readonly title: string;
  /** Category of the report, derived from its file name. */
  readonly kind: ReportKind;
  /** Size of the report file in bytes. */
  readonly size: number;
  /** ISO timestamp of the file's last modification. */
  readonly modifiedAt: string;
}

/** A persisted markdown report together with its raw content. */
export interface ReportDocument extends ReportSummary {
  /** Raw markdown content of the report. */
  readonly content: string;
}

/**
 * Minimal filesystem surface required to read reports.
 *
 * Structurally compatible with {@link FileSystem} (and therefore `nodeFs`), which
 * keeps the reader easy to stub in tests.
 */
export interface ReportFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readdir(
    path: string,
    options: { withFileTypes: true }
  ): Promise<ReadonlyArray<{ name: string; isFile(): boolean }>>;
  stat(path: string): Promise<{ size: number; mtime: Date }>;
}

/** Options for {@link listReports} and {@link readReport}. */
interface ReadReportsOptions {
  /** Directory containing the `*.md` report files. Defaults to `.mergementor/reports` in cwd. */
  readonly reportsDir?: string;
  /** Filesystem implementation. Defaults to `nodeFs`. */
  readonly fs?: ReportFileSystem;
  /** Maximum number of summaries to return after sorting. */
  readonly limit?: number;
}

const REPORT_FILE_SUFFIX = ".md";
const HEADING_PATTERN = /^#{1,6}\s+(.+?)\s*#*\s*$/m;

/**
 * Resolves the default reports directory (`.mergementor/reports` in the cwd).
 */
export function getDefaultReportsDir(): string {
  return path.join(process.cwd(), ".mergementor", "reports");
}

/**
 * Classifies a report file name into a {@link ReportKind}.
 *
 * @param name - Report file name
 * @returns The matching kind, or `"report"` when no pattern applies
 */
export function classifyReport(name: string): ReportKind {
  if (name.startsWith("merge-mentor-plan-")) return "plan";
  if (name.startsWith("pbi-")) return "pbi";
  if (name.startsWith("project-")) return "project";
  if (name.startsWith("stage-")) return "stage";
  if (name.endsWith("-review-profile-report.md")) return "review";
  return "report";
}

/**
 * Reports whether a file name is safe to resolve within the reports directory.
 *
 * Rejects empty names, names without the `.md` suffix, and anything containing a
 * path separator or `..` traversal so callers cannot escape the reports directory.
 *
 * @param name - Candidate report file name
 * @returns `true` when the name is a plain markdown file name
 */
export function isSafeReportName(name: string): boolean {
  return (
    name.length > REPORT_FILE_SUFFIX.length &&
    name.endsWith(REPORT_FILE_SUFFIX) &&
    path.basename(name) === name &&
    name !== "." &&
    name !== ".."
  );
}

/**
 * Extracts the first markdown heading from report content.
 *
 * @param content - Raw markdown content
 * @param fallback - Value returned when no heading is present
 * @returns The trimmed heading text, or the fallback
 */
export function extractReportTitle(content: string, fallback: string): string {
  const match = HEADING_PATTERN.exec(content);
  return match ? match[1].trim() : fallback;
}

/**
 * Lists persisted markdown reports, newest first.
 *
 * Missing directories and unreadable files are treated as absent so the reader
 * can be used safely before any report has been generated.
 *
 * @param options - Reader configuration
 * @returns Report summaries sorted by modification time, descending
 */
export async function listReports(options: ReadReportsOptions = {}): Promise<ReportSummary[]> {
  const fs = options.fs ?? nodeFs;
  const reportsDir = options.reportsDir ?? getDefaultReportsDir();

  let dirents: ReadonlyArray<{ name: string; isFile(): boolean }>;
  try {
    dirents = await fs.readdir(reportsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const summaries: ReportSummary[] = [];
  for (const dirent of dirents) {
    if (!dirent.isFile() || !dirent.name.endsWith(REPORT_FILE_SUFFIX)) continue;

    const summary = await summarizeReport(fs, reportsDir, dirent.name);
    if (summary) summaries.push(summary);
  }

  summaries.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));

  if (options.limit !== undefined && options.limit >= 0) {
    return summaries.slice(0, options.limit);
  }

  return summaries;
}

/**
 * Reads a single persisted markdown report by file name.
 *
 * @param name - Report file name within the reports directory
 * @param options - Reader configuration
 * @returns The report document, or `undefined` when the name is unsafe or unreadable
 */
export async function readReport(
  name: string,
  options: ReadReportsOptions = {}
): Promise<ReportDocument | undefined> {
  if (!isSafeReportName(name)) return undefined;

  const fs = options.fs ?? nodeFs;
  const reportsDir = options.reportsDir ?? getDefaultReportsDir();
  const filePath = path.join(reportsDir, name);

  try {
    const [content, stats] = await Promise.all([fs.readFile(filePath, "utf-8"), fs.stat(filePath)]);

    return {
      name,
      title: extractReportTitle(content, name),
      kind: classifyReport(name),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      content,
    };
  } catch {
    return undefined;
  }
}

async function summarizeReport(
  fs: ReportFileSystem,
  reportsDir: string,
  name: string
): Promise<ReportSummary | undefined> {
  const filePath = path.join(reportsDir, name);

  try {
    const [content, stats] = await Promise.all([fs.readFile(filePath, "utf-8"), fs.stat(filePath)]);

    return {
      name,
      title: extractReportTitle(content, name),
      kind: classifyReport(name),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    };
  } catch {
    return undefined;
  }
}
