import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TechnicalLog } from "./TechnicalLog.js";
import type { TechnicalEntry } from "./useReviewStream.js";

function renderHtml(ui: ReactNode): string {
  return renderToStaticMarkup(<MantineProvider>{ui}</MantineProvider>);
}

describe("TechnicalLog", () => {
  it("renders nothing when there are no entries", () => {
    const html = renderHtml(<TechnicalLog entries={[]} />);
    expect(html).not.toContain("Technical log");
  });

  it("renders the entry count and control", () => {
    const entries: TechnicalEntry[] = [
      { id: 0, kind: "status", text: "Starting review" },
      { id: 1, kind: "log", text: "Found 2 files" },
      { id: 2, kind: "chunk", text: "raw output" },
    ];

    const html = renderHtml(<TechnicalLog entries={entries} />);

    expect(html).toContain("Technical log");
    expect(html).toContain("3 entries");
  });
});
