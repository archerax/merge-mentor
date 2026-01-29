// AI provider abstraction layer exports

// Severity context for context-aware severity scoring

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
