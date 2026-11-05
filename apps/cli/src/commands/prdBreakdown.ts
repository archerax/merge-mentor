import path from "node:path";

import { loadConfig } from "@merge-mentor/config/config.js";
import { createAIProvider } from "@merge-mentor/core/ai/providerFactory.js";
import type { AIProviderType } from "@merge-mentor/core/ai/types.js";
import {
  type PrdBreakdownResult,
  runPrdBreakdown,
} from "@merge-mentor/core/review/prd/breakdownEngine.js";
import { ValidationError } from "@merge-mentor/shared/errors/index.js";
import {
  consoleOutputWriter,
  type FileSystem,
  nodeFs,
  type OutputWriter,
} from "@merge-mentor/shared/ports/index.js";

import { assertReadableFile, parsePrdDocumentType } from "./prd.js";
import type { PrdBreakdownOptions } from "./types.js";

/** Collaborators for {@link executePrdBreakdown}; defaults are the real implementations. */
export interface PrdBreakdownCommandDeps {
  /** Output writer for progress and the summary. Defaults to `consoleOutputWriter`. */
  readonly output?: OutputWriter;
  /** Filesystem used for the up-front file checks. Defaults to `nodeFs`. */
  readonly fileSystem?: Pick<FileSystem, "stat">;
}

/**
 * Executes the `prd-breakdown` command: breaks a PRD or FRD into epics,
 * features and PBIs, in a logical delivery order, and saves a Markdown and JSON
 * breakdown under the temp path.
 *
 * The document is either a Word file (`file`) or the stored copy of an earlier
 * `prd` review (`--from-review <run-id>`). It runs entirely against the
 * configured AI provider, created without write or shell tools because the
 * document is untrusted input.
 *
 * @param file - Path to the `.docx` file, or undefined with `--from-review`
 * @param options - Source, document type, `--force` and AI provider settings
 * @param deps - Optional output writer and filesystem
 * @returns The completed breakdown (report and where its files were written)
 * @throws {ValidationError} when neither or both of a file and `--from-review` are given,
 *   for an invalid `--type`, a missing or oversized file, an unknown run, or a review
 *   with blockers (without `--force`)
 */
export async function executePrdBreakdown(
  file: string | undefined,
  options: PrdBreakdownOptions,
  deps: PrdBreakdownCommandDeps = {}
): Promise<PrdBreakdownResult> {
  const output = deps.output ?? consoleOutputWriter;
  const fileSystem = deps.fileSystem ?? nodeFs;
  const fromRun = options.fromReview?.trim();

  if (file && fromRun) {
    throw new ValidationError("file", "give a file or --from-review, not both");
  }
  if (!file && !fromRun) {
    throw new ValidationError(
      "file",
      "give the Word document to break down, or --from-review <run-id> to use a document that was already reviewed"
    );
  }
  const documentType = parsePrdDocumentType(options.type);
  const filePath = file ? path.resolve(file) : undefined;
  if (file && filePath) await assertReadableFile(filePath, file, fileSystem);

  const config = loadConfig({
    aiProvider: options.provider,
    copilotToken: options.copilotToken,
    aiTimeout: options.aiTimeout,
    aiModel: options.aiModel,
    aiBaseUrl: options.aiBaseUrl,
    aiApiKey: options.aiApiKey,
    tempPath: options.tempPath,
  });

  const aiProvider = (options.provider ?? config.aiProvider) as AIProviderType;
  const aiClient = createAIProvider(aiProvider, {
    model: config.aiModel,
    token: config.copilotToken,
    timeoutMs: config.aiTimeoutMs,
    aiBaseUrl: config.aiBaseUrl,
    aiApiKey: config.aiApiKey,
    tempPath: config.tempPath,
    // The document is untrusted input: never give the model write or shell tools.
    enableWriteTools: false,
    enableShellTools: false,
  });

  const result = await runPrdBreakdown(
    {
      source: filePath ? { path: filePath } : { fromRun: fromRun ?? "" },
      documentType,
      force: options.force ?? false,
      tempPath: config.tempPath,
      aiProvider,
      aiModel: config.aiModel,
      output,
    },
    { aiClient }
  );

  displayRunSummary(result, output);
  return result;
}

/** Prints where the breakdown is and how to remove it. */
function displayRunSummary(result: PrdBreakdownResult, output: OutputWriter): void {
  const { report, paths } = result;
  if (!report.ordered) {
    output.log(
      "⚠️ The step that works out a delivery order could not run, so the items follow the order of the document.\n"
    );
  }
  if (!report.complete) {
    output.log(
      "⚠️ Parts of the document were not covered. See “Not covered” in the breakdown for details.\n"
    );
  }
  output.log("📁 Saved on this computer only:");
  output.log(`   Work breakdown (Markdown): ${paths.breakdownMarkdown}`);
  output.log(`   Work breakdown (JSON):     ${paths.breakdownJson}`);
  output.log(`   Run data:                  ${paths.runDir}`);
  output.log(
    `\n🗑️  To delete this run, use Delete on the Reports page (merge-mentor ui) or remove the files above.\n`
  );
}
