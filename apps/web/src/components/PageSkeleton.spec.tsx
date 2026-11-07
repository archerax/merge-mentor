import { describe, expect, it } from "vitest";

import { renderWithQuery } from "../test/renderWithQuery.test-helper.js";
import { PageSkeleton } from "./PageSkeleton.js";

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("PageSkeleton", () => {
  it("marks itself as loading for assistive technology", () => {
    const { html } = renderWithQuery(<PageSkeleton />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Loading page"');
  });

  it("renders six body rows and no tiles by default", () => {
    const { html } = renderWithQuery(<PageSkeleton />);
    expect(count(html, 'data-testid="page-skeleton-row"')).toBe(6);
    expect(html).not.toContain('data-testid="page-skeleton-tiles"');
  });

  it("renders the requested number of tiles and rows", () => {
    const { html } = renderWithQuery(<PageSkeleton tiles={3} rows={2} />);
    expect(html).toContain('data-testid="page-skeleton-tiles"');
    expect(count(html, 'data-testid="page-skeleton-tile"')).toBe(3);
    expect(count(html, 'data-testid="page-skeleton-row"')).toBe(2);
  });
});
