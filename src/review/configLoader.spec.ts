import { beforeEach, describe, expect, it, type Mocked } from "vitest";
import type { FileSystem } from "../ports/fileSystem.js";
import { createStubFileSystem } from "../ports/fileSystem.test-helper.js";
import { ConfigLoader } from "./configLoader.js";

describe("ConfigLoader", () => {
  let fileSystem: Mocked<FileSystem>;
  let fileStore: Map<string, string>;
  let loader: ConfigLoader;

  beforeEach(() => {
    fileStore = new Map();
    fileSystem = createStubFileSystem() as Mocked<FileSystem>;

    fileSystem.access.mockImplementation(async (filePath) => {
      if (fileStore.has(filePath as string)) return;
      throw new Error("ENOENT");
    });

    fileSystem.readFile.mockImplementation(async (filePath) => {
      const data = fileStore.get(filePath as string);
      if (data !== undefined) return data;
      throw new Error("ENOENT");
    });

    loader = new ConfigLoader(fileSystem);
  });

  it("returns empty options when .mergementor.json does not exist", async () => {
    const config = await loader.loadProjectConfig("/workspace");
    expect(config).toEqual({});
  });

  it("loads and parses a valid .mergementor.json", async () => {
    const configJson = JSON.stringify({
      testFilePatterns: ["**/*.spec.ts"],
      testMapping: { "src/a.ts": "src/a.spec.ts" },
    });
    fileStore.set("/workspace/.mergementor.json", configJson);

    const config = await loader.loadProjectConfig("/workspace");
    expect(config).toEqual({
      testFilePatterns: ["**/*.spec.ts"],
      testMapping: { "src/a.ts": "src/a.spec.ts" },
    });
  });

  it("ignores unknown fields due to strict schema checks", async () => {
    const configJson = JSON.stringify({
      testFilePatterns: ["**/*.spec.ts"],
      unknownField: "value",
    });
    fileStore.set("/workspace/.mergementor.json", configJson);

    const config = await loader.loadProjectConfig("/workspace");
    expect(config).toEqual({});
  });

  it("throws error for malformed JSON", async () => {
    fileStore.set("/workspace/.mergementor.json", "invalid-json");

    await expect(loader.loadProjectConfig("/workspace")).rejects.toThrow(
      "Failed to parse .mergementor.json"
    );
  });
});
