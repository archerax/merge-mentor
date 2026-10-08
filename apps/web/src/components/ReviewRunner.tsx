import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Divider,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useEffect, useRef, useState } from "react";

import type {
  ReviewFindingView,
  ReviewStreamEvent,
  ReviewStreamInput,
  ReviewSummary,
} from "../server/review.types.js";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "red",
  high: "orange",
  medium: "yellow",
  low: "blue",
};

type Status = "idle" | "running" | "done" | "error";

interface OutputEntry {
  readonly id: number;
  readonly kind: "status" | "log" | "chunk";
  readonly text: string;
}

export function ReviewRunner() {
  const [prInput, setPrInput] = useState("");
  const [write, setWrite] = useState(false);

  const [status, setStatus] = useState<Status>("idle");
  const [entries, setEntries] = useState<readonly OutputEntry[]>([]);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nextId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [entries]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function append(kind: OutputEntry["kind"], text: string) {
    setEntries((previous) => [...previous, { id: nextId.current++, kind, text }]);
  }

  function handleEvent(event: ReviewStreamEvent) {
    switch (event.type) {
      case "status":
        append("status", `\n▸ ${event.message}\n`);
        break;
      case "log":
        append("log", `${event.message}\n`);
        break;
      case "chunk":
        append("chunk", event.text);
        break;
      case "result":
        setSummary(event.summary);
        break;
      case "error":
        setError(event.message);
        setStatus("error");
        break;
      case "done":
        break;
    }
  }

  function buildInput(): ReviewStreamInput | { error: string } {
    const trimmed = prInput.trim();
    if (trimmed.length === 0) return { error: "Enter a PR URL or number." };

    if (/^https?:\/\//i.test(trimmed)) {
      return { prUrl: trimmed, write };
    }

    const pr = Number(trimmed);
    if (!Number.isInteger(pr) || pr <= 0) {
      return { error: "Enter a valid PR URL or a positive PR number." };
    }
    return { pr, write };
  }

  async function run() {
    const input = buildInput();
    if ("error" in input) {
      setError(input.error);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setEntries([]);
    setSummary(null);
    setError(null);
    setStatus("running");
    nextId.current = 0;

    try {
      const response = await fetch("/api/review/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Review request failed (HTTP ${response.status}).`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          handleEvent(JSON.parse(dataLine.slice(6)) as ReviewStreamEvent);
        }
      }

      setStatus((current) => (current === "error" ? current : "done"));
    } catch (caught) {
      if ((caught as Error).name === "AbortError") {
        setStatus("idle");
        return;
      }
      setError((caught as Error).message);
      setStatus("error");
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStatus("idle");
  }

  const running = status === "running";

  return (
    <Stack gap="lg">
      <Card withBorder padding="lg" radius="md">
        <Stack gap="md">
          <TextInput
            label="Pull request"
            placeholder="https://github.com/owner/repo/pull/123 or 123"
            value={prInput}
            onChange={(event) => setPrInput(event.currentTarget.value)}
            disabled={running}
          />
          <Switch
            label="Post comments to the PR"
            description="Off runs a dry-run and only reports what would be posted."
            checked={write}
            onChange={(event) => setWrite(event.currentTarget.checked)}
            disabled={running}
          />
          <Group>
            <Button onClick={run} loading={running} disabled={running}>
              Run review
            </Button>
            {running && (
              <Button variant="default" onClick={stop}>
                Stop
              </Button>
            )}
          </Group>
        </Stack>
      </Card>

      {error && (
        <Alert title="Review failed" color="red">
          {error}
        </Alert>
      )}

      {entries.length > 0 && (
        <Card withBorder padding="md" radius="md">
          <Group justify="space-between" mb="xs">
            <Title order={5}>Live output</Title>
            {running && <Loader size="xs" />}
          </Group>
          <ScrollArea.Autosize mah={420} viewportRef={viewportRef}>
            <Code
              block
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "transparent" }}
            >
              {entries.map((entry) => (
                <span key={entry.id} style={entryStyle(entry.kind)}>
                  {entry.text}
                </span>
              ))}
            </Code>
          </ScrollArea.Autosize>
        </Card>
      )}

      {summary && <ReviewResult summary={summary} />}
    </Stack>
  );
}

function entryStyle(kind: OutputEntry["kind"]): React.CSSProperties {
  if (kind === "status") return { color: "var(--mantine-color-blue-6)", fontWeight: 600 };
  if (kind === "log") return { color: "var(--mantine-color-dimmed)" };
  return {};
}

