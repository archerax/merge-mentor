import { describe, expect, it } from "vitest";
import { formatPBIAlignmentReport, parsePBIAlignmentResponse } from "./pbiParser.js";

describe("pbiParser", () => {
  describe("parsePBIAlignmentResponse", () => {
    const fallbackId = "999";
    const fallbackTitle = "Fallback Title";

    it("parses valid JSON successfully", () => {
      const validJson = JSON.stringify({
        pbiId: "123",
        title: "My Feature",
        metCriteria: ["Criteria 1"],
        partialCriteria: [{ criterion: "Criteria 2", explanation: "Almost done" }],
        missingCriteria: ["Criteria 3"],
        scopeCreep: ["Out of scope addition"],
        overallAssessment: "Looks perfect",
      });

      const result = parsePBIAlignmentResponse(validJson, fallbackId, fallbackTitle);
      expect(result.pbiId).toBe("123");
      expect(result.title).toBe("My Feature");
      expect(result.metCriteria).toEqual(["Criteria 1"]);
      expect(result.partialCriteria[0]).toEqual({
        criterion: "Criteria 2",
        explanation: "Almost done",
      });
      expect(result.missingCriteria).toEqual(["Criteria 3"]);
      expect(result.scopeCreep).toEqual(["Out of scope addition"]);
      expect(result.overallAssessment).toBe("Looks perfect");
    });

    it("extracts JSON text wrapped in markdown blocks", () => {
      const rawText =
        'Some introduction\n```json\n{\n  "pbiId": "456",\n  "title": "Another Feature",\n  "overallAssessment": "Good"\n}\n```\nSome outro';
      const result = parsePBIAlignmentResponse(rawText, fallbackId, fallbackTitle);
      expect(result.pbiId).toBe("456");
      expect(result.title).toBe("Another Feature");
      expect(result.overallAssessment).toBe("Good");
    });

    it("extracts JSON text wrapped in basic code blocks without language tag", () => {
      const rawText = '```\n{\n  "pbiId": "789",\n  "title": "Feature No Tag"\n}\n```';
      const result = parsePBIAlignmentResponse(rawText, fallbackId, fallbackTitle);
      expect(result.pbiId).toBe("789");
      expect(result.title).toBe("Feature No Tag");
    });

    it("normalises and falls back manually if schema validation fails", () => {
      // Missing pbiId and title to force schema validation failure,
      // and mismatching types to exercise fallback paths.
      const invalidSchemaJson = JSON.stringify({
        metCriteria: "not-an-array",
        partialCriteria: [
          "not-an-object",
          { criterion: "Valid Crit", explanation: "Valid Expl" },
          null,
        ],
        missingCriteria: "not-an-array",
        scopeCreep: "not-an-array",
        overallAssessment: null,
      });

      const result = parsePBIAlignmentResponse(invalidSchemaJson, fallbackId, fallbackTitle);
      expect(result.pbiId).toBe(fallbackId);
      expect(result.title).toBe(fallbackTitle);
      expect(result.metCriteria).toEqual([]);
      expect(result.partialCriteria).toEqual([
        { criterion: "Valid Crit", explanation: "Valid Expl" },
      ]);
      expect(result.missingCriteria).toEqual([]);
      expect(result.scopeCreep).toEqual([]);
      expect(result.overallAssessment).toBe("Validation succeeded with format deviations.");
    });

    it("returns error diagnostics if JSON parsing fails entirely", () => {
      const badJson = "{ invalid json }";
      const result = parsePBIAlignmentResponse(badJson, fallbackId, fallbackTitle);
      expect(result.pbiId).toBe(fallbackId);
      expect(result.title).toBe(fallbackTitle);
      expect(result.metCriteria).toEqual([]);
      expect(result.overallAssessment).toContain("Failed to parse AI response as JSON.");
    });
  });

  describe("formatPBIAlignmentReport", () => {
    it("formats alignment report correctly with filled arrays", () => {
      const result = {
        pbiId: "123",
        title: "Test PBI",
        metCriteria: ["Crit A"],
        partialCriteria: [{ criterion: "Crit B", explanation: "Ex B" }],
        missingCriteria: ["Crit C"],
        scopeCreep: ["Creep D"],
        overallAssessment: "Great assessment",
      };

      const formatted = formatPBIAlignmentReport(result);
      expect(formatted).toContain("🔗 Work Item #123 Alignment Report: Test PBI");
      expect(formatted).toContain("- ✅ Crit A");
      expect(formatted).toContain("- ⚠️ **Crit B**: Ex B");
      expect(formatted).toContain("- ❌ Crit C");
      expect(formatted).toContain("- ⚠️ Creep D");
    });

    it("formats alignment report correctly with empty arrays (using None fallback)", () => {
      const result = {
        pbiId: "123",
        title: "Test PBI",
        metCriteria: [],
        partialCriteria: [],
        missingCriteria: [],
        scopeCreep: [],
        overallAssessment: "",
      };

      const formatted = formatPBIAlignmentReport(result);
      expect(formatted).toContain("No overall assessment provided.");
      expect(formatted).toContain("- **Met Criteria:**\n- None");
      expect(formatted).toContain("- **Partially Met Criteria:**\n- None");
      expect(formatted).toContain("- **Missing Criteria:**\n- None");
      expect(formatted).toContain("#### Scope Creep\n- None");
    });
  });
});
