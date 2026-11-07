import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  emptyOutcomesFile,
  outcomesFilePath,
  readOutcomesFile,
  writeOutcomesFile,
} from "./cache.js";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mm-outcomes-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const now = new Date("2026-05-01T00:00:00Z");
const scanned = {
  updatedAt: "2026-04-01T00:00:00Z",
  state: "closed" as const,
  scannedAt: "2026-05-01T00:00:00Z",
  comments: [],
};

describe("outcomes file", () => {
  it("round-trips", async () => {
    const file = outcomesFilePath(dir);
    await writeOutcomesFile(file, {
      ...emptyOutcomesFile("github", "o/r", now),
      prs: { "1": scanned },
    });
    const read = await readOutcomesFile(file, "github", "o/r");
    expect(read?.prs["1"]).toEqual(scanned);
    expect((await fs.readdir(path.dirname(file))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("is ignored when missing or corrupt", async () => {
    const file = outcomesFilePath(dir);
    expect(await readOutcomesFile(file, "github", "o/r")).toBeUndefined();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{not json");
    expect(await readOutcomesFile(file, "github", "o/r")).toBeUndefined();
  });

  it("is ignored for another repository or schema version", async () => {
    const file = outcomesFilePath(dir);
    await writeOutcomesFile(file, emptyOutcomesFile("github", "o/r", now));
    expect(await readOutcomesFile(file, "github", "o/other")).toBeUndefined();
    expect(await readOutcomesFile(file, "azure", "o/r")).toBeUndefined();
    await fs.writeFile(
      file,
      JSON.stringify({ ...emptyOutcomesFile("github", "o/r", now), version: 99 })
    );
    expect(await readOutcomesFile(file, "github", "o/r")).toBeUndefined();
  });

  it("drops malformed PR entries but keeps valid ones", async () => {
    const file = outcomesFilePath(dir);
    await writeOutcomesFile(file, {
      ...emptyOutcomesFile("github", "o/r", now),
      prs: { "1": scanned, "2": { nope: true } as never },
    });
    const read = await readOutcomesFile(file, "github", "o/r");
    expect(Object.keys(read?.prs ?? {})).toEqual(["1"]);
  });
});
