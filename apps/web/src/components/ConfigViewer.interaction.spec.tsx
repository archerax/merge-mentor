// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigFieldView, ConfigSaveResult, ConfigView } from "../server/config.types.js";
import { renderWithMantine } from "../test/renderWithMantine.js";

const invalidate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate }) }));
vi.mock("../server/config.functions.js", () => ({ saveConfig: vi.fn() }));

const { saveConfig } = await import("../server/config.functions.js");
const { ConfigViewer } = await import("./ConfigViewer.js");

function field(overrides: Partial<ConfigFieldView> & { envVar: string }): ConfigFieldView {
  return {
    label: overrides.envVar,
    description: `About ${overrides.envVar}`,
    type: "text",
    secret: false,
    set: false,
    value: null,
    advanced: false,
    ...overrides,
  };
}

function view(overrides: Partial<ConfigView> = {}): ConfigView {
  return {
    sections: [
      {
        title: "General",
        description: "General settings",
        fields: [
          field({ envVar: "MM_NAME", label: "Name", value: "merge-mentor", set: true }),
          field({ envVar: "MM_COUNT", label: "Count", type: "number", value: "3" }),
          field({ envVar: "MM_VERBOSE", label: "Verbose", type: "boolean", value: "false" }),
          field({
            envVar: "MM_STRATEGY",
            label: "Strategy",
            type: "enum",
            options: ["fast", "deep"],
            value: "fast",
          }),
          field({
            envVar: "MM_TOKEN",
            label: "Token",
            type: "secret",
            secret: true,
            set: true,
            note: "Stored in .env",
          }),
          field({ envVar: "MM_TUNING", label: "Tuning", advanced: true }),
        ],
      },
      {
        title: "Review",
        description: "Review settings",
        fields: [field({ envVar: "MM_REVIEW", label: "Review option", value: "x", set: true })],
      },
    ],
    warnings: [],
    error: null,
    ...overrides,
  };
}

function saveResult(overrides: Partial<ConfigSaveResult> = {}): ConfigSaveResult {
  return { ok: true, view: view(), errors: [], ...overrides };
}

/** The edits sent by the first `saveConfig` call. */
function savedEdits(): readonly { envVar: string; value: string }[] {
  const [request] = vi.mocked(saveConfig).mock.calls[0] as unknown as [
    { data: { edits: { envVar: string; value: string }[] } },
  ];
  return request.data.edits;
}

