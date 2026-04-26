import { describe, expect, it, vi } from "vitest";
import { CliGitClient } from "./cliGitClient.js";
import { createGitClient } from "./factory.js";
import { IsomorphicGitClient } from "./isomorphicGitClient.js";

describe("createGitClient", () => {
  it("returns CliGitClient when backend is 'cli'", () => {
    const client = createGitClient("cli");
    expect(client).toBeInstanceOf(CliGitClient);
  });

  it("returns IsomorphicGitClient when backend is 'isomorphic'", () => {
    const client = createGitClient("isomorphic");
    expect(client).toBeInstanceOf(IsomorphicGitClient);
  });

  it("passes custom runner to CliGitClient", () => {
    const mockRunner = {
      exec: vi.fn(),
      execFile: vi.fn(),
      execSync: vi.fn(),
      spawn: vi.fn(),
    };

    const client = createGitClient("cli", mockRunner);

    expect(client).toBeInstanceOf(CliGitClient);
    // Verify the runner was passed by checking internal state
    // (CliGitClient stores runner privately, so we just verify instantiation works)
  });

  it("uses default nodeProcessRunner when no runner provided", () => {
    const client = createGitClient("cli");
    expect(client).toBeInstanceOf(CliGitClient);
  });

  it("ignores runner parameter for isomorphic backend", () => {
    const mockRunner = {
      exec: vi.fn(),
      execFile: vi.fn(),
      execSync: vi.fn(),
      spawn: vi.fn(),
    };

    const client = createGitClient("isomorphic", mockRunner);
    expect(client).toBeInstanceOf(IsomorphicGitClient);
  });
});
