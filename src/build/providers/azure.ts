import { PlatformApiError } from "../../errors/index.js";
import type {
  BuildAnalysisProvider,
  BuildLogChunk,
  BuildReference,
  BuildSummary,
} from "../types.js";

export interface AzureBuildHttp {
  get(url: string, init?: RequestInit): Promise<Response>;
}

export class AzureBuildProvider implements BuildAnalysisProvider {
  private readonly base: string;
  constructor(
    private readonly token: string,
    org: string,
    private readonly http: AzureBuildHttp = { get: fetch }
  ) {
    this.base = `https://dev.azure.com/${encodeURIComponent(org)}`;
  }
  private async request(reference: BuildReference, path: string): Promise<Response> {
    const url = `${this.base}/${encodeURIComponent(reference.project ?? "")}/_apis/build${path}${path.includes("?") ? "&" : "?"}api-version=7.1`;
    const response = await this.http.get(url, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
    });
    if (!response.ok)
      throw new PlatformApiError(
        "azure",
        "build-analysis",
        `HTTP ${response.status} ${response.statusText}`,
        undefined,
        response.status
      );
    return response;
  }
  async getBuildSummary(reference: BuildReference): Promise<BuildSummary> {
    const data = (await (
      await this.request(reference, `/builds/${reference.id}`)
    ).json()) as Record<string, unknown>;
    const result = String(data.result ?? "").toLowerCase();
    const definition = data.definition as Record<string, unknown> | undefined;
    return {
      id: String(data.id ?? reference.id),
      name: String(data.buildNumber ?? definition?.name ?? "Azure build"),
      status:
        data.status === "completed"
          ? "completed"
          : data.status === "inProgress"
            ? "inProgress"
            : "unknown",
      result:
        result === "failed"
          ? "failed"
          : result === "partiallysucceeded"
            ? "partiallySucceeded"
            : result === "succeeded"
              ? "succeeded"
              : "unknown",
      sourceBranch: typeof data.sourceBranch === "string" ? data.sourceBranch : undefined,
      commitSha: typeof data.sourceVersion === "string" ? data.sourceVersion : undefined,
      webUrl:
        typeof data._links === "object" &&
        data._links !== null &&
        typeof (data._links as Record<string, unknown>).web === "object"
          ? String(
              ((data._links as Record<string, unknown>).web as Record<string, unknown>).href ?? ""
            )
          : undefined,
      startedAt: typeof data.startTime === "string" ? data.startTime : undefined,
      finishedAt: typeof data.finishTime === "string" ? data.finishTime : undefined,
    };
  }
  async getFailedLogs(reference: BuildReference): Promise<BuildLogChunk[]> {
    const data = (await (
      await this.request(reference, `/builds/${reference.id}/logs?$top=100`)
    ).json()) as { value?: Array<Record<string, unknown>> };
    const chunks: BuildLogChunk[] = [];
    for (const entry of data.value ?? []) {
      if (typeof entry.url !== "string") continue;
      const response = await this.http.get(entry.url, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "text/plain" },
      });
      if (!response.ok) continue;
      chunks.push({
        sequence: typeof entry.id === "number" ? entry.id : undefined,
        content: await response.text(),
        isFailureCandidate: true,
      });
    }
    return chunks;
  }
}
