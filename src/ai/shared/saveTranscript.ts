import path from "node:path";
import type { Clock, FileSystem } from "../../ports/index.js";
import type { TokenUsage } from "../types.js";

interface SaveTranscriptLogger {
  debug(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface SaveTranscriptDeps {
  fileSystem: FileSystem;
  clock: Clock;
  logger: SaveTranscriptLogger;
  tempPath: string;
  providerLabel: string;
  filePrefix: string;
  displayName: string;
  model?: string;
}

export interface SaveTranscriptData {
  prompt: string;
  timeline?: string[];
  rawResponse?: string;
  jsonOutput?: string;
  tokenUsage?: TokenUsage;
  success: boolean;
  error?: string;
  attempt: number;
}

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
