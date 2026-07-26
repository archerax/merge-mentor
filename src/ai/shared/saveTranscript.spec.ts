import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Clock, FileSystem } from "../../ports/index.js";
import { type SaveTranscriptDeps, saveTranscript } from "./saveTranscript.js";

describe("saveTranscript", () => {
  const createMockDeps = (overrides?: Partial<SaveTranscriptDeps>) => {
    const writtenFiles: Record<string, string> = {};
    const createdDirs: string[] = [];

    const fileSystem: FileSystem = {
      mkdir: vi.fn().mockImplementation(async (dir: string) => {
        createdDirs.push(dir);
      }),
      writeFile: vi.fn().mockImplementation(async (filePath: string, content: string) => {
        writtenFiles[filePath] = content;
      }),
      readFile: vi.fn(),
      rm: vi.fn(),
      readdir: vi.fn(),
      access: vi.fn(),
      stat: vi.fn(),
      unlink: vi.fn(),
    };

    const clock: Clock = {
      timestamp: () => "2026-07-24T12:00:00.000Z",
      now: () => new Date(1700000000000),
      epochMs: () => 1700000000000,
    };

    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
    };

    return {
      deps: {
        fileSystem,
        clock,
        logger,
        tempPath: "/tmp/test",
        providerLabel: "TEST PROVIDER TRANSCRIPT",
        filePrefix: "transcript-test",
        displayName: "Test Provider",
        model: "test-model",
        ...overrides,
      },
      writtenFiles,
      createdDirs,
      logger,
      fileSystem,
    };
  };

  it("creates transcript directory and writes transcript file on success", async () => {
    const { deps, writtenFiles, logger } = createMockDeps();

    await saveTranscript(deps, {
      prompt: "Test prompt",
      timeline: ["[TOOL CALL START] foo", "  Arguments: {}"],
      rawResponse: '{"result": "ok"}',
      jsonOutput: '{"result": "ok"}',
      tokenUsage: { inputTokens: 10, outputTokens: 20 },
      success: true,
      attempt: 1,
    });

    const expectedPath = path.join(
      "/tmp/test",
      "transcripts",
      "transcript-test-2026-07-24T12-00-00-000Z-attempt-1-success.txt"
    );
    expect(writtenFiles[expectedPath]).toBeDefined();

    const content = writtenFiles[expectedPath];
    expect(content).toContain("TEST PROVIDER TRANSCRIPT");
    expect(content).toContain("Status: success");
    expect(content).toContain("Model: test-model");
    expect(content).toContain("Attempt: 1");
    expect(content).toContain(
      "INPUT PROMPT\n================================================================================\nTest prompt"
    );
    expect(content).toContain(
      "SESSION TIMELINE\n================================================================================\n[TOOL CALL START] foo"
    );
    expect(content).toContain(
      'RAW API RESPONSE\n================================================================================\n{"result": "ok"}'
    );
    expect(content).toContain(
      'JSON OUTPUT\n================================================================================\n{"result": "ok"}'
    );
    expect(content).toContain("END OF TRANSCRIPT");

    expect(logger.debug).toHaveBeenCalledWith(
      { filepath: expectedPath, success: true, attempt: 1 },
      "Saved Test Provider transcript for debugging"
    );
  });

  it("handles failure status and error details", async () => {
    const { deps, writtenFiles } = createMockDeps();

    await saveTranscript(deps, {
      prompt: "Failed prompt",
      success: false,
      error: "Timeout error",
      attempt: 2,
    });

    const expectedPath = path.join(
      "/tmp/test",
      "transcripts",
      "transcript-test-2026-07-24T12-00-00-000Z-attempt-2-failure.txt"
    );
    expect(writtenFiles[expectedPath]).toBeDefined();

    const content = writtenFiles[expectedPath];
    expect(content).toContain("Status: failure");
    expect(content).toContain(
      "ERROR\n================================================================================\nTimeout error"
    );
  });

  it("logs warning if writing transcript fails", async () => {
    const { deps, logger, fileSystem } = createMockDeps();
    vi.mocked(fileSystem.mkdir).mockRejectedValueOnce(new Error("Disk full"));

    await saveTranscript(deps, {
      prompt: "Prompt",
      success: true,
      attempt: 1,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      { error: "Disk full" },
      "Failed to save Test Provider transcript"
    );
  });
});
