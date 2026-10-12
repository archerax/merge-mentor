import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SEVERITY_COLORS, SEVERITY_ORDER, SeveritySummary } from "./SeveritySummary.js";

function renderHtml(ui: ReactNode): string {
  return renderToStaticMarkup(<MantineProvider>{ui}</MantineProvider>);
}

describe("SeveritySummary", () => {
  it("renders nothing when there are no findings", () => {
    expect(renderHtml(<SeveritySummary findings={[]} />)).not.toContain("finding");
  });

  it("shows the total and per-severity counts", () => {
    const html = renderHtml(
      <SeveritySummary
        findings={[{ severity: "high" }, { severity: "high" }, { severity: "low" }]}
      />
    );

    expect(html).toContain("3 findings");
    expect(html).toContain("2 high");
    expect(html).toContain("1 low");
    expect(html).not.toContain("critical");
  });

  it("uses the singular label for a single finding", () => {
    const html = renderHtml(<SeveritySummary findings={[{ severity: "medium" }]} />);
    expect(html).toContain("1 finding");
    expect(html).not.toContain("1 findings");
  });

  it("exports the severity order and colors", () => {
    expect(SEVERITY_ORDER).toEqual(["critical", "high", "medium", "low"]);
    expect(SEVERITY_COLORS.critical).toBe("red");
    expect(SEVERITY_COLORS.low).toBe("blue");
  });
});
