import * as azdev from "azure-devops-node-api";
import type { IBuildApi } from "azure-devops-node-api/BuildApi.js";
import { BuildResult, BuildStatus } from "azure-devops-node-api/interfaces/BuildInterfaces.js";
import { PlatformApiError } from "../../errors/index.js";
import type {
  BuildAnalysisProvider,
  BuildLogChunk,
  BuildReference,
  BuildSummary,
} from "../types.js";

export type AzureBuildAuthMode = "pat" | "bearer";

const FAILURE_LOG_PATTERN =
  /(?:##\[error\]|task\.logissue\s+type=error|\b(?:failed|failure|fatal|exception|timed?\s*out|timeout|cancelled|canceled)\b|\bexit\s+code\s*[:=]?\s*[1-9]\d*\b|\b(?:npm|pnpm|yarn)\s+ERR!)/i;

export interface AzureBuildConnection {
  getBuildApi(): Promise<IBuildApi>;
}

export class AzureBuildProvider implements BuildAnalysisProvider {
  constructor(
    token: string,
    org: string,
    authMode: AzureBuildAuthMode = "pat",
    private readonly connection: AzureBuildConnection = createConnection(token, org, authMode)
  ) {}

  async getBuildSummary(reference: BuildReference): Promise<BuildSummary> {
    const buildApi = await this.connection.getBuildApi();
    const data = await buildApi.getBuild(reference.project ?? "", Number(reference.id));
    const status = String(data.status ?? "").toLowerCase();
    const result = String(data.result ?? "").toLowerCase();
    const isCompleted = data.status === BuildStatus.Completed || status === "completed";
    const isInProgress = data.status === BuildStatus.InProgress || status === "inprogress";
    const isFailed = data.result === BuildResult.Failed || result === "failed";
    const isPartiallySucceeded =
      data.result === BuildResult.PartiallySucceeded || result === "partiallysucceeded";
    const isSucceeded = data.result === BuildResult.Succeeded || result === "succeeded";

    return {
      id: String(data.id ?? reference.id),
      name: String(data.buildNumber ?? data.definition?.name ?? "Azure build"),
      status: isCompleted ? "completed" : isInProgress ? "inProgress" : "unknown",
      result: isFailed
        ? "failed"
        : isPartiallySucceeded
          ? "partiallySucceeded"
          : isSucceeded
            ? "succeeded"
            : "unknown",
      sourceBranch: data.sourceBranch,
      commitSha: data.sourceVersion,
      webUrl: data._links?.web?.href,
      startedAt: data.startTime?.toISOString(),
      finishedAt: data.finishTime?.toISOString(),
    };
  }

  async getFailedLogs(reference: BuildReference): Promise<BuildLogChunk[]> {
    const buildApi = await this.connection.getBuildApi();
    const logs = await buildApi.getBuildLogs(reference.project ?? "", Number(reference.id));
    const chunks: BuildLogChunk[] = [];
    const failedLogIds = await this.getFailedLogIds(buildApi, reference);

    for (const entry of logs ?? []) {
      if (entry.id === undefined) continue;
      let lines: string[];
      try {
        lines = await buildApi.getBuildLogLines(
          reference.project ?? "",
          Number(reference.id),
          entry.id
        );
      } catch (error) {
        throw new PlatformApiError(
          "azure",
          "build-analysis",
          `Failed to retrieve Azure build log ${entry.id}: ${(error as Error).message}`
        );
      }
      const content = lines.join("\n");
      const isFailureCandidate = failedLogIds
        ? failedLogIds.has(entry.id)
        : FAILURE_LOG_PATTERN.test(content);
      if (!isFailureCandidate) continue;
      chunks.push({
        sequence: entry.id,
        content,
        isFailureCandidate,
      });
    }
    return chunks;
  }

  private async getFailedLogIds(
    buildApi: IBuildApi,
    reference: BuildReference
  ): Promise<Set<number> | undefined> {
    try {
      const timeline = await buildApi.getBuildTimeline(
        reference.project ?? "",
        Number(reference.id)
      );
      const failedIds = new Set(
        (timeline.records ?? [])
          .filter((record) =>
            ["failed", "canceled", "cancelled", "abandoned", "timedout", "timed_out"].includes(
              String(record.result ?? "").toLowerCase()
            )
          )
          .map((record) => record.log?.id)
          .filter((id): id is number => typeof id === "number")
      );
      return failedIds.size > 0 ? failedIds : undefined;
    } catch {
      return undefined;
    }
  }
}

function createConnection(
  token: string,
  org: string,
  authMode: AzureBuildAuthMode
): AzureBuildConnection {
  const authHandler =
    authMode === "bearer"
      ? azdev.getBearerHandler(token)
      : azdev.getPersonalAccessTokenHandler(token);
  return new azdev.WebApi(`https://dev.azure.com/${org}`, authHandler);
}
