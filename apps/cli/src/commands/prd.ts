import path from "node:path";

import { loadConfig } from "@merge-mentor/config/config.js";
import type { PrdDocumentType } from "@merge-mentor/core/ai/prompts/prd.js";
import { createAIProvider } from "@merge-mentor/core/ai/providerFactory.js";
import type { AIProviderType } from "@merge-mentor/core/ai/types.js";
import { formatMb, MAX_DOCX_BYTES } from "@merge-mentor/core/review/prd/docxValidator.js";
import { type PrdReviewResult, runPrdReview } from "@merge-mentor/core/review/prd/prdEngine.js";
import { ValidationError } from "@merge-mentor/shared/errors/index.js";
import {
  consoleOutputWriter,
  type FileSystem,
  nodeFs,
  type OutputWriter,
} from "@merge-mentor/shared/ports/index.js";

import type { PrdOptions } from "./types.js";

/** Document types accepted by `--type`. */
const PRD_DOCUMENT_TYPES: readonly PrdDocumentType[] = ["prd", "frd"];

/** Collaborators for {@link executePrdReview}; defaults are the real implementations. */
export interface PrdCommandDeps {
  /** Output writer for progress and the summary. Defaults to `consoleOutputWriter`. */
  readonly output?: OutputWriter;
  /** Filesystem used for the up-front file checks. Defaults to `nodeFs`. */
  readonly fileSystem?: Pick<FileSystem, "stat">;
}

/**
 * Validates a `--type` value.
 *
 * @throws {ValidationError} when the value is not `prd` or `frd`
 */
export function parsePrdDocumentType(value: string | undefined): PrdDocumentType {
  const normalized = (value ?? "prd").trim().toLowerCase();
  const match = PRD_DOCUMENT_TYPES.find((type) => type === normalized);
  if (!match) {
    throw new ValidationError(
      "--type",
      `"${value ?? ""}" is not a document type; use ${PRD_DOCUMENT_TYPES.join(" or ")}`
    );
  }
  return match;
}

/**
 * Executes the `prd` command: reviews a PRD or FRD Word document (`.docx`)
 * and saves a Markdown and JSON report under the temp path.
 *
 * Runs entirely against the configured AI provider; the document is not sent
 * anywhere else. The AI client is created without write or shell tools
 * because the document is untrusted input.
 *
 * @param file - Path to the `.docx` file to review
 * @param options - Document type, image opt-in and AI provider settings
 * @param deps - Optional output writer and filesystem
 * @returns The completed review (report and where its files were written)
 * @throws {ValidationError} for an invalid `--type`, a missing file, or a file over the size limit
 */
export async function executePrdReview(
  file: string,
  options: PrdOptions,
  deps: PrdCommandDeps = {}
): Promise<PrdReviewResult> {
  const output = deps.output ?? consoleOutputWriter;
  const fileSystem = deps.fileSystem ?? nodeFs;
  const documentType = parsePrdDocumentType(options.type);
  const filePath = path.resolve(file);

  // Friendly checks before loading config or starting the AI provider. The
  // engine repeats the size check and validates the content (zip signature,
  // zip-bomb guard) itself.
  await assertReadableFile(filePath, file, fileSystem);

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

  const result = await runPrdReview(
    {
      source: { path: filePath },
      documentType,
      includeImages: options.includeImages ?? false,
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

async function assertReadableFile(
  filePath: string,
  displayPath: string,
  fileSystem: Pick<FileSystem, "stat">
): Promise<void> {
  let stats: Awaited<ReturnType<FileSystem["stat"]>>;
  try {
    stats = await fileSystem.stat(filePath);
  } catch {
    throw new ValidationError("file", `${displayPath} was not found`);
  }
  if (!stats.isFile()) {
    throw new ValidationError("file", `${displayPath} is not a file`);
  }
  if (stats.size > MAX_DOCX_BYTES) {
    throw new ValidationError(
      "file",
      `${displayPath} is ${formatMb(stats.size)}, which is over the ${formatMb(MAX_DOCX_BYTES)} limit`
    );
  }
}

/** Prints where the run's files are and how to remove them. */
function displayRunSummary(result: PrdReviewResult, output: OutputWriter): void {
  const { report, paths } = result;
  if (report.imageReview && !report.imageReview.supported) {
    output.log(
      `⚠️ --include-images was set, but images were not reviewed: ${report.imageReview.reason}.\n`
    );
  }
  if (!report.complete) {
    output.log(
      "⚠️ Parts of the document were not reviewed. See “Not reviewed” in the report for details.\n"
    );
  }
  output.log("📁 Saved on this computer only:");
  output.log(`   Report (Markdown): ${paths.reportMarkdown}`);
  output.log(`   Report (JSON):     ${paths.reportJson}`);
  output.log(`   Run data:          ${paths.runDir}`);
  output.log("                      (document copy, extracted text, images, AI transcripts)");
  output.log(
    `\n🗑️  To delete this run, use Delete on the Reports page (merge-mentor ui) or remove the files above.\n`
  );
}
