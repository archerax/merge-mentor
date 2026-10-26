import { MantineProvider } from "@mantine/core";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { theme } from "../theme.js";

function Providers({ children }: { readonly children: ReactNode }) {
  return (
    <MantineProvider theme={theme} env="test">
      {children}
    </MantineProvider>
  );
}

/**
 * Renders a component inside the MantineProvider every UI component expects.
 * The provider is a `wrapper`, so `rerender` keeps it.
 */
export function renderWithMantine(ui: ReactElement): RenderResult {
  return render(ui, { wrapper: Providers });
}
