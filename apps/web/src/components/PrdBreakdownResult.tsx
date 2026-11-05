import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  List,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type {
  PrdBreakdownEpic,
  PrdBreakdownFeature,
  PrdBreakdownPbi,
} from "@merge-mentor/core/review/prd/breakdownReport.js";
import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { PrdBreakdownSummary } from "../server/prd.types.js";
import { CopyReportButton } from "./review/CopyReportButton.js";
import { DownloadMarkdownButton } from "./review/DownloadMarkdownButton.js";

/** Every epic and feature is open at first; PBIs open one at a time. */
function initiallyOpen(epics: readonly PrdBreakdownEpic[]): string[] {
  return epics.flatMap((epic) => [
    `epic-${epic.number}`,
    ...epic.features.map((feature) => `feature-${feature.number}`),
  ]);
}

/** Ids of every item in the tree, for "expand all". */
function allIds(epics: readonly PrdBreakdownEpic[]): string[] {
  return epics.flatMap((epic) => [
    `epic-${epic.number}`,
    ...epic.features.flatMap((feature) => [
      `feature-${feature.number}`,
      ...feature.pbis.map((pbi) => `pbi-${pbi.number}`),
    ]),
  ]);
}

/**
 * Accordion change handler for one level of the tree. All levels share one
 * open/closed list, so a change replaces only this accordion's own items.
 */
function changeOpen(
  open: readonly string[],
  own: readonly string[],
  next: readonly string[]
): string[] {
  const ownIds = new Set(own);
  return [...open.filter((id) => !ownIds.has(id)), ...next];
}

function PbiPanel({ pbi }: { readonly pbi: PrdBreakdownPbi }) {
  return (
    <Stack gap="xs">
      {pbi.description && <Text size="sm">{pbi.description}</Text>}

      {pbi.acceptanceCriteria.length > 0 && (
        <div>
          <Text size="sm" fw={600}>
            Acceptance criteria
          </Text>
          <List size="sm" spacing={2} mt={4}>
            {pbi.acceptanceCriteria.map((criterion, index) => (
              <List.Item key={`${index}-${criterion}`}>{criterion}</List.Item>
            ))}
          </List>
        </div>
      )}

      {pbi.dependsOn.length > 0 && (
        <Group gap="xs">
          <Text size="sm" fw={600}>
            Depends on
          </Text>
          {pbi.dependsOn.map((number) => (
            <Badge key={number} variant="outline" color="gray" size="sm">
              PBI {number}
            </Badge>
          ))}
        </Group>
      )}

      <Text size="xs" c="dimmed">
        From the document: {pbi.headingPath.length > 0 ? pbi.headingPath.join(" › ") : "Document"}
      </Text>
      {pbi.quote && (
        <Text
          size="sm"
          c="dimmed"
          fs="italic"
          pl="sm"
          style={{ borderLeft: "3px solid var(--mantine-color-default-border)" }}
        >
          {pbi.quote}
        </Text>
      )}
    </Stack>
  );
}

interface TreeState {
  readonly open: readonly string[];
  readonly setOpen: (next: string[]) => void;
}

