import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { vi } from "vitest";
import type { ProcessRunner } from "./processRunner.js";

/** Creates a stub ProcessRunner for testing. */
export function createStubProcessRunner(overrides?: Partial<ProcessRunner>): ProcessRunner {
  return {
    exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
    execFile: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
    execSync: vi.fn().mockReturnValue(""),
    spawn: vi.fn().mockReturnValue(createStubChildProcess()),
    ...overrides,
  };
}

/** Options for configuring a stub ChildProcess. */
interface StubChildProcessOptions {
  /** Data emitted on the child process stdout stream. */
  readonly stdout?: string;
  /** Data emitted on the child process stderr stream. */
  readonly stderr?: string;
  /** Exit code emitted on the close event (default: 0). */
  readonly exitCode?: number;
  /** Error emitted instead of close when provided. */
  readonly error?: Error;
}

/** Creates a stub ChildProcess for testing. */
function createStubChildProcess(
  optionsOrExitCode?: StubChildProcessOptions | number
): ChildProcess {
  const opts: StubChildProcessOptions =
    typeof optionsOrExitCode === "number"
      ? { exitCode: optionsOrExitCode }
      : (optionsOrExitCode ?? {});
  const exitCode = opts.exitCode ?? 0;

  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin: null,
    pid: 12345,
  }) as unknown as ChildProcess;

  // Auto-emit events on next tick (after listeners are attached)
  process.nextTick(() => {
    if (opts.stdout) {
      stdout.emit("data", Buffer.from(opts.stdout));
    }
    if (opts.stderr) {
      stderr.emit("data", Buffer.from(opts.stderr));
    }
    if (opts.error) {
      proc.emit("error", opts.error);
    } else {
      proc.emit("close", exitCode);
    }
  });

  return proc;
}
