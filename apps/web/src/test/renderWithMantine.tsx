import { MantineProvider } from "@mantine/core";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

/** Renders a component inside the MantineProvider every UI component expects. */
export function renderWithMantine(ui: ReactElement): RenderResult {
  const result = render(<MantineProvider env="test">{ui}</MantineProvider>);
  return {
    ...result,
    rerender: (next) => result.rerender(<MantineProvider env="test">{next}</MantineProvider>),
  };
}
