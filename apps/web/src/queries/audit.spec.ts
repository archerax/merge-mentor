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

  it("re-reads the log on a later visit instead of trusting a long-lived cache", () => {
    expect(auditQuery.staleTime).toBeLessThanOrEqual(5000);
    expect(auditQuery.staleTime).toBeGreaterThan(0);
  });

  it("propagates a failed load so the route error screen shows it", async () => {
    getAuditEvents.mockRejectedValue(new Error("audit unavailable"));
    await expect(createTestQueryClient().fetchQuery(auditQuery)).rejects.toThrow(
      "audit unavailable"
    );
  });
});
