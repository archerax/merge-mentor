import { Badge, Card, Group, Loader, ScrollArea, Title } from "@mantine/core";
import { useEffect, useRef } from "react";

import { MarkdownReport } from "../MarkdownReport.js";
import { phaseLabel } from "./format.js";
import type { LiveOutput } from "./useReviewStream.js";

interface LiveThinkingProps {
  readonly live: LiveOutput | null;
  readonly running: boolean;
}

/**
 * Renders the active phase's accumulated AI output as formatted markdown.
 *
 * Partial markdown mid-stream is tolerated; the panel is only shown while the
 * run is in flight and collapses once the result arrives.
 */
export function LiveThinking({ live, running }: LiveThinkingProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const text = live?.text ?? "";

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [text]);

  if (!running || live === null || text.trim().length === 0) return null;

  return (
    <Card padding="lg">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Title order={5}>Live AI output</Title>
          <Badge variant="light" color="brand" tt="none">
            {phaseLabel(live.phase)}
          </Badge>
        </Group>
        <Loader size="xs" />
      </Group>
      <ScrollArea.Autosize mah={360} viewportRef={viewportRef} type="auto">
        <div style={{ paddingRight: 8 }}>
          <MarkdownReport content={text} />
        </div>
      </ScrollArea.Autosize>
    </Card>
  );
}
