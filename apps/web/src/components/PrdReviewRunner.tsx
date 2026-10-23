import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  Divider,
  FileInput,
  Group,
  Radio,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { MAX_DOCX_BYTES } from "@merge-mentor/core/review/prd/docxValidator.js";
import type { PrdReadinessVerdict } from "@merge-mentor/core/review/prd/prdReport.js";
import { IconFileTypeDocx, IconLock } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  PRD_STREAM_ENDPOINT,
  PRD_UPLOAD_HEADERS,
  type PrdDocumentTypeInput,
  type PrdReviewRunInput,
  type PrdReviewSummary,
} from "../server/prd.types.js";
import { MarkdownReport } from "./MarkdownReport.js";
import { CopyReportButton } from "./review/CopyReportButton.js";
import { LiveThinking } from "./review/LiveThinking.js";
import { ProgressTimeline } from "./review/ProgressTimeline.js";
import { TechnicalLog } from "./review/TechnicalLog.js";
import { useReviewStream } from "./review/useReviewStream.js";

/** Formats a byte count as KB/MB for plain-language messages. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Checks a picked file before uploading, so an obviously wrong pick fails fast.
 * The server still validates the bytes; this is only a convenience.
 */
export function checkPickedFile(
  file: { readonly name: string; readonly size: number } | null
): string | null {
  if (!file) return "Choose a Word document (.docx) to review.";
  if (/\.doc$/i.test(file.name)) {
    return "This is an older Word file (.doc). Open it in Word, save it as .docx, and try again.";
  }
  if (!/\.docx$/i.test(file.name)) return "Choose a Word document saved as .docx.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_DOCX_BYTES) {
    return `This file is ${formatFileSize(file.size)}; the limit is ${formatFileSize(MAX_DOCX_BYTES)}.`;
  }
  return null;
}

interface PrdReviewRunnerProps {
  /** Run id from the URL, re-attached on mount to resume a run. */
  readonly runId?: string;
  /** Called with the new run id so the page can persist it in the URL. */
  readonly onRunCreated?: (runId: string) => void;
}

/**
 * Upload form and live view for a PRD / FRD review.
 *
 * Shares the streaming hook and progress/live/log panels with the PBI runner;
 * the request body is the raw file instead of JSON.
 */
