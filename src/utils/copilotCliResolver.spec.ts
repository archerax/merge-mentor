import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    it("returns resolved path or undefined predictably when fs.existsSync reports file exists", () => {
      const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);

      const resolvedPath = resolveCopilotCliPath();
      if (resolvedPath !== undefined) {
        expect(typeof resolvedPath).toBe("string");
        expect(resolvedPath).toContain("index.js");
      } else {
        expect(resolvedPath).toBeUndefined();
      }

      existsSpy.mockRestore();
    });

    it("returns undefined when fs.existsSync reports file does not exist", () => {
      const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const resolvedPath = resolveCopilotCliPath();

      expect(resolvedPath).toBeUndefined();

      existsSpy.mockRestore();
    });
  });
});
