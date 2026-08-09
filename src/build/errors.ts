import { MergeMentorError } from "../errors/index.js";

/**
 * Error thrown when a build analysis cannot be performed.
 *
 * Raised when the referenced build is still in progress or completed
 * successfully, so there is no failure to analyze.
 */
export class BuildAnalysisError extends MergeMentorError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BuildAnalysisError";
  }
}
