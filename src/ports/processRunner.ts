import {
  type ChildProcess,
  exec as execCallback,
  execFile as execFileCallback,
  execSync as nodeExecSync,
  spawn as nodeSpawn,
  type SpawnOptions,
} from "node:child_process";
import { promisify } from "node:util";

const execPromise = promisify(execCallback);
const execFilePromise = promisify(execFileCallback);

/** Result from executing a command. */
export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
}

/** Options shared by exec-style process runners. */
interface ExecOptions {
  signal?: AbortSignal;
  maxBuffer?: number;
  encoding?: BufferEncoding;
  timeout?: number;
}

/** Abstraction over child process execution for testability. */
export interface ProcessRunner {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  /**
   * Executes a file with an explicit argument array, bypassing the shell.
   * Prefer this over `exec` whenever arguments include user-supplied values
   * to prevent command injection.
   */
  execFile(file: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
  execSync(
    command: string,
    options?: {
      encoding: BufferEncoding;
      stdio?: import("node:child_process").StdioOptions;
      timeout?: number;
    }
  ): string;
  spawn(command: string, args: string[], options?: SpawnOptions): ChildProcess;
}

/** Production implementation using Node.js child_process. */
export const nodeProcessRunner: ProcessRunner = {
  exec: async (command, options) => {
    const result = await execPromise(command, { ...options, encoding: "utf-8" });
    return { stdout: result.stdout, stderr: result.stderr };
  },
  execFile: async (file, args, options) => {
    const result = await execFilePromise(file, args, { ...options, encoding: "utf-8" });
    return { stdout: result.stdout as string, stderr: result.stderr as string };
  },
  execSync: (command, options) => nodeExecSync(command, options) as string,
  spawn: (command, args, options = {}) => nodeSpawn(command, args, options),
};
