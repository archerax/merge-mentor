import {
  Accordion,
  ActionIcon,
  Code,
  CopyButton,
  Group,
  ScrollArea,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import type { TechnicalEntry } from "./useReviewStream.js";

const ENTRY_STYLES: Record<TechnicalEntry["kind"], React.CSSProperties> = {
  status: { color: "var(--mantine-color-blue-6)", fontWeight: 600 },
  log: { color: "var(--mantine-color-dimmed)" },
  chunk: {},
};

interface TechnicalLogProps {
  readonly entries: readonly TechnicalEntry[];
}

/**
 * Collapsed, copyable view of the raw status/log/chunk stream.
 *
 * Kept available for debugging and full detail, but out of the way: it never
 * auto-scrolls unless expanded, and the engine's structured progress events
 * are what drive the primary UI.
 */
export function TechnicalLog({ entries }: TechnicalLogProps) {
  const [open, setOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [entries, open]);

  if (entries.length === 0) return null;

  const raw = entries.map((entry) => entry.text).join("");

  return (
    <Accordion
      variant="separated"
      value={open ? "log" : null}
      onChange={(value) => setOpen(value === "log")}
    >
      <Accordion.Item value="log">
        <Accordion.Control>
          <Group gap="xs">
            <Text fw={600}>Technical log</Text>
            <Text size="xs" c="dimmed">
              {entries.length} entries
            </Text>
          </Group>
        </Accordion.Control>
        <Accordion.Panel>
          <Group justify="flex-end" mb="xs">
            <CopyButton value={raw} timeout={1500}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? "Copied" : "Copy log"}>
                  <ActionIcon variant="subtle" onClick={copy} aria-label="Copy technical log">
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
          <ScrollArea.Autosize mah={420} viewportRef={viewportRef} type="auto">
            <Code block className="mm-code-block">
              {entries.map((entry) => (
                <span key={entry.id} style={ENTRY_STYLES[entry.kind]}>
                  {entry.text}
                </span>
              ))}
            </Code>
          </ScrollArea.Autosize>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
