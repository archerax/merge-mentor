import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processEnvironment } from "../ports/index.js";
import { getCliPlatformPackageNames, resolveCopilotCliPath } from "./copilotCliResolver.js";

describe("copilotCliResolver", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("getCliPlatformPackageNames", () => {
    it("returns platform package names containing process arch", () => {
      const packageNames = getCliPlatformPackageNames();
      expect(packageNames.length).toBeGreaterThan(0);
      for (const name of packageNames) {
        expect(name).toContain(process.arch);
        expect(name).toContain("@github/copilot-");
      }
    });

    it("returns appropriate packages for linux platform", () => {
      if (process.platform === "linux") {
        const packageNames = getCliPlatformPackageNames();
        expect(packageNames).toContain(`@github/copilot-linux-${process.arch}`);
        expect(packageNames).toContain(`@github/copilot-linuxmusl-${process.arch}`);
      }
    });
  });

  describe("resolveCopilotCliPath", () => {
    it("prioritizes COPILOT_CLI_PATH environment variable if file exists", () => {
      const envSpy = vi.spyOn(processEnvironment, "get").mockImplementation((key) => {
        if (key === "COPILOT_CLI_PATH") return "/custom/copilot-cli.js";
        return undefined;
      });
      const existsSpy = vi
        .spyOn(fs, "existsSync")
        .mockImplementation((p) => p === "/custom/copilot-cli.js");

      const resolvedPath = resolveCopilotCliPath();
      expect(resolvedPath).toBe("/custom/copilot-cli.js");

      envSpy.mockRestore();
      existsSpy.mockRestore();
    });

    it("resolves via ExecutableFinder when COPILOT_CLI_PATH and local packages are unavailable", () => {
      const envSpy = vi.spyOn(processEnvironment, "get").mockReturnValue(undefined);
      const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const mockFinder = { find: vi.fn().mockReturnValue("/usr/local/bin/copilot") };

      const resolvedPath = resolveCopilotCliPath(mockFinder);
      expect(resolvedPath).toBe("/usr/local/bin/copilot");
      expect(mockFinder.find).toHaveBeenCalledWith("copilot");

      envSpy.mockRestore();
      existsSpy.mockRestore();
    });

    it("returns undefined when file does not exist and executable is not found in PATH", () => {
      const envSpy = vi.spyOn(processEnvironment, "get").mockReturnValue(undefined);
      const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
      const mockFinder = { find: vi.fn().mockReturnValue(undefined) };

      const resolvedPath = resolveCopilotCliPath(mockFinder);

      expect(resolvedPath).toBeUndefined();

      envSpy.mockRestore();
      existsSpy.mockRestore();
    });
  });
});
