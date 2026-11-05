import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DownloadMarkdownButton, saveMarkdownFile } from "./DownloadMarkdownButton.js";

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

describe("saveMarkdownFile", () => {
  it("offers the text as a Markdown file and releases the URL only after the click", async () => {
    const link = { href: "", download: "", click: vi.fn() } as unknown as HTMLAnchorElement;
    const order: string[] = [];
    let blob: Blob | undefined;
    let later: (() => void) | undefined;
    link.click = vi.fn(() => order.push("click"));

    saveMarkdownFile("# Backlog", "prd-run-1-breakdown.md", {
      createObjectURL: (created) => {
        blob = created;
        return "blob:abc";
      },
      revokeObjectURL: (url) => order.push(`revoke ${url}`),
      createLink: () => link,
      schedule: (callback) => {
        later = callback;
      },
    });

    expect(link.href).toBe("blob:abc");
    expect(link.download).toBe("prd-run-1-breakdown.md");
    expect(blob?.type).toBe("text/markdown;charset=utf-8");
    expect(await blob?.text()).toBe("# Backlog");
    // Not released yet: the browser may still be reading the blob.
    expect(order).toEqual(["click"]);
    later?.();
    expect(order).toEqual(["click", "revoke blob:abc"]);
  });
});
