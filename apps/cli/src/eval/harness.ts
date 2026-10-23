import os from "node:os";
import path from "node:path";

import { buildGeneralFileReviewPrompt } from "@merge-mentor/core/ai/prompts/specialists/general.js";
import type { AIProviderClient, AIResponse } from "@merge-mentor/core/ai/types.js";
import type { DiffManifest } from "@merge-mentor/domain/diff.js";
import type {
  FileFinding,
  FileReviewResult,
  FindingSeverity,
} from "@merge-mentor/domain/platform.js";
import { AIProviderError, CorpusEvalError } from "@merge-mentor/shared/errors/index.js";
import type { FileSystem } from "@merge-mentor/shared/ports/fileSystem.js";
import { nodeFs } from "@merge-mentor/shared/ports/fileSystem.js";
import { getIgnorePatterns, shouldIgnoreFile } from "@merge-mentor/shared/utils/ignoreFilter.js";

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

/** Tells sandboxed providers where the diffs are so they do not probe outside it. */
const SANDBOX_NOTE = `

# EVALUATION SANDBOX
The working directory contains only the diff files listed above, in the hidden
.mergementor/diffs folder and as copies in the visible diffs folder. The repository
itself is not available, so source files other than these diffs do not exist. Do not
read any path outside the working directory and do not call bash. Review from the
diffs alone and return the JSON result.
`;

