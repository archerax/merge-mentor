import type {
  CrossFileFinding,
  CrossFileReviewResult,
  FileFinding,
  FileReviewResult,
} from "../../platforms/types.js";
import {
  BatchedFileReviewResponseSchema,
  CrossFileReviewResponseSchema,
  FastReviewResponseSchema,
  FileReviewResponseSchema,
} from "../schemas.js";
import type { AIResponse, FastReviewResult } from "../types.js";
import { validateReasoning } from "./validateReasoning.js";

interface ParserLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Parses an AI response into a file review result.
 */
export function parseFileReview(
  logger: ParserLogger,
  filename: string,
  response: AIResponse
): FileReviewResult {
  const result = FileReviewResponseSchema.safeParse(response.parsed);
  if (!result.success) {
    logger.warn({ error: result.error.format() }, "File review schema drift detected");
  }

  const data = result.success ? result.data : { findings: [] };
  const findings: FileFinding[] = data.findings.map((finding) => {
    validateReasoning(logger, finding.reasoning, filename, finding.line);
    return {
      line: finding.line,
      severity: finding.severity,
      confidence: finding.confidence,
      category: finding.category,
      message: finding.message,
      suggestion: finding.suggestion,
      reasoning: finding.reasoning,
      isPreExisting: finding.isPreExisting,
    };
  });

  return { filename, findings };
}

/**
 * Parses an AI response into a cross-file review result.
 */
export function parseCrossFileReview(
  logger: ParserLogger,
  response: AIResponse
): CrossFileReviewResult {
  const result = CrossFileReviewResponseSchema.safeParse(response.parsed);
  if (!result.success) {
    logger.warn({ error: result.error.format() }, "Cross-file review schema drift detected");
  }

  const data = result.success
    ? result.data
    : { overall_assessment: "Review completed", findings: [], recommendations: [] };

  const findings: CrossFileFinding[] = data.findings.map((finding) => {
    const affectedFilesStr = finding.affected_files.join(", ") || "unknown";
    validateReasoning(logger, finding.reasoning, "cross-file", affectedFilesStr);
    return {
      severity: finding.severity,
      confidence: finding.confidence,
      category: finding.category,
      message: finding.message,
      reasoning: finding.reasoning,
      affectedFiles: finding.affected_files,
    };
  });

  return {
    overallAssessment: data.overall_assessment,
    findings,
    recommendations: data.recommendations,
  };
}

/**
 * Parses a batched AI response containing reviews for multiple files.
 */
export function parseBatchedFileReview(
  logger: ParserLogger,
  response: AIResponse
): FileReviewResult[] {
  const result = BatchedFileReviewResponseSchema.safeParse(response.parsed);
  if (!result.success) {
    logger.warn({ error: result.error.format() }, "Batched file review schema drift detected");
  }

  const data = result.success ? result.data : { file_results: {} };
  const results: FileReviewResult[] = [];

  for (const [filename, fileData] of Object.entries(data.file_results)) {
    const findings: FileFinding[] = fileData.findings.map((finding) => {
      validateReasoning(logger, finding.reasoning, filename, finding.line);
      return {
        line: finding.line,
        severity: finding.severity,
        confidence: finding.confidence,
        category: finding.category,
        message: finding.message,
        suggestion: finding.suggestion,
        reasoning: finding.reasoning,
        isPreExisting: finding.isPreExisting,
      };
    });

    results.push({ filename, findings });
  }

  return results;
}

/**
 * Parses a fast review response (combined file + cross-file analysis).
 */
export function parseFastReview(logger: ParserLogger, response: AIResponse): FastReviewResult {
  const result = FastReviewResponseSchema.safeParse(response.parsed);
  if (!result.success) {
    logger.warn({ error: result.error.format() }, "Fast review schema drift detected");
  }

  const data = result.success ? result.data : { summary: "Review completed", findings: [] };
  const fileFindings = new Map<string, FileFinding[]>();
  const crossFileFindings: CrossFileFinding[] = [];

  for (const finding of data.findings) {
    const file = finding.file;
    const line = finding.line;
    const context = file ? (line ? `${file}:${line}` : file) : "cross-file";
    validateReasoning(logger, finding.reasoning, context, line || "general");

    if (file) {
      if (!fileFindings.has(file)) {
        fileFindings.set(file, []);
      }

      fileFindings.get(file)?.push({
        line: finding.line,
        severity: finding.severity,
        confidence: finding.confidence,
        category: finding.category,
        message: finding.message,
        suggestion: finding.suggestion,
        reasoning: finding.reasoning,
        isPreExisting: finding.isPreExisting,
      });
    } else {
      crossFileFindings.push({
        severity: finding.severity,
        confidence: finding.confidence,
        category: finding.category as unknown as CrossFileFinding["category"],
        message: finding.message,
        reasoning: finding.reasoning,
        affectedFiles: [],
      });
    }
  }

  const fileResults: FileReviewResult[] = Array.from(fileFindings.entries()).map(
    ([filename, findings]) => ({ filename, findings })
  );

  const crossFileResult: CrossFileReviewResult = {
    overallAssessment: data.summary,
    findings: crossFileFindings,
    recommendations: [],
  };

  return { fileResults, crossFileResult };
}
