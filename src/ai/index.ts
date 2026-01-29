// AI provider abstraction layer exports

// Severity context for context-aware severity scoring
export {
  buildSeverityContextSection,
  type CodeContext,
  inferCodeContext,
} from "./prompts/severityContext.js";
// Specialized review prompts
export {
  buildLogicReviewPrompt,
  buildPerformanceReviewPrompt,
  buildSecurityReviewPrompt,
} from "./prompts/specialized.js";

export { createAIProvider } from "./providerFactory.js";
export type {
  AIProviderClient,
  AIProviderType,
} from "./types.js";
