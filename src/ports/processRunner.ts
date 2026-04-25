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

/**
 * Child process execution abstraction.
 *
 * Provides multiple ways to execute external commands and programs:
 * - exec: Shell command execution (use with care for security)
 * - execFile: Direct file execution with explicit arguments (preferred for user input)
 * - execSync: Synchronous command execution (blocks until complete)
 * - spawn: Long-running process with streaming I/O
 *
 * Abstracts Node.js child_process module for testability and
 * consistent error handling across platforms.
 *
 * @example
 * ```typescript
 * // Run a command with shell
 * const result = await runner.exec("echo Hello World");
 * console.log(result.stdout);  // "Hello World\n"
 *
 * // Execute a file with arguments (safer for user input)
 * const result = await runner.execFile("node", ["script.js", "--option", userInput]);
 *
 * // Synchronous execution (blocks)
 * const output = runner.execSync("which python", { encoding: "utf-8" });
 *
 * // Streaming subprocess (e.g., long-running processes)
 * const proc = runner.spawn("python", ["train.py"]);
 * proc.stdout?.on("data", (chunk) => console.log(chunk.toString()));
 * ```
 */
export interface ProcessRunner {
  /**
   * Executes a shell command.
   *
   * The command is executed via shell (sh or cmd.exe), allowing pipes, redirects, etc.
   * Use execFile() instead if command arguments come from user input to prevent
   * command injection vulnerabilities.
   *
   * @param command - Shell command string to execute
   * @param options - Execution options (timeout, env, signal, etc.)
   * @returns Promise resolving to stdout and stderr
   * @throws If command times out or returns non-zero exit code
   *
   * @example
   * ```typescript
   * const result = await runner.exec("cat file.txt | grep pattern");
   * ```
   */
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;

  /**
   * Executes a file with an explicit argument array, bypassing the shell.
   *
   * Arguments are passed directly to the executable, preventing shell interpretation.
   * Prefer this over exec() whenever arguments include user-supplied values.
   *
   * @param file - Executable file path or command name
   * @param args - Array of arguments to pass to the executable
   * @param options - Execution options (timeout, env, signal, etc.)
   * @returns Promise resolving to stdout and stderr
   * @throws If command times out or returns non-zero exit code
   *
   * @example
   * ```typescript
   * const result = await runner.execFile("node", ["script.js", userInput]);
   * // userInput is passed as-is, no shell interpretation
   * ```
   */
  execFile(file: string, args: string[], options?: ExecOptions): Promise<ExecResult>;

  /**
   * Executes a command synchronously, blocking until completion.
   *
   * Returns the stdout output directly. Use for simple, fast commands only.
   * For long-running processes or complex I/O, use spawn() instead.
   *
   * @param command - Shell command string to execute
   * @param options - Execution options (encoding, timeout, stdio)
   * @returns Command output as string
   * @throws If command times out or returns non-zero exit code
   *
   * @example
   * ```typescript
   * const output = runner.execSync("which python", { encoding: "utf-8" });
   * ```
   */
  execSync(
    command: string,
    options?: {
      encoding: BufferEncoding;
      stdio?: import("node:child_process").StdioOptions;
      timeout?: number;
    }
  ): string;

  /**
   * Spawns a child process with streaming I/O.
   *
   * Returns a ChildProcess object for managing long-running processes,
   * streaming output, or processes that require manual termination.
   *
   * @param command - Executable command or file path
   * @param args - Array of arguments to pass to the executable
   * @param options - Spawn options (cwd, env, stdio config, etc.)
   * @returns ChildProcess object with stdout, stderr, and kill() method
   *
   * @example
   * ```typescript
   * const proc = runner.spawn("node", ["longRunningScript.js"]);
   * proc.stdout?.on("data", (chunk) => {
   *   console.log("Output:", chunk.toString());
   * });
   * proc.on("exit", (code) => {
   *   console.log(`Process exited with code ${code}`);
   * });
   * ```
   */
  spawn(command: string, args: string[], options?: SpawnOptions): ChildProcess;
}

/**
 * Result from executing a command.
 *
 * Contains the complete stdout and stderr output from the process.
 */
interface ExecResult {
  /** Standard output from the command */
  readonly stdout: string;
  /** Standard error output from the command */
  readonly stderr: string;
}

/** Options shared by exec-style process runners. */
interface ExecOptions {
  /** AbortSignal to cancel the operation */
  signal?: AbortSignal;
  /** Maximum buffer size for output (default: 1MB) */
  maxBuffer?: number;
  /** Text encoding for output (default: utf-8) */
  encoding?: BufferEncoding;
  /** Maximum time to wait in milliseconds */
  timeout?: number;
  /** Environment variables for the child process */
  env?: Record<string, string>;
}

/**
 * Production implementation using Node.js child_process.
 *
 * Provides all four execution methods with standard Node.js behavior:
 * - exec and execFile: Return promises
 * - execSync: Returns string synchronously
 * - spawn: Returns ChildProcess immediately
 */
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
