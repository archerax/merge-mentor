/** Token usage statistics from AI provider execution. */
export interface TokenUsage {
  /** Number of input (prompt) tokens consumed. */
  readonly inputTokens: number;
  /** Number of output (completion) tokens produced. */
  readonly outputTokens: number;
  /** Tokens served from cache across read and write cache events, when reported. */
  readonly cachedTokens?: number;
  /** Number of premium (enhanced) requests made, when reported. */
  readonly premiumRequests?: number;
  /** Model identifier the usage report corresponds to, when reported. */
  readonly model?: string;
  /** API-side duration of the call in seconds, when reported. */
  readonly durationApiSeconds?: number;
  /** Wall-clock duration of the call in seconds, when measured locally. */
  readonly durationWallSeconds?: number;
}
