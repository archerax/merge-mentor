import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import type { PermissionRequest } from "@github/copilot-sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createReviewPermissionHandler } from "./copilot-sdk.js";
import { isDeniedWritePath, relativeInsideWorkingTree } from "./permissionPolicy.js";

let root: string;
let workTree: string;
let outside: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "mm-perm-"));
  workTree = join(root, "repo");
  outside = join(root, "outside");
  mkdirSync(join(workTree, "src"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "s");
  symlinkSync(outside, join(workTree, "link-out"));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("relativeInsideWorkingTree", () => {
  it("accepts relative and absolute paths inside the tree, including new files", () => {
    expect(relativeInsideWorkingTree(workTree, "src/a.ts")).toBe(join("src", "a.ts"));
    expect(relativeInsideWorkingTree(workTree, join(workTree, "src", "new", "b.ts"))).toBe(
      join("src", "new", "b.ts")
    );
  });

  it("rejects traversal, absolute paths elsewhere and NUL bytes", () => {
    expect(relativeInsideWorkingTree(workTree, "../outside/secret.txt")).toBeUndefined();
    expect(relativeInsideWorkingTree(workTree, "/etc/passwd")).toBeUndefined();
    expect(relativeInsideWorkingTree(workTree, "src/a\0.ts")).toBeUndefined();
  });

  it("rejects a symlink that escapes the tree", () => {
    expect(relativeInsideWorkingTree(workTree, "link-out/secret.txt")).toBeUndefined();
    expect(relativeInsideWorkingTree(workTree, "link-out/new.txt")).toBeUndefined();
  });
});

describe("isDeniedWritePath", () => {
  it.each([
    ".git/hooks/pre-commit",
    ".husky/pre-push",
    ".github/workflows/ci.yml",
    ".vscode/tasks.json",
    "package.json",
    "apps/web/package.json",
    ".npmrc",
  ])("denies %s", (path) => {
    expect(isDeniedWritePath(path.split("/").join(sep))).toBe(true);
  });

  it("allows ordinary source files", () => {
    expect(isDeniedWritePath(join("src", "index.ts"))).toBe(false);
    expect(isDeniedWritePath(join("docs", ".github-notes.md"))).toBe(false);
  });
});

function ask(handler: ReturnType<typeof createReviewPermissionHandler>, request: object) {
  return handler(request as PermissionRequest, { sessionId: "s" });
}

describe("createReviewPermissionHandler policy", () => {
  const logger = { warn: vi.fn() } as unknown as Parameters<
    typeof createReviewPermissionHandler
  >[0];

  it("rejects reads outside the working tree and sandbox bypass requests", () => {
    const handler = createReviewPermissionHandler(logger, false, false, workTree);
    expect(ask(handler, { kind: "read", path: "../outside/secret.txt" })).toEqual({
      kind: "reject",
    });
    expect(ask(handler, { kind: "read", path: join(workTree, "link-out", "secret.txt") })).toEqual({
      kind: "reject",
    });
    expect(ask(handler, { kind: "read", path: "src/a.ts", requestSandboxBypass: true })).toEqual({
      kind: "reject",
    });
    expect(ask(handler, { kind: "read" })).toEqual({ kind: "reject" });
    expect(ask(handler, { kind: "read", path: "src/a.ts" })).toEqual({ kind: "approve-once" });
  });

  it("rejects unknown and newly added permission kinds", () => {
    const handler = createReviewPermissionHandler(logger, true, true, workTree);
    for (const kind of [
      "workflow",
      "extension-management",
      "extension-env-access",
      "future-kind",
    ]) {
      expect(ask(handler, { kind })).toEqual({ kind: "reject" });
    }
  });

  it("confines writes to the tree and refuses protected paths", () => {
    const handler = createReviewPermissionHandler(logger, true, false, workTree);
    expect(ask(handler, { kind: "write", fileName: "src/a.ts" })).toEqual({ kind: "approve-once" });
    for (const fileName of [
      ".husky/pre-push",
      ".git/hooks/pre-commit",
      "package.json",
      "../x.ts",
      "link-out/x.ts",
    ]) {
      expect(ask(handler, { kind: "write", fileName })).toEqual({ kind: "reject" });
    }
    expect(
      ask(handler, {
        kind: "write",
        fileName: "src/a.ts",
        fileEdits: [{ after: { path: ".vscode/tasks.json", content: "" } }],
      })
    ).toEqual({ kind: "reject" });
  });

  it("rejects writes when write tools are disabled", () => {
    const handler = createReviewPermissionHandler(logger, false, false, workTree);
    expect(ask(handler, { kind: "write", fileName: "src/a.ts" })).toEqual({ kind: "reject" });
  });
});
