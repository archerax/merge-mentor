import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ConfigFieldView, ConfigView } from "../server/config.types.js";
import { ConfigViewer } from "./ConfigViewer.js";

vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate: vi.fn() }) }));
vi.mock("../server/config.functions.js", () => ({ saveConfig: vi.fn() }));

function field(overrides: Partial<ConfigFieldView> & { envVar: string }): ConfigFieldView {
  return {
    label: overrides.envVar,
    description: "Help text",
    type: "text",
    secret: false,
    set: false,
    value: null,
    advanced: false,
    ...overrides,
  };
}

function view(sections: ConfigView["sections"]): ConfigView {
  return { sections, warnings: [], error: null };
}

function renderHtml(ui: ReactNode): string {
  return renderToStaticMarkup(<MantineProvider>{ui}</MantineProvider>);
}

describe("ConfigViewer", () => {
  const sections: ConfigView["sections"] = [
    {
      title: "Basics",
      description: "Everyday settings",
      fields: [field({ envVar: "BASIC", label: "Basic setting" })],
    },
    {
      title: "Tuning",
      description: "Rarely changed",
      fields: [field({ envVar: "TUNE", label: "Tuning knob", advanced: true })],
    },
  ];

  it("hides unset advanced settings, and tabs that become empty, by default", () => {
    const html = renderHtml(<ConfigViewer view={view(sections)} />);

    expect(html).toContain("Basic setting");
    expect(html).not.toContain("Tuning knob");
    expect(html).not.toContain("Tuning");
    expect(html).toContain("1 advanced setting is hidden.");
    expect(html).toContain("Show advanced settings");
  });

  it("keeps an advanced setting visible once it has a value", () => {
    const withValue: ConfigView["sections"] = [
      sections[0],
      {
        ...sections[1],
        fields: [field({ envVar: "TUNE", label: "Tuning knob", advanced: true, set: true })],
      },
    ];
    const html = renderHtml(<ConfigViewer view={view(withValue)} />);

    expect(html).toContain("Tuning");
    expect(html).not.toContain("hidden.");
  });
});
