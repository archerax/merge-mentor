import { MantineProvider } from "@mantine/core";
import type { UsageSummary } from "@merge-mentor/shared/reports/usageReport.js";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UsagePanel } from "./UsagePanel.js";

const empty: UsageSummary = {
  runs: 0,
  prs: 0,
  reportedPrs: 0,
  completeRuns: 0,
  partialRuns: 0,
  notReportedRuns: 0,
  inputTokens: 0,
  outputTokens: 0,
  byModel: [],
  byProvider: [],
};

function render(usage: UsageSummary): string {
  return renderToStaticMarkup(
    <MantineProvider>
      <UsagePanel usage={usage} days={30} />
    </MantineProvider>
  );
}

describe("UsagePanel", () => {
  it("explains when nothing has been recorded", () => {
    expect(render(empty)).toContain("No usage recorded");
  });

  it("says usage was not reported instead of showing zero totals", () => {
    const html = render({ ...empty, prs: 1, notReportedRuns: 1 });
    expect(html).toContain("Usage not reported");
    expect(html).not.toContain("Total tokens");
  });

  it("shows totals, marks unreported fields, and breaks down by model and provider", () => {
    const group = { key: "gpt-4.1", runs: 2, inputTokens: 1000, outputTokens: 200 };
    const html = render({
      ...empty,
      runs: 2,
      prs: 2,
      reportedPrs: 2,
      completeRuns: 2,
      inputTokens: 1000,
      outputTokens: 200,
      byModel: [group],
      byProvider: [{ ...group, key: "copilot-sdk" }],
    });
    expect(html).toContain("1,200");
    expect(html).toContain("Cached tokens");
    expect(html).toContain("not reported");
    expect(html).toContain("1,000 in, 200 out");
    expect(html).not.toContain("reasoning");
    expect(html).toContain("gpt-4.1");
    expect(html).toContain("copilot-sdk");
  });

  it("shows provider-reported cost as AI credits", () => {
    const html = render({
      ...empty,
      runs: 1,
      prs: 1,
      reportedPrs: 1,
      completeRuns: 1,
      inputTokens: 10,
      outputTokens: 5,
      nanoAiu: 2.5e9,
    });
    expect(html).toContain("2.50 AI credits");
    expect(html).toContain("~$0.0250");
  });

  it("shows estimated dollars from list prices with the price date", () => {
    const html = render({
      ...empty,
      runs: 1,
      prs: 1,
      reportedPrs: 1,
      completeRuns: 1,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.0042,
      byModel: [
        { key: "deepseek-v4.1-flash", runs: 1, inputTokens: 10, outputTokens: 5, costUsd: 0.0042 },
      ],
    });
    expect(html).toContain("$0.0042");
    expect(html).toContain("DeepSeek list prices as of 2026-10-25");
  });

  it("flags partial and unreported reviews", () => {
    const html = render({
      ...empty,
      runs: 1,
      prs: 2,
      reportedPrs: 1,
      partialRuns: 1,
      notReportedRuns: 1,
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(html).toContain("Partial usage");
    expect(html).toContain("Some reviews did not report usage");
  });
});
