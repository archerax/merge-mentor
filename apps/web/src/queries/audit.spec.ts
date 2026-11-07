import { describe, expect, it, vi } from "vitest";

const getAuditEvents = vi.fn<() => Promise<unknown[]>>();
vi.mock("../server/audit.functions.js", () => ({ getAuditEvents }));

const { auditQuery } = await import("./audit.js");
const { createTestQueryClient } = await import("../test/renderWithQuery.test-helper.js");

describe("auditQuery", () => {
  it("loads the audit events from the server function", async () => {
    getAuditEvents.mockResolvedValue([{ id: "event-1" }]);
    await expect(createTestQueryClient().fetchQuery(auditQuery)).resolves.toEqual([
      { id: "event-1" },
    ]);
  });
});
