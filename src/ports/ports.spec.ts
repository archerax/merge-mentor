import { describe, expect, test, vi } from "vitest";
import { systemClock } from "./clock.js";
import { processEnvironment } from "./environment.js";
import { createSystemExecutableFinder } from "./executableFinder.js";
import { nodeFs } from "./fileSystem.js";
import { consoleOutputWriter } from "./outputWriter.js";
import { nodeProcessRunner } from "./processRunner.js";
import { createStubProcessRunner } from "./processRunner.test-helper.js";

// Mock node:fs/promises so nodeFs does not touch real system disk
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
    access: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
  },
}));

// Mock node:child_process for nodeProcessRunner unit tests
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    exec: vi.fn((_cmd, opts, cb) => {
      const callback = typeof opts === "function" ? opts : cb;
      if (callback) callback(null, { stdout: "mock stdout", stderr: "mock stderr" });
    }),
    execFile: vi.fn((_file, _args, opts, cb) => {
      const callback = typeof opts === "function" ? opts : cb;
      if (callback) callback(null, { stdout: "mock file stdout", stderr: "" });
    }),
    execSync: vi.fn().mockReturnValue("mock sync output"),
    spawn: vi.fn().mockReturnValue({ pid: 9999 }),
  };
});

import fs from "node:fs/promises";

// ---------------------------------------------------------------------------
// executableFinder
// ---------------------------------------------------------------------------
describe("createSystemExecutableFinder", () => {
  test("returns path when command is found", () => {
    const stub = createStubProcessRunner({
      execSync: vi.fn().mockReturnValue("/usr/bin/git\n"),
    });
    const finder = createSystemExecutableFinder(stub);

    const result = finder.find("git");

    expect(result).toBe("/usr/bin/git");
    expect(stub.execSync).toHaveBeenCalledOnce();
  });

  test("returns undefined when command is not found", () => {
    const stub = createStubProcessRunner({
      execSync: vi.fn().mockImplementation(() => {
        throw new Error("not found");
      }),
    });
    const finder = createSystemExecutableFinder(stub);

    const result = finder.find("non-existent-cmd");

    expect(result).toBeUndefined();
  });

  test("caches results so execSync is called only once", () => {
    const stub = createStubProcessRunner({
      execSync: vi.fn().mockReturnValue("/usr/bin/node\n"),
    });
    const finder = createSystemExecutableFinder(stub);

    const first = finder.find("node");
    const second = finder.find("node");

    expect(first).toBe("/usr/bin/node");
    expect(second).toBe("/usr/bin/node");
    expect(stub.execSync).toHaveBeenCalledOnce();
  });

  test("handles multi-line output by taking first line", () => {
    const stub = createStubProcessRunner({
      execSync: vi
        .fn()
        .mockReturnValue("C:\\Program Files\\Git\\cmd\\git.exe\r\nC:\\Git\\git.exe\r\n"),
    });
    const finder = createSystemExecutableFinder(stub);

    const result = finder.find("git");

    expect(result).toBe("C:\\Program Files\\Git\\cmd\\git.exe");
  });

  test("returns command name for Windows .bat files", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      const stub = createStubProcessRunner({
        execSync: vi.fn().mockReturnValue("C:\\tools\\run.bat\n"),
      });
      const finder = createSystemExecutableFinder(stub);

      const result = finder.find("run-bat");

      expect(result).toBe("run-bat");
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  test("returns command name for Windows .cmd files", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      const stub = createStubProcessRunner({
        execSync: vi.fn().mockReturnValue("C:\\tools\\run.cmd\n"),
      });
      const finder = createSystemExecutableFinder(stub);

      const result = finder.find("run-cmd");

      expect(result).toBe("run-cmd");
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  test("uses 'which' on non-Windows platforms", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });

    try {
      const stub = createStubProcessRunner({
        execSync: vi.fn().mockReturnValue("/usr/bin/ls\n"),
      });
      const finder = createSystemExecutableFinder(stub);

      finder.find("ls");

      expect(stub.execSync).toHaveBeenCalledWith(
        "which ls",
        expect.objectContaining({ encoding: "utf-8", timeout: 5000 })
      );
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  test("uses 'where' on Windows platforms", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });

    try {
      const stub = createStubProcessRunner({
        execSync: vi.fn().mockReturnValue("C:\\bin\\tool.exe\n"),
      });
      const finder = createSystemExecutableFinder(stub);

      finder.find("tool");

      expect(stub.execSync).toHaveBeenCalledWith(
        "where tool",
        expect.objectContaining({ encoding: "utf-8", timeout: 5000 })
      );
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });
});

