import type {
  CrossFileFinding,
  CrossFileReviewResult,
  FileFinding,
  FileReviewResult,
  ResolvedComment,
} from "../platforms/types.js";

/**
 * Generates a fingerprint for a finding to enable deduplication.
 * Uses filename, line, category, and first few words of the message.
 */
function generateFindingFingerprint(filename: string, finding: FileFinding): string {
  const firstWords = finding.message.split(/\s+/).slice(0, 10).join(" ").toLowerCase();
  return `${filename}:${finding.line}:${finding.category}:${firstWords}`;
}

/**
 * Generates a fingerprint for a cross-file finding.
 */
function generateCrossFileFindingFingerprint(finding: CrossFileFinding): string {
  const firstWords = finding.message.split(/\s+/).slice(0, 10).join(" ").toLowerCase();
  const filesKey = [...finding.affectedFiles].sort().join(",");
  return `${finding.category}:${filesKey}:${firstWords}`;
}

/**
 * Compares two confidence levels and returns the higher one.
 */
function higherConfidence(
  a: FileFinding["confidence"],
  b: FileFinding["confidence"]
): FileFinding["confidence"] {
  const order: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const aVal = order[a || "low"] || 0;
  const bVal = order[b || "low"] || 0;
  return aVal >= bVal ? a : b;
}

/**
 * Aggregates findings from multiple review runs to deduplicate and merge results.
 */
export class FindingAggregator {
  /**
   * Aggregates file findings from multiple runs, deduplicating and merging similar findings.
   * Returns a single array of FileReviewResult with unique findings from all runs.
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
    // Map: filename -> Map<line, resolved comment>
    const fileResolved = new Map<string, Map<number, ResolvedComment>>();

    for (const run of runs) {
      for (const fileResult of run) {
        if (!fileFindings.has(fileResult.filename)) {
          fileFindings.set(fileResult.filename, new Map());
        }
        const findingsMap = fileFindings.get(fileResult.filename)!;

        for (const finding of fileResult.findings) {
          const fingerprint = generateFindingFingerprint(fileResult.filename, finding);
          const existing = findingsMap.get(fingerprint);

          if (!existing) {
            findingsMap.set(fingerprint, finding);
          } else {
            // Keep finding with higher confidence
            const bestConfidence = higherConfidence(existing.confidence, finding.confidence);
            if (bestConfidence === finding.confidence && bestConfidence !== existing.confidence) {
              findingsMap.set(fingerprint, finding);
            }
          }
        }

        // Aggregate resolved comments
        if (fileResult.resolvedComments) {
          if (!fileResolved.has(fileResult.filename)) {
            fileResolved.set(fileResult.filename, new Map());
          }
          const resolvedMap = fileResolved.get(fileResult.filename)!;
          for (const resolved of fileResult.resolvedComments) {
            // Keep the first resolution reason we find for each line
            if (!resolvedMap.has(resolved.line)) {
              resolvedMap.set(resolved.line, resolved);
            }
          }
        }
      }
    }

    // Convert back to FileReviewResult array
    const results: FileReviewResult[] = [];
    for (const [filename, findingsMap] of fileFindings) {
      const resolvedMap = fileResolved.get(filename);
      const resolvedComments = resolvedMap ? Array.from(resolvedMap.values()) : undefined;
      results.push({
        filename,
        findings: Array.from(findingsMap.values()),
        resolvedComments:
          resolvedComments && resolvedComments.length > 0 ? resolvedComments : undefined,
      });
    }

    return results;
  }

  /**
   * Aggregates cross-file findings from multiple runs.
   * Deduplicates findings and combines recommendations.
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
