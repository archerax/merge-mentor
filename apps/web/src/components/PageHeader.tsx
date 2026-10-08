import { Box, Group, Stack, Text, Title } from "@mantine/core";

interface PageHeaderProps {
  readonly title: string;
  readonly description?: React.ReactNode;
  readonly actions?: React.ReactNode;
}

/** Consistent page heading used across the workspace routes. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
      <Stack gap={4}>
        <Box
          w={44}
          h={4}
          mb={4}
          style={{
            borderRadius: 999,
            background:
              "linear-gradient(90deg, var(--mantine-color-accent-6), var(--mantine-color-brand-6))",
          }}
        />
        <Title order={2}>{title}</Title>
        {description && (
          <Text c="dimmed" maw={720}>
            {description}
          </Text>
        )}
      </Stack>
      {actions}
    </Group>
  );
}
