import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  Divider,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconSend } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import {
  type PendingCommentView,
  REVIEW_STRATEGY_OPTIONS,
  type ReviewFindingView,
  type ReviewStreamInput,
  type ReviewStrategyInput,
  type ReviewSummary,
} from "../server/review.types.js";
import { useReviewForm } from "../stores/reviewForms.js";
import { commentLocation, PostableCommentRow } from "./review/commentView.js";
import { CopyReportButton } from "./review/CopyReportButton.js";
import { LiveThinking } from "./review/LiveThinking.js";
import { ProgressTimeline } from "./review/ProgressTimeline.js";
import { SEVERITY_COLORS, SEVERITY_ORDER, SeveritySummary } from "./review/SeveritySummary.js";
import { TechnicalLog } from "./review/TechnicalLog.js";
import {
  type PostCommentsController,
  type PostTarget,
  usePostComments,
} from "./review/usePostComments.js";
import { useReviewStream } from "./review/useReviewStream.js";

interface ReviewRunnerProps {
  /** Run id from the URL, re-attached on mount to resume a run. */
  readonly runId?: string;
  /** Called with the new run id so the page can persist it in the URL. */
  readonly onRunCreated?: (runId: string) => void;
}

export function ReviewRunner({ runId, onRunCreated }: ReviewRunnerProps) {
  const {
    input: prInput,
    write,
    strategy,
    setInput: setPrInput,
    setWrite,
    setStrategy,
  } = useReviewForm("pr");
  const [formError, setFormError] = useState<string | null>(null);

  const {
    run,
    stop,
    running,
    phases,
    steps,
    activity,
    live,
    entries,
    summary,
    error,
    elapsedMs,
    runInput,
  } = useReviewStream<ReviewSummary>({ endpoint: "/api/review/stream", runId, onRunCreated });

  const targetInput = (runInput as ReviewStreamInput | null) ?? null;

  function buildInput(): ReviewStreamInput | { error: string } {
    const trimmed = prInput.trim();
    if (trimmed.length === 0) return { error: "Enter a PR URL or number." };

    const base = strategy ? { write, strategy } : { write };

    if (/^https?:\/\//i.test(trimmed)) {
      return { prUrl: trimmed, ...base };
    }

    const pr = Number(trimmed);
    if (!Number.isInteger(pr) || pr <= 0) {
      return { error: "Enter a valid PR URL or a positive PR number." };
    }
    return { pr, ...base };
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
            label="Pull request"
            placeholder="https://dev.azure.com/org/project/_git/repo/pullrequest/123 or 123"
            value={prInput}
            onChange={(event) => setPrInput(event.currentTarget.value)}
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
            label="Post comments to the PR"
            description="Off runs a dry-run; you can still post the planned comments afterwards."
            checked={write}
            onChange={(event) => setWrite(event.currentTarget.checked)}
            disabled={running}
          />
          <Group>
            <Button onClick={handleRun} loading={running} disabled={running}>
              Run review
            </Button>
            {running && (
              <Button
                variant="default"
                onClick={stop}
                title="Detach from this run — the review keeps running on the server and resumes if you reload."
              >
                Stop watching
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

      {summary && <ReviewResult summary={summary} target={targetInput} />}

      {!running && <TechnicalLog entries={entries} />}
    </Stack>
  );
}

/** Builds a plain-text/markdown report from a completed review summary. */
function buildReportText(summary: ReviewSummary): string {
  const lines: string[] = [
    `# Review: PR #${summary.number} — ${summary.title}`,
    "",
    `${summary.author} · ${summary.headBranch} → ${summary.baseBranch}`,
    `URL: ${summary.url}`,
    `Mode: ${summary.dryRun ? "dry-run" : "write"}`,
    "",
    `Files reviewed: ${summary.filesReviewed} · skipped: ${summary.filesSkipped} · comments: ${summary.commentsCreated}`,
    "",
  ];

  const allFindings = [...summary.findings, ...summary.crossFileFindings];
  lines.push(`## Findings (${allFindings.length})`);
  for (const finding of allFindings) {
    const location = finding.file
      ? ` ${finding.file}${finding.line > 0 ? `:${finding.line}` : ""}`
      : "";
    lines.push(`- [${finding.severity}/${finding.category}]${location} ${finding.message}`);
    if (finding.suggestion) lines.push(`  - Suggestion: ${finding.suggestion}`);
  }

  if (summary.overallAssessment) {
    lines.push("", "## Overall assessment", summary.overallAssessment);
  }

  if (summary.recommendations.length > 0) {
    lines.push("", "## Recommendations");
    for (const recommendation of summary.recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }

  return lines.join("\n");
}

/**
 * Pairs each file finding with the inline comment the review planned for it.
 *
 * The engine emits one inline comment per posted finding plus a single summary
 * comment, and comments carry no back-reference to their finding. We therefore
 * match on the comment's path and the finding message embedded in its body.
 * Comments that match nothing (the summary comment) are returned separately so
 * they can still be posted.
 */
function matchFindingComments(
  findings: readonly ReviewFindingView[],
  comments: readonly PendingCommentView[]
): { byFinding: Map<ReviewFindingView, PendingCommentView>; unassigned: PendingCommentView[] } {
  const byFinding = new Map<ReviewFindingView, PendingCommentView>();
  const used = new Set<string>();

  for (const finding of findings) {
    const match = comments.find(
      (comment) =>
        !used.has(comment.fingerprint) &&
        comment.path !== undefined &&
        (finding.file === undefined || comment.path === finding.file) &&
        finding.message.length > 0 &&
        comment.body.includes(finding.message)
    );
    if (match) {
      used.add(match.fingerprint);
      byFinding.set(finding, match);
    }
  }

  return { byFinding, unassigned: comments.filter((comment) => !used.has(comment.fingerprint)) };
}

/** Renders a completed PR review, with each finding postable when a comment was planned for it. */
export function ReviewResult({
  summary,
  target,
}: {
  readonly summary: ReviewSummary;
  readonly target: PostTarget | null;
}) {
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const controller = usePostComments("pr", target, summary.pendingComments);

  const findings = summary.findings;
  const critical = findings.filter((finding) => finding.severity === "critical").length;
  const allFindings = [...findings, ...summary.crossFileFindings];

  const { byFinding: commentsByFinding, unassigned: unassignedComments } = useMemo(
    () => matchFindingComments(findings, summary.pendingComments),
    [findings, summary.pendingComments]
  );

  const matchesFilter = (finding: ReviewFindingView): boolean =>
    severityFilter === null || finding.severity === severityFilter;
  const filteredFileFindings = findings.filter(matchesFilter);
  const filteredCrossFileFindings = summary.crossFileFindings.filter(matchesFilter);
  const filteredCount = filteredFileFindings.length + filteredCrossFileFindings.length;

  const { pending, selectedPending } = controller;

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
            <CopyReportButton text={buildReportText(summary)} />
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

        <SeveritySummary findings={allFindings} />

        <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }} spacing="sm">
          <Stat label="Files reviewed" value={summary.filesReviewed} />
          <Stat label="Files skipped" value={summary.filesSkipped} />
          <Stat label="File findings" value={findings.length} />
          <Stat label="Cross-file findings" value={summary.crossFileFindings.length} />
          <Stat label="Comments" value={summary.commentsCreated} />
          <Stat label="Lines" value={`+${summary.linesAdded} / -${summary.linesDeleted}`} />
        </SimpleGrid>

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

        {allFindings.length > 0 && (
          <Group justify="space-between" align="center">
            <Text size="sm" c="dimmed">
              Showing {filteredCount} of {allFindings.length} findings
            </Text>
            <Select
              size="xs"
              w={170}
              placeholder="All severities"
              clearable
              data={SEVERITY_ORDER.map((severity) => ({ value: severity, label: severity }))}
              value={severityFilter}
              onChange={setSeverityFilter}
            />
          </Group>
        )}

        <FindingsList
          title="File findings"
          findings={filteredFileFindings}
          showFile
          commentsByFinding={commentsByFinding}
          controller={controller}
        />
        <FindingsList
          title="Cross-file findings"
          findings={filteredCrossFileFindings}
          commentsByFinding={commentsByFinding}
          controller={controller}
        />

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

        {(pending.length > 0 || controller.result !== null || controller.error !== null) && (
          <>
            <Divider />
            <div>
              <Group justify="space-between" align="flex-start">
                <div>
                  <Title order={5}>Post planned comments</Title>
                  <Text size="sm" c="dimmed">
                    {pending.length === 0
                      ? "All planned comments have been posted."
                      : `Select from the ${pending.length} planned comment${
                          pending.length === 1 ? "" : "s"
                        } to post in a batch, or post one individually with its button.`}
                  </Text>
                </div>
                {pending.length > 0 && (
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={controller.allSelected || controller.busy}
                      onClick={controller.selectAll}
                    >
                      Select all
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={selectedPending.length === 0 || controller.busy}
                      onClick={controller.clearSelection}
                    >
                      Clear
                    </Button>
                  </Group>
                )}
              </Group>

              {unassignedComments.length > 0 && (
                <Stack gap="xs" mt="xs">
                  {unassignedComments.map((comment) => (
                    <PostableCommentRow
                      key={comment.fingerprint}
                      comment={comment}
                      controller={controller}
                    />
                  ))}
                </Stack>
              )}

              {controller.result && (
                <Alert
                  mt="sm"
                  color={controller.result.commentErrors.length > 0 ? "yellow" : "green"}
                  title={
                    controller.result.commentErrors.length > 0
                      ? "Comments partially posted"
                      : "Comments posted"
                  }
                >
                  <Stack gap={2}>
                    <Text size="sm">
                      {controller.result.commentsCreated} comment
                      {controller.result.commentsCreated === 1 ? "" : "s"} posted.
                      {controller.result.commentsSkipped > 0
                        ? ` ${controller.result.commentsSkipped} already posted, skipped.`
                        : ""}
                    </Text>
                    {controller.result.commentErrors.map((message) => (
                      <Text key={message} size="sm" c="dimmed">
                        {message}
                      </Text>
                    ))}
                  </Stack>
                </Alert>
              )}

              {controller.error && (
                <Text size="sm" c="red" mt="sm">
                  {controller.error}
                </Text>
              )}

              {pending.length > 0 && (
                <Group mt="sm">
                  <Button
                    leftSection={<IconSend size={16} />}
                    onClick={controller.postSelected}
                    loading={controller.busy}
                    disabled={
                      controller.busy || !controller.targetReady || selectedPending.length === 0
                    }
                  >
                    Post {selectedPending.length} comment{selectedPending.length === 1 ? "" : "s"}
                  </Button>
                </Group>
              )}
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
    <Card
      withBorder={false}
      shadow="none"
      padding="sm"
      radius="md"
      bg="var(--mantine-color-default-hover)"
    >
      <Text size="xl" fw={700} lh={1.15}>
        {value}
      </Text>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Card>
  );
}

interface FindingsListProps {
  readonly title: string;
  readonly findings: readonly ReviewFindingView[];
  readonly showFile?: boolean;
  /** Planned inline comment for each finding, when one exists. */
  readonly commentsByFinding: ReadonlyMap<ReviewFindingView, PendingCommentView>;
  /** Posting controller shared across all findings and the summary comment. */
  readonly controller: PostCommentsController;
}

function FindingsList({
  title,
  findings,
  showFile = false,
  commentsByFinding,
  controller,
}: FindingsListProps) {
  if (findings.length === 0) return null;

  return (
    <>
      <Divider />
      <div>
        <Title order={5}>
          {title} ({findings.length})
        </Title>
        <Stack gap="sm" mt="xs">
          {findings.map((finding, index) => {
            const comment = commentsByFinding.get(finding);
            const rowError = comment ? controller.rowError(comment.fingerprint) : undefined;
            return (
              <Card
                key={`${finding.file ?? ""}:${finding.line}:${index}`}
                withBorder
                shadow="none"
                radius="md"
                padding="sm"
              >
                <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                  <div style={{ flex: 1 }}>
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
                    {rowError && (
                      <Text size="xs" c="red" mt={4}>
                        {rowError}
                      </Text>
                    )}
                  </div>
                  {comment && <FindingPostControls comment={comment} controller={controller} />}
                </Group>
              </Card>
            );
          })}
        </Stack>
      </div>
    </>
  );
}

/** Checkbox and Post button attached to a finding that has a planned comment. */
function FindingPostControls({
  comment,
  controller,
}: {
  readonly comment: PendingCommentView;
  readonly controller: PostCommentsController;
}) {
  const isPosted = controller.isPosted(comment.fingerprint);
  const label = commentLocation(comment);

  return (
    <Stack align="flex-end" gap={6}>
      <Checkbox
        aria-label={isPosted ? `${label} posted` : `Select ${label}`}
        checked={isPosted || controller.isSelected(comment.fingerprint)}
        disabled={isPosted || controller.busy}
        onChange={() => controller.toggle(comment.fingerprint)}
      />
      {isPosted ? (
        <Badge color="green" variant="light" size="sm">
          posted
        </Badge>
      ) : (
        <Button
          size="xs"
          variant="light"
          leftSection={<IconSend size={14} />}
          loading={controller.isPosting(comment.fingerprint)}
          disabled={!controller.targetReady || controller.busy}
          aria-label={`Post ${label}`}
          onClick={() => controller.postOne(comment)}
        >
          Post
        </Button>
      )}
    </Stack>
  );
}
