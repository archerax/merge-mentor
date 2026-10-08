import { Typography } from "@mantine/core";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownReportProps {
  readonly content: string;
}

/**
 * Renders a markdown review report as React nodes.
 *
 * Uses Mantine's `Typography` for element styling and `react-markdown` for
 * parsing, which escapes raw HTML by default so report content cannot inject
 * markup into the workspace.
 */
export function MarkdownReport({ content }: MarkdownReportProps) {
  return (
    <Typography>
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </Typography>
  );
}