export function PrdReviewRunner({ runId, onRunCreated }: PrdReviewRunnerProps) {
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<PrdDocumentTypeInput>("prd");
  const [includeImages, setIncludeImages] = useState(false);
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
  } = useReviewStream<PrdReviewSummary>({ endpoint: PRD_STREAM_ENDPOINT, runId, onRunCreated });

  const reviewing = (runInput as PrdReviewRunInput | null) ?? null;

  async function handleRun() {
    const problem = checkPickedFile(file);
    if (problem || !file) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    const input: PrdReviewRunInput = {
      documentType,
      includeImages,
      fileName: file.name,
      sizeBytes: file.size,
    };
    await run(input, {
      body: file,
      headers: {
        "Content-Type": "application/octet-stream",
        [PRD_UPLOAD_HEADERS.documentType]: documentType,
        [PRD_UPLOAD_HEADERS.includeImages]: String(includeImages),
        [PRD_UPLOAD_HEADERS.fileName]: encodeURIComponent(file.name),
      },
    });
  }

  return (
    <Stack gap="lg">
      <Card withBorder padding="lg" radius="md">
        <Stack gap="md">
          <FileInput
            label="Requirements document"
            description={`A Word document saved as .docx, up to ${formatFileSize(MAX_DOCX_BYTES)}.`}
            placeholder="Choose a .docx file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            leftSection={<IconFileTypeDocx size={18} />}
            value={file}
            onChange={(picked) => {
              setFile(picked);
              setFormError(null);
            }}
            clearable
            disabled={running}
          />

          <Radio.Group
            label="What kind of document is it?"
            value={documentType}
            onChange={(value) => setDocumentType(value === "frd" ? "frd" : "prd")}
          >
            <Stack gap="xs" mt="xs">
              <Radio
                value="prd"
                label="Product requirements (PRD)"
                description="Checks the problem, users and goals, scope, ambiguity, and missing non-functional needs."
                disabled={running}
              />
              <Radio
                value="frd"
                label="Functional requirements (FRD)"
                description="Checks that each requirement is clear and testable, has acceptance criteria, and covers edge cases and errors."
                disabled={running}
              />
            </Stack>
          </Radio.Group>

          <Checkbox
            label="Include images"
            description="Off by default. Sends the document's images to your AI provider, which needs a model that accepts images (set one with MM_AI_MODEL). This may take longer and cost more. Images that are not reviewed are listed in the report with the reason."
            checked={includeImages}
            onChange={(event) => setIncludeImages(event.currentTarget.checked)}
            disabled={running}
          />

          <Alert
            variant="light"
            color="gray"
            icon={<IconLock size={18} />}
            title="Your document stays local"
          >
            The file is reviewed on this computer with your configured AI provider. A copy, the
            report and the AI request transcripts are kept in <Code>.mergementor</Code> so you can
            reopen them, and Delete on the Reports page removes all of them.
          </Alert>

          <Group>
            <Button onClick={handleRun} loading={running} disabled={running}>
              Review document
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

      {reviewing && (running || summary) && (
        <Text size="sm" c="dimmed">
          Reviewing {reviewing.fileName} as a {reviewing.documentType.toUpperCase()}
          {reviewing.includeImages ? " (with images)" : ""}.
        </Text>
      )}

      {(error ?? formError) && (
        <Alert title="The review could not be completed" color="red">
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

      {summary && <PrdReviewResult summary={summary} />}

      {!running && <TechnicalLog entries={entries} />}
    </Stack>
  );
}

const VERDICT_VIEW: Record<
  PrdReadinessVerdict,
  { readonly label: string; readonly color: string }
> = {
  ready: { label: "Ready for development", color: "green" },
  "needs-work": { label: "Needs work", color: "orange" },
  "not-ready": { label: "Not ready", color: "red" },
};

const SEVERITY_VIEW = [
  { key: "Blocker", color: "red", one: "blocker", many: "blockers" },
  { key: "Major", color: "orange", one: "major issue", many: "major issues" },
  { key: "Minor", color: "yellow", one: "minor issue", many: "minor issues" },
] as const;

/** Renders a completed PRD / FRD review: verdict, counts and the full report. */
export function PrdReviewResult({ summary }: { readonly summary: PrdReviewSummary }) {
  const { report } = summary;
  const verdict = VERDICT_VIEW[report.readiness.verdict];

  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={4}>{report.documentType.toUpperCase()} review result</Title>
            <Text size="sm" c="dimmed">
              {report.document.title ? `${report.document.title} · ` : ""}
              {report.source.fileName}
            </Text>
          </div>
          <Group gap="xs">
            <Button
              renderRoot={(props) => (
                <Link to="/reports" search={{ report: summary.reportName }} {...props} />
              )}
              variant="default"
              size="xs"
            >
              Open in Reports
            </Button>
            <CopyReportButton text={summary.reportMarkdown} />
          </Group>
        </Group>

        <Group gap="xs">
          <Badge color={verdict.color} variant="filled">
            {verdict.label}
          </Badge>
          {SEVERITY_VIEW.map(({ key, color, one, many }) => (
            <Badge key={key} color={color} variant="light">
              {report.counts[key]} {report.counts[key] === 1 ? one : many}
            </Badge>
          ))}
          {!report.complete && (
            <Badge color="gray" variant="outline">
              partly reviewed
            </Badge>
          )}
        </Group>

        {report.imageReview && !report.imageReview.supported && (
          <Alert variant="light" color="yellow" title="Images were not reviewed">
            Image review was turned on, but {report.imageReview.reason}. The images are listed under
            “Not reviewed” in the report.
          </Alert>
        )}

        <Divider />
        <MarkdownReport content={summary.reportMarkdown} />
      </Stack>
    </Card>
  );
}
