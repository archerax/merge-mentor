import { Button, Card, NavLink, Paper, createTheme } from "@mantine/core";
import type { DefaultMantineColor, MantineColorsTuple } from "@mantine/core";

declare module "@mantine/core" {
  export interface MantineThemeColorsOverride {
    colors: Record<DefaultMantineColor | "brand" | "accent", MantineColorsTuple>;
  }
}

const brand: MantineColorsTuple = [
  "#f4f1ff",
  "#e6deff",
  "#c9b8ff",
  "#a98fff",
  "#8e6cff",
  "#7c5cff",
  "#6a45f0",
  "#5a35d6",
  "#4c2bb8",
  "#3e2296",
];

const accent: MantineColorsTuple = [
  "#e6fffb",
  "#c6fff4",
  "#95f7e6",
  "#60ecd6",
  "#37dfc6",
  "#22d3ba",
  "#12b9a3",
  "#0a9484",
  "#0a7569",
  "#0d5f57",
];

export const theme = createTheme({
  primaryColor: "brand",
  primaryShade: { light: 6, dark: 5 },
  autoContrast: true,
  cursorType: "pointer",
  fontSmoothing: true,
  defaultRadius: "md",
  radius: {
    xs: "4px",
    sm: "6px",
    md: "10px",
    lg: "14px",
    xl: "20px",
  },
  fontFamily:
    "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  fontFamilyMonospace:
    "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  headings: {
    fontFamily:
      "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    fontWeight: "650",
    sizes: {
      h1: { fontSize: "2.25rem", lineHeight: "1.2" },
      h2: { fontSize: "1.75rem", lineHeight: "1.3" },
      h3: { fontSize: "1.35rem", lineHeight: "1.4" },
    },
  },
  colors: { brand, accent },
  components: {
    Card: Card.extend({
      defaultProps: {
        withBorder: true,
        radius: "lg",
        shadow: "xs",
      },
    }),
    Paper: Paper.extend({
      defaultProps: {
        radius: "lg",
      },
    }),
    Button: Button.extend({
      defaultProps: {
        radius: "md",
      },
    }),
    NavLink: NavLink.extend({
      defaultProps: {
        variant: "light",
      },
    }),
  },
});
