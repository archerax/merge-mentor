import { Button, Card, Code, Group, Stack, Text, Title } from "@mantine/core";
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Merge Mentor Web UI</Title>
        <Text c="dimmed">A local workspace for inspecting Merge Mentor review activity.</Text>
      </div>

      <Card withBorder padding="lg" radius="md">
        <Stack gap="sm">
          <Title order={4}>Interactive Review</Title>
          <Text>
            Trigger a pull request review and watch raw output stream in live. Link out to the PR
            for the full diff, then save a report for later.
          </Text>
          <Group>
            <Button component={Link} to="/review">
              Run a PR review
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder padding="lg" radius="md">
        <Stack gap="sm">
          <Title order={4}>Backlog &amp; Plan Reviews</Title>
          <Text>
            Review Product Backlog Items for backlog quality, or review a project/feature plan
            hierarchy for completeness, dependencies, acceptance criteria, and estimation. Results
            stream in live and are saved as reports.
          </Text>
          <Group>
            <Button component={Link} to="/pbi" variant="light">
              Run a PBI review
            </Button>
            <Button component={Link} to="/project" variant="light">
              Run a project review
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder padding="lg" radius="md">
        <Stack gap="sm">
          <Title order={4}>Review Reports</Title>
          <Text>
            Browse and read the rendered markdown reports written to{" "}
            <Code>.mergementor/reports</Code>, including PR reviews, PBI and project assessments,
            implementation plans, and staged reviews.
          </Text>
          <Group>
            <Button component={Link} to="/reports">
              View reports
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder padding="lg" radius="md">
        <Stack gap="sm">
          <Title order={4}>Audit Log</Title>
          <Text>
            Browse the structured audit events written to <Code>.mergementor/logs</Code> during
            reviews, including PR access, AI provider executions, and comment posting.
          </Text>
          <Group>
            <Button component={Link} to="/audit">
              View audit log
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder padding="lg" radius="md">
        <Stack gap="sm">
          <Title order={4}>Configuration</Title>
          <Text>
            Inspect the resolved configuration, including platform settings, the active AI provider,
            review profile, and runtime behavior. Sensitive values such as tokens are hidden.
          </Text>
          <Group>
            <Button component={Link} to="/config">
              View configuration
            </Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}
