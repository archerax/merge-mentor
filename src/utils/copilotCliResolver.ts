import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSystemExecutableFinder, type ExecutableFinder } from "../ports/executableFinder.js";
import { processEnvironment } from "../ports/index.js";

/**
 * Gets the list of potential platform-specific package names for the Copilot CLI.
 */
export function getCliPlatformPackageNames(): string[] {
  const arch = process.arch;
  const variants = process.platform === "linux" ? ["linux", "linuxmusl"] : [process.platform];
  return variants.map((variant) => `@github/copilot-${variant}-${arch}`);
}

/**
 * Dynamically resolves the path to the installed Copilot CLI executable (index.js or binary).
 * Resolution order:
 * 1. COPILOT_CLI_PATH environment variable (if set and file exists)
 * 2. Local node_modules @github/copilot platform packages (if installed)
 * 3. System PATH lookup for global copilot executable
 *
 * Returns undefined if it cannot be resolved.
 */
export function resolveCopilotCliPath(
  executableFinder: ExecutableFinder = createSystemExecutableFinder()
): string | undefined {
  const envPath = processEnvironment.get("COPILOT_CLI_PATH");
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

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

  const globalPath = executableFinder.find("copilot");
  if (globalPath) {
    return globalPath;
  }

  return undefined;
}
