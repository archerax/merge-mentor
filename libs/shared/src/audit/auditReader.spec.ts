import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getDefaultAuditLogsDir,
  listAuditLogFiles,
  parseAuditLine,
  readAuditEvents,
  type AuditLogFileSystem,
} from "./auditReader.js";

const LOGS_DIR = path.join("/tmp", "logs");

function createFakeFs(files: Record<string, string>): AuditLogFileSystem {
  return {
    readFile: async (filePath) => {
      const content = files[filePath];
      if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
      return content;
    },
    readdir: async (dirPath) => {
      const prefix = dirPath.endsWith(path.sep) ? dirPath : `${dirPath}${path.sep}`;
      return Object.keys(files)
        .filter((filePath) => filePath.startsWith(prefix))
        .map((filePath) => filePath.slice(prefix.length))
        .filter((name) => !name.includes(path.sep))
        .map((name) => ({ name, isFile: () => true }));
    },
  };
}

function pinoLine(event: Record<string, unknown>): string {
  return JSON.stringify({
    level: 30,
    time: 1_759_000_000_000,
    pid: 1,
    hostname: "test-host",
    component: "AuditLogger",
    audit: event,
    msg: "AUDIT",
  });
}

const PR_FETCH_EVENT = {
  eventType: "pr.details.fetch",
  timestamp: "2026-10-07T10:00:00.000Z",
  severity: "info",
  actor: "merge-mentor-bot",
  resource: { type: "pr", id: "1", details: { platform: "github" } },
  action: "Fetch PR #1 details",
  result: "success",
  metadata: { platform: "github" },
};

const REVIEW_FAILURE_EVENT = {
  eventType: "review.complete",
  timestamp: "2026-10-07T11:00:00.000Z",
  severity: "error",
  actor: "merge-mentor-bot",
  resource: { type: "review", id: "pr-2", details: { platform: "azure" } },
  action: "Complete review of PR #2",
  result: "failure",
  error: "boom",
};

describe("getDefaultAuditLogsDir", () => {
  it("points at .mergementor/logs in the cwd", () => {
    expect(getDefaultAuditLogsDir()).toBe(path.join(process.cwd(), ".mergementor", "logs"));
  });
});

describe("listAuditLogFiles", () => {
  it("lists only .log files, newest first", async () => {
    const fs = createFakeFs({
      [path.join(LOGS_DIR, "merge-mentor_2026-10-06.log")]: "",
      [path.join(LOGS_DIR, "merge-mentor_2026-10-07.log")]: "",
      [path.join(LOGS_DIR, "notes.txt")]: "",
    });

    await expect(listAuditLogFiles(LOGS_DIR, fs)).resolves.toEqual([
      "merge-mentor_2026-10-07.log",
      "merge-mentor_2026-10-06.log",
    ]);
  });

  it("propagates filesystem errors to the caller", async () => {
    const fs: AuditLogFileSystem = {
      readFile: async () => {
        throw new Error("nope");
      },
      readdir: async () => {
        throw new Error("ENOENT");
      },
    };

    await expect(listAuditLogFiles(LOGS_DIR, fs)).rejects.toThrow("ENOENT");
  });
});

describe("parseAuditLine", () => {
  it("extracts the audit event and attaches its location", () => {
    const entry = parseAuditLine(pinoLine(PR_FETCH_EVENT), "a.log", 3);

    expect(entry).toEqual({
      ...PR_FETCH_EVENT,
      sourceFile: "a.log",
      lineNumber: 3,
    });
  });

  it("returns undefined for empty lines", () => {
    expect(parseAuditLine("   ", "a.log", 1)).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    expect(parseAuditLine("{not json", "a.log", 1)).toBeUndefined();
  });

  it("returns undefined when no audit payload is present", () => {
    expect(parseAuditLine(JSON.stringify({ msg: "hello" }), "a.log", 1)).toBeUndefined();
  });

  it("returns undefined when required fields are missing", () => {
    const { eventType: _eventType, ...incomplete } = PR_FETCH_EVENT;

    expect(parseAuditLine(pinoLine(incomplete), "a.log", 1)).toBeUndefined();
  });

  it("returns undefined for unknown severities", () => {
    const entry = parseAuditLine(pinoLine({ ...PR_FETCH_EVENT, severity: "critical" }), "a.log", 1);

    expect(entry).toBeUndefined();
  });
});

describe("readAuditEvents", () => {
  const newerFile = path.join(LOGS_DIR, "merge-mentor_2026-10-07.log");
  const olderFile = path.join(LOGS_DIR, "merge-mentor_2026-10-06.log");

  it("reads events across files and sorts newest first", async () => {
    const fs = createFakeFs({
      [olderFile]: `${pinoLine(PR_FETCH_EVENT)}\n`,
      [newerFile]: `${pinoLine(REVIEW_FAILURE_EVENT)}\n`,
    });

    const entries = await readAuditEvents({ logsDir: LOGS_DIR, fs });

    expect(entries.map((entry) => entry.eventType)).toEqual([
      "review.complete",
      "pr.details.fetch",
    ]);
    expect(entries[0].sourceFile).toBe("merge-mentor_2026-10-07.log");
  });

  it("filters by severity and event type", async () => {
    const fs = createFakeFs({
      [newerFile]: `${pinoLine(PR_FETCH_EVENT)}\n${pinoLine(REVIEW_FAILURE_EVENT)}\n`,
    });

    await expect(
      readAuditEvents({ logsDir: LOGS_DIR, fs, severity: "error" })
    ).resolves.toHaveLength(1);
    await expect(
      readAuditEvents({ logsDir: LOGS_DIR, fs, eventType: "pr.details.fetch" })
    ).resolves.toHaveLength(1);
  });

  it("limits the number of returned entries", async () => {
    const fs = createFakeFs({
      [newerFile]: `${pinoLine(PR_FETCH_EVENT)}\n${pinoLine(REVIEW_FAILURE_EVENT)}\n`,
    });

    const entries = await readAuditEvents({ logsDir: LOGS_DIR, fs, limit: 1 });

    expect(entries).toHaveLength(1);
    expect(entries[0].eventType).toBe("review.complete");
  });

  it("can restrict reading to a single source file", async () => {
    const fs = createFakeFs({
      [olderFile]: `${pinoLine(PR_FETCH_EVENT)}\n`,
      [newerFile]: `${pinoLine(REVIEW_FAILURE_EVENT)}\n`,
    });

    const entries = await readAuditEvents({
      logsDir: LOGS_DIR,
      fs,
      sourceFile: "merge-mentor_2026-10-06.log",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].eventType).toBe("pr.details.fetch");
  });

  it("returns an empty array when logs are missing", async () => {
    const fs = createFakeFs({});

    await expect(readAuditEvents({ logsDir: LOGS_DIR, fs })).resolves.toEqual([]);
  });

  it("skips unreadable files", async () => {
    const fs: AuditLogFileSystem = {
      readFile: async () => {
        throw new Error("EACCES");
      },
      readdir: async () => [{ name: "merge-mentor.log", isFile: () => true }],
    };

    await expect(readAuditEvents({ logsDir: LOGS_DIR, fs })).resolves.toEqual([]);
  });
});
