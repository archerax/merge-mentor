import { BuildAnalysisError } from "./errors.js";
import { storeLogArtifacts } from "./logArtifacts.js";
import { prepareEvidence } from "./logNormalizer.js";
import { fallbackDiagnosis, parseDiagnosis } from "./parser.js";
import { buildAnalysisPrompt } from "./prompt.js";
import { renderReport } from "./renderer.js";
import type {
  BuildAnalysisOptions,
  BuildAnalysisProvider,
  BuildAnalysisResult,
  BuildDiagnosis,
  BuildReference,
} from "./types.js";

export async function analyzeBuild(
  reference: BuildReference,
  provider: BuildAnalysisProvider,
  options: BuildAnalysisOptions = {}
): Promise<BuildAnalysisResult> {
  const summary = await provider.getBuildSummary(reference);
  if (summary.status === "inProgress") {
    throw new BuildAnalysisError(
      `Build ${summary.id} is still running; analysis requires a completed build.`
    );
  }
  if (summary.result === "succeeded") {
    throw new BuildAnalysisError(
      `Build ${summary.id} completed successfully; there is no failure to analyze.`
    );
  }
  const chunks = await provider.getFailedLogs(reference);
  const evidence = prepareEvidence(chunks, options.maxLogBytes);
  const artifacts = await storeLogArtifacts(reference, chunks, evidence.blocks, {
    tempPath: options.tempPath ?? ".mergementor",
    tailLines: options.initialTailLines,
    tailBytes: options.initialTailBytes,
    fileSystem: options.fileSystem,
  });
  let diagnosis: BuildDiagnosis;
  if (options.aiProvider) {
    try {
      const response = await options.aiProvider.executePrompt(
        buildAnalysisPrompt(reference, summary, evidence, artifacts.artifacts),
        { promptType: "build-analysis", workingDirectory: artifacts.directory }
      );
      diagnosis = parseDiagnosis(response.raw, evidence, artifacts.artifacts);
    } catch (error) {
      diagnosis = fallbackDiagnosis(
        evidence,
        `AI analysis was unavailable or invalid: ${(error as Error).message}`
      );
    }
  } else {
    diagnosis = fallbackDiagnosis(evidence, "No AI provider was configured.");
  }
  return {
    summary,
    evidence,
    diagnosis,
    report: renderReport(reference, summary, evidence, diagnosis),
    logDirectory: artifacts.directory,
  };
}
