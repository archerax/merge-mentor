/** Token usage statistics from AI provider execution. */
export interface TokenUsage {
  /** Number of input (prompt) tokens consumed. */
  readonly inputTokens: number;
  /** Number of output (completion) tokens produced, excluding reasoning tokens. */
  readonly outputTokens: number;
  /** Reasoning (thinking) tokens produced, when reported separately from output tokens. */
  readonly reasoningTokens?: number;
  /** Tokens served from cache across read and write cache events, when reported. */
  readonly cachedTokens?: number;
  /** Number of premium (enhanced) requests made, when reported. */
  readonly premiumRequests?: number;
  /** Provider-reported cost in nano-AI units (1 AI credit = 1e9), when reported. */
  readonly nanoAiu?: number;
  /** Estimated cost in US dollars from a built-in price table, when the provider reports none. */
  readonly costUsd?: number;
  /** Model identifier the usage report corresponds to, when reported. */
  readonly model?: string;
  /** API-side duration of the call in seconds, when reported. */
  readonly durationApiSeconds?: number;
  /** Wall-clock duration of the call in seconds, when measured locally. */
  readonly durationWallSeconds?: number;
}
