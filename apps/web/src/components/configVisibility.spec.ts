import { describe, expect, it } from "vitest";

import type { ConfigFieldView } from "../server/config.types.js";
import { isFieldVisible } from "./configVisibility.js";

function field(overrides: Partial<ConfigFieldView> = {}): ConfigFieldView {
  return {
    envVar: "MM_TEST",
    label: "Test",
    description: "Help text",
    type: "text",
    secret: false,
    set: false,
    value: null,
    advanced: false,
    ...overrides,
  };
}

const base = { showAdvanced: false, selectedPlatform: "azure", touched: false } as const;

describe("isFieldVisible", () => {
  it("shows basic settings", () => {
    expect(isFieldVisible(field(), base)).toBe(true);
  });

  it("hides an unset advanced setting until advanced settings are shown", () => {
    const advanced = field({ advanced: true });

    expect(isFieldVisible(advanced, base)).toBe(false);
    expect(isFieldVisible(advanced, { ...base, showAdvanced: true })).toBe(true);
  });

  it("keeps an advanced setting visible once it holds a value", () => {
    expect(isFieldVisible(field({ advanced: true, set: true }), base)).toBe(true);
  });

  it("keeps an advanced setting visible while it has an edit, pending clear, or error", () => {
    expect(isFieldVisible(field({ advanced: true }), { ...base, touched: true })).toBe(true);
  });

  it("hides settings for the unselected platform, even when they hold a value", () => {
    const github = field({ platform: "github", set: true });

    expect(isFieldVisible(github, base)).toBe(false);
    expect(isFieldVisible(github, { ...base, selectedPlatform: "github" })).toBe(true);
    expect(isFieldVisible(github, { ...base, showAdvanced: true })).toBe(true);
    expect(isFieldVisible(github, { ...base, touched: true })).toBe(true);
  });

  it("hides an advanced setting for the other platform even when it holds a value", () => {
    const github = field({ platform: "github", advanced: true, set: true });

    expect(isFieldVisible(github, base)).toBe(false);
    expect(isFieldVisible(github, { ...base, selectedPlatform: "github" })).toBe(true);
  });

  it("shows platform settings when the selected platform is not known", () => {
    const azure = field({ platform: "azure" });

    expect(isFieldVisible(azure, { ...base, selectedPlatform: undefined })).toBe(true);
  });
});
