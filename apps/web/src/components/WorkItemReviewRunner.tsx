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
  PBIReviewSummary,
  ProjectReviewFindingView,
  ProjectReviewSummary,
  ReviewStreamEvent,
} from "../server/review.types.js";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "red",
  high: "orange",
  medium: "yellow",
  low: "blue",
};

const DIMENSION_LABELS: Record<string, string> = {
  completeness: "Completeness",
  dependency: "Dependency",
  acceptance_criteria: "Acceptance Criteria",
  estimation: "Estimation",
};

type Status = "idle" | "running" | "done" | "error";

interface OutputEntry {
  readonly id: number;
  readonly kind: "status" | "log" | "chunk";
  readonly text: string;
}

/** Input shared by the PBI and project review endpoints. */
interface WorkItemInput {
  readonly id?: string;
  readonly url?: string;
  readonly write: boolean;
}

interface WorkItemReviewRunnerProps<TSummary> {
  /** Server-sent events endpoint that runs the review. */
  readonly endpoint: string;
  /** Label for the work item ID field. */
  readonly inputLabel: string;
  /** Placeholder shown in the work item ID field. */
  readonly placeholder: string;
  /** Label for the write-mode toggle. */
  readonly writeLabel: string;
  /** Description under the write-mode toggle. */
  readonly writeDescription: string;
  /** Label for the submit button. */
  readonly actionLabel: string;
  /** Renders the final summary once the review completes. */
  readonly renderResult: (summary: TSummary) => React.ReactNode;
}

/**
 * Interactive runner for work item (PBI/project) reviews.
 *
 * Mirrors the PR review runner: posts the work item ID to a streaming endpoint,
 * renders status/log/raw output live, then hands the final summary to a
 * kind-specific result renderer.
 */
export function WorkItemReviewRunner<TSummary>({
  endpoint,
  inputLabel,
  placeholder,
  writeLabel,
  writeDescription,
  actionLabel,
  renderResult,
}: WorkItemReviewRunnerProps<TSummary>) {
  const [itemInput, setItemInput] = useState("");
  const [write, setWrite] = useState(false);

  const [status, setStatus] = useState<Status>("idle");
  const [entries, setEntries] = useState<readonly OutputEntry[]>([]);
  const [summary, setSummary] = useState<TSummary | null>(null);
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

  function handleEvent(event: ReviewStreamEvent<TSummary>) {
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

  function buildInput(): WorkItemInput | { error: string } {
    const value = itemInput.trim();
    if (value.length === 0) return { error: "Enter a work item URL or ID." };
    if (/^https?:\/\//i.test(value)) return { url: value, write };
    return { id: value, write };
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
      const response = await fetch(endpoint, {
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
          handleEvent(JSON.parse(dataLine.slice(6)) as ReviewStreamEvent<TSummary>);
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
            label={inputLabel}
            placeholder={placeholder}
            value={itemInput}
            onChange={(event) => setItemInput(event.currentTarget.value)}
            disabled={running}
          />
          <Switch
            label={writeLabel}
            description={writeDescription}
            checked={write}
            onChange={(event) => setWrite(event.currentTarget.checked)}
            disabled={running}
          />
          <Group>
            <Button onClick={run} loading={running} disabled={running}>
              {actionLabel}
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
          <ScrollArea.Autosize mah={420} viewportRef={viewportRef} type="auto">
            <Code block className="mm-code-block">
              {entries.map((entry) => (
                <span key={entry.id} style={entryStyle(entry.kind)}>
                  {entry.text}
                </span>
              ))}
            </Code>
          </ScrollArea.Autosize>
        </Card>
      )}

      {summary && renderResult(summary)}
    </Stack>
  );
}

function entryStyle(kind: OutputEntry["kind"]): React.CSSProperties {
  if (kind === "status") return { color: "var(--mantine-color-blue-6)", fontWeight: 600 };
  if (kind === "log") return { color: "var(--mantine-color-dimmed)" };
  return {};
}

/** Renders the result of a completed PBI review. */
export function PBIReviewResult({ summary }: { readonly summary: PBIReviewSummary }) {
  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={4}>PBI review result</Title>
            <Text size="sm" c="dimmed">
              #{summary.id}
              {summary.title ? ` · ${summary.title}` : ""}
            </Text>
          </div>
          {summary.dryRun && (
            <Badge color="gray" variant="light">
              dry-run
            </Badge>
          )}
        </Group>

        <Divider />
        <div>
          <Title order={5}>Assessment</Title>
          <Text style={{ whiteSpace: "pre-wrap" }}>{summary.overallAssessment}</Text>
        </div>

        <SuggestionsList suggestions={summary.suggestions} />
      </Stack>
    </Card>
  );
}

/** Renders the result of a completed project plan review. */
export function ProjectReviewResult({ summary }: { readonly summary: ProjectReviewSummary }) {
  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={4}>Project review result</Title>
            <Text size="sm" c="dimmed">
              #{summary.id}
              {summary.title ? ` · ${summary.title}` : ""}
            </Text>
          </div>
          <Group gap="xs">
            {summary.confidence && (
              <Badge variant="outline">confidence: {summary.confidence}</Badge>
            )}
            {summary.dryRun && (
              <Badge color="gray" variant="light">
                dry-run
              </Badge>
            )}
          </Group>
        </Group>

        <Divider />
        <Stack gap="sm">
          <AssessmentBlock title="Plan completeness & gaps" text={summary.completenessAssessment} />
          <AssessmentBlock title="Dependency & sequencing risks" text={summary.dependencyRisks} />
          <AssessmentBlock
            title="Acceptance criteria alignment"
            text={summary.acceptanceCriteriaAlignment}
          />
          <AssessmentBlock
            title="Estimation & scope consistency"
            text={summary.estimationConsistency}
          />
        </Stack>

        <ProjectFindings findings={summary.findings} />

        <Divider />
        <div>
          <Title order={5}>Overall assessment</Title>
          <Text style={{ whiteSpace: "pre-wrap" }}>{summary.overallAssessment}</Text>
        </div>

        <SuggestionsList suggestions={summary.suggestions} />
      </Stack>
    </Card>
  );
}

