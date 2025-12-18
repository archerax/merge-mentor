/**
 * Base error class for MergeMentor errors.
 * All custom errors extend this class for consistent handling.
 */
export class PrBotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeMentorError";
  }
}

/**
 * Error thrown when the Copilot CLI fails or is unavailable.
 */
export class CopilotCliError extends PrBotError {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "CopilotCliError";
  }
}

/**
 * Error thrown when configuration is missing or invalid.
 */
export class ConfigurationError extends PrBotError {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(`Configuration error for ${field}: ${message}`);
    this.name = "ConfigurationError";
  }
}

/**
 * Error thrown when a platform API (GitHub/Azure) fails.
 */
export class PlatformApiError extends PrBotError {
  constructor(
    public readonly platform: "github" | "azure",
    public readonly operation: string,
    message: string,
    public readonly cause?: Error
  ) {
    super(`${platform} API error during ${operation}: ${message}`);
    this.name = "PlatformApiError";
  }
}

/**
 * Error thrown when JSON parsing fails for Copilot responses.
 */
export class JsonParseError extends PrBotError {
  constructor(
    message: string,
    public readonly rawContent?: string
  ) {
    super(`Failed to parse JSON: ${message}`);
    this.name = "JsonParseError";
  }
}

/**
 * Error thrown when input validation fails.
 */
export class ValidationError extends PrBotError {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(`Validation failed for ${field}: ${message}`);
    this.name = "ValidationError";
  }
}
