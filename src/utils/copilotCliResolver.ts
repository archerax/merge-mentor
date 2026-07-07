import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Gets the list of potential platform-specific package names for the Copilot CLI.
 */
export function getCliPlatformPackageNames(): string[] {
  const arch = process.arch;
  const variants = process.platform === "linux" ? ["linux", "linuxmusl"] : [process.platform];
  return variants.map((variant) => `@github/copilot-${variant}-${arch}`);
}

/**
 * Dynamically resolves the path to the installed Copilot CLI executable (index.js).
 * Returns undefined if it cannot be resolved.
 */
export function resolveCopilotCliPath(): string | undefined {
  const packageNames = getCliPlatformPackageNames();
  if (typeof import.meta.resolve === "function") {
    for (const packageName of packageNames) {
      try {
        const sdkUrl = import.meta.resolve(`${packageName}/sdk`);
        const sdkPath = fileURLToPath(sdkUrl);
        const resolvedPath = path.join(path.dirname(path.dirname(sdkPath)), "index.js");
        if (fs.existsSync(resolvedPath)) {
          return resolvedPath;
        }
      } catch {
        // Continue searching other platform variants
      }
    }
  }
  return undefined;
}
