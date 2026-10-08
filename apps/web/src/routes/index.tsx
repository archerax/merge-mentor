import {
  Badge,
  Button,
  Card,
  Code,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconBolt,
  IconFileText,
  IconGitPullRequest,
  IconHistory,
  IconListDetails,
  IconSettings,
  IconShieldCheck,
  IconSitemap,
} from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

type RouteTo = React.ComponentProps<typeof Link>["to"];

interface Feature {
  readonly icon: React.ComponentType<{ size?: number | string; stroke?: number | string }>;
  readonly title: string;
  readonly description: React.ReactNode;
  readonly to: RouteTo;
  readonly action: string;
}

const FEATURES: readonly Feature[] = [
  {
    icon: IconGitPullRequest,
    title: "PR Review",
    description:
      "Trigger a pull request review and watch raw output stream in live, then open the PR for the full diff.",
    to: "/review",
    action: "Run a PR review",
  },
  {
    icon: IconListDetails,
    title: "PBI Review",
    description:
      "Assess Product Backlog Items for completeness, clarity, and acceptance criteria quality.",
    to: "/pbi",
    action: "Run a PBI review",
  },
  {
    icon: IconSitemap,
    title: "Project Review",
    description:
      "Review a project or feature plan hierarchy for dependencies, sequencing, and estimation consistency.",
    to: "/project",
    action: "Run a project review",
  },
  {
    icon: IconFileText,
    title: "Review Reports",
    description: (
      <>
        Browse rendered markdown reports written to <Code>.mergementor/reports</Code>.
      </>
    ),
    to: "/reports",
    action: "View reports",
  },
  {
    icon: IconHistory,
    title: "Audit Log",
    description: (
      <>
        Inspect structured audit events in <Code>.mergementor/logs</Code>, from PR access to comment
        posting.
      </>
    ),
    to: "/audit",
    action: "View audit log",
  },
  {
    icon: IconSettings,
    title: "Configuration",
    description:
      "Inspect the resolved configuration, platform settings, AI provider, and review profile. Secrets stay hidden.",
    to: "/config",
    action: "View configuration",
  },
];

function Home() {
  return (
    <Stack gap="xl">
      <Paper
        radius="lg"
        p={{ base: "xl", md: 48 }}
        style={{
          position: "relative",
          overflow: "hidden",
          border: "1px solid var(--mantine-color-default-border)",
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--mantine-color-brand-6) 14%, var(--mantine-color-body)) 0%, var(--mantine-color-body) 55%, color-mix(in srgb, var(--mantine-color-accent-6) 12%, var(--mantine-color-body)) 100%)",
        }}
      >
        <Stack gap="lg" maw={720}>
          <Group gap="xs">
            <Badge variant="light" leftSection={<IconShieldCheck size={13} />}>
              Local workspace
            </Badge>
            <Badge variant="dot" color="accent">
              AI-powered code review
            </Badge>
          </Group>
          <Title order={1} className="mm-gradient-text">
            Review pull requests and backlogs with confidence
          </Title>
          <Text size="lg" c="dimmed">
            A self-hosted workspace for running Merge Mentor reviews, streaming results live, and
            inspecting the reports, audit trail, and configuration produced along the way.
          </Text>
          <Group>
            <Button component={Link} to="/review" size="md" leftSection={<IconBolt size={18} />}>
              Run a PR review
            </Button>
            <Button component={Link} to="/reports" size="md" variant="default">
              Browse reports
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Stack gap="md">
        <Title order={3}>Everything in one place</Title>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.to} feature={feature} />
          ))}
        </SimpleGrid>
      </Stack>
    </Stack>
  );
}

function FeatureCard({ feature }: { readonly feature: Feature }) {
  const Icon = feature.icon;

  return (
    <Card className="mm-card-interactive" padding="lg">
      <Stack gap="sm" h="100%">
        <ThemeIcon variant="light" size="lg" radius="md">
          <Icon size={20} stroke={1.75} />
        </ThemeIcon>
        <Title order={4}>{feature.title}</Title>
        <Text size="sm" c="dimmed" style={{ flex: 1 }}>
          {feature.description}
        </Text>
        <Button
          component={Link}
          to={feature.to}
          variant="subtle"
          size="compact-sm"
          justify="flex-start"
          px={0}
        >
          {feature.action} →
        </Button>
      </Stack>
    </Card>
  );
}
