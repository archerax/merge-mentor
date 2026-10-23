import type { AIProviderType } from "@merge-mentor/core/ai/types.js";
import { CorpusEvalError } from "@merge-mentor/shared/errors/index.js";
import { consoleOutputWriter } from "@merge-mentor/shared/ports/index.js";

import { evaluateCorpus, formatTerminalSummary } from "../eval/harness.js";
import type { EvalCommandOptions, EvalExecutionResult, ProgramDeps } from "./types.js";

/**
 * Executes the Golden-PR evaluation harness command.
 */
export async function executeEval(
  options: EvalCommandOptions,
  deps: ProgramDeps = {}
): Promise<EvalExecutionResult> {
  const output = deps.output ?? consoleOutputWriter;

  const report = await evaluateCorpus({
    corpusDir: options.corpusDir,
    provider: (options.provider as AIProviderType | "mock") ?? "mock",
    model: options.aiModel ?? process.env.MM_AI_MODEL,
    aiBaseUrl: options.aiBaseUrl ?? process.env.MM_AI_BASE_URL,
    aiApiKey: options.aiApiKey ?? process.env.MM_AI_API_KEY,
    minRecall: options.minRecall,
    minPrecision: options.minPrecision,
    runs: options.runs,
    json: options.json,
    outputFile: options.outputFile,
    output,
  });

  const summaryText = formatTerminalSummary(report);

  if (options.json) {
    output.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    output.write(`${summaryText}\n`);
  }

  if (!report.overallPassed) {
    throw new CorpusEvalError(
      undefined,
      `Evaluation failed quality gate (Mean Recall: ${(report.meanRecall * 100).toFixed(1)}%, Mean Precision: ${(report.meanPrecision * 100).toFixed(1)}%)`
    );
  }

  return { report, summaryText };
}
