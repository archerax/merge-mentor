import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageHeader } from "./PageHeader.js";

function renderHtml(ui: ReactNode): string {
  return renderToStaticMarkup(<MantineProvider>{ui}</MantineProvider>);
}

describe("PageHeader", () => {
  it("renders the title", () => {
    const html = renderHtml(<PageHeader title="Dashboard" />);
    expect(html).toContain("Dashboard");
  });

  it("renders the description when provided", () => {
    const html = renderHtml(<PageHeader title="Dashboard" description="Overview of runs" />);
    expect(html).toContain("Overview of runs");
  });

  it("omits the description when absent", () => {
    const html = renderHtml(<PageHeader title="Dashboard" />);
    expect(html).not.toContain("Overview of runs");
  });

  it("renders the actions slot", () => {
    const html = renderHtml(
      <PageHeader title="Dashboard" actions={<button type="button">Refresh</button>} />
    );
    expect(html).toContain("<button");
    expect(html).toContain("Refresh");
  });
});
