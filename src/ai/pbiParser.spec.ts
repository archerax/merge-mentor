import { describe, expect, it } from "vitest";
import { formatPBIAlignmentReport, parsePBIAlignmentResponse } from "./pbiParser.js";

describe("pbiParser", () => {
  describe("parsePBIAlignmentResponse", () => {
    it("parses valid JSON response inside a markdown json block", () => {
      const rawText = `Here is the assessment:
\`\`\`json
{
  "pbiId": "123",
  "title": "Add Auth Feature",
  "metCriteria": ["Criteria 1"],
  "partialCriteria": [{ "criterion": "Criteria 2", "explanation": "Half done" }],
  "missingCriteria": ["Criteria 3"],
  "scopeCreep": ["Unrequested refactor"],
  "overallAssessment": "Good start overall."
}
\`\`\``;

      const result = parsePBIAlignmentResponse(rawText, "123", "Fallback Title");

      expect(result).toEqual({
        pbiId: "123",
        title: "Add Auth Feature",
        metCriteria: ["Criteria 1"],
        partialCriteria: [{ criterion: "Criteria 2", explanation: "Half done" }],
        missingCriteria: ["Criteria 3"],
        scopeCreep: ["Unrequested refactor"],
        overallAssessment: "Good start overall.",
      });
    });

    it("parses valid JSON response inside generic code block", () => {
      const rawText = `\`\`\`
{
  "pbiId": "456",
  "title": "Fix Bug",
  "metCriteria": [],
  "partialCriteria": [],
  "missingCriteria": [],
  "scopeCreep": [],
  "overallAssessment": "Looks good"
}
\`\`\``;

      const result = parsePBIAlignmentResponse(rawText, "456", "Fallback Title");
      expect(result.pbiId).toBe("456");
      expect(result.title).toBe("Fix Bug");
    });

    it("parses valid raw JSON response without markdown blocks", () => {
      const rawText = JSON.stringify({
        pbiId: "789",
        title: "Refactor API",
        metCriteria: ["Met 1"],
        partialCriteria: [],
        missingCriteria: [],
        scopeCreep: [],
        overallAssessment: "Clean code",
      });

      const result = parsePBIAlignmentResponse(rawText, "789", "Fallback Title");
      expect(result.pbiId).toBe("789");
      expect(result.title).toBe("Refactor API");
    });

    it("handles schema validation failure gracefully by normalizing properties", () => {
      const rawText = JSON.stringify({
        pbiId: 100, // Number instead of string
        title: null, // missing title
        metCriteria: ["Criteria 1", 200], // mixed array
        partialCriteria: [{ criterion: "Partial 1", explanation: 123 }, "invalid item"],
        missingCriteria: "not-an-array", // bad type
        scopeCreep: null,
      });

      const result = parsePBIAlignmentResponse(rawText, "100", "Fallback Title");

      expect(result.pbiId).toBe("100");
      expect(result.title).toBe("Fallback Title");
      expect(result.metCriteria).toEqual(["Criteria 1", "200"]);
      expect(result.partialCriteria).toEqual([{ criterion: "Partial 1", explanation: "123" }]);
      expect(result.missingCriteria).toEqual([]);
      expect(result.scopeCreep).toEqual([]);
      expect(result.overallAssessment).toBe("Validation succeeded with format deviations.");
    });

    it("returns fallback error result on invalid JSON syntax", () => {
      const rawText = "This is not JSON at all!";

      const result = parsePBIAlignmentResponse(rawText, "PBI-1", "My Feature");

      expect(result.pbiId).toBe("PBI-1");
      expect(result.title).toBe("My Feature");
      expect(result.metCriteria).toEqual([]);
      expect(result.partialCriteria).toEqual([]);
      expect(result.missingCriteria).toEqual([]);
      expect(result.scopeCreep).toEqual([]);
      expect(result.overallAssessment).toContain("Failed to parse AI response as JSON");
    });
  });

  describe("formatPBIAlignmentReport", () => {
    it("formats complete report with all sections populated", () => {
      const report = formatPBIAlignmentReport({
        pbiId: "42",
        title: "User Profile Page",
        metCriteria: ["Avatars rendered"],
        partialCriteria: [{ criterion: "Dark mode", explanation: "Only header done" }],
        missingCriteria: ["Settings menu"],
        scopeCreep: ["Database migration added"],
        overallAssessment: "Partial implementation.",
      });

      expect(report).toContain(
        "<summary>🔗 Work Item #42 Alignment Report: User Profile Page</summary>"
      );
      expect(report).toContain("Partial implementation.");
      expect(report).toContain("- ✅ Avatars rendered");
      expect(report).toContain("- ⚠️ **Dark mode**: Only header done");
      expect(report).toContain("- ❌ Settings menu");
      expect(report).toContain("- ⚠️ Database migration added");
    });

    it("formats report with empty lists as '- None'", () => {
      const report = formatPBIAlignmentReport({
        pbiId: "99",
        title: "Empty Test",
        metCriteria: [],
        partialCriteria: [],
        missingCriteria: [],
        scopeCreep: [],
        overallAssessment: "",
      });

      expect(report).toContain("No overall assessment provided.");
      expect(report).toContain("- **Met Criteria:**\n- None");
      expect(report).toContain("- **Partially Met Criteria:**\n- None");
      expect(report).toContain("- **Missing Criteria:**\n- None");
      expect(report).toContain("#### Scope Creep\n- None");
    });
  });
});
