import { execSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { detectGitRemoteUrl, parseGitRemoteUrl } from "./gitRemote.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("parseGitRemoteUrl", () => {
  describe("GitHub", () => {
    it("should parse GitHub HTTPS URLs", () => {
      expect(parseGitRemoteUrl("https://github.com/owner/repo.git")).toEqual({
        platform: "github",
        owner: "owner",
        repo: "repo",
      });

      expect(parseGitRemoteUrl("https://www.github.com/owner/repo")).toEqual({
        platform: "github",
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse GitHub SSH URLs", () => {
      expect(parseGitRemoteUrl("git@github.com:owner/repo.git")).toEqual({
        platform: "github",
        owner: "owner",
        repo: "repo",
      });

      expect(parseGitRemoteUrl("github.com:owner/repo")).toEqual({
        platform: "github",
        owner: "owner",
        repo: "repo",
      });
    });
  });

  describe("Azure DevOps", () => {
    it("should parse Azure DevOps HTTPS URLs", () => {
      expect(parseGitRemoteUrl("https://dev.azure.com/org/project/_git/repo")).toEqual({
        platform: "azure",
        org: "org",
        project: "project",
        repo: "repo",
      });

      expect(parseGitRemoteUrl("https://dev.azure.com/org/project/_git/repo.git")).toEqual({
        platform: "azure",
        org: "org",
        project: "project",
        repo: "repo",
      });
    });

    it("should parse Azure DevOps legacy HTTPS URLs", () => {
      expect(parseGitRemoteUrl("https://org.visualstudio.com/project/_git/repo")).toEqual({
        platform: "azure",
        org: "org",
        project: "project",
        repo: "repo",
      });
    });

    it("should parse Azure DevOps SSH URLs", () => {
      expect(parseGitRemoteUrl("git@ssh.dev.azure.com:v3/org/project/repo")).toEqual({
        platform: "azure",
        org: "org",
        project: "project",
        repo: "repo",
      });

      expect(parseGitRemoteUrl("ssh.dev.azure.com:v3/org/project/repo.git")).toEqual({
        platform: "azure",
        org: "org",
        project: "project",
        repo: "repo",
      });
    });

    it("should parse Azure DevOps legacy SSH URLs", () => {
      expect(parseGitRemoteUrl("org@vs-ssh.visualstudio.com:v3/org/project/repo")).toEqual({
        platform: "azure",
        org: "org",
        project: "project",
        repo: "repo",
      });
    });
  });

  describe("Invalid/Unknown", () => {
    it("should return null for unrecognized URLs", () => {
      expect(parseGitRemoteUrl("https://gitlab.com/owner/repo.git")).toBeNull();
      expect(parseGitRemoteUrl("")).toBeNull();
      expect(parseGitRemoteUrl("   ")).toBeNull();
    });
  });

  describe("detectGitRemoteUrl", () => {
    it("should return the git remote URL on success", () => {
      vi.mocked(execSync).mockReturnValueOnce("https://github.com/owner/repo.git\n");
      const url = detectGitRemoteUrl();
      expect(url).toBe("https://github.com/owner/repo.git");
      expect(execSync).toHaveBeenCalledWith("git remote get-url origin", expect.any(Object));
    });

    it("should return null when git command fails", () => {
      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error("Git command failed");
      });
      const url = detectGitRemoteUrl();
      expect(url).toBeNull();
    });
  });
});
