import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { vi } from "vitest";
import type { ProcessRunner } from "./processRunner.js";

/** Creates a stub ProcessRunner for testing. */
export function createStubProcessRunner(overrides?: Partial<ProcessRunner>): ProcessRunner {
  return {
    exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
    execSync: vi.fn().mockReturnValue(""),
    spawn: vi.fn().mockReturnValue(createStubChildProcess()),
    ...overrides,
  };
}

/** Options for configuring a stub ChildProcess. */
export interface StubChildProcessOptions {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly error?: Error;
}

/** Creates a stub ChildProcess for testing. */
export function createStubChildProcess(
  optionsOrExitCode?: StubChildProcessOptions | number
): ChildProcess {
  const opts: StubChildProcessOptions =
    typeof optionsOrExitCode === "number"
      ? { exitCode: optionsOrExitCode }
      : (optionsOrExitCode ?? {});
  const exitCode = opts.exitCode ?? 0;

  const proc = new EventEmitter() as unknown as ChildProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  (proc as any).stdout = stdout;
  (proc as any).stderr = stderr;
  (proc as any).stdin = null;
  (proc as any).pid = 12345;

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
