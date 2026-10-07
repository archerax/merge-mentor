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
    </Stack>
  );
}
