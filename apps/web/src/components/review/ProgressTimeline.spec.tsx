import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProgressTimeline } from "./ProgressTimeline.js";
import type { ProgressPhaseView, ProgressStepView } from "./useReviewStream.js";

function renderHtml(ui: ReactNode): string {
  return renderToStaticMarkup(<MantineProvider>{ui}</MantineProvider>);
}

function phase(overrides: Partial<ProgressPhaseView> = {}): ProgressPhaseView {
  return { id: "resolve", label: "Resolving target", status: "done", startedAt: 0, ...overrides };
}

describe("ProgressTimeline", () => {
  it("renders nothing when idle with no phases", () => {
    const html = renderHtml(
      <ProgressTimeline phases={[]} steps={[]} activity={null} elapsedMs={0} running={false} />
    );
    expect(html).not.toContain("Progress");
  });

  it("shows a starting state when running with no phases yet", () => {
    const html = renderHtml(
      <ProgressTimeline phases={[]} steps={[]} activity={null} elapsedMs={1000} running={true} />
    );
    expect(html).toContain("Starting…");
  });

  it("summarizes phase statuses and the elapsed clock", () => {
    const phases: ProgressPhaseView[] = [
      phase({ id: "resolve", label: "Resolving target", status: "done", endedAt: 3000 }),
      phase({ id: "fetch", label: "Fetching data", status: "error" }),
      phase({ id: "ai-review", label: "AI review", status: "start" }),
    ];
    const html = renderHtml(
      <ProgressTimeline phases={phases} steps={[]} activity={null} elapsedMs={65_000} running />
    );

    expect(html).toContain("Resolving target");
    expect(html).toContain("Done in 3s");
    expect(html).toContain("Failed");
    expect(html).toContain("In progress…");
    expect(html).toContain("01:05");
  });

  it("renders the activity line and subagent steps", () => {
    const steps: ProgressStepView[] = [
      { id: "general", label: "general", status: "done", detail: "3 findings", startedAt: 0 },
      { id: "security", label: "security", status: "start", startedAt: 0 },
    ];
    const html = renderHtml(
      <ProgressTimeline
        phases={[phase({ status: "start" })]}
        steps={steps}
        activity="Running security subagent"
        elapsedMs={5000}
        running
      />
    );

    expect(html).toContain("Running security subagent");
    expect(html).toContain("Subagents");
    expect(html).toContain("general");
    expect(html).toContain("· 3 findings");
    expect(html).toContain("security");
  });
});
