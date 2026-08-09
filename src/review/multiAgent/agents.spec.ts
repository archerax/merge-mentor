import { describe, expect, it } from "vitest";
import {
  AGENT_ROLES,
  getAgentRole,
  getAllAgentIds,
  isAgentRoleId,
  resolveAgentForPass,
  resolveAgentsFromPasses,
} from "./agents.js";

describe("multi-agent agents registry", () => {
  describe("resolveAgentForPass", () => {
    it("maps each ReviewPass to exactly one subagent", () => {
      expect(resolveAgentForPass("security")).toBe("security");
      expect(resolveAgentForPass("performance")).toBe("performance");
      expect(resolveAgentForPass("database")).toBe("performance");
      expect(resolveAgentForPass("testing")).toBe("testing");
      expect(resolveAgentForPass("logic")).toBe("general");
      expect(resolveAgentForPass("monorepo")).toBe("architecture");
      expect(resolveAgentForPass("scan")).toBe("general");
    });

    it("deduplicates passes targeting the same agent", () => {
      expect(resolveAgentsFromPasses(["performance", "database"])).toEqual(["performance"]);
      expect(resolveAgentsFromPasses(["logic", "monorepo", "scan"])).toEqual([
        "general",
        "architecture",
      ]);
    });

    it("returns a subset in canonical order", () => {
      expect(resolveAgentsFromPasses(["security", "testing"])).toEqual(["security", "testing"]);
      expect(resolveAgentsFromPasses(["database", "testing", "logic"])).toEqual([
        "general",
        "performance",
        "testing",
      ]);
    });
  });

  describe("getAllAgentIds", () => {
    it("returns the five hardcoded roles", () => {
      expect(getAllAgentIds()).toEqual([
        "general",
        "security",
        "performance",
        "testing",
        "architecture",
      ]);
    });
  });

  describe("isAgentRoleId", () => {
    it("accepts valid role ids and rejects everything else", () => {
      expect(isAgentRoleId("general")).toBe(true);
      expect(isAgentRoleId("security")).toBe(true);
      expect(isAgentRoleId("performance")).toBe(true);
      expect(isAgentRoleId("testing")).toBe(true);
      expect(isAgentRoleId("architecture")).toBe(true);
      expect(isAgentRoleId("compliance")).toBe(false);
      expect(isAgentRoleId("")).toBe(false);
    });
  });

  describe("AGENT_ROLES / getAgentRole", () => {
    it("exposes a label, emoji, and passes for each role", () => {
      expect(AGENT_ROLES).toHaveLength(5);
      expect(getAgentRole("general")).toMatchObject({
        id: "general",
        label: "General Logic & Correctness Agent",
        emoji: "🧠",
      });
      expect(getAgentRole("security")).toMatchObject({
        id: "security",
        label: "Security & Trust Agent",
        emoji: "🔒",
      });
      expect(getAgentRole("architecture")).toMatchObject({
        id: "architecture",
        label: "Architecture & Style Agent",
        emoji: "🏗️",
      });
      expect(getAgentRole("nonexistent" as never)).toBeUndefined();
    });
  });
});
