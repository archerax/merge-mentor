import { describe, expect, it } from "vitest";
import { parsePRUrl } from "./prUrl.js";

describe("parsePRUrl", () => {
  describe("GitHub URLs", () => {
    it("parses a standard GitHub PR URL", () => {
      const result = parsePRUrl("https://github.com/myorg/myrepo/pull/42");
      expect(result).toEqual({
        platform: "github",
        prNumber: 42,
        owner: "myorg",
        repo: "myrepo",
      });
    });

    it("parses a GitHub PR URL with trailing slash", () => {
      const result = parsePRUrl("https://github.com/myorg/myrepo/pull/42/");
      expect(result).toEqual({
        platform: "github",
        prNumber: 42,
        owner: "myorg",
        repo: "myrepo",
      });
    });

    it("parses GitHub URL with www prefix", () => {
      const result = parsePRUrl("https://www.github.com/myorg/myrepo/pull/42");
      expect(result.platform).toBe("github");
      expect(result.prNumber).toBe(42);
    });

    it("parses large PR numbers", () => {
      const result = parsePRUrl("https://github.com/myorg/myrepo/pull/999999");
      expect(result.prNumber).toBe(999999);
    });

    it("throws on GitHub URL without /pull/ segment", () => {
      expect(() => parsePRUrl("https://github.com/myorg/myrepo/issues/42")).toThrow(
        "Invalid GitHub PR URL"
      );
    });

    it("throws on GitHub URL with missing components", () => {
      expect(() => parsePRUrl("https://github.com/myorg/pull/42")).toThrow("Invalid GitHub PR URL");
    });

    it("throws on GitHub URL with non-numeric PR", () => {
      expect(() => parsePRUrl("https://github.com/myorg/myrepo/pull/abc")).toThrow(
        "Invalid GitHub PR URL"
      );
    });
  });

  describe("Azure DevOps modern URLs", () => {
    it("parses a standard Azure DevOps PR URL", () => {
      const result = parsePRUrl(
        "https://dev.azure.com/archerax/CodeReviewTest/_git/CodeReviewTest/pullrequest/40"
      );
      expect(result).toEqual({
        platform: "azure",
        prNumber: 40,
        org: "archerax",
        project: "CodeReviewTest",
        azureRepo: "CodeReviewTest",
      });
    });

    it("parses Azure DevOps URL with trailing slash", () => {
      const result = parsePRUrl(
        "https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/123/"
      );
      expect(result).toEqual({
        platform: "azure",
        prNumber: 123,
        org: "myorg",
        project: "myproject",
        azureRepo: "myrepo",
      });
    });

    it("parses Azure DevOps URL with project containing hyphens", () => {
      const result = parsePRUrl(
        "https://dev.azure.com/my-org/my-project/_git/my-repo/pullrequest/50"
      );
      expect(result).toEqual({
        platform: "azure",
        prNumber: 50,
        org: "my-org",
        project: "my-project",
        azureRepo: "my-repo",
      });
    });

    it("parses Azure DevOps URL with project containing dots", () => {
      const result = parsePRUrl(
        "https://dev.azure.com/contoso/Tools.Finance/_git/backend/pullrequest/77"
      );
      expect(result).toEqual({
        platform: "azure",
        prNumber: 77,
        org: "contoso",
        project: "Tools.Finance",
        azureRepo: "backend",
      });
    });

    it("parses large PR numbers in Azure DevOps", () => {
      const result = parsePRUrl("https://dev.azure.com/org/proj/_git/repo/pullrequest/999999");
      expect(result.prNumber).toBe(999999);
    });

    it("throws on Azure DevOps URL with wrong path format", () => {
      expect(() => parsePRUrl("https://dev.azure.com/org/proj/repo/pullrequest/40")).toThrow(
        "Invalid Azure DevOps PR URL"
      );
    });

    it("throws on Azure DevOps URL without pullrequest segment", () => {
      expect(() => parsePRUrl("https://dev.azure.com/org/proj/_git/repo/commit/abc123")).toThrow(
        "Invalid Azure DevOps PR URL"
      );
    });

    it("throws on Azure DevOps URL with non-numeric PR", () => {
      expect(() => parsePRUrl("https://dev.azure.com/org/proj/_git/repo/pullrequest/abc")).toThrow(
        "Invalid Azure DevOps PR URL"
      );
    });
  });

  describe("Azure DevOps legacy URLs", () => {
    it("parses a legacy visualstudio.com URL", () => {
      const result = parsePRUrl(
        "https://myorg.visualstudio.com/myproject/_git/myrepo/pullrequest/15"
      );
      expect(result).toEqual({
        platform: "azure",
        prNumber: 15,
        org: "myorg",
        project: "myproject",
        azureRepo: "myrepo",
      });
    });

    it("parses legacy URL with trailing slash", () => {
      const result = parsePRUrl(
        "https://myorg.visualstudio.com/myproject/_git/myrepo/pullrequest/15/"
      );
      expect(result.prNumber).toBe(15);
    });

    it("throws on legacy URL with wrong format", () => {
      expect(() =>
        parsePRUrl("https://myorg.visualstudio.com/myproject/repo/pullrequest/15")
      ).toThrow("Invalid Azure DevOps PR URL");
    });
  });

  describe("error cases", () => {
    it("throws for empty string", () => {
      expect(() => parsePRUrl("")).toThrow("URL is empty");
    });

    it("throws for whitespace-only string", () => {
      expect(() => parsePRUrl("   ")).toThrow("URL is empty");
    });

    it("throws for an obviously invalid URL", () => {
      expect(() => parsePRUrl("not-a-url")).toThrow("is not a valid URL");
    });

    it("throws for unrecognized hostname", () => {
      expect(() => parsePRUrl("https://gitlab.com/org/repo/merge_requests/42")).toThrow(
        "Unrecognized PR URL"
      );
    });

    it("throws for FTP URL", () => {
      expect(() => parsePRUrl("ftp://github.com/org/repo/pull/42")).toThrow(
        "only HTTPS URLs are supported"
      );
    });

    it("throws for HTTP URL", () => {
      expect(() => parsePRUrl("http://github.com/org/repo/pull/42")).toThrow(
        "only HTTPS URLs are supported"
      );
    });

    it("includes help text in error messages", () => {
      try {
        parsePRUrl("");
      } catch (error) {
        const msg = (error as Error).message;
        expect(msg).toContain("Expected format");
        expect(msg).toContain("github.com");
        expect(msg).toContain("dev.azure.com");
      }

      try {
        parsePRUrl("https://gitlab.com/org/repo/merge_requests/42");
      } catch (error) {
        const msg = (error as Error).message;
        expect(msg).toContain("Supported platforms");
        expect(msg).toContain("github.com");
        expect(msg).toContain("dev.azure.com");
      }
    });
  });
});
