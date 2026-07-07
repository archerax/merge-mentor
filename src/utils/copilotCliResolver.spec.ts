import { describe, expect, it } from "vitest";
import { getCliPlatformPackageNames, resolveCopilotCliPath } from "./copilotCliResolver.js";

describe("copilotCliResolver", () => {
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
    it("runs without throwing and returns a string path or undefined", () => {
      expect(() => {
        const resolvedPath = resolveCopilotCliPath();
        if (resolvedPath !== undefined) {
          expect(typeof resolvedPath).toBe("string");
        }
      }).not.toThrow();
    });
  });
});
