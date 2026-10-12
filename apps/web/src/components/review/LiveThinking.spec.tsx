import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LiveThinking } from "./LiveThinking.js";
import type { LiveOutput } from "./useReviewStream.js";

function renderHtml(live: LiveOutput | null, running: boolean): string {
  return renderToStaticMarkup(
    <MantineProvider>
      <LiveThinking live={live} running={running} />
    </MantineProvider>
  );
}

describe("LiveThinking", () => {
  it("renders nothing when not running", () => {
    const html = renderHtml({ phase: "ai-review", text: "thinking" }, false);
    expect(html).not.toContain("Live AI output");
  });

  it("renders nothing when there is no live output", () => {
    const html = renderHtml(null, true);
    expect(html).not.toContain("Live AI output");
  });

  it("renders nothing when the live text is blank", () => {
    const html = renderHtml({ phase: "ai-review", text: "   " }, true);
    expect(html).not.toContain("Live AI output");
  });

  it("renders the phase label and streamed markdown", () => {
    const html = renderHtml({ phase: "file-review", text: "## Finding\n\nDetails" }, true);
    expect(html).toContain("Live AI output");
    expect(html).toContain("Reviewing files");
    expect(html).toContain("Finding");
    expect(html).toContain("Details");
  });
});
