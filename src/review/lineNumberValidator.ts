import { createChildLogger } from "../logger.js";
import type { FileReviewResult, PRFile } from "../platforms/types.js";
import { findNearestValidLine, getValidDiffLines } from "../utils/diffParser.js";

export class LineNumberValidator {
  private readonly logger = createChildLogger({ component: "LineNumberValidator" });

  /**
   * Validates and adjusts line numbers in findings to match actual diff lines.
   * Filters out findings with invalid line numbers that can't be mapped.
   */
  validate(fileResults: FileReviewResult[], files: PRFile[]): FileReviewResult[] {
    // Create a map of filename to valid line numbers
    const validLinesMap = new Map<string, Set<number>>();
    for (const file of files) {
      validLinesMap.set(file.filename, getValidDiffLines(file.patch));
    }

    const validatedResults: FileReviewResult[] = [];

    for (const result of fileResults) {
      const validLines = validLinesMap.get(result.filename);
      if (!validLines || validLines.size === 0) {
        this.logger.warn(
          {
            filename: result.filename,
            findingsCount: result.findings.length,
          },
          "No valid diff lines found for file, skipping inline comments"
        );
        continue;
      }

      const validatedFindings = result.findings
        .map((finding) => {
          if (validLines.has(finding.line)) {
            return finding;
          }

          // Try to find nearest valid line
          const nearestLine = findNearestValidLine(finding.line, validLines);
          if (nearestLine !== undefined) {
            this.logger.info(
              {
                filename: result.filename,
                requestedLine: finding.line,
                adjustedLine: nearestLine,
                severity: finding.severity,
                category: finding.category,
              },
              "Adjusted finding line number to nearest valid diff line"
            );

            return {
              ...finding,
              line: nearestLine,
            };
          }

          // No valid line found, log and filter out
          this.logger.warn(
            {
              filename: result.filename,
              invalidLine: finding.line,
              severity: finding.severity,
              category: finding.category,
              message: finding.message.slice(0, 100),
            },
            "Cannot find valid diff line for finding, skipping inline comment"
          );

          return null;
        })
        .filter((f): f is NonNullable<typeof f> => f !== null);

      if (validatedFindings.length > 0 || result.findings.length === 0) {
        // Include files with validated findings OR files with no findings at all
        validatedResults.push({
          filename: result.filename,
          findings: validatedFindings,
        });
      } else if (result.findings.length > 0) {
        this.logger.warn(
          {
            filename: result.filename,
            originalFindingsCount: result.findings.length,
          },
          "All findings filtered out due to invalid line numbers"
        );
      }
    }

    return validatedResults;
  }
}
