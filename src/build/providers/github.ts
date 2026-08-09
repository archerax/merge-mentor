import { PlatformApiError } from "../../errors/index.js";
import type {
  BuildAnalysisProvider,
  BuildLogChunk,
  BuildReference,
  BuildSummary,
} from "../types.js";

/**
 * Minimal HTTP client interface used to call the GitHub API.
 */
export interface GithubBuildHttp {
  /** Performs an HTTP request and returns the raw response. */
  get(url: string, init?: RequestInit): Promise<Response>;
}

/**
 * Build analysis provider backed by the GitHub REST API.
 *
 * Fetches workflow run summaries and the logs of failed jobs in the run via
 * `actions/runs`, `actions/runs/{id}/jobs`, and `actions/jobs/{id}/logs`.
 */
export class GithubBuildProvider implements BuildAnalysisProvider {
  constructor(
    private readonly token: string,
    private readonly http: GithubBuildHttp = { get: fetch }
  ) {}
  private url(reference: BuildReference, suffix: string): string {
    return `https://api.github.com/repos/${reference.ownerOrOrg}/${reference.repository}${suffix}`;
  }
  private async request(reference: BuildReference, suffix: string): Promise<Response> {
    const response = await this.http.get(this.url(reference, suffix), {
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json" },
    });
    if (!response.ok)
      throw new PlatformApiError(
        "github",
        "build-analysis",
        `HTTP ${response.status} ${response.statusText}`,
        undefined,
        response.status
      );
    return response;
  }
  /**
   * Fetches normalized summary metadata for the referenced workflow run.
   *
   * @param reference - The run to summarize.
   * @returns Normalized build summary metadata.
   */
  async getBuildSummary(reference: BuildReference): Promise<BuildSummary> {
    const data = (await (
      await this.request(reference, `/actions/runs/${reference.id}`)
    ).json()) as Record<string, unknown>;
    return {
      id: String(data.id ?? reference.id),
      name: String(data.name ?? "workflow run"),
      status:
        data.status === "completed"
          ? "completed"
          : data.status === "in_progress"
            ? "inProgress"
            : "unknown",
      result:
        data.conclusion === "failure"
          ? "failed"
          : data.conclusion === "success"
            ? "succeeded"
            : "unknown",
      sourceBranch: typeof data.head_branch === "string" ? data.head_branch : undefined,
      commitSha: typeof data.head_sha === "string" ? data.head_sha : undefined,
      webUrl: typeof data.html_url === "string" ? data.html_url : undefined,
      startedAt: typeof data.run_started_at === "string" ? data.run_started_at : undefined,
      finishedAt: typeof data.updated_at === "string" ? data.updated_at : undefined,
    };
  }
  /**
   * Fetches the logs of the failed jobs in the referenced workflow run.
   *
   * Only jobs whose conclusion is `failure`, `cancelled`, or `timed_out` are
   * collected, and only when the returned content type is textual.
   *
   * @param reference - The run whose failure logs are fetched.
   * @returns The failed run's log chunks.
   */
  async getFailedLogs(reference: BuildReference): Promise<BuildLogChunk[]> {
    const jobs = (await (
      await this.request(reference, `/actions/runs/${reference.id}/jobs?per_page=100`)
    ).json()) as { jobs?: Array<Record<string, unknown>> };
    const failed = (jobs.jobs ?? []).filter((job) =>
      ["failure", "cancelled", "timed_out"].includes(String(job.conclusion))
    );
    const chunks: BuildLogChunk[] = [];
    for (const job of failed) {
      const response = await this.request(reference, `/actions/jobs/${job.id}/logs`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text") && !contentType.includes("json")) continue;
      chunks.push({
        jobName: typeof job.name === "string" ? job.name : undefined,
        content: await response.text(),
        isFailureCandidate: true,
      });
    }
    return chunks;
  }
}
