import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Config } from "@merge-mentor/config/config.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadPostedFingerprints,
  postedTargetKey,
  recordPostedFingerprints,
  reviewScope,
} from "./postedComments.server.js";

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    defaultPlatform: "github",
    github: { token: "t", owner: "acme", repo: "widgets" },
    azure: { token: "t", org: "acme-org", project: "proj", repo: "az-repo" },
    ...overrides,
  } as Config;
}

describe("postedComments.server", () => {
  let tempPath: string;

  beforeEach(() => {
    tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "mm-posted-"));
  });

  afterEach(() => {
    fs.rmSync(tempPath, { recursive: true, force: true });
  });

  describe("reviewScope", () => {
    it("composes owner/repo for github", () => {
      expect(reviewScope("github", createConfig())).toBe("acme/widgets");
    });

    it("composes org/project/repo for azure", () => {
      expect(reviewScope("azure", createConfig())).toBe("acme-org/proj/az-repo");
    });
  });

  describe("postedTargetKey", () => {
    it("joins kind, platform, scope, and id", () => {
      expect(postedTargetKey("pr", "github", "acme/widgets", 42)).toBe("pr:github:acme/widgets:42");
    });
  });

  describe("loadPostedFingerprints", () => {
    it("returns an empty set when the store does not exist", () => {
      expect(loadPostedFingerprints(tempPath, "pr:github:a/b:1").size).toBe(0);
    });

    it("returns an empty set when the store is malformed", () => {
      fs.writeFileSync(path.join(tempPath, "posted-comments.json"), "{not json", "utf8");
      expect(loadPostedFingerprints(tempPath, "pr:github:a/b:1").size).toBe(0);
    });

    it("returns an empty set when targets is not an object", () => {
      fs.writeFileSync(
        path.join(tempPath, "posted-comments.json"),
        JSON.stringify({ targets: "nope" }),
        "utf8"
      );
      expect(loadPostedFingerprints(tempPath, "pr:github:a/b:1").size).toBe(0);
    });

    it("returns an empty set for an unknown target key", () => {
      recordPostedFingerprints(tempPath, "pr:github:a/b:1", ["fp1"]);
      expect(loadPostedFingerprints(tempPath, "pr:github:a/b:2").size).toBe(0);
    });
  });

  describe("recordPostedFingerprints", () => {
    it("persists fingerprints and reads them back", () => {
      const key = "pr:github:a/b:1";
      recordPostedFingerprints(tempPath, key, ["fp1", "fp2"]);

      const loaded = loadPostedFingerprints(tempPath, key);
      expect([...loaded].toSorted()).toEqual(["fp1", "fp2"]);
    });

    it("deduplicates and merges with existing fingerprints", () => {
      const key = "pbi:github:a/b:7";
      recordPostedFingerprints(tempPath, key, ["fp1"]);
      recordPostedFingerprints(tempPath, key, ["fp1", "fp2"]);

      const loaded = loadPostedFingerprints(tempPath, key);
      expect([...loaded].toSorted()).toEqual(["fp1", "fp2"]);
    });

    it("does not create a store when there are no fingerprints", () => {
      recordPostedFingerprints(tempPath, "project:azure:o/p/r:9", []);
      expect(fs.existsSync(path.join(tempPath, "posted-comments.json"))).toBe(false);
    });

    it("ignores malformed entries already in the store", () => {
      const key = "pr:github:a/b:1";
      fs.writeFileSync(
        path.join(tempPath, "posted-comments.json"),
        JSON.stringify({ targets: { [key]: ["ok", 42, null] } }),
        "utf8"
      );

      expect([...loadPostedFingerprints(tempPath, key)]).toEqual(["ok"]);
    });
  });
});
