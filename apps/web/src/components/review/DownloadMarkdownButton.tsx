import { Button } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";

interface DownloadMarkdownButtonProps {
  /** The Markdown to save. */
  readonly text: string;
  /** File name offered by the browser's save dialog. */
  readonly fileName: string;
  readonly label?: string;
}

/**
 * Saves Markdown text as a `.md` file on the person's computer, for further
 * processing in their own tools. Works from the text already on the page, so
 * nothing is requested from the server.
 */
export function DownloadMarkdownButton({
  text,
  fileName,
  label = "Download Markdown",
}: DownloadMarkdownButtonProps) {
  function download(): void {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="default" size="xs" onClick={download} leftSection={<IconDownload size={14} />}>
      {label}
    </Button>
  );
}
