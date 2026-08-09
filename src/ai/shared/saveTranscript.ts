import path from "node:path";
import type { Clock, FileSystem } from "../../ports/index.js";
import type { TokenUsage } from "../types.js";

/** Minimal logger surface used by the transcript writer. */
interface SaveTranscriptLogger {
  /** Logs a debug entry with structured fields and a message. */
  debug(obj: Record<string, unknown>, msg: string): void;
  /** Logs a warning with structured fields and a message. */
  warn(obj: Record<string, unknown>, msg: string): void;
}

/** Dependencies injected into the transcript writer. */
export interface SaveTranscriptDeps {
  /** Filesystem used to create the transcript directory and write files. */
  fileSystem: FileSystem;
  /** Clock providing timestamps for the transcript filename and content. */
  clock: Clock;
  /** Logger used to report successful writes and failures. */
  logger: SaveTranscriptLogger;
  /** Base path under which the transcripts directory is created. */
  tempPath: string;
  /** Label rendered at the top of the transcript identifying the provider. */
  providerLabel: string;
  /** Prefix used for the generated transcript filename. */
  filePrefix: string;
  /** Human-readable provider name used in log messages. */
  displayName: string;
  /** Optional model identifier recorded in the transcript header. */
  model?: string;
}

/** Payload describing a single AI exchange to persist as a transcript. */
export interface SaveTranscriptData {
  /** The prompt sent to the AI model. */
  prompt: string;
  /** Optional session event timeline rendered as text lines. */
  timeline?: string[];
  /** Optional raw response text from the AI model. */
  rawResponse?: string;
  /** Optional pretty-printed JSON output produced from the response. */
  jsonOutput?: string;
  /** Optional token usage statistics associated with the exchange. */
  tokenUsage?: TokenUsage;
  /** Whether the exchange succeeded. */
  success: boolean;
  /** Optional error message when the exchange failed. */
  error?: string;
  /** Retry attempt number this transcript corresponds to. */
  attempt: number;
}

/**
 * Writes a debugging transcript of an AI exchange to a timestamped file under
 * `<tempPath>/transcripts`. Failures are logged as warnings rather than
 * throwing, so transcript writing never breaks the review flow.
 *
 * @param deps - Injected dependencies (filesystem, clock, logger, paths, labels).
 * @param data - The exchange data to persist.
 * @returns A promise that resolves once the transcript write attempt completes.
 */
export async function saveTranscript(
  deps: SaveTranscriptDeps,
  data: SaveTranscriptData
): Promise<void> {
  try {
    const transcriptDir = path.join(deps.tempPath, "transcripts");
    await deps.fileSystem.mkdir(transcriptDir, { recursive: true });

    const timestamp = deps.clock.timestamp().replace(/[:.]/g, "-");
    const status = data.success ? "success" : "failure";
    const filename = `${deps.filePrefix}-${timestamp}-attempt-${data.attempt}-${status}.txt`;
    const filepath = path.join(transcriptDir, filename);

    const transcriptLines: (string | undefined)[] = [
      "=".repeat(80),
      deps.providerLabel,
      "=".repeat(80),
      `Timestamp: ${deps.clock.timestamp()}`,
      `Status: ${status}`,
      `Model: ${deps.model || "default"}`,
      `Attempt: ${data.attempt}`,
      data.tokenUsage ? `Token Usage: ${JSON.stringify(data.tokenUsage, null, 2)}` : "",
      "",
      "=".repeat(80),
      "INPUT PROMPT",
      "=".repeat(80),
      data.prompt,
    ];

    if (data.timeline && data.timeline.length > 0) {
      transcriptLines.push("", "=".repeat(80), "SESSION TIMELINE", "=".repeat(80));
      for (const line of data.timeline) {
        transcriptLines.push(line);
      }
    }

    transcriptLines.push(
      "",
      "=".repeat(80),
      "RAW API RESPONSE",
      "=".repeat(80),
      data.rawResponse || "(empty)",
      "",
      "=".repeat(80),
      "JSON OUTPUT",
      "=".repeat(80),
      data.jsonOutput || "(empty)"
    );

    if (data.error) {
      transcriptLines.push("", "=".repeat(80), "ERROR", "=".repeat(80), data.error);
    }

    transcriptLines.push("", "=".repeat(80), "END OF TRANSCRIPT", "=".repeat(80));

    const content = transcriptLines.filter((line): line is string => line !== undefined).join("\n");

    await deps.fileSystem.writeFile(filepath, content, "utf-8");

    deps.logger.debug(
      { filepath, success: data.success, attempt: data.attempt },
      `Saved ${deps.displayName} transcript for debugging`
    );
  } catch (err) {
    deps.logger.warn(
      { error: (err as Error).message },
      `Failed to save ${deps.displayName} transcript`
    );
  }
}
