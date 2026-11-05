import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DownloadMarkdownButton } from "./DownloadMarkdownButton.js";

function render(label?: string): string {
  return renderToStaticMarkup(
    <MantineProvider>
      <DownloadMarkdownButton text="# Title" fileName="breakdown.md" label={label} />
    </MantineProvider>
  );
}

describe("DownloadMarkdownButton", () => {
  it("renders a button with the default and a custom label", () => {
    expect(render()).toContain("Download Markdown");
    expect(render("Save backlog")).toContain("Save backlog");
  });
});
