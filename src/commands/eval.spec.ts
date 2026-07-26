import path from "node:path";
import { describe, expect, it } from "vitest";
import { CorpusEvalError } from "../errors/index.js";
import type { OutputWriter } from "../ports/index.js";
import { executeEval } from "./eval.js";

describe("executeEval Command", { timeout: 30000 }, () => {
  const corpusDir = path.join(process.cwd(), "test/eval/corpus");

  it("executes evaluation command against corpus and outputs summary", async () => {
    let outputText = "";
    const mockOutput: OutputWriter = {
      log: (msg: string) => {
        outputText += `${msg}\n`;
      },
      error: () => {},
      write: (chunk: string) => {
        outputText += chunk;
        return true;
      },
    };

    const result = await executeEval({ corpusDir, provider: "mock" }, { output: mockOutput });

    expect(result.report.overallPassed).toBe(true);
    expect(outputText).toContain("GOLDEN-PR EVALUATION HARNESS REPORT");
    expect(outputText).toContain("01-sql-injection-auth");
  });

  it("outputs JSON when --json option is passed", async () => {
    let outputText = "";
    const mockOutput: OutputWriter = {
      log: (msg: string) => {
        outputText += `${msg}\n`;
      },
      error: () => {},
      write: (chunk: string) => {
        outputText += chunk;
        return true;
      },
    };

    const result = await executeEval(
      { corpusDir, provider: "mock", json: true },
      { output: mockOutput }
    );

    expect(result.report.overallPassed).toBe(true);
    const parsed = JSON.parse(outputText);
    expect(parsed.overallPassed).toBe(true);
    expect(parsed.scenarioResults).toHaveLength(10);
  });

  it("throws CorpusEvalError when quality gate fails", async () => {
    const mockOutput: OutputWriter = {
      log: () => {},
      error: () => {},
      write: () => true,
    };

    // Setting minRecall to 1.1 guarantees threshold failure
    await expect(
      executeEval({ corpusDir, provider: "mock", minRecall: 1.1 }, { output: mockOutput })
    ).rejects.toThrow(CorpusEvalError);
  });
});
