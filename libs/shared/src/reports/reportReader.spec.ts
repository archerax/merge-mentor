import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifyReport,
  extractReportTitle,
  getDefaultReportsDir,
  isSafeReportName,
  listReports,
  readReport,
  type ReportFileSystem,
} from "./reportReader.js";

const REPORTS_DIR = path.join("/tmp", "reports");

interface FakeFile {
  readonly content: string;
  readonly mtime: Date;
}

function createFakeFs(files: Record<string, FakeFile>): ReportFileSystem {
  return {
    readFile: async (filePath) => {
      const file = files[filePath];
      if (file === undefined) throw new Error(`ENOENT: ${filePath}`);
      return file.content;
    },
    readdir: async (dirPath) => {
      const prefix = dirPath.endsWith(path.sep) ? dirPath : `${dirPath}${path.sep}`;
      return Object.keys(files)
        .filter((filePath) => filePath.startsWith(prefix))
        .map((filePath) => filePath.slice(prefix.length))
        .filter((name) => !name.includes(path.sep))
        .map((name) => ({ name, isFile: () => true }));
    },
    stat: async (filePath) => {
      const file = files[filePath];
      if (file === undefined) throw new Error(`ENOENT: ${filePath}`);
      return { size: Buffer.byteLength(file.content), mtime: file.mtime };
    },
  };
}

function reportFile(content: string, mtime: string): FakeFile {
  return { content, mtime: new Date(mtime) };
}

describe("getDefaultReportsDir", () => {
  it("points at .mergementor/reports in the cwd", () => {
    expect(getDefaultReportsDir()).toBe(path.join(process.cwd(), ".mergementor", "reports"));
  });
});

describe("classifyReport", () => {
  it.each([
    ["merge-mentor-plan-42.md", "plan"],
    ["pbi-7-review-report.md", "pbi"],
    ["project-12-review-report.md", "project"],
    ["stage-feature-branch.md", "stage"],
    ["Github-repo-PR9-review-profile-report.md", "review"],
    ["something-else.md", "report"],
  ])("classifies %s as %s", (name, expected) => {
    expect(classifyReport(name)).toBe(expected);
  });
});

describe("isSafeReportName", () => {
  it("accepts a plain markdown file name", () => {
    expect(isSafeReportName("pbi-7-review-report.md")).toBe(true);
  });

  it.each(["", ".md", "../secret.md", "nested/report.md", "report.txt"])("rejects %s", (name) => {
    expect(isSafeReportName(name)).toBe(false);
  });
});

describe("extractReportTitle", () => {
  it("returns the first heading text", () => {
    expect(extractReportTitle("## 📋 PBI Review: #7 - Login\n\nbody", "fallback")).toBe(
      "📋 PBI Review: #7 - Login"
    );
  });

  it("prefers the first heading regardless of level", () => {
    expect(extractReportTitle("# Code Review Report - PR #9\n", "fallback")).toBe(
      "Code Review Report - PR #9"
    );
  });

  it("falls back when no heading is present", () => {
    expect(extractReportTitle("no heading here", "fallback")).toBe("fallback");
  });
});

describe("listReports", () => {
  it("lists markdown reports newest first with metadata", async () => {
    const fs = createFakeFs({
      [path.join(REPORTS_DIR, "older-review-profile-report.md")]: reportFile(
        "# Code Review Report - PR #1\n",
        "2026-10-01T00:00:00.000Z"
      ),
      [path.join(REPORTS_DIR, "pbi-2-review-report.md")]: reportFile(
        "## PBI Review #2\n",
        "2026-10-02T00:00:00.000Z"
      ),
      [path.join(REPORTS_DIR, "notes.txt")]: reportFile("ignored", "2026-10-03T00:00:00.000Z"),
    });

    const reports = await listReports({ reportsDir: REPORTS_DIR, fs });

    expect(reports.map((report) => report.name)).toEqual([
      "pbi-2-review-report.md",
      "older-review-profile-report.md",
    ]);
    expect(reports[0]).toMatchObject({
      title: "PBI Review #2",
      kind: "pbi",
      size: Buffer.byteLength("## PBI Review #2\n"),
      modifiedAt: "2026-10-02T00:00:00.000Z",
    });
  });

  it("limits the number of returned summaries", async () => {
    const fs = createFakeFs({
      [path.join(REPORTS_DIR, "a.md")]: reportFile("# A\n", "2026-10-02T00:00:00.000Z"),
      [path.join(REPORTS_DIR, "b.md")]: reportFile("# B\n", "2026-10-01T00:00:00.000Z"),
    });

    const reports = await listReports({ reportsDir: REPORTS_DIR, fs, limit: 1 });

    expect(reports).toHaveLength(1);
    expect(reports[0].name).toBe("a.md");
  });

  it("returns an empty array when the directory is missing", async () => {
    const fs = createFakeFs({});

    await expect(listReports({ reportsDir: REPORTS_DIR, fs })).resolves.toEqual([]);
  });

  it("skips unreadable files", async () => {
    const fs: ReportFileSystem = {
      readFile: async () => {
        throw new Error("EACCES");
      },
      readdir: async () => [{ name: "report.md", isFile: () => true }],
      stat: async () => {
        throw new Error("EACCES");
      },
    };

    await expect(listReports({ reportsDir: REPORTS_DIR, fs })).resolves.toEqual([]);
  });
});

describe("readReport", () => {
  it("reads a report by name and parses its metadata", async () => {
    const fs = createFakeFs({
      [path.join(REPORTS_DIR, "stage-main.md")]: reportFile(
        "# Staged Review Report\n\nbody",
        "2026-10-05T00:00:00.000Z"
      ),
    });

    const report = await readReport("stage-main.md", { reportsDir: REPORTS_DIR, fs });

    expect(report).toMatchObject({
      name: "stage-main.md",
      title: "Staged Review Report",
      kind: "stage",
      content: "# Staged Review Report\n\nbody",
    });
  });

  it("returns undefined for unsafe names", async () => {
    const fs = createFakeFs({});

    await expect(
      readReport("../secret.md", { reportsDir: REPORTS_DIR, fs })
    ).resolves.toBeUndefined();
    await expect(
      readReport("report.txt", { reportsDir: REPORTS_DIR, fs })
    ).resolves.toBeUndefined();
  });

  it("returns undefined for missing reports", async () => {
    const fs = createFakeFs({});

    await expect(
      readReport("missing.md", { reportsDir: REPORTS_DIR, fs })
    ).resolves.toBeUndefined();
  });
});