/** Loads and parses a scenario's ground truth. */
async function loadGroundTruth(
  fs: FileSystem,
  scenarioDir: string,
  scenarioId: string
): Promise<GroundTruth> {
  const gtPath = path.join(scenarioDir, "ground-truth.json");
  if (!(await pathExists(fs, gtPath))) {
    throw new CorpusEvalError(scenarioId, `Missing ground-truth.json file in "${scenarioDir}"`);
  }

  try {
    const gtContent = await fs.readFile(gtPath, "utf-8");
    return JSON.parse(gtContent) as GroundTruth;
  } catch (err) {
    throw new CorpusEvalError(
      scenarioId,
      `Failed to parse ground-truth.json: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Describes an expected finding for the report. */
function describeExpected(expected: ExpectedFinding): string {
  const parts = [expected.filePath, expected.category];
  if (expected.minSeverity) parts.push(`>=${expected.minSeverity}`);
  if (expected.containsKeywords?.length) {
    parts.push(`keywords: ${expected.containsKeywords.join(" & ")}`);
  }
  return `${expected.id} (${parts.join(", ")})`;
}

/** Describes a reported finding for the report. */
function describeReported(finding: FileFinding & { filePath: string }): string {
  const message =
    finding.message.length > 160 ? `${finding.message.slice(0, 157)}...` : finding.message;
  return `${finding.filePath}:${finding.line} [${finding.severity}/${finding.category}] ${message}`;
}

/** Evaluates a scenario once. */
async function evaluateScenarioOnce(
  scenarioDir: string,
  groundTruth: GroundTruth,
  options?: EvalHarnessOptions
): Promise<ScenarioEvalResult> {
  const fs: FileSystem = options?.fileSystem ?? nodeFs;
  const minRecall = options?.minRecall ?? 0.9;
  const scenarioId = path.basename(scenarioDir);

  let provider: AIProviderClient;
  const providerType = options?.provider ?? "mock";
  if (providerType === "mock") {
    provider = new MockAIProvider({ scenarioDir, fileSystem: fs });
  } else {
    const { createAIProvider } = await import("@merge-mentor/core/ai/providerFactory.js");
    provider = createAIProvider(providerType, {
      model: options?.model,
      aiBaseUrl: options?.aiBaseUrl,
      aiApiKey: options?.aiApiKey,
    });
  }

  // Real providers get a sandbox holding only the diffs. Pointing them at the scenario
  // directory would expose ground-truth.json and mock-response.json, and a git checkout
  // would pull in unrelated repo files and instructions.
  const sandboxDir =
    providerType === "mock"
      ? undefined
      : path.join(os.tmpdir(), `mm-eval-${scenarioId}-${process.pid}-${Date.now()}`);
  const workDir = sandboxDir ?? scenarioDir;

  let response: AIResponse | undefined;
  let providerError: string | undefined;
  // Set when the production ignore filter leaves nothing to review.
  let skipProvider = false;
  try {
    let prompt =
      "Review all changed files in this pull request scenario. Return a JSON object with a fileResults array containing findings for each file.";
    let diffFiles: string[] | undefined;

    const diffManifestPath = path.join(scenarioDir, "diffs", "manifest.json");
    if (await pathExists(fs, diffManifestPath)) {
      let manifest: DiffManifest;
      try {
        manifest = JSON.parse(await fs.readFile(diffManifestPath, "utf-8")) as DiffManifest;
      } catch (err) {
        throw new CorpusEvalError(
          scenarioId,
          `Failed to parse diffs/manifest.json: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      // Same filter as production: lockfiles, build output and other generated files
      // never reach the model.
      const ignorePatterns = getIgnorePatterns();
      manifest = {
        ...manifest,
        files: (manifest.files ?? []).filter((f) => !shouldIgnoreFile(f.filename, ignorePatterns)),
      };
      skipProvider = manifest.files.length === 0;
      const files: string[] = [];
      for (const f of manifest.files) {
        if (typeof f.diffPath !== "string" || f.diffPath.length === 0) {
          throw new CorpusEvalError(
            scenarioId,
            `diffs/manifest.json entry for "${f.filename}" has no "diffPath"`
          );
        }
        const source = path.join(scenarioDir, "diffs", f.diffPath);
        if (sandboxDir) {
          const target = path.join(sandboxDir, ".mergementor", "diffs", f.diffPath);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.mkdir(path.join(sandboxDir, "diffs"), { recursive: true });
          const content = await fs.readFile(source, "utf-8");
          await fs.writeFile(target, content, "utf-8");
          // Visible copy: directory listings omit the hidden folder above.
          await fs.writeFile(path.join(sandboxDir, "diffs", f.diffPath), content, "utf-8");
          files.push(target);
        } else {
          files.push(source);
        }
      }
      prompt = buildGeneralFileReviewPrompt(manifest, undefined, workDir);
      if (sandboxDir) {
        // The diffs sit in the hidden .mergementor folder, which directory listings
        // omit, and a read outside the sandbox is rejected and aborts the session.
        prompt += SANDBOX_NOTE;
      }
      diffFiles = files;
    }

    if (!skipProvider) {
      if (sandboxDir) {
        await fs.mkdir(sandboxDir, { recursive: true });
      }
      response = await provider.executePrompt(prompt, {
        workingDirectory: workDir,
        ...(diffFiles ? { diffFiles } : {}),
      });
    }
  } catch (err) {
    // A provider failure fails this scenario, not the whole corpus run.
    if (!(err instanceof AIProviderError)) throw err;
    providerError = err.message;
  } finally {
    if (sandboxDir) {
      await fs.rm(sandboxDir, { recursive: true, force: true });
    }
  }

  if (response === undefined && !skipProvider) {
    return {
      scenarioId: groundTruth.scenarioId || scenarioId,
      name: groundTruth.name || scenarioId,
      passed: false,
      recall: 0,
      precision: 0,
      duplicateCount: 0,
      caughtFindings: [],
      missedFindings: groundTruth.expectedFindings.map((ef) => ef.id),
      missedDetails: groundTruth.expectedFindings.map(describeExpected),
      falsePositives: [],
      reportedFindings: [],
      error: providerError ?? "AI provider returned no response",
    };
  }

  let combinedFileResults: FileReviewResult[] = [];
  if (response !== undefined) {
    const fileResults = provider.parseBatchedFileReview(response);
    const fastResults = provider.parseFastReview(response);
    combinedFileResults = fileResults.length > 0 ? fileResults : fastResults.fileResults;
  }

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

    const isAcceptable =
      !isForbidden &&
      (groundTruth.acceptableFindings ?? []).some((ok) => matchFinding(finding, ok));

    if (
      isForbidden ||
      (!matchedFindingIndexes.has(i) && !isAcceptable && groundTruth.expectedFindings.length > 0)
    ) {
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

  // Precision is gated on the corpus mean (see evaluateCorpus), so one extra finding
  // does not fail a scenario whose expected issues were all caught.
  const passed = recall >= minRecall && duplicateCount <= groundTruth.maxAllowedDuplicates;

  return {
    scenarioId: groundTruth.scenarioId || scenarioId,
    name: groundTruth.name || scenarioId,
    passed,
    recall,
    precision,
    duplicateCount,
    caughtFindings,
    missedFindings,
    missedDetails: groundTruth.expectedFindings
      .filter((ef) => missedFindings.includes(ef.id))
      .map(describeExpected),
    falsePositives,
    reportedFindings: allFindings.map(describeReported),
  };
}

/** Averages several runs of one scenario into a single result. */
function aggregateRuns(
  results: readonly ScenarioEvalResult[],
  groundTruth: GroundTruth,
  options?: EvalHarnessOptions
): ScenarioEvalResult {
  const n = results.length;
  const mean = (pick: (r: ScenarioEvalResult) => number): number =>
    results.reduce((acc, r) => acc + pick(r), 0) / n;
  const recall = mean((r) => r.recall);
  const precision = mean((r) => r.precision);
  const duplicateCount = Math.max(...results.map((r) => r.duplicateCount));
  const countIn = (pick: (r: ScenarioEvalResult) => readonly string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const r of results) {
      for (const item of new Set(pick(r))) counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    return counts;
  };
  const withCounts = (counts: Map<string, number>): string[] =>
    [...counts].map(([item, c]) => (c === n ? item : `${item} [${c}/${n} runs]`));
  const errors = results.map((r) => r.error).filter((e): e is string => e !== undefined);

  return {
    scenarioId: results[0].scenarioId,
    name: results[0].name,
    passed:
      recall >= (options?.minRecall ?? 0.9) &&
      duplicateCount <= groundTruth.maxAllowedDuplicates &&
      errors.length === 0,
    recall,
    precision,
    duplicateCount,
    runs: n,
    caughtFindings: [...countIn((r) => r.caughtFindings).keys()],
    missedFindings: withCounts(countIn((r) => r.missedFindings)),
    missedDetails: withCounts(countIn((r) => r.missedDetails ?? [])),
    falsePositives: withCounts(countIn((r) => r.falsePositives)),
    reportedFindings: results.flatMap((r, i) =>
      (r.reportedFindings ?? []).map((f) => `run ${i + 1}: ${f}`)
    ),
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  };
}

/** Evaluates a single evaluation scenario directory, averaging `options.runs` samples. */
export async function evaluateScenario(
  scenarioDir: string,
  options?: EvalHarnessOptions
): Promise<ScenarioEvalResult> {
  const fs: FileSystem = options?.fileSystem ?? nodeFs;
  const groundTruth = await loadGroundTruth(fs, scenarioDir, path.basename(scenarioDir));
  const runs = Math.max(1, Math.floor(options?.runs ?? 1));
  if (runs === 1) {
    return evaluateScenarioOnce(scenarioDir, groundTruth, options);
  }
  const results: ScenarioEvalResult[] = [];
  for (let i = 0; i < runs; i++) {
    results.push(await evaluateScenarioOnce(scenarioDir, groundTruth, options));
  }
  return aggregateRuns(results, groundTruth, options);
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
  // Every scenario must catch its expected issues; precision is judged on the mean.
  const overallPassed =
    scenarioResults.every((r) => r.passed) && meanPrecision >= (options?.minPrecision ?? 0.85);

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
    const runsNote = res.runs && res.runs > 1 ? ` | Runs: ${res.runs}` : "";
    lines.push(
      `[${status.padEnd(4)}] ${res.scenarioId.padEnd(28)} | Recall: ${recallPct.padStart(4)} | Prec: ${precPct.padStart(4)} | Dups: ${res.duplicateCount}${runsNote}`
    );
    if (res.error) {
      lines.push(`       Error: ${res.error}`);
    }
    if (res.missedFindings.length > 0) {
      lines.push(`       Missed Findings: ${res.missedFindings.join(", ")}`);
      for (const detail of res.missedDetails ?? []) {
        lines.push(`         expected ${detail}`);
      }
      // Show what the model did report, to tell a wrong severity from no finding at all.
      for (const reported of res.reportedFindings ?? []) {
        lines.push(`         reported ${reported}`);
      }
      if ((res.reportedFindings ?? []).length === 0) {
        lines.push("         reported (no findings)");
      }
    }
    if (res.falsePositives.length > 0) {
      lines.push(`       False Positives: ${res.falsePositives.join(", ")}`);
    }
  }

  lines.push("================================================================");
  return lines.join("\n");
}
