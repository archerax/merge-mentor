import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListReports = vi.fn(async () => []);
const mockReadReport = vi.fn(async () => undefined);

vi.mock("@merge-mentor/shared/reports/index.js", () => ({
  listReports: mockListReports,
  readReport: mockReadReport,
}));

const { loadReport, loadReports } = await import("./reports.server.js");

describe("reports.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MM_TEMP_PATH = "/tmp/mm-reports";
  });

  it("lists reports from the temp reports directory", async () => {
    await loadReports();

    expect(mockListReports).toHaveBeenCalledWith({
      limit: 200,
      reportsDir: path.join("/tmp/mm-reports", "reports"),
    });
  });

  it("honours a custom limit", async () => {
    await loadReports(5);

    expect(mockListReports).toHaveBeenCalledWith({
      limit: 5,
      reportsDir: path.join("/tmp/mm-reports", "reports"),
    });
  });

  it("reads a single report by name from the temp reports directory", async () => {
    await loadReport("report-1.md");

    expect(mockReadReport).toHaveBeenCalledWith("report-1.md", {
      reportsDir: path.join("/tmp/mm-reports", "reports"),
    });
  });
});
