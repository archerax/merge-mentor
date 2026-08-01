import { MergeMentorError } from "../errors/index.js";

export class BuildAnalysisError extends MergeMentorError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BuildAnalysisError";
  }
}
