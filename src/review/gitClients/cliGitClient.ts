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

import path from "node:path";
import {
  type FileSystem,
  nodeFs,
  nodeProcessRunner,
  type ProcessRunner,
} from "../../ports/index.js";
import type { GitAuth, GitClient, GitCloneOptions, GitFileChange } from "../gitClient.js";
import {
  buildAddedFilePatch,
  countPatchStats,
  extractNewPath,
  extractNewSha,
  hasContentHunks,
  isBinaryContent,
  splitGitDiff,
} from "../localDiff.js";

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
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly fileSystem: FileSystem = nodeFs
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
      [
        ...authArgs,
        "-C",
        repoPath,
        "fetch",
        "--depth",
        String(depth),
        "origin",
        `+${branch}:refs/remotes/origin/${branch}`,
      ],
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

  async currentBranch(repoPath: string): Promise<string> {
    const out = await this.execFile(
      ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"],
      this.timeoutMs
    );
    const branch = out.trim();
    return branch === "HEAD" ? "HEAD" : branch;
  }

  async getRemoteUrl(repoPath: string): Promise<string | undefined> {
    try {
      const out = await this.execFile(
        ["-C", repoPath, "remote", "get-url", "origin"],
        this.timeoutMs
      );
      const url = out.trim();
      return url.length > 0 ? url : undefined;
    } catch {
      return undefined;
    }
  }

  async workingTreeDiff(repoPath: string, baseRef = "HEAD"): Promise<GitFileChange[]> {
    const tracked = await this.runDiff(repoPath, [baseRef]);
    const untracked = await this.collectUntracked(repoPath);
    return [...tracked, ...untracked];
  }

  async stagedDiff(repoPath: string, baseRef = "HEAD"): Promise<GitFileChange[]> {
    return this.runDiff(repoPath, ["--cached", baseRef]);
  }

  async diff(repoPath: string, baseRef: string, headRef: string): Promise<GitFileChange[]> {
    return this.runDiff(repoPath, [baseRef, headRef]);
  }

  /**
   * Produces file changes from a single `git diff` invocation.
   *
   * `commits` holds the mode-specific trailing arguments, e.g. `[base]` for the
   * working tree, `["--cached", base]` for the index, or `[base, head]` for a
   * ref pair.
   */
  private async runDiff(repoPath: string, commits: readonly string[]): Promise<GitFileChange[]> {
    const nameStatus = await this.execFile(
      ["-C", repoPath, "diff", ...commits, "-M", "--name-status"],
      this.timeoutMs
    );
    const fullDiff = await this.execFile(
      ["-C", repoPath, "diff", ...commits, "-M"],
      this.timeoutMs
    );

    const chunks = splitGitDiff(fullDiff);
    const chunkByPath = new Map<string, (typeof chunks)[number]>();
    for (const chunk of chunks) {
      const newPath = extractNewPath(chunk);
      if (newPath && newPath !== "/dev/null") {
        chunkByPath.set(newPath, chunk);
      }
    }

    const changes: GitFileChange[] = [];
    for (const line of nameStatus.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const [rawStatus, first, second] = trimmed.split("\t");
      const status = rawStatus.charAt(0);

      let filePath = first;
      let fileStatus: GitFileChange["status"];
      if (status === "R" || status === "C") {
        filePath = second ?? first;
        fileStatus = "renamed";
      } else if (status === "A") {
        fileStatus = "added";
      } else if (status === "D") {
        fileStatus = "deleted";
      } else if (status === "T") {
        fileStatus = "modified";
      } else {
        fileStatus = "modified";
      }

      const chunk = chunkByPath.get(filePath);
      const hasPatch = chunk !== undefined && hasContentHunks(chunk);
      const { additions, deletions } = chunk
        ? countPatchStats(chunk)
        : { additions: 0, deletions: 0 };

      changes.push({
        path: filePath,
        status: fileStatus,
        additions,
        deletions,
        patch: hasPatch ? chunk.patch : undefined,
        sha: fileStatus === "deleted" ? undefined : chunk ? extractNewSha(chunk) : undefined,
      });
    }

    return changes;
  }

  /**
   * Collects untracked (non-ignored) files as `added` changes, which `git diff`
   * does not include.
   */
  private async collectUntracked(repoPath: string): Promise<GitFileChange[]> {
    const output = await this.execFile(
      ["-C", repoPath, "ls-files", "--others", "--exclude-standard"],
      this.timeoutMs
    );

    const changes: GitFileChange[] = [];
    for (const filePath of output.split("\n")) {
      const trimmed = filePath.trim();
      if (!trimmed) continue;

      const fullPath = path.join(repoPath, trimmed);
      let content: string;
      try {
        content = await this.fileSystem.readFile(fullPath, "utf-8");
      } catch {
        continue;
      }
      if (isBinaryContent(content)) continue;

      const sha = await this.execFile(["-C", repoPath, "hash-object", trimmed], this.timeoutMs);
      const blobSha = sha.trim();
      const patch = buildAddedFilePatch(trimmed, content, blobSha);
      const count = content.split("\n").filter((line) => line.length > 0).length;

      changes.push({
        path: trimmed,
        status: "added",
        additions: count,
        deletions: 0,
        patch,
        sha: blobSha,
      });
    }

    return changes;
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
