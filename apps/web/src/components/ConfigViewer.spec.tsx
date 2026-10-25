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

function platformView(platform: string): ConfigView {
  return view([
    {
      title: "Platform",
      description: "Where your code is hosted",
      fields: [
        field({
          envVar: "MM_PLATFORM",
          label: "Default platform",
          type: "enum",
          value: platform,
        }),
        field({ envVar: "AZ", label: "Azure org", platform: "azure" }),
        field({ envVar: "GH", label: "GitHub owner", platform: "github", set: true }),
      ],
    },
  ]);
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
    expect(html).toContain("1 setting is hidden.");
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

  describe("platform settings", () => {
    it("hides GitHub settings while Azure DevOps is selected, even when they hold a value", () => {
      const html = renderHtml(<ConfigViewer view={platformView("azure")} />);

      expect(html).toContain("Azure org");
      expect(html).not.toContain("GitHub owner");
      expect(html).toContain("1 setting is hidden.");
    });

    it("hides Azure DevOps settings while GitHub is selected", () => {
      const html = renderHtml(<ConfigViewer view={platformView("github")} />);

      expect(html).toContain("GitHub owner");
      expect(html).not.toContain("Azure org");
    });
  });
});
