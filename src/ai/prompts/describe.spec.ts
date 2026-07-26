import { describe, expect, it } from "vitest";
import { buildDescribePrompt, buildSuggestTitlePrompt } from "./describe.js";

describe("describe prompts", () => {
  describe("buildDescribePrompt", () => {
    it("wraps diff content in untrusted section and includes output guidelines", () => {
      const diff = "diff --git a/index.ts b/index.ts\n+console.log('hello');";
      const prompt = buildDescribePrompt(diff);

      expect(prompt).toContain("You are an expert technical writer and AI coding assistant.");
      expect(prompt).toContain("<untrusted-pr-diff>");
      expect(prompt).toContain("</untrusted-pr-diff>");
      expect(prompt).toContain(diff);
      expect(prompt).toContain("## 🔍 Summary");
      expect(prompt).toContain("## 🛠️ Key Changes");
      expect(prompt).toContain("## ⚠️ Breaking Changes & Configs");
      expect(prompt).toContain("## 🏷️ Suggested Labels");
    });
  });

  describe("buildSuggestTitlePrompt", () => {
    it("formats prompt for Conventional Commits PR title suggestion", () => {
      const diff = "diff --git a/fix.ts b/fix.ts\n- oldCode()\n+ newCode()";
      const prompt = buildSuggestTitlePrompt(diff);

      expect(prompt).toContain("Suggest a concise title for this pull request");
      expect(prompt).toContain("Conventional Commits / Semantic Release format");
      expect(prompt).toContain("<untrusted-pr-diff>");
      expect(prompt).toContain("</untrusted-pr-diff>");
      expect(prompt).toContain(diff);
      expect(prompt).toContain("Keep the title under 72 characters.");
    });
  });
});
