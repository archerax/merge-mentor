// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithMantine } from "../../test/renderWithMantine.js";
import { TechnicalLog } from "./TechnicalLog.js";
import type { TechnicalEntry } from "./useReviewStream.js";

const entries: readonly TechnicalEntry[] = [
  { id: 0, kind: "status", text: "\n▸ Starting\n" },
  { id: 1, kind: "log", text: "a log line\n" },
  { id: 2, kind: "chunk", text: "raw chunk" },
];

describe("TechnicalLog interactions", () => {
  it("renders nothing without entries", () => {
    renderWithMantine(<TechnicalLog entries={[]} />);

    expect(screen.queryByText("Technical log")).not.toBeInTheDocument();
  });

  it("expands to reveal the entries and collapses again", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TechnicalLog entries={entries} />);
    const header = screen.getByRole("button", { name: /Technical log/ });

    expect(screen.getByText("3 entries")).toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "false");

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("a log line")).toBeInTheDocument();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("copies the raw log and confirms with a Copied tooltip", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TechnicalLog entries={entries} />);
    await user.click(screen.getByRole("button", { name: /Technical log/ }));

    await user.click(await screen.findByRole("button", { name: "Copy technical log" }));

    expect(await navigator.clipboard.readText()).toBe("\n▸ Starting\na log line\nraw chunk");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });
});