function ReviewResult({ summary }: { readonly summary: ReviewSummary }) {
  const findings = summary.findings;
  const critical = findings.filter((finding) => finding.severity === "critical").length;

  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={4}>Review result</Title>
            <Text size="sm" c="dimmed">
              PR #{summary.number} · {summary.title}
            </Text>
            <Text size="sm" c="dimmed">
              {summary.author} · <Code>{summary.headBranch}</Code> →{" "}
              <Code>{summary.baseBranch}</Code>
            </Text>
          </div>
          <Group gap="xs">
            {summary.dryRun && (
              <Badge color="gray" variant="light">
                dry-run
              </Badge>
            )}
            <Button
              component="a"
              href={summary.url}
              target="_blank"
              rel="noreferrer"
              variant="light"
            >
              Open PR
            </Button>
          </Group>
        </Group>

        <Group gap="lg">
          <Stat label="Files reviewed" value={summary.filesReviewed} />
          <Stat label="Files skipped" value={summary.filesSkipped} />
          <Stat label="File findings" value={findings.length} />
          <Stat label="Cross-file findings" value={summary.crossFileFindings.length} />
          <Stat label="Comments" value={summary.commentsCreated} />
          <Stat label="Lines" value={`+${summary.linesAdded} / -${summary.linesDeleted}`} />
        </Group>

        {critical > 0 && (
          <Alert title={`${critical} critical finding(s)`} color="red">
            The review flagged critical issues. Open the PR to inspect the changed code.
          </Alert>
        )}

        {summary.overallAssessment && (
          <>
            <Divider />
            <div>
              <Title order={5}>Overall assessment</Title>
              <Text style={{ whiteSpace: "pre-wrap" }}>{summary.overallAssessment}</Text>
            </div>
          </>
        )}

        <FindingsList title="File findings" findings={findings} showFile />
        <FindingsList title="Cross-file findings" findings={summary.crossFileFindings} />

        {summary.recommendations.length > 0 && (
          <>
            <Divider />
            <div>
              <Title order={5}>Recommendations</Title>
              <Stack gap={4}>
                {summary.recommendations.map((recommendation) => (
                  <Text key={recommendation} size="sm">
                    • {recommendation}
                  </Text>
                ))}
              </Stack>
            </div>
          </>
        )}

        {summary.commentErrors.length > 0 && (
          <Alert title={`${summary.commentErrors.length} comment(s) failed to post`} color="yellow">
            <Stack gap={2}>
              {summary.commentErrors.map((commentError) => (
                <Text key={commentError} size="sm">
                  {commentError}
                </Text>
              ))}
            </Stack>
          </Alert>
        )}
      </Stack>
    </Card>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string | number }) {
  return (
    <Stack gap={0}>
      <Text size="xl" fw={700}>
        {value}
      </Text>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Stack>
  );
}

interface FindingsListProps {
  readonly title: string;
  readonly findings: readonly ReviewFindingView[];
  readonly showFile?: boolean;
}

function FindingsList({ title, findings, showFile = false }: FindingsListProps) {
  if (findings.length === 0) return null;

  return (
    <>
      <Divider />
      <div>
        <Title order={5}>
          {title} ({findings.length})
        </Title>
        <Stack gap="sm" mt="xs">
          {findings.map((finding, index) => (
            <Card key={`${finding.file ?? ""}:${finding.line}:${index}`} withBorder padding="sm">
              <Group gap="xs" mb={4}>
                <Badge
                  color={SEVERITY_COLORS[finding.severity] ?? "gray"}
                  variant="light"
                  size="sm"
                >
                  {finding.severity}
                </Badge>
                <Badge variant="outline" size="sm">
                  {finding.category}
                </Badge>
                {finding.isPreExisting && (
                  <Badge color="gray" variant="light" size="sm">
                    pre-existing
                  </Badge>
                )}
                {showFile && finding.file && (
                  <Text size="xs" c="dimmed" ff="monospace">
                    {finding.file}
                    {finding.line > 0 ? `:${finding.line}` : ""}
                  </Text>
                )}
              </Group>
              <Text size="sm">{finding.message}</Text>
              {finding.suggestion && (
                <Text size="sm" c="dimmed" mt={4}>
                  Suggestion: {finding.suggestion}
                </Text>
              )}
            </Card>
          ))}
        </Stack>
      </div>
    </>
  );
}
