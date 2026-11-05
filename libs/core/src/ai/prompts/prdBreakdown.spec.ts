import { describe, expect, it } from "vitest";

import { buildPrdBreakdownExtractPrompt, buildPrdBreakdownOrganizePrompt } from "./prdBreakdown.js";
import { buildSecurityPreamble } from "./securityPreamble.js";

describe("PRD breakdown prompts", () => {
  describe("buildPrdBreakdownExtractPrompt", () => {
    const base = {
      documentType: "prd" as const,
      documentTitle: "Checkout redesign",
      chunkText: "## Goals [s1]\n\n[p2] Guests can pay without an account.",
      sectionIds: ["s1", "s1.1"],
      chunkIndex: 2,
      chunkCount: 3,
    };

    it("starts with the security preamble and wraps the document as untrusted", () => {
      const prompt = buildPrdBreakdownExtractPrompt(base);
      expect(prompt.startsWith(buildSecurityPreamble())).toBe(true);
      expect(prompt).toContain(
        "<untrusted-document>\nDocument title: Checkout redesign\n\n## Goals [s1]\n\n[p2] Guests can pay without an account.\n</untrusted-document>"
      );
      expect(prompt).toContain("portion 2 of 3");
      expect(prompt).toContain('must be one of: "s1", "s1.1"');
    });

    it("explains epics, features and PBIs and forbids inventing requirements", () => {
      const prompt = buildPrdBreakdownExtractPrompt(base);
      expect(prompt).toContain("**Epic**");
      expect(prompt).toContain("**Feature**");
      expect(prompt).toContain("**PBI**");
      expect(prompt).toContain("Do not invent requirements");
      expect(prompt).toContain("out of scope");
      expect(prompt).toContain("copied **exactly**");
    });

    it("names the document type and mentions a split section", () => {
      const frd = buildPrdBreakdownExtractPrompt({
        ...base,
        documentType: "frd",
        part: { index: 1, total: 2 },
      });
      expect(frd).toContain("Functional Requirements Document");
      expect(frd).toContain("part 1 of 2 of a long section");
    });
  });

  describe("buildPrdBreakdownOrganizePrompt", () => {
    const base = {
      documentType: "prd" as const,
      documentTitle: "Checkout redesign",
      outline: ["s1: Goals", "s2: Scope"],
      epics: [
        {
          id: "E1",
          title: "Guest checkout",
          goal: "Pay without an account.",
          features: [
            {
              id: "F1",
              title: "Guest form",
              description: "Collects details.",
              pbis: [
                {
                  id: "P1",
                  title: "Guest can enter an address",
                  description: "As a guest I want to give an address.",
                  sectionId: "s1",
                },
                {
                  id: "P2",
                  title: "Guest can pay",
                  description: "x ".repeat(200),
                  sectionId: "s1",
                },
              ],
            },
            { id: "F2", title: "Empty feature", description: "", pbis: [] },
          ],
        },
      ],
    };

    it("lists every proposed item with its id inside the untrusted wrapper", () => {
      const prompt = buildPrdBreakdownOrganizePrompt(base);
      expect(prompt.startsWith(buildSecurityPreamble())).toBe(true);
      expect(prompt).toContain("<untrusted-work-items>");
      expect(prompt).toContain("- E1: Guest checkout - Pay without an account.");
      expect(prompt).toContain("    - F1: Guest form - Collects details.");
      expect(prompt).toContain(
        "      - P1: Guest can enter an address [s1] - As a guest I want to give an address."
      );
      // Long descriptions are cut so the listing stays small.
      expect(prompt).toMatch(/- P2: Guest can pay \[s1\] - (?:x ){70,}x…\n/);
      expect(prompt).toContain("- (no items)");
      expect(prompt).toContain("- s1: Goals");
    });

    it("asks for merging, a dependency-first delivery order and earlier-only dependencies", () => {
      const prompt = buildPrdBreakdownOrganizePrompt(base);
      expect(prompt).toContain("Merge duplicates");
      expect(prompt).toContain("Do not merge or drop PBIs");
      expect(prompt).not.toContain("keep only one");
      expect(prompt).toContain("Dependencies first");
      expect(prompt).toContain("exactly one feature's `pbiIds`");
      expect(prompt).toContain("**earlier** in your order");
    });

    it("copes with nothing having been proposed", () => {
      const prompt = buildPrdBreakdownOrganizePrompt({ ...base, outline: [], epics: [] });
      expect(prompt).toContain("- (no headings)");
      expect(prompt).toContain("- (none)");
    });
  });
});
