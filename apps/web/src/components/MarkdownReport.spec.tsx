import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownReport } from "./MarkdownReport.js";

function renderHtml(content: string): string {
  return renderToStaticMarkup(
    <MantineProvider>
      <MarkdownReport content={content} />
    </MantineProvider>
  );
}

describe("MarkdownReport", () => {
  it("renders markdown headings, emphasis, and lists", () => {
    const html = renderHtml("# Title\n\nSome **bold** text\n\n- one\n- two");
    expect(html).toContain("Title");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<li>one</li>");
  });

  it("renders GitHub-flavored tables", () => {
    const html = renderHtml("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table");
    expect(html).toContain("<td>1</td>");
  });

  it("escapes raw HTML so report content cannot inject markup", () => {
    const html = renderHtml('<script>alert("x")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