// ---------------------------------------------------------------------------
// fileSystem (nodeFs)
// ---------------------------------------------------------------------------
describe("nodeFs", () => {
  test("readFile delegates to fs.readFile", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("content");

    const content = await nodeFs.readFile("/tmp/test.txt", "utf-8");

    expect(content).toBe("content");
    expect(fs.readFile).toHaveBeenCalledWith("/tmp/test.txt", "utf-8");
  });

  test("writeFile delegates to fs.writeFile", async () => {
    vi.mocked(fs.writeFile).mockResolvedValue();

    await nodeFs.writeFile("/tmp/test.txt", "hello", "utf-8");

    expect(fs.writeFile).toHaveBeenCalledWith("/tmp/test.txt", "hello", "utf-8");
  });

  test("mkdir delegates to fs.mkdir", async () => {
    vi.mocked(fs.mkdir).mockResolvedValue("/tmp/a/b");

    const res = await nodeFs.mkdir("/tmp/a/b", { recursive: true });

    expect(res).toBe("/tmp/a/b");
    expect(fs.mkdir).toHaveBeenCalledWith("/tmp/a/b", { recursive: true });
  });

  test("rm delegates to fs.rm", async () => {
    vi.mocked(fs.rm).mockResolvedValue();

    await nodeFs.rm("/tmp/dir", { recursive: true, force: true });

    expect(fs.rm).toHaveBeenCalledWith("/tmp/dir", { recursive: true, force: true });
  });

  test("access delegates to fs.access", async () => {
    vi.mocked(fs.access).mockResolvedValue();

    await nodeFs.access("/tmp/file.txt");

    expect(fs.access).toHaveBeenCalledWith("/tmp/file.txt");
  });

  test("readdir delegates to fs.readdir", async () => {
    const mockEntries = [{ name: "a.txt", isFile: () => true, isDirectory: () => false }];
    vi.mocked(fs.readdir).mockResolvedValue(mockEntries as never);

    const entries = await nodeFs.readdir("/tmp/dir", { withFileTypes: true });

    expect(entries).toBe(mockEntries);
    expect(fs.readdir).toHaveBeenCalledWith("/tmp/dir", { withFileTypes: true });
  });

  test("stat delegates to fs.stat", async () => {
    const mockStats = { isFile: () => true, size: 100 };
    vi.mocked(fs.stat).mockResolvedValue(mockStats as never);

    const stats = await nodeFs.stat("/tmp/file.txt");

    expect(stats).toBe(mockStats);
    expect(fs.stat).toHaveBeenCalledWith("/tmp/file.txt");
  });

  test("unlink delegates to fs.unlink", async () => {
    vi.mocked(fs.unlink).mockResolvedValue();

    await nodeFs.unlink("/tmp/file.txt");

    expect(fs.unlink).toHaveBeenCalledWith("/tmp/file.txt");
  });
});

// ---------------------------------------------------------------------------
// processRunner (nodeProcessRunner)
// ---------------------------------------------------------------------------
describe("nodeProcessRunner", () => {
  test("exec delegates to child_process exec", async () => {
    const result = await nodeProcessRunner.exec("echo hello");

    expect(result).toEqual({ stdout: "mock stdout", stderr: "mock stderr" });
  });

  test("execFile delegates to child_process execFile", async () => {
    const result = await nodeProcessRunner.execFile("git", ["status"]);

    expect(result).toEqual({ stdout: "mock file stdout", stderr: "" });
  });

  test("execSync delegates to child_process execSync", () => {
    const output = nodeProcessRunner.execSync("whoami", { encoding: "utf-8" });

    expect(output).toBe("mock sync output");
  });

  test("spawn delegates to child_process spawn", () => {
    const proc = nodeProcessRunner.spawn("node", ["script.js"]);

    expect(proc).toEqual({ pid: 9999 });
  });
});

// ---------------------------------------------------------------------------
// outputWriter (consoleOutputWriter)
// ---------------------------------------------------------------------------
describe("consoleOutputWriter", () => {
  test("log calls console.log", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    consoleOutputWriter.log("test message");

    expect(spy).toHaveBeenCalledWith("test message");
    spy.mockRestore();
  });

  test("error calls console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    consoleOutputWriter.error("error message");

    expect(spy).toHaveBeenCalledWith("error message");
    spy.mockRestore();
  });

  test("write calls process.stdout.write", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const result = consoleOutputWriter.write("raw data");

    expect(spy).toHaveBeenCalledWith("raw data");
    expect(result).toBe(true);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// systemClock
// ---------------------------------------------------------------------------
describe("systemClock", () => {
  test("now returns a valid Date instance", () => {
    const before = Date.now();
    const date = systemClock.now();
    const after = Date.now();

    expect(date).toBeInstanceOf(Date);
    expect(date.getTime()).toBeGreaterThanOrEqual(before);
    expect(date.getTime()).toBeLessThanOrEqual(after);
  });

  test("timestamp returns ISO 8601 string", () => {
    const ts = systemClock.timestamp();

    expect(typeof ts).toBe("string");
    expect(Number.isNaN(Date.parse(ts))).toBe(false);
  });

  test("epochMs returns current epoch milliseconds", () => {
    const before = Date.now();
    const ms = systemClock.epochMs();
    const after = Date.now();

    expect(typeof ms).toBe("number");
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// processEnvironment
// ---------------------------------------------------------------------------
describe("processEnvironment", () => {
  test("get returns process.env value when defined", () => {
    const key = "MERGE_MENTOR_TEST_ENV_VAR";
    process.env[key] = "test-val";

    try {
      expect(processEnvironment.get(key)).toBe("test-val");
    } finally {
      delete process.env[key];
    }
  });

  test("get returns undefined when key is not set", () => {
    expect(processEnvironment.get("UNSET_ENV_VAR_XYZ")).toBeUndefined();
  });
});
