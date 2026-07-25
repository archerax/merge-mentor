import path from "node:path";
import { buildGeneralFileReviewPrompt } from "../ai/prompts/specialists/general.js";
import type { AIProviderClient, AIResponse } from "../ai/types.js";
import { CorpusEvalError } from "../errors/index.js";
import type { FileFinding, FileReviewResult, FindingSeverity } from "../platforms/types.js";
import type { FileSystem } from "../ports/fileSystem.js";
import { nodeFs } from "../ports/fileSystem.js";
import type { DiffManifest } from "../review/diffStorage.js";
import { MockAIProvider } from "./mockProvider.js";
import type {
  EvalHarnessOptions,
  ExpectedFinding,
  ForbiddenFinding,
  FullEvalReport,
  GroundTruth,
  ScenarioEvalResult,
} from "./types.js";

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Checks whether a path exists in the given filesystem. */
async function pathExists(fs: FileSystem, p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Normalizes file paths for comparison. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
}

/** Checks if a generated finding matches an expected ground truth specification. */
export function matchFinding(
  finding: FileFinding & { filePath?: string },
  expected: ExpectedFinding
): boolean {
  if (finding.filePath) {
    const normFindingPath = normalizePath(finding.filePath);
    const normExpectedPath = normalizePath(expected.filePath);
    if (
      !normFindingPath.endsWith(normExpectedPath) &&
      !normExpectedPath.endsWith(normFindingPath)
    ) {
      return false;
    }
  }

  if (expected.category) {
    const expectedCategories = expected.category
      .toLowerCase()
      .split("|")
      .map((c) => c.trim());
    if (!expectedCategories.includes(finding.category.toLowerCase())) {
      return false;
    }
  }

  if (expected.minSeverity) {
    const expectedRank = SEVERITY_RANK[expected.minSeverity.toLowerCase() as FindingSeverity] ?? 0;
    const actualRank = SEVERITY_RANK[finding.severity.toLowerCase() as FindingSeverity] ?? 0;
    if (actualRank < expectedRank) {
      return false;
    }
  }

  if (expected.containsKeywords && expected.containsKeywords.length > 0) {
    const fullText =
      `${finding.message} ${finding.reasoning ?? ""} ${finding.suggestion ?? ""}`.toLowerCase();
    for (const kw of expected.containsKeywords) {
      const alternatives = kw
        .toLowerCase()
        .split("|")
        .map((alt) => alt.trim());
      const matchesAnyAlt = alternatives.some((alt) => fullText.includes(alt));
      if (!matchesAnyAlt) {
        return false;
      }
    }
  }

  return true;
}

/** Checks if a generated finding matches a forbidden false-positive specification. */
export function matchForbiddenFinding(
  finding: FileFinding & { filePath?: string },
  forbidden: ForbiddenFinding
): boolean {
  if (finding.filePath) {
    const normFindingPath = normalizePath(finding.filePath);
    const normForbiddenPath = normalizePath(forbidden.filePath);
    if (
      normFindingPath.endsWith(normForbiddenPath) ||
      normForbiddenPath.endsWith(normFindingPath)
    ) {
      return true;
    }
  }
  return false;
}

