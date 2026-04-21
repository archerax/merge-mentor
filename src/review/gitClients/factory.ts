/**
 * Factory for creating `GitClient` instances by backend type.
 *
 * @module
 */

import { nodeProcessRunner, type ProcessRunner } from "../../ports/index.js";
import type { GitBackendType, GitClient } from "../gitClient.js";
import { CliGitClient } from "./cliGitClient.js";
import { IsomorphicGitClient } from "./isomorphicGitClient.js";

/**
 * Creates a `GitClient` for the requested backend.
 *
 * @param backend - Which implementation to use (`'cli'` | `'isomorphic'`).
 * @param runner  - Process runner injected into `CliGitClient` (ignored for
 *                  the isomorphic backend). Defaults to `nodeProcessRunner`.
 * @returns A concrete `GitClient` implementation.
 */
export function createGitClient(
  backend: GitBackendType,
  runner: ProcessRunner = nodeProcessRunner
): GitClient {
  if (backend === "isomorphic") {
    return new IsomorphicGitClient();
  }
  return new CliGitClient(runner);
}
