/**
 * Aggregation and deduplication of findings from multiple review runs.
 *
 * When the ReviewEngine runs multiple review passes (reviewRuns > 1), each pass
 * can produce different findings. The FindingAggregator merges these findings using
 * fingerprinting to:
 * - Deduplicate identical findings across runs
 * - Deduplicate cross-file findings
 * - Merge and combine recommendations
 * - Select the best overall assessment
 *
 * Fingerprinting strategy:
 * - File findings: `filename:line:category:first10words` of message
 * - Cross-file findings: `category:sortedfiles:first10words` of message
 *
 * This allows reliable deduplication even when:
 * - AI uses slightly different wording on the same issue
 * - Same issue found in multiple runs
 * - Multiple related files affected by same issue
 *
 * @example
 * ```typescript
 * const aggregator = new FindingAggregator();
 *
 * // Run review 3 times and collect results
 * const run1Results = await engine.reviewFiles(files);
 * const run2Results = await engine.reviewFiles(files);
 * const run3Results = await engine.reviewFiles(files);
 *
 * // Aggregate findings
 * const uniqueFindings = aggregator.aggregateFileFindings([
 *   run1Results,
 *   run2Results,
 *   run3Results,
 * ]);
 *
 * console.log(`Found ${uniqueFindings.length} unique findings`);
 * ```
 */

import type {
  CrossFileFinding,
  CrossFileReviewResult,
  FileFinding,
  FileReviewResult,
} from "../platforms/types.js";

/**
 * Generates a fingerprint for a finding to enable deduplication.
 *
 * Fingerprint components: `filename:line:category:first10words`
 *
 * Using the first 10 words allows exact duplicates to match perfectly while also
 * catching similar findings with slightly different wording. The category ensures
 * different types of issues on the same line don't merge.
 *
 * @param filename - The file path
 * @param finding - The finding object with message, line, category
 * @returns Fingerprint string for deduplication matching
 *
 * @example
 * ```typescript
 * // Finding about unused variable
 * const fp1 = generateFindingFingerprint('main.ts', {
 *   line: 42,
 *   category: 'code-quality',
 *   message: 'Unused variable should be removed',
 * });
 *
 * // Different wording, same issue
 * const fp2 = generateFindingFingerprint('main.ts', {
 *   line: 42,
 *   category: 'code-quality',
 *   message: 'Unused variable x not used anywhere',
 * });
 *
 * // fp1 === fp2 (deduped)
 * ```
 */
function generateFindingFingerprint(filename: string, finding: FileFinding): string {
  const firstWords = finding.message.split(/\s+/).slice(0, 10).join(" ").toLowerCase();
  return `${filename}:${finding.line}:${finding.category}:${firstWords}`;
}

/**
 * Generates a fingerprint for a cross-file finding.
 *
 * Fingerprint components: `category:sortedfiles:first10words`
 *
 * Sorting the affected files list ensures consistent fingerprints regardless
 * of the order files appear in results (from run to run).
 *
 * @param finding - The cross-file finding
 * @returns Fingerprint string for deduplication matching
 */
function generateCrossFileFindingFingerprint(finding: CrossFileFinding): string {
  const firstWords = finding.message.split(/\s+/).slice(0, 10).join(" ").toLowerCase();
  const filesKey = [...finding.affectedFiles].sort().join(",");
  return `${finding.category}:${filesKey}:${firstWords}`;
}

/**
 * Aggregates findings from multiple review runs to deduplicate and merge results.
 *
 * Each FindingAggregator instance is independent and stateless. Reuse for multiple
 * aggregation operations.
 */
