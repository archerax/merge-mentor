import { JsonParseError } from "../errors/index.js";
import { createChildLogger } from "../logger.js";
import type {
  CrossFileFinding,
  CrossFileReviewResult,
  FileFinding,
  FileReviewResult,
} from "../platforms/types.js";
import type { AIResponse, TokenUsage } from "./types.js";

const logger = createChildLogger({ component: "ResponseParser" });

/** Raw finding structure from AI JSON response. */
interface RawFileFinding {
  line?: unknown;
  severity?: unknown;
  confidence?: unknown;
  category?: unknown;
  message?: unknown;
  suggestion?: unknown;
  reasoning?: unknown;
  isPreExisting?: unknown;
}

/** Raw cross-file finding from AI JSON response. */
interface RawCrossFileFinding {
  severity?: unknown;
  confidence?: unknown;
  category?: unknown;
  message?: unknown;
  reasoning?: unknown;
  affected_files?: unknown[];
}

/** Raw file review response from AI. */
interface RawFileReviewResponse {
  findings?: RawFileFinding[];
}

/** Raw cross-file review response from AI. */
interface RawCrossFileReviewResponse {
  overall_assessment?: string;
  findings?: RawCrossFileFinding[];
  recommendations?: unknown[];
}

/** Raw batched file review response from AI. */
interface RawBatchedFileReviewResponse {
  file_results?: Record<string, RawFileReviewResponse>;
}

/**
 * Parses JSON from raw AI response content.
 * Handles both markdown code blocks and raw JSON.
 *
 * @param raw - Raw response content
 * @returns Parsed JSON object
 * @throws {JsonParseError} When JSON cannot be extracted or parsed
 */
export function parseJsonFromContent(raw: string): unknown {
  logger.debug(
    {
      responseLength: raw.length,
      responsePreview: raw.substring(0, 500),
      responseSuffix: raw.substring(Math.max(0, raw.length - 500)),
    },
    "Parsing JSON response"
  );

  // Try to extract JSON from markdown code blocks first
  const markdownMatch = raw.match(/```json\n([\s\S]*?)\n```/);
  if (markdownMatch) {
    logger.debug(
      {
        jsonLength: markdownMatch[1].length,
        jsonPreview: markdownMatch[1].substring(0, 300),
      },
      "Extracted JSON from markdown code block"
    );
    try {
      const parsed = JSON.parse(markdownMatch[1]);
      logger.debug({ parsedKeys: Object.keys(parsed) }, "JSON parsing successful");
      return parsed;
    } catch (error) {
      logger.warn(
        { error: (error as Error).message },
        "Failed to parse JSON from markdown block, falling back to regex"
      );
    }
  }

  // Fallback: finding the first '{' and last '}'
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.error({ fullResponse: raw }, "No JSON object found in response");
    throw new JsonParseError("No JSON object found in response.", raw);
  }

  logger.debug(
    {
      jsonLength: jsonMatch[0].length,
      jsonPreview: jsonMatch[0].substring(0, 300),
    },
    "Extracted JSON for parsing (regex fallback)"
  );

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    logger.debug({ parsedKeys: Object.keys(parsed) }, "JSON parsing successful");
    return parsed;
  } catch (error) {
    logger.error(
      {
        error: (error as Error).message,
        failedJson: jsonMatch[0],
      },
      "JSON parsing failed"
    );
    throw new JsonParseError((error as Error).message, raw);
  }
}

/**
 * Validates severity value and returns a valid severity or default.
 */
function validateSeverity(value: unknown): FileFinding["severity"] {
  const validSeverities = ["critical", "high", "medium", "low"] as const;
  const stringValue = String(value);
  return validSeverities.includes(stringValue as (typeof validSeverities)[number])
    ? (stringValue as FileFinding["severity"])
    : "medium";
}

/**
 * Validates confidence value and returns a valid confidence or default.
 */
function validateConfidence(value: unknown): FileFinding["confidence"] {
  const validConfidence = ["high", "medium", "low"] as const;
  const stringValue = String(value);
  return validConfidence.includes(stringValue as (typeof validConfidence)[number])
    ? (stringValue as FileFinding["confidence"])
    : "high";
}

/**
 * Validates category value and returns a valid category or default.
 */
