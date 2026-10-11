import { Button, CopyButton } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";

interface CopyReportButtonProps {
  readonly text: string;
  readonly label?: string;
}

/** Copies a plain-text/markdown report of the review result to the clipboard. */
export function CopyReportButton({ text, label = "Copy report" }: CopyReportButtonProps) {
  return (
    <CopyButton value={text} timeout={1500}>
      {({ copied, copy }) => (
        <Button
          variant="default"
          size="xs"
          onClick={copy}
          leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        >
          {copied ? "Copied" : label}
        </Button>
      )}
    </CopyButton>
  );
}
