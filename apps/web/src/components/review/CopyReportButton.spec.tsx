// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithMantine } from "../../test/renderWithMantine.js";
import { CopyReportButton } from "./CopyReportButton.js";

describe("CopyReportButton", () => {
  it("shows the default label", () => {
    renderWithMantine(<CopyReportButton text="report" />);
    expect(screen.getByRole("button", { name: "Copy report" })).toBeInTheDocument();
  });

  it("shows a custom label", () => {
    renderWithMantine(<CopyReportButton text="report" label="Copy PBI" />);
    expect(screen.getByRole("button", { name: "Copy PBI" })).toBeInTheDocument();
  });

  it("copies the text to the clipboard and confirms with a Copied label", async () => {
    const user = userEvent.setup();
    renderWithMantine(<CopyReportButton text="# My report" />);

    await user.click(screen.getByRole("button", { name: "Copy report" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument());
    expect(await navigator.clipboard.readText()).toBe("# My report");
  });
});
