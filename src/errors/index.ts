/**
 * Custom error types for merge-mentor.
 *
 * All custom errors extend MergeMentorError for consistent error handling and
 * type checking. Specific error types help diagnose issues and enable
 * targeted error recovery strategies.
 *
 * @example
 * ```typescript
 * try {
 *   await validateConfig();
 * } catch (error) {
 *   if (error instanceof ConfigurationError) {
 *     logger.error(`Config error in field "${error.field}": ${error.message}`);
 *   } else if (error instanceof ValidationError) {
 *     logger.error(`Validation failed for "${error.field}"`);
 *   }
 * }
 * ```
 */

/**
 * Base error class for merge-mentor errors.
 *
 * All custom errors extend this class for consistent handling and type checking.
 * Provides a way to catch all merge-mentor-specific errors without catching
 * unexpected system errors.
 *
 * @example
 * ```typescript
 * catch (error) {
 *   if (error instanceof MergeMentorError) {
 *     logger.error(`Application error: ${error.message}`);
 *   } else {
 *     logger.error(`Unexpected error: ${error}`);
 *   }
 * }
 * ```
 */
export class MergeMentorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeMentorError";
  }
}

/**
 * Error thrown when the Copilot SDK fails or is unavailable.
 *
 * Raised when the @github/copilot-sdk package fails, is not installed,
 * or returns an error. Use this to distinguish SDK failures from CLI failures.
 *
 * @example
 * ```typescript
 * try {
 *   const result = await copilotClient.createMessage(...);
 * } catch (error) {
 *   if (error instanceof CopilotSdkError) {
 *     logger.error("Copilot SDK error", { cause: error.cause });
 *   }
 * }
 * ```
 */
export class CopilotSdkError extends MergeMentorError {
  constructor(
    message: string,
    /**
     * The underlying error from the SDK (e.g., authentication, API response).
     * Contains details needed for SDK debugging.
     */
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "CopilotSdkError";
  }
}

/**
 * Error thrown when the OpenCode SDK fails or is unavailable.
 *
 * Raised when the OpenCode provider fails, is not installed, or returns an error.
 * Use this to distinguish OpenCode failures from other AI provider failures.
 *
 * @example
 * ```typescript
 * try {
 *   const result = await opencodeClient.generateCode(...);
 * } catch (error) {
 *   if (error instanceof OpenCodeSdkError) {
 *     logger.error("OpenCode SDK error", { cause: error.cause });
 *   }
 * }
 * ```
 */
export class OpenCodeSdkError extends MergeMentorError {
  constructor(
    message: string,
    /**
     * The underlying error from the OpenCode SDK.
     * Contains details needed for debugging OpenCode issues.
     */
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "OpenCodeSdkError";
  }
}

/**
 * Error thrown when configuration is missing or invalid.
 *
 * Raised during configuration loading or validation when required settings
 * are missing or contain invalid values. Include the field name for
 * targeted error recovery (e.g., prompting for input, providing defaults).
 *
 * @example
 * ```typescript
 * if (!config.githubToken) {
 *   throw new ConfigurationError("GITHUB_TOKEN", "required for GitHub operations");
 * }
 * ```
 */
export class ConfigurationError extends MergeMentorError {
  constructor(
    /**
     * The configuration field that has the problem.
     * Helps identify which setting needs to be fixed.
     */
    public readonly field: string,
    message: string
  ) {
    super(`Configuration error for ${field}: ${message}`);
    this.name = "ConfigurationError";
  }
}

/**
 * Error thrown when a platform API (GitHub/Azure) fails.
 *
 * Raised when a GitHub or Azure DevOps API call fails. Includes the platform,
 * operation, and underlying error for targeted recovery or logging.
 *
 * @example
 * ```typescript
 * try {
 *   const pr = await octokit.pulls.get({ owner, repo, pull_number });
 * } catch (error) {
 *   throw new PlatformApiError(
 *     "github",
 *     "fetch-pr-details",
 *     `HTTP ${error.status}: ${error.message}`,
 *     error
 *   );
 * }
 * ```
 */
export class PlatformApiError extends MergeMentorError {
  constructor(
    /**
     * The platform (github or azure) where the API call failed.
     */
    public readonly platform: "github" | "azure",
    /**
     * The operation that was attempted (e.g., "fetch-pr-details", "post-comment").
     * Helps identify which API was being used when failure occurred.
     */
    public readonly operation: string,
    message: string,
    /**
     * The underlying error from the platform API (HTTP error, network timeout, etc.).
     * Use for debugging platform-specific issues.
     */
    public readonly cause?: Error,
    /**
     * The HTTP status code from the platform API response, if available.
     */
    public readonly status?: number
  ) {
    super(`${platform} API error during ${operation}: ${message}`);
    this.name = "PlatformApiError";
  }
}

/**
 * Error thrown when JSON parsing fails for AI provider responses.
 *
 * Raised when the AI provider's response cannot be parsed as valid JSON.
 * Includes the raw content for debugging malformed responses.
 *
 * @example
 * ```typescript
 * try {
 *   return JSON.parse(response);
 * } catch (error) {
 *   throw new JsonParseError(
 *     `Expected JSON object but got: ${error.message}`,
 *     response.substring(0, 100)  // First 100 chars for debugging
 *   );
 * }
 * ```
 */
export class JsonParseError extends MergeMentorError {
  constructor(
    message: string,
    /**
     * The raw content that failed to parse.
     * Useful for debugging what the AI provider actually returned.
     * Often truncated or redacted for security.
     */
    public readonly rawContent?: string
  ) {
    super(`Failed to parse JSON: ${message}`);
    this.name = "JsonParseError";
  }
}

/**
 * Error thrown when input validation fails.
 *
 * Raised when user input, configuration, or API response fails validation checks.
 * Include the field name for targeted error reporting and recovery.
 *
 * @example
 * ```typescript
 * if (!isValidUrl(config.webhookUrl)) {
 *   throw new ValidationError("webhookUrl", "must be a valid HTTPS URL");
 * }
 * ```
 */
export class ValidationError extends MergeMentorError {
  constructor(
    /**
     * The field or input that failed validation.
     * Helps users identify which input needs to be corrected.
     */
    public readonly field: string,
    message: string
  ) {
    super(`Validation failed for ${field}: ${message}`);
    this.name = "ValidationError";
  }
}
