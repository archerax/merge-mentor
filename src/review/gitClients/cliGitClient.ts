/**
 * CLI git client — delegates git operations to the system `git` binary.
 *
 * This is the default `GitClient` adapter. It reproduces exactly the behaviour
 * that `RepoManager` previously embedded directly: credentials are passed via
 * `-c http.<host>/.extraHeader=Authorization: Basic <encoded>` so that tokens
 * are never written to `.git/config` or embedded in remote URLs.
 *
 * Shell injection is prevented because all arguments are passed as an explicit
 * array through `ProcessRunner.execFile` (not via a shell string).
 */

import { nodeProcessRunner, type ProcessRunner } from "../../ports/index.js";
import type { GitAuth, GitClient, GitCloneOptions } from "../gitClient.js";

/** Default timeout used when no external timeout mechanism is provided (ms). */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Git client backed by the system `git` binary.
 *
 * @example
 * ```typescript
 * const client = new CliGitClient();
 * await client.clone('https://github.com/org/repo.git', '/tmp/repo', auth, { branch: 'main' });
 * ```
 */
export class CliGitClient implements GitClient {
  constructor(
    private readonly runner: ProcessRunner = nodeProcessRunner,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {}

  async clone(
    url: string,
    targetPath: string,
    auth: GitAuth,
    opts: GitCloneOptions
  ): Promise<void> {
    const authArgs = buildAuthArgs(auth);
    const env = buildGitEnv(auth);
    await this.execFile(
      [
        ...authArgs,
        "clone",
        "--depth",
        String(opts.depth ?? 1),
        "--single-branch",
        "--branch",
        opts.branch,
        url,
        targetPath,
      ],
      this.timeoutMs,
      env
    );
  }

  async fetch(repoPath: string, branch: string, auth: GitAuth, depth = 1): Promise<void> {
    const authArgs = buildAuthArgs(auth);
    const env = buildGitEnv(auth);
    await this.execFile(
      [...authArgs, "-C", repoPath, "fetch", "--depth", String(depth), "origin", branch],
      this.timeoutMs,
      env
    );
  }

  async checkout(repoPath: string, branch: string): Promise<void> {
    await this.execFile(
      ["-C", repoPath, "checkout", "-B", branch, `origin/${branch}`],
      this.timeoutMs
    );
  }

  async clean(repoPath: string): Promise<void> {
    await this.execFile(["-C", repoPath, "clean", "-fdx"], this.timeoutMs);
  }

  async setRemoteUrl(repoPath: string, remoteUrl: string): Promise<void> {
    await this.execFile(["-C", repoPath, "remote", "set-url", "origin", remoteUrl], this.timeoutMs);
  }

  private async execFile(
    args: string[],
    timeoutMs: number,
    env?: Record<string, string>
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let execEnv: Record<string, string> | undefined;
      if (env) {
        execEnv = {};
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined) {
            execEnv[key] = value;
          }
        }
        Object.assign(execEnv, env);
      }

      const result = await this.runner.execFile("git", args, {
        signal: controller.signal,
        maxBuffer: 50 * 1024 * 1024, // 50 MB
        env: execEnv,
      });
      return result.stdout;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new Error(`git command timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Builds `git -c` arguments that inject credentials as an HTTP Authorization
 * header for the duration of this command only.
 *
 * The header is scoped to the specific host so it cannot leak to unrelated
 * remotes. Nothing is written to `.git/config` or any file on disk.
 *
 * GitHub  → `x-access-token:<token>` (standard PAT / OAuth format)
 * Azure   → `:<token>`               (empty username + PAT, per Microsoft docs)
 * CI mode → no args (environment supplies credentials)
 */
export function buildAuthArgs(auth: GitAuth): string[] {
  if (auth.type === "ci") {
    return [];
  }

  const host = auth.platform === "azure" ? "https://dev.azure.com" : "https://github.com";
  const credentials = auth.platform === "azure" ? `:${auth.token}` : `x-access-token:${auth.token}`;
  const encoded = Buffer.from(credentials).toString("base64");

  return ["-c", `http.${host}/.extraHeader=Authorization: Basic ${encoded}`];
}

/**
 * Builds environment variables for git commands.
 *
 * Sets `GIT_TERMINAL_PROMPT=0` to prevent git from falling back to interactive
 * credential prompts — authentication is handled via `buildAuthArgs` instead.
 * In CI mode no overrides are needed.
 */
export function buildGitEnv(auth: GitAuth): Record<string, string> {
  if (auth.type === "ci") {
    return {};
  }
  return { GIT_TERMINAL_PROMPT: "0" };
}
