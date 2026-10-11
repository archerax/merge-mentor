import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useState } from "react";

import {
  type PBIReviewSummary,
  type ProjectReviewFindingView,
  type ProjectReviewSummary,
  REVIEW_STRATEGY_OPTIONS,
  type ReviewStrategyInput,
} from "../server/review.types.js";
import { CopyReportButton } from "./review/CopyReportButton.js";
import { LiveThinking } from "./review/LiveThinking.js";
import { ProgressTimeline } from "./review/ProgressTimeline.js";
import { SEVERITY_COLORS, SeveritySummary } from "./review/SeveritySummary.js";
import { TechnicalLog } from "./review/TechnicalLog.js";
import { useReviewStream } from "./review/useReviewStream.js";

const DIMENSION_LABELS: Record<string, string> = {
  completeness: "Completeness",
  dependency: "Dependency",
  acceptance_criteria: "Acceptance Criteria",
  estimation: "Estimation",
};

/** Input shared by the PBI and project review endpoints. */
interface WorkItemInput {
  readonly id?: string;
  readonly url?: string;
  readonly write: boolean;
  readonly strategy?: ReviewStrategyInput;
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
 * Shares the streaming hook and progress/live/log panels with the PR runner,
 * then hands the final summary to a kind-specific result renderer.
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
  const [strategy, setStrategy] = useState<ReviewStrategyInput | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { run, stop, running, phases, steps, activity, live, entries, summary, error, elapsedMs } =
    useReviewStream<TSummary>(endpoint);

  function buildInput(): WorkItemInput | { error: string } {
    const value = itemInput.trim();
    if (value.length === 0) return { error: "Enter a work item URL or ID." };
    const base = strategy ? { write, strategy } : { write };
    if (/^https?:\/\//i.test(value)) return { url: value, ...base };
    return { id: value, ...base };
  }

  async function handleRun() {
    const input = buildInput();
    if ("error" in input) {
      setFormError(input.error);
      return;
    }
    setFormError(null);
    await run(input);
  }

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
          <Select
            label="Review strategy"
            description="Overrides the configured default for this run."
            placeholder="Use configured default"
            data={REVIEW_STRATEGY_OPTIONS}
            value={strategy}
            onChange={(next) => setStrategy(next as ReviewStrategyInput | null)}
            clearable
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
            <Button onClick={handleRun} loading={running} disabled={running}>
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

      {(error ?? formError) && (
        <Alert title="Review failed" color="red">
          {error ?? formError}
        </Alert>
      )}

      <ProgressTimeline
        phases={phases}
        steps={steps}
        activity={activity}
        elapsedMs={elapsedMs}
        running={running}
      />

      <LiveThinking live={live} running={running} />

      {summary && renderResult(summary)}

      {!running && <TechnicalLog entries={entries} />}
    </Stack>
  );
}

/** Builds a plain-text/markdown report from a completed PBI review summary. */
function buildPBIReportText(summary: PBIReviewSummary): string {
  const lines = [
    `# PBI review: #${summary.id}${summary.title ? ` — ${summary.title}` : ""}`,
    "",
    `Mode: ${summary.dryRun ? "dry-run" : "write"}`,
    "",
    "## Assessment",
    summary.overallAssessment,
  ];
  if (summary.suggestions.length > 0) {
    lines.push("", "## Suggestions");
    for (const suggestion of summary.suggestions) lines.push(`- ${suggestion}`);
  }
  return lines.join("\n");
}

/** Builds a plain-text/markdown report from a completed project review summary. */
function buildProjectReportText(summary: ProjectReviewSummary): string {
  const lines = [
    `# Project review: #${summary.id}${summary.title ? ` — ${summary.title}` : ""}`,
    "",
    `Confidence: ${summary.confidence} · Mode: ${summary.dryRun ? "dry-run" : "write"}`,
    "",
    "## Plan completeness & gaps",
    summary.completenessAssessment,
    "",
    "## Dependency & sequencing risks",
    summary.dependencyRisks,
    "",
    "## Acceptance criteria alignment",
    summary.acceptanceCriteriaAlignment,
    "",
    "## Estimation & scope consistency",
    summary.estimationConsistency,
  ];

  if (summary.findings.length > 0) {
    lines.push("", `## Findings (${summary.findings.length})`);
    for (const finding of summary.findings) {
      const location = finding.workItemId ? ` #${finding.workItemId}` : "";
      lines.push(`- [${finding.severity}/${finding.dimension}]${location} ${finding.issue}`);
      if (finding.recommendation) lines.push(`  - Recommendation: ${finding.recommendation}`);
    }
  }

  lines.push("", "## Overall assessment", summary.overallAssessment);
  if (summary.suggestions.length > 0) {
    lines.push("", "## Suggestions");
    for (const suggestion of summary.suggestions) lines.push(`- ${suggestion}`);
  }
  return lines.join("\n");
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
          <Group gap="xs">
            {summary.dryRun && (
              <Badge color="gray" variant="light">
                dry-run
              </Badge>
            )}
            <CopyReportButton text={buildPBIReportText(summary)} />
          </Group>
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
            <CopyReportButton text={buildProjectReportText(summary)} />
          </Group>
        </Group>

        <SeveritySummary findings={summary.findings} />

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
