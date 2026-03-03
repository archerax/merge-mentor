import {
  type ChildProcess,
  exec as execCallback,
  execSync as nodeExecSync,
  spawn as nodeSpawn,
  type SpawnOptions,
} from "node:child_process";
import { promisify } from "node:util";

const execPromise = promisify(execCallback);

/** Result from executing a command. */
export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
}

/** Abstraction over child process execution for testability. */
export interface ProcessRunner {
  exec(
    command: string,
    options?: {
      signal?: AbortSignal;
      maxBuffer?: number;
      encoding?: BufferEncoding;
      timeout?: number;
    }
  ): Promise<ExecResult>;
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
  execSync: (command, options) => nodeExecSync(command, options) as string,
  spawn: (command, args, options = {}) => nodeSpawn(command, args, options),
};
