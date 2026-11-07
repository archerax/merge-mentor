import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { QueryDevtools } from "./QueryDevtools.js";

describe("QueryDevtools", () => {
  it("renders nothing on the server, so hydration matches", () => {
    expect(renderToStaticMarkup(<QueryDevtools />)).toBe("");
  });
});