describe("ConfigViewer interactions", () => {
  beforeEach(() => {
    vi.mocked(saveConfig).mockReset();
    invalidate.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders sections as tabs, with descriptions and notes", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ConfigViewer view={view()} />);

    expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("General settings")).toBeInTheDocument();
    expect(screen.getByText("Stored in .env")).toBeInTheDocument();
    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Review" }));

    expect(await screen.findByText("Review settings")).toBeInTheDocument();
    expect(screen.getByLabelText("Review option")).toHaveValue("x");
  });

  it("shows configuration warnings", () => {
    renderWithMantine(<ConfigViewer view={view({ warnings: ["Token is missing"] })} />);

    expect(screen.getByText("Configuration warnings")).toBeInTheDocument();
    expect(screen.getByText("Token is missing")).toBeInTheDocument();
  });

  it("reveals advanced settings with the switch and remembers the choice", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ConfigViewer view={view()} />);
    expect(screen.queryByLabelText("Tuning")).not.toBeInTheDocument();
    expect(screen.getByText("1 setting is hidden.")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Show advanced settings" }));

    expect(screen.getByLabelText("Tuning")).toBeInTheDocument();
    expect(window.localStorage.getItem("merge-mentor:config:show-advanced")).toBe("true");
  });

  it("restores the advanced preference from storage", async () => {
    window.localStorage.setItem("merge-mentor:config:show-advanced", "true");
    renderWithMantine(<ConfigViewer view={view()} />);

    expect(await screen.findByLabelText("Tuning")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show advanced settings" })).toBeChecked();
  });

  it("works when storage is unavailable", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderWithMantine(<ConfigViewer view={view()} />);

    await user.click(screen.getByRole("switch", { name: "Show advanced settings" }));

    expect(screen.getByLabelText("Tuning")).toBeInTheDocument();
  });

  it("tracks edits to a text field and can revert to the original value", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ConfigViewer view={view()} />);
    const input = screen.getByLabelText("Name");

    await user.type(input, "-x");
    expect(screen.getByText("Modified")).toBeInTheDocument();
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "General — has unsaved changes" })).toBeInTheDocument();

    await user.type(input, "{Backspace}{Backspace}");
    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();
    expect(screen.queryByText("Modified")).not.toBeInTheDocument();
  });

  it("edits number, boolean, enum and secret fields", async () => {
    const user = userEvent.setup();
    vi.mocked(saveConfig).mockResolvedValue(saveResult());
    renderWithMantine(<ConfigViewer view={view()} />);

    await user.clear(screen.getByLabelText("Count"));
    await user.type(screen.getByLabelText("Count"), "5");
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Verbose" }));
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Strategy" }));
    await user.click(await screen.findByRole("option", { name: "deep" }));
    await user.type(screen.getByPlaceholderText("Set (hidden) — type to replace"), "s3cret");
    expect(screen.getByText("4 unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(saveConfig).toHaveBeenCalledTimes(1));
    const edits = savedEdits();
    expect(edits).toEqual(
      expect.arrayContaining([
        { envVar: "MM_COUNT", value: "5" },
        { envVar: "MM_VERBOSE", value: "true" },
        { envVar: "MM_STRATEGY", value: "deep" },
        { envVar: "MM_TOKEN", value: expect.stringContaining("s3cret") },
      ])
    );
    expect(edits).toHaveLength(4);
  });

  it("clears an enum selection back to the default", async () => {
    const user = userEvent.setup();
    vi.mocked(saveConfig).mockResolvedValue(saveResult());
    renderWithMantine(<ConfigViewer view={view()} />);

    // Choosing the current option again deselects a clearable Select.
    await user.click(screen.getByRole("combobox", { name: "Strategy" }));
    await user.click(await screen.findByRole("option", { name: "fast" }));

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(saveConfig).toHaveBeenCalled());
    expect(savedEdits()).toEqual([{ envVar: "MM_STRATEGY", value: "" }]);
  });

  it("clears and un-clears a stored secret", async () => {
    const user = userEvent.setup();
    vi.mocked(saveConfig).mockResolvedValue(saveResult());
    renderWithMantine(<ConfigViewer view={view()} />);

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByPlaceholderText("Will be cleared")).toBeInTheDocument();
    expect(screen.getByText("Modified")).toBeInTheDocument();
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(saveConfig).toHaveBeenCalled());
    expect(savedEdits()).toEqual([{ envVar: "MM_TOKEN", value: "" }]);
  });

  it("does not offer Clear for a secret that is not set", () => {
    renderWithMantine(
      <ConfigViewer
        view={view({
          sections: [
            {
              title: "General",
              description: "",
              fields: [field({ envVar: "MM_TOKEN", label: "Token", type: "secret", secret: true })],
            },
          ],
        })}
      />
    );

    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Not set")).toBeInTheDocument();
  });

  it("saves, confirms and refreshes the route data", async () => {
    const user = userEvent.setup();
    vi.mocked(saveConfig).mockResolvedValue(saveResult());
    renderWithMantine(<ConfigViewer view={view()} />);

    await user.type(screen.getByLabelText("Name"), "!");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Configuration saved")).toBeInTheDocument();
    expect(saveConfig).toHaveBeenCalledWith({
      data: { edits: [{ envVar: "MM_NAME", value: "merge-mentor!" }] },
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();
  });

  it("shows field errors with their labels and marks the tab", async () => {
    const user = userEvent.setup();
    vi.mocked(saveConfig).mockResolvedValue(
      saveResult({
        ok: false,
        errors: [
          { envVar: "MM_COUNT", message: "Must be at least 1" },
          { envVar: "UNKNOWN_VAR", message: "Not recognised" },
        ],
      })
    );
    renderWithMantine(<ConfigViewer view={view()} />);

    await user.clear(screen.getByLabelText("Count"));
    await user.type(screen.getByLabelText("Count"), "0");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Some values are invalid")).toBeInTheDocument();
    expect(screen.getByText("Count", { selector: "b" })).toBeInTheDocument();
    expect(screen.getAllByText(/Must be at least 1/)).toHaveLength(2);
    expect(screen.getByText("UNKNOWN_VAR", { selector: "b" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "General — has invalid values" })).toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalled();
    expect(screen.queryByText("Configuration saved")).not.toBeInTheDocument();
    // The edit is kept so the user can fix it.
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
  });

  it("discards pending edits", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ConfigViewer view={view()} />);
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();

    await user.type(screen.getByLabelText("Name"), "!");
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(screen.getByLabelText("Name")).toHaveValue("merge-mentor");
    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();
  });

  it("filters platform-specific settings by the selected platform", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ConfigViewer
        view={view({
          sections: [
            {
              title: "Platform",
              description: "Where your code is hosted",
              fields: [
                field({
                  envVar: "MM_PLATFORM",
                  label: "Default platform",
                  type: "enum",
                  options: ["github", "azure"],
                  value: "github",
                }),
                field({ envVar: "AZ", label: "Azure org", platform: "azure" }),
                field({ envVar: "GH", label: "GitHub owner", platform: "github", set: true }),
              ],
            },
          ],
        })}
      />
    );

    expect(screen.getByLabelText("GitHub owner")).toBeInTheDocument();
    expect(screen.queryByLabelText("Azure org")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Default platform" }));
    await user.click(await screen.findByRole("option", { name: "azure" }));

    expect(await screen.findByLabelText("Azure org")).toBeInTheDocument();
    expect(screen.queryByLabelText("GitHub owner")).not.toBeInTheDocument();
  });

  it("falls back to the first visible tab when the active one disappears", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ConfigViewer
        view={view({
          sections: [
            {
              title: "Basic",
              description: "Basic settings",
              fields: [field({ envVar: "MM_BASIC", label: "Basic option" })],
            },
            {
              title: "Tuning",
              description: "Tuning settings",
              fields: [field({ envVar: "MM_TUNE", label: "Tune option", advanced: true })],
            },
          ],
        })}
      />
    );
    expect(screen.queryByRole("tab", { name: "Tuning" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Show advanced settings" }));
    await user.click(await screen.findByRole("tab", { name: "Tuning" }));
    expect(screen.getByRole("tab", { name: "Tuning" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("switch", { name: "Show advanced settings" }));

    await waitFor(() =>
      expect(screen.queryByRole("tab", { name: "Tuning" })).not.toBeInTheDocument()
    );
    expect(screen.getByRole("tab", { name: "Basic" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows an empty editor when no settings are visible", () => {
    renderWithMantine(<ConfigViewer view={view({ sections: [] })} />);

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();
  });
});