function PbiItems({
  feature,
  tree,
}: {
  readonly feature: PrdBreakdownFeature;
  readonly tree: TreeState;
}) {
  const own = feature.pbis.map((pbi) => `pbi-${pbi.number}`);
  return (
    <Accordion
      multiple
      variant="separated"
      value={tree.open.filter((id) => own.includes(id))}
      onChange={(next) => tree.setOpen(changeOpen(tree.open, own, next))}
    >
      {feature.pbis.map((pbi) => (
        <Accordion.Item key={pbi.number} value={`pbi-${pbi.number}`}>
          <Accordion.Control>
            <Group gap="xs" wrap="nowrap">
              <Badge variant="light" color="grape" size="sm">
                PBI {pbi.number}
              </Badge>
              <Text size="sm" fw={500}>
                {pbi.title}
              </Text>
              {pbi.dependsOn.length > 0 && (
                <Badge variant="outline" color="gray" size="xs">
                  needs {pbi.dependsOn.length}
                </Badge>
              )}
              {!pbi.quoteVerified && (
                <Badge variant="light" color="yellow" size="xs">
                  source not found
                </Badge>
              )}
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <PbiPanel pbi={pbi} />
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}

function FeatureItems({
  epic,
  tree,
}: {
  readonly epic: PrdBreakdownEpic;
  readonly tree: TreeState;
}) {
  const own = epic.features.map((feature) => `feature-${feature.number}`);
  return (
    <Accordion
      multiple
      variant="contained"
      value={tree.open.filter((id) => own.includes(id))}
      onChange={(next) => tree.setOpen(changeOpen(tree.open, own, next))}
    >
      {epic.features.map((feature) => (
        <Accordion.Item key={feature.number} value={`feature-${feature.number}`}>
          <Accordion.Control>
            <Group gap="xs" wrap="nowrap">
              <Badge variant="light" color="teal" size="sm">
                Feature {feature.number}
              </Badge>
              <Text size="sm" fw={600}>
                {feature.title}
              </Text>
              <Text size="xs" c="dimmed">
                {feature.pbis.length} {feature.pbis.length === 1 ? "PBI" : "PBIs"}
              </Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              {feature.description && (
                <Text size="sm" c="dimmed">
                  {feature.description}
                </Text>
              )}
              <PbiItems feature={feature} tree={tree} />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}

function EpicItems({
  epics,
  tree,
}: {
  readonly epics: readonly PrdBreakdownEpic[];
  readonly tree: TreeState;
}) {
  const own = epics.map((epic) => `epic-${epic.number}`);
  return (
    <Accordion
      multiple
      variant="separated"
      value={tree.open.filter((id) => own.includes(id))}
      onChange={(next) => tree.setOpen(changeOpen(tree.open, own, next))}
    >
      {epics.map((epic) => (
        <Accordion.Item key={epic.number} value={`epic-${epic.number}`}>
          <Accordion.Control>
            <Group gap="xs" wrap="nowrap">
              <Badge variant="filled" color="brand" size="md">
                Epic {epic.number}
              </Badge>
              <Text fw={700}>{epic.title}</Text>
              <Text size="xs" c="dimmed">
                {epic.features.length} {epic.features.length === 1 ? "feature" : "features"}
              </Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              {epic.goal && (
                <Text size="sm">
                  <b>Goal:</b> {epic.goal}
                </Text>
              )}
              {epic.rationale && (
                <Text size="sm" c="dimmed">
                  <b>Why it is here:</b> {epic.rationale}
                </Text>
              )}
              {epic.dependsOn.length > 0 && (
                <Group gap="xs">
                  <Text size="sm" fw={600}>
                    Needs first
                  </Text>
                  {epic.dependsOn.map((number) => (
                    <Badge key={number} variant="outline" color="gray" size="sm">
                      Epic {number}
                    </Badge>
                  ))}
                </Group>
              )}
              <FeatureItems epic={epic} tree={tree} />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}

/**
 * Renders a completed work breakdown: counts, the suggested order, a read-only
 * tree of epics, features and PBIs, and what the breakdown could not cover.
 * The Markdown can be downloaded or copied for further refinement elsewhere.
 */
export function PrdBreakdownResult({
  summary,
  expanded = false,
}: {
  readonly summary: PrdBreakdownSummary;
  /** Start with every PBI open too, instead of only epics and features. */
  readonly expanded?: boolean;
}) {
  const { report } = summary;
  const [open, setOpen] = useState<string[]>(() =>
    expanded ? allIds(report.epics) : initiallyOpen(report.epics)
  );
  const tree: TreeState = { open, setOpen };
  const everythingOpen = open.length >= allIds(report.epics).length;

  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={4}>Work breakdown</Title>
            <Text size="sm" c="dimmed">
              {report.document.title ? `${report.document.title} · ` : ""}
              {report.source.fileName}
            </Text>
          </div>
          <Group gap="xs">
            <DownloadMarkdownButton text={summary.reportMarkdown} fileName={summary.reportName} />
            <CopyReportButton text={summary.reportMarkdown} label="Copy Markdown" />
            <Button
              renderRoot={(props) => (
                <Link to="/reports" search={{ report: summary.reportName }} {...props} />
              )}
              variant="default"
              size="xs"
            >
              Open in Reports
            </Button>
          </Group>
        </Group>

        <Group gap="xs">
          <Badge color="brand" variant="filled">
            {report.counts.epics} {report.counts.epics === 1 ? "epic" : "epics"}
          </Badge>
          <Badge color="teal" variant="light">
            {report.counts.features} {report.counts.features === 1 ? "feature" : "features"}
          </Badge>
          <Badge color="grape" variant="light">
            {report.counts.pbis} {report.counts.pbis === 1 ? "PBI" : "PBIs"}
          </Badge>
          {!report.ordered && (
            <Badge color="yellow" variant="outline">
              not ordered
            </Badge>
          )}
          {!report.complete && (
            <Badge color="gray" variant="outline">
              partly covered
            </Badge>
          )}
        </Group>

        {report.summary && <Text size="sm">{report.summary}</Text>}

        {!report.ordered && (
          <Alert
            variant="light"
            color="yellow"
            icon={<IconAlertTriangle size={18} />}
            title="Not ordered"
          >
            The step that works out a delivery order could not run, so the items follow the order of
            the document.
          </Alert>
        )}
        {!report.complete && (
          <Alert
            variant="light"
            color="yellow"
            icon={<IconAlertTriangle size={18} />}
            title="Partial breakdown"
          >
            Some parts of the document could not be processed. See “Not covered” below.
          </Alert>
        )}

        {report.epics.length === 0 ? (
          <Text size="sm" c="dimmed">
            No work items could be drawn from the document.
          </Text>
        ) : (
          <Stack gap="xs">
            <Group justify="flex-end">
              <Button
                variant="subtle"
                size="compact-xs"
                onClick={() => setOpen(everythingOpen ? [] : allIds(report.epics))}
              >
                {everythingOpen ? "Collapse all" : "Expand all"}
              </Button>
            </Group>
            <EpicItems epics={report.epics} tree={tree} />
          </Stack>
        )}

        {report.openQuestions.length > 0 && (
          <div>
            <Title order={5}>Open questions</Title>
            <List size="sm" spacing={4} mt="xs">
              {report.openQuestions.map((item, index) => (
                <List.Item key={`${index}-${item.question}`}>
                  {item.question}
                  {item.headingPath.length > 0 && (
                    <Text span size="xs" c="dimmed">
                      {" "}
                      ({item.headingPath.join(" › ")})
                    </Text>
                  )}
                </List.Item>
              ))}
            </List>
          </div>
        )}

        <div>
          <Title order={5}>Not covered</Title>
          {report.uncoveredSections.length === 0 && report.notes.length === 0 ? (
            <Text size="sm" c="dimmed" mt="xs">
              Every part of the document with text produced at least one work item.
            </Text>
          ) : (
            <Stack gap="xs" mt="xs">
              {report.uncoveredSections.length > 0 && (
                <Alert variant="light" color="gray" icon={<IconInfoCircle size={18} />}>
                  <Text size="sm">
                    These sections have text but produced no work items. They may be background, or
                    something may have been missed:
                  </Text>
                  <List size="sm" mt={4}>
                    {report.uncoveredSections.map((section) => (
                      <List.Item key={section.sectionId}>
                        {section.headingPath.length > 0
                          ? section.headingPath.join(" › ")
                          : "Document"}
                      </List.Item>
                    ))}
                  </List>
                </Alert>
              )}
              {report.notes.length > 0 && (
                <List size="sm" spacing={4}>
                  {report.notes.map((note, index) => (
                    <List.Item key={`${index}-${note}`}>{note}</List.Item>
                  ))}
                </List>
              )}
            </Stack>
          )}
        </div>

        <Text size="xs" c="dimmed">
          This is an automated first draft of a backlog. Check it, reorder it and refine it with
          your team before planning work from it.
        </Text>
      </Stack>
    </Card>
  );
}
