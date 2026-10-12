import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadAuditEvents = vi.fn(async () => []);

vi.mock("@merge-mentor/shared/audit/index.js", () => ({
  readAuditEvents: mockReadAuditEvents,
}));

const { loadAuditEvents } = await import("./audit.server.js");

describe("audit.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MM_TEMP_PATH = "/tmp/mm-audit";
  });

  it("loads audit events from the temp logs directory", async () => {
    await loadAuditEvents();

    expect(mockReadAuditEvents).toHaveBeenCalledWith({
      limit: 500,
      logsDir: path.join("/tmp/mm-audit", "logs"),
    });
  });

  it("honours a custom limit", async () => {
    await loadAuditEvents(10);

    expect(mockReadAuditEvents).toHaveBeenCalledWith({
      limit: 10,
      logsDir: path.join("/tmp/mm-audit", "logs"),
    });
  });
});
