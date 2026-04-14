import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSystemExecutableFinder } from "./executableFinder.js";
import { nodeFs } from "./fileSystem.js";
import { consoleOutputWriter } from "./outputWriter.js";
import { nodeProcessRunner } from "./processRunner.js";
import { createStubProcessRunner } from "./processRunner.test-helper.js";

// ---------------------------------------------------------------------------
// executableFinder
// ---------------------------------------------------------------------------
describe("createSystemExecutableFinder", () => {
  test("returns path when command is found", () => {
    const stub = createStubProcessRunner({
      execSync: vi.fn().mockReturnValue("/usr/bin/git\n"),
    });
    const finder = createSystemExecutableFinder(stub);
    const uniqueCmd = `found-cmd-${randomUUID()}`;

    const result = finder.find(uniqueCmd);

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
    const uniqueCmd = `missing-cmd-${randomUUID()}`;

    const result = finder.find(uniqueCmd);

    expect(result).toBeUndefined();
  });

  test("caches results so execSync is called only once", () => {
    const stub = createStubProcessRunner({
      execSync: vi.fn().mockReturnValue("/usr/bin/node\n"),
    });
    const finder = createSystemExecutableFinder(stub);
    const uniqueCmd = `cached-cmd-${randomUUID()}`;

    const first = finder.find(uniqueCmd);
    const second = finder.find(uniqueCmd);

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
    const uniqueCmd = `multiline-cmd-${randomUUID()}`;

    const result = finder.find(uniqueCmd);

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
      const uniqueCmd = `bat-cmd-${randomUUID()}`;

      const result = finder.find(uniqueCmd);

      expect(result).toBe(uniqueCmd);
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
      const uniqueCmd = `cmd-cmd-${randomUUID()}`;

      const result = finder.find(uniqueCmd);

      expect(result).toBe(uniqueCmd);
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
      const uniqueCmd = `linux-cmd-${randomUUID()}`;

      finder.find(uniqueCmd);

      expect(stub.execSync).toHaveBeenCalledWith(
        `which ${uniqueCmd}`,
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
      const uniqueCmd = `win-cmd-${randomUUID()}`;

      finder.find(uniqueCmd);

      expect(stub.execSync).toHaveBeenCalledWith(
        `where ${uniqueCmd}`,
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
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `merge-mentor-test-${randomUUID()}`);
    await nodeFs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await nodeFs.rm(tempDir, { recursive: true, force: true });
  });

  test("writeFile and readFile round-trip", async () => {
    const filePath = path.join(tempDir, "test.txt");

    await nodeFs.writeFile(filePath, "hello world", "utf-8");
    const content = await nodeFs.readFile(filePath, "utf-8");

    expect(content).toBe("hello world");
  });

  test("mkdir creates nested directories", async () => {
    const nested = path.join(tempDir, "a", "b", "c");

    await nodeFs.mkdir(nested, { recursive: true });
    await nodeFs.access(nested);
  });

  test("rm removes directory recursively", async () => {
    const nested = path.join(tempDir, "to-remove", "child");
    await nodeFs.mkdir(nested, { recursive: true });
    const filePath = path.join(nested, "file.txt");
    await nodeFs.writeFile(filePath, "data", "utf-8");

    await nodeFs.rm(path.join(tempDir, "to-remove"), {
      recursive: true,
      force: true,
    });

    await expect(nodeFs.access(path.join(tempDir, "to-remove"))).rejects.toThrow();
  });

  test("access resolves for existing file", async () => {
    const filePath = path.join(tempDir, "exists.txt");
    await nodeFs.writeFile(filePath, "", "utf-8");

    await expect(nodeFs.access(filePath)).resolves.toBeUndefined();
  });

  test("access rejects for non-existing file", async () => {
    const filePath = path.join(tempDir, "nope.txt");

    await expect(nodeFs.access(filePath)).rejects.toThrow();
  });

  test("readdir returns entries with withFileTypes", async () => {
    await nodeFs.writeFile(path.join(tempDir, "a.txt"), "", "utf-8");
    await nodeFs.mkdir(path.join(tempDir, "subdir"));

    const entries = await nodeFs.readdir(tempDir, { withFileTypes: true });

    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["a.txt", "subdir"]);

    const fileEntry = entries.find((e) => e.name === "a.txt");
    expect(fileEntry?.isFile()).toBe(true);

    const dirEntry = entries.find((e) => e.name === "subdir");
    expect(dirEntry?.isDirectory()).toBe(true);
  });

  test("stat returns a Stats object", async () => {
    const filePath = path.join(tempDir, "stat-test.txt");
    await nodeFs.writeFile(filePath, "content", "utf-8");

    const stats = await nodeFs.stat(filePath);

    expect(stats.isFile()).toBe(true);
    expect(stats.size).toBeGreaterThan(0);
  });

  test("unlink removes a file", async () => {
    const filePath = path.join(tempDir, "to-delete.txt");
    await nodeFs.writeFile(filePath, "bye", "utf-8");

    await nodeFs.unlink(filePath);

    await expect(nodeFs.access(filePath)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// processRunner (nodeProcessRunner)
// ---------------------------------------------------------------------------
describe("nodeProcessRunner", () => {
  describe("exec", () => {
    test("returns stdout and stderr", async () => {
      const result = await nodeProcessRunner.exec('echo "hello"');

      expect(result.stdout.trim()).toBe("hello");
      expect(result.stderr).toBeDefined();
    });

    test("rejects on command failure", async () => {
      await expect(nodeProcessRunner.exec('node -e "process.exit(1)"')).rejects.toThrow();
    });
  });

  describe("execSync", () => {
    test("returns string output", () => {
      const result = nodeProcessRunner.execSync('echo "sync-hello"', {
        encoding: "utf-8",
      });

      expect(result.trim()).toBe("sync-hello");
    });

    test("throws on failure", () => {
      expect(() =>
        nodeProcessRunner.execSync('node -e "process.exit(1)"', {
          encoding: "utf-8",
        })
      ).toThrow();
    });
  });

  describe("spawn", () => {
    test("returns a ChildProcess", () => {
      const child = nodeProcessRunner.spawn("echo", ["spawned"]);

      expect(child).toBeDefined();
      expect(child.pid).toBeTypeOf("number");
    });

    test("can spawn a simple command and receive exit", async () => {
      const child = nodeProcessRunner.spawn("echo", ["test"]);

      const exitCode = await new Promise<number | null>((resolve) => {
        child.on("close", resolve);
      });

      expect(exitCode).toBe(0);
    });
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