function validateCategory(value: unknown): FileFinding["category"] {
  const validCategories = ["bug", "security", "performance", "quality", "documentation"] as const;
  const stringValue = String(value);
  return validCategories.includes(stringValue as (typeof validCategories)[number])
    ? (stringValue as FileFinding["category"])
    : "quality";
}

/**
 * Validates cross-file category value and returns a valid category or default.
 */
function validateCrossFileCategory(value: unknown): CrossFileFinding["category"] {
  const validCategories = [
    "architecture",
    "design",
    "testing",
    "documentation",
    "bug",
    "security",
    "performance",
    "quality",
  ] as const;
  const stringValue = String(value);
  return validCategories.includes(stringValue as (typeof validCategories)[number])
    ? (stringValue as CrossFileFinding["category"])
    : "design";
}

/**
 * Parses an AI response into a file review result.
 *
 * @param filename - Name of the reviewed file
 * @param response - Raw AI response
 * @returns Structured file review result
 */
export function parseFileReview(filename: string, response: AIResponse): FileReviewResult {
  const data = response.parsed as RawFileReviewResponse;
  const findings: FileFinding[] = [];

  if (Array.isArray(data.findings)) {
    for (const finding of data.findings) {
      findings.push({
        line: typeof finding.line === "number" ? finding.line : 0,
        severity: validateSeverity(finding.severity),
        confidence: validateConfidence(finding.confidence),
        category: validateCategory(finding.category),
        message: String(finding.message || ""),
        suggestion: String(finding.suggestion || ""),
        reasoning: finding.reasoning
          ? String(finding.reasoning)
          : "Reasoning not provided by the model.",
        isPreExisting: typeof finding.isPreExisting === "boolean" ? finding.isPreExisting : false,
      });
    }
  }

  return {
    filename,
    findings,
  };
}

/**
 * Parses an AI response into a cross-file review result.
 *
 * @param response - Raw AI response
 * @returns Structured cross-file review result
 */
export function parseCrossFileReview(response: AIResponse): CrossFileReviewResult {
  const data = response.parsed as RawCrossFileReviewResponse;
  const findings: CrossFileFinding[] = [];

  if (Array.isArray(data.findings)) {
    for (const finding of data.findings) {
      findings.push({
        severity: validateSeverity(finding.severity),
        confidence: validateConfidence(finding.confidence),
        category: validateCrossFileCategory(finding.category),
        message: String(finding.message || ""),
        reasoning: finding.reasoning
          ? String(finding.reasoning)
          : "Reasoning not provided by the model.",
        affectedFiles: Array.isArray(finding.affected_files)
          ? finding.affected_files.map(String)
          : [],
      });
    }
  }

  return {
    overallAssessment: String(data.overall_assessment || "Review completed"),
    findings,
    recommendations: Array.isArray(data.recommendations) ? data.recommendations.map(String) : [],
  };
}

/**
 * Parses a batched AI response containing reviews for multiple files.
 *
 * @param response - Raw AI response with file_results object
 * @returns Array of structured file review results
 */
export function parseBatchedFileReview(response: AIResponse): FileReviewResult[] {
  logger.debug(
    {
      rawResponseLength: response.raw?.length || 0,
      rawResponsePreview: response.raw?.substring(0, 1000),
      parsedResponse: response.parsed,
    },
    "AI response details"
  );

  const data = response.parsed as RawBatchedFileReviewResponse;
  const results: FileReviewResult[] = [];

  if (!data.file_results || typeof data.file_results !== "object") {
    logger.debug(
      {
        fileResultsExists: !!data.file_results,
        fileResultsType: typeof data.file_results,
        parsedDataKeys: Object.keys(data),
      },
      "Missing or invalid file_results"
    );
    return results;
  }

  logger.debug(
    {
      fileCount: Object.keys(data.file_results).length,
      fileNames: Object.keys(data.file_results),
    },
    "Processing file_results"
  );

  for (const [filename, fileData] of Object.entries(data.file_results)) {
    logger.debug({ filename, fileData }, "Processing individual file");

    const rawFileData = fileData as RawFileReviewResponse;
    const findings: FileFinding[] = [];

    logger.debug(
      {
        filename,
        findingsExists: Array.isArray(rawFileData.findings),
        findingsCount: rawFileData.findings?.length || 0,
      },
      "Processing file findings"
    );

    if (Array.isArray(rawFileData.findings)) {
      for (const finding of rawFileData.findings) {
        findings.push({
          line: typeof finding.line === "number" ? finding.line : 0,
          severity: validateSeverity(finding.severity),
          confidence: validateConfidence(finding.confidence),
          category: validateCategory(finding.category),
          message: String(finding.message || ""),
          suggestion: String(finding.suggestion || ""),
          reasoning: finding.reasoning
            ? String(finding.reasoning)
            : "Reasoning not provided by the model.",
          isPreExisting: typeof finding.isPreExisting === "boolean" ? finding.isPreExisting : false,
        });
      }
    }

    logger.debug(
      {
        filename,
        findingsCount: findings.length,
      },
      "Final file review result"
    );

    results.push({
      filename,
      findings,
    });
  }

  logger.debug(
    {
      filesProcessed: results.length,
      totalFindings: results.reduce((sum, r) => sum + r.findings.length, 0),
    },
    "Final batched results"
  );

  return results;
}

