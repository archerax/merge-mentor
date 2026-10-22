import type {
  CrossFileFinding,
  CrossFileReviewResult,
  FileFinding,
  FileReviewResult,
} from "@merge-mentor/domain/platform.js";

import {
  CrossFileReviewResponseSchema,
  FileReviewResponseSchema,
  ReviewResponseSchema,
} from "../schemas.js";
import type { AIResponse, FastReviewResult } from "../types.js";
import { validateReasoning } from "./validateReasoning.js";

/** Minimal logger surface used by the response parsers to emit warnings. */
interface ParserLogger {
  /** Logs a warning with structured fields and a message. */
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
      startLine: finding.start_line,
      endLine: finding.end_line,
      severity: finding.severity,
      confidence: finding.confidence,
      category: finding.category,
      message: finding.message,
      suggestion: finding.suggestion,
      replacement: finding.replacement,
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
 * Parses the review result shared by every review strategy: `file_results`
 * (an entry per reviewed file), `cross_file_findings`, and, for tolerance of
 * older responses, a flat `findings` list whose file-less entries are
 * cross-file concerns.
 *
 * `reviewedFiles` lists the files the model returned a result for, so callers
 * can tell a file with no findings from a file the model never looked at.
 */
function parseReviewResponse(logger: ParserLogger, response: AIResponse): FastReviewResult {
  const result = ReviewResponseSchema.safeParse(response.parsed);
  if (!result.success) {
    logger.warn({ error: result.error.format() }, "Review result schema drift detected");
  }

  const data = result.success
    ? result.data
    : { summary: "Review completed", file_results: {}, cross_file_findings: [], findings: [] };
  const fileFindings = new Map<string, FileFinding[]>();
  const crossFileFindings: CrossFileFinding[] = [];

  const addFileFinding = (
    filename: string,
    finding: (typeof data.findings)[number] | (typeof data.file_results)[string]["findings"][number]
  ): void => {
    validateReasoning(
      logger,
      finding.reasoning,
      finding.line ? `${filename}:${finding.line}` : filename,
      finding.line || "general"
    );
    const findings = fileFindings.get(filename) ?? [];
    findings.push({
      line: finding.line,
      startLine: finding.start_line,
      endLine: finding.end_line,
      severity: finding.severity,
      confidence: finding.confidence,
      category: finding.category as FileFinding["category"],
      message: finding.message,
      suggestion: finding.suggestion,
      replacement: finding.replacement,
      reasoning: finding.reasoning,
      isPreExisting: finding.isPreExisting,
    });
    fileFindings.set(filename, findings);
  };

  const addCrossFileFinding = (finding: {
    severity: CrossFileFinding["severity"];
    confidence: CrossFileFinding["confidence"];
    category: string;
    message: string;
    reasoning: string;
    affected_files: string[];
  }): void => {
    validateReasoning(
      logger,
      finding.reasoning,
      "cross-file",
      finding.affected_files.join(", ") || "unknown"
    );
    crossFileFindings.push({
      severity: finding.severity,
      confidence: finding.confidence,
      category: finding.category as CrossFileFinding["category"],
      message: finding.message,
      reasoning: finding.reasoning,
      affectedFiles: finding.affected_files,
    });
  };

  // A file with an entry in file_results counts as reviewed, even with no findings.
  for (const [filename, fileData] of Object.entries(data.file_results)) {
    fileFindings.set(filename, fileFindings.get(filename) ?? []);
    for (const finding of fileData.findings) {
      addFileFinding(filename, finding);
    }
  }

  for (const finding of data.cross_file_findings) {
    addCrossFileFinding(finding);
  }

  for (const finding of data.findings) {
    if (finding.file) {
      addFileFinding(finding.file, finding);
    } else {
      addCrossFileFinding(finding);
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

  return { fileResults, crossFileResult, reviewedFiles: Array.from(fileFindings.keys()) };
}

/** Parses a fast review response (combined file + cross-file analysis). */
export function parseFastReview(logger: ParserLogger, response: AIResponse): FastReviewResult {
  return parseReviewResponse(logger, response);
}

/** Parses a deep (batched) file review response into per-file results. */
export function parseBatchedFileReview(
  logger: ParserLogger,
  response: AIResponse
): FileReviewResult[] {
  return parseReviewResponse(logger, response).fileResults;
}

/** A subagent's findings flattened for the synthesizer, plus the files it reported on. */
export interface AgentReviewParse {
  /** File-level findings carry `file`; cross-file findings carry `affectedFiles` and line 0. */
  readonly findings: FileFinding[];
  /** Files the subagent returned a result for. */
  readonly reviewedFiles: string[];
}

/**
 * Parses a single subagent's review result and flattens it into the list the
 * Lead Synthesizer consumes: file-level findings keep their `file`, and
 * cross-file findings are preserved with `affectedFiles`.
 */
export function parseAgentReviewResult(
  logger: ParserLogger,
  response: AIResponse
): AgentReviewParse {
  const parsed = parseReviewResponse(logger, response);

  const findings: FileFinding[] = [
    ...parsed.fileResults.flatMap((fileResult) =>
      fileResult.findings.map((finding) => ({ ...finding, file: fileResult.filename }))
    ),
    ...parsed.crossFileResult.findings.map((finding): FileFinding => ({
      line: 0,
      severity: finding.severity,
      confidence: finding.confidence,
      category: finding.category as FileFinding["category"],
      message: finding.message,
      suggestion: "",
      reasoning: finding.reasoning,
      isPreExisting: false,
      affectedFiles: [...finding.affectedFiles],
    })),
  ];

  return { findings, reviewedFiles: parsed.reviewedFiles };
}

/** Parses a subagent's review result into the flat finding list the synthesizer consumes. */
export function parseAgentReview(logger: ParserLogger, response: AIResponse): FileFinding[] {
  return parseAgentReviewResult(logger, response).findings;
}
