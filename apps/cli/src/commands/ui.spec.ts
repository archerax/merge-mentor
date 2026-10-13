import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { program } from "../program.js";
import { DEFAULT_UI_HOST, executeUiCommand, parseUiPort, shouldOpenBrowser } from "./ui.js";

vi.mock("@merge-mentor/config/config.js", () => ({
  loadConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

function createChild(): EventEmitter {
  return new EventEmitter();
}

function spawnChild(): EventEmitter {
  const child = createChild();
  vi.mocked(spawn).mockReturnValue(child as never);
  return child;
}

function withTTY<T>(isTTY: boolean, fn: () => T): T {
  Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true });
  try {
    return fn();
  } finally {
    delete (process.stdout as { isTTY?: boolean }).isTTY;
  }
}

describe("parseUiPort", () => {
  it("accepts a valid port", () => {
    expect(parseUiPort("4321")).toBe(4321);
  });

  it("rejects non-numeric input", () => {
    expect(() => parseUiPort("abc")).toThrow("Port must be an integer");
  });

  it("rejects out-of-range ports", () => {
    expect(() => parseUiPort("0")).toThrow("Port must be an integer");
    expect(() => parseUiPort("65536")).toThrow("Port must be an integer");
  });
});

describe("shouldOpenBrowser", () => {
  it("opens by default on a loopback host from a terminal", () => {
    expect(shouldOpenBrowser({}, "127.0.0.1", true)).toBe(true);
  });

  it("does not open when --no-open is passed", () => {
    expect(shouldOpenBrowser({ open: false }, "127.0.0.1", true)).toBe(false);
  });

  it("does not open when stdout is not a terminal", () => {
    expect(shouldOpenBrowser({}, "127.0.0.1", false)).toBe(false);
  });

  it("does not open for a non-loopback host", () => {
    expect(shouldOpenBrowser({}, "0.0.0.0", true)).toBe(false);
  });
});

describe("ui command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(existsSync).mockReturnValue(true);
  });

  it("starts the dashboard on the default port", async () => {
    const child = spawnChild();

    const parsePromise = program.parseAsync(["node", "test", "ui"]);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    child.emit("exit", 0);
    await parsePromise;

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringContaining("index.mjs")],
      expect.objectContaining({
        env: expect.objectContaining({
          PORT: "3000",
          HOST: DEFAULT_UI_HOST,
          NITRO_HOST: DEFAULT_UI_HOST,
          NITRO_PORT: "3000",
        }),
      })
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("http://127.0.0.1:3000"));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("honors a custom port", async () => {
    const child = spawnChild();

    const parsePromise = program.parseAsync(["node", "test", "ui", "--port", "4321"]);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    child.emit("exit", 0);
    await parsePromise;

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.anything(),
      expect.objectContaining({ env: expect.objectContaining({ PORT: "4321" }) })
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("http://127.0.0.1:4321"));
  });

  it("passes the host to the server environment", async () => {
    const child = spawnChild();

    const parsePromise = program.parseAsync(["node", "test", "ui", "--host", "0.0.0.0"]);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    child.emit("exit", 0);
    await parsePromise;

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.anything(),
      expect.objectContaining({
        env: expect.objectContaining({ HOST: "0.0.0.0", NITRO_HOST: "0.0.0.0" }),
      })
    );
  });

  it("accepts --no-open without an unknown-option error", async () => {
    const child = spawnChild();

    const parsePromise = program.parseAsync(["node", "test", "ui", "--no-open"]);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    child.emit("exit", 0);
    await parsePromise;

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("rejects a non-numeric port without spawning the server", async () => {
    await expect(executeUiCommand({ port: Number.NaN })).rejects.toThrow("Port must be an integer");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("errors when the dashboard is not bundled", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    await expect(executeUiCommand({})).rejects.toThrow("not bundled");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects when the server exits with a non-zero code", async () => {
    const child = spawnChild();

    const commandPromise = executeUiCommand({});
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    child.emit("exit", 3);

    await expect(commandPromise).rejects.toThrow("Dashboard exited with code 3");
  });

  it("rejects when the server fails to start", async () => {
    const child = spawnChild();

    const commandPromise = executeUiCommand({});
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    child.emit("error", new Error("boom"));

    await expect(commandPromise).rejects.toThrow("Failed to start the dashboard: boom");
  });

  it("reports a startup failure through the CLI", async () => {
    const child = spawnChild();

    const parsePromise = program.parseAsync(["node", "test", "ui"]);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    child.emit("error", new Error("boom"));
    await parsePromise;

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to start"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("opens the browser when --open is set", async () => {
    vi.useFakeTimers();
    try {
      const child = spawnChild();

      const commandPromise = withTTY(true, () => executeUiCommand({ open: true }));
      expect(spawn).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1500);
      expect(spawn).toHaveBeenCalledTimes(2);

      child.emit("exit", 0);
      await commandPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not open the browser when --no-open is set", async () => {
    vi.useFakeTimers();
    try {
      const child = spawnChild();

      const commandPromise = withTTY(true, () => executeUiCommand({ open: false }));
      expect(spawn).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1500);
      expect(spawn).toHaveBeenCalledTimes(1);

      child.emit("exit", 0);
      await commandPromise;
    } finally {
      vi.useRealTimers();
    }
  });
});
