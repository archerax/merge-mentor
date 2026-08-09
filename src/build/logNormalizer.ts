import { redactLog } from "./logArtifacts.js";
import type { BuildLogChunk, EvidenceBlock, FailureType, PreparedEvidence } from "./types.js";

const SIGNALS: readonly [FailureType, RegExp, number][] = [
  [
    "compilation",
    /(?:error TS\d+|cannot find symbol|compilation failed|build failed|CS\d{4})/i,
    0.95,
  ],
  ["test", /(?:failed|failure|assert(?:ion)?error|test suite failed|expect\()/i, 0.85],
  ["lint", /(?:eslint|biome|prettier|lint(?:ing)? error)/i, 0.85],
  [
    "dependency",
    /(?:unable to resolve|could not resolve|no matching version|lockfile|npm ERR!|pnpm ERR)/i,
    0.9,
  ],
  ["timeout", /(?:timed? ?out|timeout|deadline exceeded|cancelled)/i, 0.9],
  [
    "infrastructure",
    /(?:out of memory|runner|agent|service unavailable|HTTP 5\d\d|ECONN|permission denied)/i,
    0.8,
  ],
];

/**
 * Classifies a log line into a failure category.
 *
 * Tests the text against known failure signal patterns and returns the first
 * matching category with its confidence.
 *
 * @param text - The log line to classify.
 * @returns The matched failure category and confidence, or an `"unknown"`
 * category with low confidence when no signal matches.
 */
function classify(text: string): { category: FailureType; confidence: number } {
  for (const [category, pattern, confidence] of SIGNALS) {
    if (pattern.test(text)) return { category, confidence };
  }
  return { category: "unknown", confidence: 0.25 };
}

/**
 * Normalizes raw build log chunks into curated, deduplicated evidence.
 *
 * Chunks are prioritized by their failure-candidate flag, scanned for
 * signal-bearing lines, and sliced into bounded evidence blocks that are
 * deduplicated, redacted, and classified.
 *
 * @param chunks - The failed build's raw log chunks.
 * @param maxBytes - Total byte budget for the captured evidence.
 * @returns The prepared evidence blocks plus truncation/redaction flags.
 */
export function prepareEvidence(
  chunks: readonly BuildLogChunk[],
  maxBytes = 24_000
): PreparedEvidence {
  const blocks: EvidenceBlock[] = [];
  let bytes = 0;
  let redacted = false;
  let truncated = false;
  const seen = new Set<string>();
  const ordered = [...chunks].sort(
    (a, b) => Number(b.isFailureCandidate) - Number(a.isFailureCandidate)
  );
  for (const chunk of ordered) {
    const lines = chunk.content.split(/\r?\n/).filter((line) => line.trim());
    const candidateIndexes = lines.flatMap((line, index) =>
      classify(line).category !== "unknown" ? [index] : []
    );
    const selected = candidateIndexes.flatMap((index) =>
      lines.slice(Math.max(0, index - 1), index + 2)
    );
    const source = selected.length > 0 ? selected : lines.slice(-8);
    const content = source.join("\n");
    if (!content || seen.has(content)) continue;
    seen.add(content);
    const safeText = redactLog(content);
    const safe = { text: safeText, changed: safeText !== content };
    redacted ||= safe.changed;
    const classification = classify(safe.text);
    const prefix = `E${blocks.length + 1}`;
    const remaining = maxBytes - bytes;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const bounded =
      Buffer.byteLength(safe.text) <= remaining
        ? safe.text
        : Buffer.from(safe.text).subarray(0, remaining).toString("utf8");
    if (bounded.length < safe.text.length) truncated = true;
    blocks.push({
      id: prefix,
      category: classification.category,
      confidence: classification.confidence,
      content: bounded,
      jobName: chunk.jobName,
      sequence: chunk.sequence,
    });
    bytes += Buffer.byteLength(bounded);
  }
  return { blocks, truncated, redacted };
}
