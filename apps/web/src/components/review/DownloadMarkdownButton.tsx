import { Button } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";

/** Browser pieces {@link saveMarkdownFile} uses, replaceable in tests. */
interface SaveEnvironment {
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
  readonly createLink: () => HTMLAnchorElement;
  readonly schedule: (callback: () => void) => void;
}

const BROWSER: SaveEnvironment = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  createLink: () => document.createElement("a"),
  schedule: (callback) => {
    setTimeout(callback, 1000);
  },
};

/**
 * Saves Markdown text as a `.md` file through the browser's download. The
 * object URL is released a moment later, not straight after the click, because
 * a browser may still be reading the blob when the click returns.
 */
export function saveMarkdownFile(
  text: string,
  fileName: string,
  env: SaveEnvironment = BROWSER
): void {
  const url = env.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = env.createLink();
  link.href = url;
  link.download = fileName;
  link.click();
  env.schedule(() => env.revokeObjectURL(url));
}

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
  return (
    <Button
      variant="default"
      size="xs"
      onClick={() => saveMarkdownFile(text, fileName)}
      leftSection={<IconDownload size={14} />}
    >
      {label}
    </Button>
  );
}
