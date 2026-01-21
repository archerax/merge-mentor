import { describe, expect, it } from "vitest";
import type {
  CrossFileFinding,
  CrossFileReviewResult,
  FileFinding,
  FileReviewResult,
} from "../platforms/types.js";
import { FindingAggregator } from "./findingAggregator.js";

function createFileFinding(overrides: Partial<FileFinding> = {}): FileFinding {
  return {
    line: 10,
    severity: "medium",
    confidence: "high",
    category: "bug",
    message: "Test issue found",
    suggestion: "Fix it",
    reasoning: "Test reasoning explaining why this is an issue.",
    isPreExisting: false,
    ...overrides,
  };
}

function createFileReviewResult(filename: string, findings: FileFinding[] = []): FileReviewResult {
  return { filename, findings };
}

function createCrossFileResult(
  overrides: Partial<CrossFileReviewResult> = {}
): CrossFileReviewResult {
  return {
    overallAssessment: "Test assessment",
    findings: [],
    recommendations: [],
    ...overrides,
  };
}

describe("FindingAggregator", () => {
  describe("aggregateFileFindings", () => {
    it("returns empty array for empty runs", () => {
      const aggregator = new FindingAggregator();

      const result = aggregator.aggregateFileFindings([]);

      expect(result).toEqual([]);
    });

    it("passes through single run unchanged", () => {
      const aggregator = new FindingAggregator();
      const findings = [createFileFinding({ line: 10, message: "Issue 1" })];
      const run = [createFileReviewResult("file.ts", findings)];

      const result = aggregator.aggregateFileFindings([run]);

      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe("file.ts");
      expect(result[0].findings).toHaveLength(1);
    });

    it("deduplicates exact duplicate findings across runs", () => {
      const aggregator = new FindingAggregator();
      const finding = createFileFinding({
        line: 10,
        category: "bug",
        message: "Same exact issue",
      });

      const run1 = [createFileReviewResult("file.ts", [finding])];
      const run2 = [createFileReviewResult("file.ts", [finding])];

      const result = aggregator.aggregateFileFindings([run1, run2]);

      expect(result).toHaveLength(1);
      expect(result[0].findings).toHaveLength(1);
    });

    it("preserves unique findings from different runs", () => {
      const aggregator = new FindingAggregator();
      const finding1 = createFileFinding({ line: 10, message: "Issue one" });
      const finding2 = createFileFinding({ line: 20, message: "Issue two" });

      const run1 = [createFileReviewResult("file.ts", [finding1])];
      const run2 = [createFileReviewResult("file.ts", [finding2])];

      const result = aggregator.aggregateFileFindings([run1, run2]);

      expect(result).toHaveLength(1);
      expect(result[0].findings).toHaveLength(2);
    });

    it("preserves findings from different files", () => {
      const aggregator = new FindingAggregator();
      const finding1 = createFileFinding({ line: 10 });
      const finding2 = createFileFinding({ line: 10 });

      const run1 = [createFileReviewResult("file1.ts", [finding1])];
      const run2 = [createFileReviewResult("file2.ts", [finding2])];

      const result = aggregator.aggregateFileFindings([run1, run2]);

      expect(result).toHaveLength(2);
      expect(result.find((r) => r.filename === "file1.ts")).toBeDefined();
      expect(result.find((r) => r.filename === "file2.ts")).toBeDefined();
    });

    it("aggregates findings from three runs", () => {
      const aggregator = new FindingAggregator();
      const finding1 = createFileFinding({ line: 10, message: "Issue A" });
      const finding2 = createFileFinding({ line: 20, message: "Issue B" });
      const finding3 = createFileFinding({ line: 30, message: "Issue C" });

      const run1 = [createFileReviewResult("file.ts", [finding1])];
      const run2 = [createFileReviewResult("file.ts", [finding2])];
      const run3 = [createFileReviewResult("file.ts", [finding1, finding3])];

      const result = aggregator.aggregateFileFindings([run1, run2, run3]);

      expect(result[0].findings).toHaveLength(3);
    });

    it("handles empty findings arrays", () => {
      const aggregator = new FindingAggregator();
      const run1 = [createFileReviewResult("file.ts", [])];
      const run2 = [createFileReviewResult("file.ts", [createFileFinding()])];

      const result = aggregator.aggregateFileFindings([run1, run2]);

      expect(result[0].findings).toHaveLength(1);
    });

    it("differentiates findings by category at same line", () => {
      const aggregator = new FindingAggregator();
      const bugFinding = createFileFinding({
        line: 10,
        category: "bug",
        message: "Same message",
      });
      const securityFinding = createFileFinding({
        line: 10,
        category: "security",
        message: "Same message",
      });

      const run = [createFileReviewResult("file.ts", [bugFinding, securityFinding])];

      const result = aggregator.aggregateFileFindings([run]);

      expect(result[0].findings).toHaveLength(2);
    });
  });

  describe("aggregateCrossFileFindings", () => {
    it("returns default result for empty runs", () => {
      const aggregator = new FindingAggregator();

      const result = aggregator.aggregateCrossFileFindings([]);

      expect(result.overallAssessment).toBe("No review data available");
      expect(result.findings).toEqual([]);
      expect(result.recommendations).toEqual([]);
    });

    it("passes through single run unchanged", () => {
      const aggregator = new FindingAggregator();
      const run = createCrossFileResult({
        overallAssessment: "Single assessment",
        recommendations: ["Do this"],
      });

      const result = aggregator.aggregateCrossFileFindings([run]);

      expect(result.overallAssessment).toBe("Single assessment");
      expect(result.recommendations).toEqual(["Do this"]);
    });

    it("uses longest overall assessment", () => {
      const aggregator = new FindingAggregator();
      const run1 = createCrossFileResult({ overallAssessment: "Short" });
      const run2 = createCrossFileResult({
        overallAssessment: "This is a much longer and more detailed assessment",
      });

      const result = aggregator.aggregateCrossFileFindings([run1, run2]);

      expect(result.overallAssessment).toBe("This is a much longer and more detailed assessment");
    });

    it("deduplicates cross-file findings", () => {
      const aggregator = new FindingAggregator();
      const finding: CrossFileFinding = {
        severity: "high",
        confidence: "high",
        category: "architecture",
        message: "Circular dependency detected",
        reasoning: "Module A imports B which imports A.",
        affectedFiles: ["a.ts", "b.ts"],
      };

      const run1 = createCrossFileResult({ findings: [finding] });
      const run2 = createCrossFileResult({ findings: [finding] });

      const result = aggregator.aggregateCrossFileFindings([run1, run2]);

      expect(result.findings).toHaveLength(1);
    });

    it("preserves unique cross-file findings", () => {
      const aggregator = new FindingAggregator();
      const finding1: CrossFileFinding = {
        severity: "high",
        confidence: "high",
        category: "architecture",
        message: "Issue one",
        reasoning: "Reasoning for issue one.",
        affectedFiles: ["a.ts"],
      };
      const finding2: CrossFileFinding = {
        severity: "medium",
        confidence: "medium",
        category: "design",
        message: "Issue two",
        reasoning: "Reasoning for issue two.",
        affectedFiles: ["b.ts"],
      };

      const run1 = createCrossFileResult({ findings: [finding1] });
      const run2 = createCrossFileResult({ findings: [finding2] });

      const result = aggregator.aggregateCrossFileFindings([run1, run2]);

      expect(result.findings).toHaveLength(2);
    });

    it("deduplicates recommendations", () => {
      const aggregator = new FindingAggregator();
      const run1 = createCrossFileResult({
        recommendations: ["Add tests", "Improve docs"],
      });
      const run2 = createCrossFileResult({
        recommendations: ["Add tests", "Refactor module"],
      });

      const result = aggregator.aggregateCrossFileFindings([run1, run2]);

      expect(result.recommendations).toHaveLength(3);
      expect(result.recommendations).toContain("Add tests");
      expect(result.recommendations).toContain("Improve docs");
      expect(result.recommendations).toContain("Refactor module");
    });

    it("handles findings with different affected files order", () => {
      const aggregator = new FindingAggregator();
      const finding1: CrossFileFinding = {
        severity: "high",
        confidence: "high",
        category: "architecture",
        message: "Same issue",
        reasoning: "Reasoning for the same issue.",
        affectedFiles: ["a.ts", "b.ts"],
      };
      const finding2: CrossFileFinding = {
        severity: "high",
        confidence: "high",
        category: "architecture",
        message: "Same issue",
        reasoning: "Reasoning for the same issue.",
        affectedFiles: ["b.ts", "a.ts"],
      };

      const run1 = createCrossFileResult({ findings: [finding1] });
      const run2 = createCrossFileResult({ findings: [finding2] });

      const result = aggregator.aggregateCrossFileFindings([run1, run2]);

      // Should be deduplicated regardless of file order
      expect(result.findings).toHaveLength(1);
    });
  });
});
