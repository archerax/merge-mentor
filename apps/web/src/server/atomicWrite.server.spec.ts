import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeFileAtomic } from "./atomicWrite.server.js";

describe("writeFileAtomic", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-atomic-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes the content and leaves no temp file behind", () => {
    const file = path.join(dir, "data.json");
    writeFileAtomic(file, "one");
    writeFileAtomic(file, "two");

    expect(fs.readFileSync(file, "utf8")).toBe("two");
    expect(fs.readdirSync(dir)).toEqual(["data.json"]);
  });

  it("removes its temp file when the rename fails", () => {
    const target = path.join(dir, "taken");
    fs.mkdirSync(target);

    expect(() => writeFileAtomic(target, "x")).toThrow(/EISDIR|EPERM|EEXIST|ENOTEMPTY|EBUSY/);
    expect(fs.readdirSync(dir)).toEqual(["taken"]);
  });
});
