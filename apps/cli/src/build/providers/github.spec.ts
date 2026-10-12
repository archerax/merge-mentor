import { PlatformApiError } from "@merge-mentor/shared/errors/index.js";
import { describe, expect, it, vi } from "vitest";

import type { BuildReference } from "../types.js";
import { type GithubBuildHttp, GithubBuildProvider } from "./github.js";

const reference: BuildReference = {
  platform: "github",
  id: "17",
  ownerOrOrg: "acme",
  repository: "widget",
};

function http(responses: Response[]): GithubBuildHttp {
  return { get: vi.fn().mockImplementation(async () => responses.shift()) };
}

describe("GithubBuildProvider", () => {
  it("maps a workflow run into a build summary and sends auth headers", async () => {
    const get = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 17,
          name: "Checks",
          status: "completed",
          conclusion: "failure",
          head_branch: "feature/test",
          head_sha: "abc123",
          html_url: "https://github.test/run/17",
          run_started_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:01:00Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const provider = new GithubBuildProvider("secret", { get });

    await expect(provider.getBuildSummary(reference)).resolves.toMatchObject({
      id: "17",
      name: "Checks",
      status: "completed",
      result: "failed",
      sourceBranch: "feature/test",
    });
    expect(get).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/widget/actions/runs/17",
      expect.objectContaining({
        headers: { Authorization: "Bearer secret", Accept: "application/vnd.github+json" },
      })
    );
  });

  it("returns logs only for failed jobs with textual content", async () => {
    const client = http([
      new Response(
        JSON.stringify({
          jobs: [
            { id: 1, name: "test", conclusion: "failure" },
            { id: 2, name: "docs", conclusion: "success" },
            { id: 3, name: "lint", conclusion: "cancelled" },
          ],
        }),
        { status: 200 }
      ),
      new Response("test failed", { status: 200, headers: { "content-type": "text/plain" } }),
      new Response("binary", { status: 200, headers: { "content-type": "application/zip" } }),
    ]);

    await expect(
      new GithubBuildProvider("token", client).getFailedLogs(reference)
    ).resolves.toEqual([{ jobName: "test", content: "test failed", isFailureCandidate: true }]);
  });

  it("raises PlatformApiError for unsuccessful responses", async () => {
    const provider = new GithubBuildProvider(
      "token",
      http([new Response("no", { status: 403, statusText: "Forbidden" })])
    );

    await expect(provider.getBuildSummary(reference)).rejects.toBeInstanceOf(PlatformApiError);
  });

  it("maps in-progress and successful runs without optional metadata", async () => {
    const get = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "in_progress", conclusion: "success" }), {
        status: 200,
      })
    );
    const provider = new GithubBuildProvider("token", { get });

    await expect(provider.getBuildSummary(reference)).resolves.toMatchObject({
      id: "17",
      name: "workflow run",
      status: "inProgress",
      result: "succeeded",
      sourceBranch: undefined,
      commitSha: undefined,
      webUrl: undefined,
    });
  });

  it("defaults unknown status and result", async () => {
    const get = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: "queued", conclusion: "skipped" }), { status: 200 })
      );
    const provider = new GithubBuildProvider("token", { get });

    await expect(provider.getBuildSummary(reference)).resolves.toMatchObject({
      status: "unknown",
      result: "unknown",
    });
  });

  it("collects unnamed failed jobs and accepts json log content", async () => {
    const client = http([
      new Response(
        JSON.stringify({
          jobs: [
            { id: 1, conclusion: "timed_out" },
            { id: 2, name: "named", conclusion: "failure" },
          ],
        }),
        { status: 200 }
      ),
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response("named log", { status: 200, headers: { "content-type": "text/plain" } }),
    ]);

    await expect(
      new GithubBuildProvider("token", client).getFailedLogs(reference)
    ).resolves.toEqual([
      { jobName: undefined, content: '{"ok":true}', isFailureCandidate: true },
      { jobName: "named", content: "named log", isFailureCandidate: true },
    ]);
  });

  it("handles a jobs payload without a jobs array", async () => {
    const client = http([new Response(JSON.stringify({}), { status: 200 })]);

    await expect(
      new GithubBuildProvider("token", client).getFailedLogs(reference)
    ).resolves.toEqual([]);
  });

  it("skips jobs whose log has no textual content type", async () => {
    const client = http([
      new Response(JSON.stringify({ jobs: [{ id: 1, conclusion: "failure" }] }), { status: 200 }),
      new Response(null, { status: 200 }),
    ]);

    await expect(
      new GithubBuildProvider("token", client).getFailedLogs(reference)
    ).resolves.toEqual([]);
  });
});