/**
 * Parses token count strings like "33.0k" or "22.0k" into numbers.
 */
function parseTokenCount(value: string): number {
  const num = Number.parseFloat(value);
  if (value.toLowerCase().includes("k")) {
    return Math.round(num * 1000);
  }
  if (value.toLowerCase().includes("m")) {
    return Math.round(num * 1000000);
  }
  return Math.round(num);
}

/**
 * Parses token usage statistics from Copilot CLI stderr output.
 *
 * Example output:
 * ```
 * Total usage est:       0 Premium requests
 * Total duration (API):  21s
 * Total duration (wall): 26s
 * Usage by model:
 *     gpt-5-mini           33.0k input, 773 output, 22.0k cache read (Est. 0 Premium requests)
 * ```
 *
 * @param stderr - Stderr output from Copilot CLI
 * @returns Parsed token usage statistics, or undefined if not found
 */
export function parseTokenUsageFromStderr(stderr: string): TokenUsage | undefined {
  if (!stderr || stderr.trim().length === 0) {
    return undefined;
  }

  try {
    let premiumRequests: number | undefined;
    let durationApiSeconds: number | undefined;
    let durationWallSeconds: number | undefined;
    let model: string | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let cachedTokens: number | undefined;

    // Parse premium requests: "Total usage est:       0 Premium requests"
    const premiumMatch = stderr.match(/Total usage est:\s+(\d+)\s+Premium requests/);
    if (premiumMatch) {
      premiumRequests = Number.parseInt(premiumMatch[1], 10);
    }

    // Parse API duration: "Total duration (API):  21s"
    const apiDurationMatch = stderr.match(/Total duration \(API\):\s+(\d+)s/);
    if (apiDurationMatch) {
      durationApiSeconds = Number.parseInt(apiDurationMatch[1], 10);
    }

    // Parse wall duration: "Total duration (wall): 26s"
    const wallDurationMatch = stderr.match(/Total duration \(wall\):\s+(\d+)s/);
    if (wallDurationMatch) {
      durationWallSeconds = Number.parseInt(wallDurationMatch[1], 10);
    }

    // Parse usage by model: "gpt-5-mini           33.0k input, 773 output, 22.0k cache read"
    const usageMatch = stderr.match(
      /^\s+([a-z0-9-]+)\s+([\d.]+[kKmM]?)\s+input,\s+(\d+)\s+output(?:,\s+([\d.]+[kKmM]?)\s+cache read)?/m
    );
    if (usageMatch) {
      model = usageMatch[1];
      inputTokens = parseTokenCount(usageMatch[2]);
      outputTokens = Number.parseInt(usageMatch[3], 10);
      if (usageMatch[4]) {
        cachedTokens = parseTokenCount(usageMatch[4]);
      }
    }

    // Return undefined if no usage data was found
    if (inputTokens === undefined && outputTokens === undefined) {
      return undefined;
    }

    // Return TokenUsage object with all parsed data
    return {
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      cachedTokens,
      premiumRequests,
      model,
      durationApiSeconds,
      durationWallSeconds,
    };
  } catch (error) {
    logger.warn({ error: (error as Error).message, stderr }, "Failed to parse token usage");
    return undefined;
  }
}