function AssessmentBlock({ title, text }: { readonly title: string; readonly text: string }) {
  if (text.length === 0) return null;
  return (
    <div>
      <Text fw={600} size="sm">
        {title}
      </Text>
      <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
        {text}
      </Text>
    </div>
  );
}

function SuggestionsList({ suggestions }: { readonly suggestions: readonly string[] }) {
  if (suggestions.length === 0) return null;
  return (
    <>
      <Divider />
      <div>
        <Title order={5}>Suggestions for improvement</Title>
        <Stack gap={4} mt="xs">
          {suggestions.map((suggestion) => (
            <Text key={suggestion} size="sm">
              • {suggestion}
            </Text>
          ))}
        </Stack>
      </div>
    </>
  );
}

function ProjectFindings({ findings }: { readonly findings: readonly ProjectReviewFindingView[] }) {
  if (findings.length === 0) return null;
  return (
    <>
      <Divider />
      <div>
        <Title order={5}>Findings ({findings.length})</Title>
        <Stack gap="sm" mt="xs">
          {findings.map((finding, index) => (
            <Card
              key={`${finding.workItemId}:${finding.dimension}:${index}`}
              withBorder
              shadow="none"
              radius="md"
              padding="sm"
            >
              <Group gap="xs" mb={4}>
                <Badge
                  color={SEVERITY_COLORS[finding.severity] ?? "gray"}
                  variant="light"
                  size="sm"
                >
                  {finding.severity}
                </Badge>
                <Badge variant="outline" size="sm">
                  {DIMENSION_LABELS[finding.dimension] ?? finding.dimension}
                </Badge>
                {finding.workItemId && (
                  <Text size="xs" c="dimmed" ff="monospace">
                    #{finding.workItemId}
                  </Text>
                )}
              </Group>
              <Text size="sm">{finding.issue}</Text>
              {finding.recommendation && (
                <Text size="sm" c="dimmed" mt={4}>
                  Recommendation: {finding.recommendation}
                </Text>
              )}
            </Card>
          ))}
        </Stack>
      </div>
    </>
  );
}