export class FindingAggregator {
  /**
   * Aggregates file findings from multiple runs.
   *
   * Deduplicates findings using fingerprints, returning a single array of
   * FileReviewResult with unique findings from all runs combined.
   *
   * Handles edge cases:
   * - Empty input: returns []
   * - Single run: returns copy of findings
   * - Multiple runs: merges using fingerprinting
   *
   * @param runs - Array of run results (each run is array of FileReviewResult)
   * @returns Merged findings with duplicates removed, preserving best match per fingerprint
   *
   * @example
   * ```typescript
   * const aggregator = new FindingAggregator();
   *
   * const merged = aggregator.aggregateFileFindings([
   *   run1FileResults,  // result from first review run
   *   run2FileResults,  // result from second review run
   * ]);
   *
   * console.log(`Original: ${run1FileResults.length + run2FileResults.length} findings`);
   * console.log(`Deduplicated: ${merged.length} unique findings`);
   * ```
   */
  aggregateFileFindings(runs: FileReviewResult[][]): FileReviewResult[] {
    if (runs.length === 0) {
      return [];
    }

    if (runs.length === 1) {
      return [...runs[0]];
    }

    // Map: filename -> Map<fingerprint, best finding>
    const fileFindings = new Map<string, Map<string, FileFinding>>();

    for (const run of runs) {
      for (const fileResult of run) {
        if (!fileFindings.has(fileResult.filename)) {
          fileFindings.set(fileResult.filename, new Map());
        }
        const findingsMap = fileFindings.get(fileResult.filename);
        if (!findingsMap) continue;

        for (const finding of fileResult.findings) {
          const fingerprint = generateFindingFingerprint(fileResult.filename, finding);
          const existing = findingsMap.get(fingerprint);

          if (!existing) {
            findingsMap.set(fingerprint, finding);
          }
        }
      }
    }

    // Convert back to FileReviewResult array
    const results: FileReviewResult[] = [];
    for (const [filename, findingsMap] of fileFindings) {
      results.push({
        filename,
        findings: Array.from(findingsMap.values()),
      });
    }

    return results;
  }

  /**
   * Aggregates cross-file findings from multiple runs.
   *
   * Merges findings and recommendations, selecting the longest/most detailed
   * overall assessment. Deduplicates cross-file findings using fingerprints.
   *
   * Handles edge cases:
   * - Empty input: returns empty result
   * - Single run: returns that run as-is
   * - Multiple runs: merges all findings and recommendations
   *
   * @param runs - Array of cross-file results from multiple runs
   * @returns Merged cross-file result with deduped findings and recommendations
   *
   * @example
   * ```typescript
   * const aggregator = new FindingAggregator();
   *
   * const merged = aggregator.aggregateCrossFileFindings([
   *   run1CrossFileResult,
   *   run2CrossFileResult,
   * ]);
   *
   * console.log(`Overall assessment: ${merged.overallAssessment}`);
   * console.log(`Cross-file findings: ${merged.findings.length}`);
   * console.log(`Recommendations: ${merged.recommendations.length}`);
   * ```
   */
  aggregateCrossFileFindings(runs: CrossFileReviewResult[]): CrossFileReviewResult {
    if (runs.length === 0) {
      return {
        overallAssessment: "No review data available",
        findings: [],
        recommendations: [],
      };
    }

    if (runs.length === 1) {
      return runs[0];
    }

    // Use the longest/most detailed overall assessment
    let bestAssessment = runs[0].overallAssessment;
    for (const run of runs) {
      if (run.overallAssessment.length > bestAssessment.length) {
        bestAssessment = run.overallAssessment;
      }
    }

    // Deduplicate findings
    const findingsMap = new Map<string, CrossFileFinding>();
    for (const run of runs) {
      for (const finding of run.findings) {
        const fingerprint = generateCrossFileFindingFingerprint(finding);
        if (!findingsMap.has(fingerprint)) {
          findingsMap.set(fingerprint, finding);
        }
      }
    }

    // Deduplicate recommendations
    const recommendationsSet = new Set<string>();
    for (const run of runs) {
      for (const rec of run.recommendations) {
        recommendationsSet.add(rec);
      }
    }

    return {
      overallAssessment: bestAssessment,
      findings: Array.from(findingsMap.values()),
      recommendations: Array.from(recommendationsSet),
    };
  }
}