/** Evaluates a single evaluation scenario directory. */
export async function evaluateScenario(
  scenarioDir: string,
  options?: EvalHarnessOptions
): Promise<ScenarioEvalResult> {
  const fs: FileSystem = options?.fileSystem ?? nodeFs;
  const minRecall = options?.minRecall ?? 0.9;
  const minPrecision = options?.minPrecision ?? 0.85;
  const scenarioId = path.basename(scenarioDir);

  const gtPath = path.join(scenarioDir, "ground-truth.json");
  if (!(await pathExists(fs, gtPath))) {
    throw new CorpusEvalError(scenarioId, `Missing ground-truth.json file in "${scenarioDir}"`);
  }

  let groundTruth: GroundTruth;
  try {
    const gtContent = await fs.readFile(gtPath, "utf-8");
    groundTruth = JSON.parse(gtContent) as GroundTruth;
  } catch (err) {
    throw new CorpusEvalError(
      scenarioId,
      `Failed to parse ground-truth.json: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let provider: AIProviderClient;
  const providerType = options?.provider ?? "mock";
  if (providerType === "mock") {
    provider = new MockAIProvider({ scenarioDir, fileSystem: fs });
  } else {
    const { createAIProvider } = await import("../ai/providerFactory.js");
    provider = createAIProvider(providerType);
  }

  let prompt =
    "Review all changed files in this pull request scenario. Return a JSON object with a fileResults array containing findings for each file.";
  let diffFiles: string[] | undefined;

  const diffManifestPath = path.join(scenarioDir, "diffs", "manifest.json");
  if (await pathExists(fs, diffManifestPath)) {
    try {
      const manifestContent = await fs.readFile(diffManifestPath, "utf-8");
      const manifest = JSON.parse(manifestContent) as DiffManifest;
      prompt = buildGeneralFileReviewPrompt(manifest, undefined, scenarioDir);
      diffFiles = manifest.files.map((f) => path.join(scenarioDir, "diffs", f.diffPath));
    } catch {
      // Fall back to default prompt on error loading manifest
    }
  }

  const response: AIResponse = await provider.executePrompt(prompt, {
    workingDirectory: scenarioDir,
    ...(diffFiles ? { diffFiles } : {}),
  });

  const fileResults: FileReviewResult[] = provider.parseBatchedFileReview(response);
  const fastResults = provider.parseFastReview(response);
  const combinedFileResults = fileResults.length > 0 ? fileResults : fastResults.fileResults;

  const allFindings: Array<FileFinding & { filePath: string }> = [];
  for (const fr of combinedFileResults) {
    for (const f of fr.findings) {
      allFindings.push({ ...f, filePath: fr.filename });
    }
  }

  const caughtFindings: string[] = [];
  const matchedFindingIndexes = new Set<number>();

  for (const expected of groundTruth.expectedFindings) {
    let caught = false;
    for (let i = 0; i < allFindings.length; i++) {
      if (matchFinding(allFindings[i], expected)) {
        caught = true;
        matchedFindingIndexes.add(i);
      }
    }
    if (caught) {
      caughtFindings.push(expected.id);
    }
  }

  const missedFindings = groundTruth.expectedFindings
    .filter((ef) => !caughtFindings.includes(ef.id))
    .map((ef) => ef.id);

  const falsePositives: string[] = [];
  for (let i = 0; i < allFindings.length; i++) {
    const finding = allFindings[i];
    let isForbidden = false;
    for (const forbidden of groundTruth.forbiddenFindings) {
      if (matchForbiddenFinding(finding, forbidden)) {
        isForbidden = true;
        break;
      }
    }

    if (isForbidden || (!matchedFindingIndexes.has(i) && groundTruth.expectedFindings.length > 0)) {
      falsePositives.push(`${finding.filePath}:${finding.line} - ${finding.message}`);
    }
  }

  let duplicateCount = 0;
  const findingKeys = new Set<string>();
  for (const f of allFindings) {
    const key = `${normalizePath(f.filePath)}:${f.line}:${f.category}:${f.message.trim().toLowerCase()}`;
    if (findingKeys.has(key)) {
      duplicateCount++;
    } else {
      findingKeys.add(key);
    }
  }

  const recall =
    groundTruth.expectedFindings.length > 0
      ? caughtFindings.length / groundTruth.expectedFindings.length
      : 1.0;

  const totalPositives = caughtFindings.length + falsePositives.length;
  const precision = totalPositives > 0 ? caughtFindings.length / totalPositives : 1.0;

  const passed =
    recall >= minRecall &&
    precision >= minPrecision &&
    duplicateCount <= groundTruth.maxAllowedDuplicates;

  return {
    scenarioId: groundTruth.scenarioId || scenarioId,
    name: groundTruth.name || scenarioId,
    passed,
    recall,
    precision,
    duplicateCount,
    caughtFindings,
    missedFindings,
    falsePositives,
  };
}

/** Evaluates all scenarios in the Golden-PR evaluation corpus. */
export async function evaluateCorpus(options?: EvalHarnessOptions): Promise<FullEvalReport> {
  const fs: FileSystem = options?.fileSystem ?? nodeFs;
  const corpusDir = options?.corpusDir ?? path.join(process.cwd(), "test/eval/corpus");

  if (!(await pathExists(fs, corpusDir))) {
    throw new CorpusEvalError(undefined, `Evaluation corpus directory not found at "${corpusDir}"`);
  }

  const dirents = await fs.readdir(corpusDir, { withFileTypes: true });
  const scenarioResults: ScenarioEvalResult[] = [];

  for (const entry of dirents) {
    const name = typeof entry === "string" ? entry : (entry as { name: string }).name;
    const fullPath = path.join(corpusDir, name);
    const gtPath = path.join(fullPath, "ground-truth.json");
    if (await pathExists(fs, gtPath)) {
      const result = await evaluateScenario(fullPath, options);
      scenarioResults.push(result);
    }
  }

  if (scenarioResults.length === 0) {
    throw new CorpusEvalError(undefined, `No evaluation scenarios found in "${corpusDir}"`);
  }

  const meanRecall = scenarioResults.reduce((acc, r) => acc + r.recall, 0) / scenarioResults.length;
  const meanPrecision =
    scenarioResults.reduce((acc, r) => acc + r.precision, 0) / scenarioResults.length;
  const totalDuplicates = scenarioResults.reduce((acc, r) => acc + r.duplicateCount, 0);
  const overallPassed = scenarioResults.every((r) => r.passed);

  const report: FullEvalReport = {
    timestamp: new Date().toISOString(),
    overallPassed,
    meanRecall,
    meanPrecision,
    totalDuplicates,
    scenarioResults,
  };

  if (options?.outputFile) {
    await fs.writeFile(options.outputFile, JSON.stringify(report, null, 2), "utf-8");
  }

  return report;
}

/** Formats a FullEvalReport into a clean, colorized terminal summary. */
export function formatTerminalSummary(report: FullEvalReport): string {
  const lines: string[] = [];
  lines.push("================================================================");
  lines.push("          🎯 GOLDEN-PR EVALUATION HARNESS REPORT               ");
  lines.push("================================================================");
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(`Overall Status: ${report.overallPassed ? "✅ PASS" : "❌ FAIL"}`);
  lines.push(`Mean Recall:    ${(report.meanRecall * 100).toFixed(1)}%`);
  lines.push(`Mean Precision: ${(report.meanPrecision * 100).toFixed(1)}%`);
  lines.push(`Total Dups:     ${report.totalDuplicates}`);
  lines.push("----------------------------------------------------------------");
  lines.push("SCENARIO SUMMARY:");
  lines.push("----------------------------------------------------------------");

  for (const res of report.scenarioResults) {
    const status = res.passed ? "PASS" : "FAIL";
    const recallPct = `${(res.recall * 100).toFixed(0)}%`;
    const precPct = `${(res.precision * 100).toFixed(0)}%`;
    lines.push(
      `[${status.padEnd(4)}] ${res.scenarioId.padEnd(28)} | Recall: ${recallPct.padStart(4)} | Prec: ${precPct.padStart(4)} | Dups: ${res.duplicateCount}`
    );
    if (!res.passed) {
      if (res.missedFindings.length > 0) {
        lines.push(`       Missed Findings: ${res.missedFindings.join(", ")}`);
      }
      if (res.falsePositives.length > 0) {
        lines.push(`       False Positives: ${res.falsePositives.join(", ")}`);
      }
    }
  }

  lines.push("================================================================");
  return lines.join("\n");
}
